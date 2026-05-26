import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  DwsDaemonStatus,
  DwsGroupSearchResult,
  DwsMember,
  DwsMessage,
  DwsNewMessage,
  DwsSession,
  DwsStats,
} from './dws-types';

const run = promisify(execFile);

type ExecOpts = { maxBuffer?: number; timeout?: number };

const DEFAULT_OPTS: ExecOpts = {
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120_000,
};

const DWS_BIN = process.env.DINGTALK_RADAR_DWS_BIN || 'dws';

async function dwsRaw(args: string[], opts: ExecOpts = DEFAULT_OPTS): Promise<string> {
  const { stdout } = await run(DWS_BIN, args, opts);
  return stdout;
}

async function dwsJson<T>(args: string[], opts: ExecOpts = DEFAULT_OPTS): Promise<T> {
  const stdout = await dwsRaw([...args, '--format', 'json'], opts);
  return JSON.parse(stdout) as T;
}

// dws responses come in slightly different envelopes per command. Normalise
// the array shape so callers can iterate uniformly.
function unwrapList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    for (const key of ['list', 'items', 'data', 'result', 'records', 'messages', 'groups', 'users', 'members']) {
      const v = obj[key];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const inner = unwrapList(v);
        if (inner.length || key === 'data' || key === 'result') return inner;
      }
    }
  }
  return [];
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return '';
}

function pickNumber(obj: Record<string, unknown>, ...keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function toIsoTime(ts: number, fallback?: string): string {
  if (ts > 0) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  }
  return fallback || '';
}


// ----------------------- public commands -----------------------

export async function dwsAvailable(): Promise<boolean> {
  try {
    await run(DWS_BIN, ['--version'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function dwsDaemonStatus(): Promise<DwsDaemonStatus> {
  try {
    const out = await dwsRaw(['--version'], { timeout: 5_000 });
    return { running: true, version: out.trim().split('\n')[0] };
  } catch {
    return { running: false };
  }
}

// dws does not expose a global "session list". We approximate by returning
// the locally-tracked groups; callers should reconcile with `dwsSearchGroups`.
export async function dwsSessions(trackedGroups: string[]): Promise<DwsSession[]> {
  return trackedGroups.map((id) => ({
    chat: id,
    chat_type: 'group' as const,
    is_group: true,
    last_msg_type: '',
    last_sender: '',
    summary: '',
    time: '',
    timestamp: 0,
    unread: 0,
    username: id,
  }));
}

export async function dwsSearchGroups(query: string): Promise<DwsGroupSearchResult[]> {
  const raw = await dwsJson<unknown>(['chat', 'search', '--query', query]);
  const items = unwrapList(raw);
  return items.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const obj = entry as Record<string, unknown>;
    const id = pickString(obj, 'openConversationId', 'open_conversation_id', 'id', 'conversationId');
    if (!id) return [];
    return [
      {
        open_conversation_id: id,
        name: pickString(obj, 'title', 'name', 'groupName', 'chatName'),
        owner: pickString(obj, 'owner', 'ownerUserId', 'ownerName') || undefined,
        member_count: pickNumber(obj, 'memberCount', 'member_count') || undefined,
      },
    ];
  });
}

function parseMessage(entry: unknown): DwsMessage | null {
  if (!entry || typeof entry !== 'object') return null;
  const obj = entry as Record<string, unknown>;
  const message_id = pickString(
    obj,
    'msgId',
    'openMsgId',
    'messageId',
    'openMessageId',
    'msgUuid',
    'id',
  );
  if (!message_id) return null;
  // dws normally returns createTime in ms; downstream stores seconds.
  let ts = pickNumber(obj, 'createTime', 'createTimestamp', 'sendTime', 'timestamp', 'msgTimestamp');
  if (ts > 1e12) ts = Math.floor(ts / 1000);
  const sender = pickString(obj, 'senderName', 'senderNick', 'sender', 'senderUserName');
  const sender_id = pickString(obj, 'senderId', 'senderUserId', 'senderStaffId', 'openSenderId');
  const type = pickString(obj, 'msgType', 'type', 'messageType') || 'text';
  const contentRaw = obj['text'] ?? obj['content'] ?? obj['msgContent'];
  let content = '';
  if (typeof contentRaw === 'string') {
    content = contentRaw;
  } else if (contentRaw && typeof contentRaw === 'object') {
    const c = contentRaw as Record<string, unknown>;
    content =
      pickString(c, 'content', 'text', 'title', 'desc') ||
      JSON.stringify(contentRaw);
  } else {
    content = pickString(obj, 'text', 'plainText') || '';
  }
  const time = toIsoTime(ts, pickString(obj, 'createTimeStr', 'time'));
  const open_conv_thread_id = pickString(obj, 'openConvThreadId') || undefined;
  return {
    message_id,
    sender: sender || sender_id || 'unknown',
    sender_id: sender_id || undefined,
    content,
    time,
    timestamp: ts,
    type,
    open_conv_thread_id,
    raw: entry,
  };
}

// Pulls group messages in a [since, until] window using dws's forward-paged
// `message list` (PC only). Pages are stitched by re-issuing with the boundary
// createTime until hasMore=false or we cross `until`.
export async function dwsHistory(
  group: string,
  since: string,
  until: string,
  pageLimit = 500,
  maxMessages = 5000,
): Promise<DwsMessage[]> {
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);
  if (!Number.isFinite(sinceMs) || !Number.isFinite(untilMs)) {
    throw new Error(`dwsHistory: bad time range ${since} ${until}`);
  }
  const out: DwsMessage[] = [];
  const seen = new Set<string>();
  let cursor = since;
  let safety = 0;
  while (safety < 200) {
    safety += 1;
    const raw = await dwsJson<unknown>([
      'chat',
      'message',
      'list',
      '--group',
      group,
      '--time',
      cursor,
      '--limit',
      String(pageLimit),
      '--forward',
      'true',
    ]);
    const items = unwrapList(raw);
    if (items.length === 0) break;
    let advanced = false;
    let pageMax = sinceMs;
    for (const entry of items) {
      const msg = parseMessage(entry);
      if (!msg || seen.has(msg.message_id)) continue;
      if (msg.timestamp > untilMs) continue;
      seen.add(msg.message_id);
      out.push(msg);
      if (msg.timestamp > pageMax) pageMax = msg.timestamp;
      advanced = true;
    }
    const hasMore =
      raw && typeof raw === 'object' && (raw as Record<string, unknown>)['hasMore'] === true;
    if (!hasMore || !advanced || out.length >= maxMessages) break;
    cursor = toIsoTime(pageMax + 1) || cursor;
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

export async function dwsStats(
  group: string,
  since: string,
  until: string,
): Promise<DwsStats> {
  // dws has no native stats endpoint; aggregate locally from history.
  const msgs = await dwsHistory(group, since, until);
  const byHourMap = new Map<number, number>();
  const bySenderMap = new Map<string, number>();
  const byTypeMap = new Map<string, number>();
  for (const m of msgs) {
    const hour = m.timestamp > 0 ? new Date(m.timestamp > 1e12 ? m.timestamp : m.timestamp * 1000).getHours() : 0;
    byHourMap.set(hour, (byHourMap.get(hour) || 0) + 1);
    bySenderMap.set(m.sender, (bySenderMap.get(m.sender) || 0) + 1);
    byTypeMap.set(m.type, (byTypeMap.get(m.type) || 0) + 1);
  }
  return {
    chat: group,
    chat_type: 'group',
    is_group: true,
    username: group,
    total: msgs.length,
    by_hour: Array.from(byHourMap.entries())
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour - b.hour),
    by_type: Array.from(byTypeMap.entries())
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
    top_senders: Array.from(bySenderMap.entries())
      .map(([sender, count]) => ({ sender, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20),
  };
}

// dws has no push/poll new-messages endpoint. We expose a stub so the rescan
// flow uses dwsHistory exclusively. Streaming arrivals are out of scope here.
export async function dwsNewMessages(): Promise<DwsNewMessage[]> {
  return [];
}

export async function dwsMembers(group: string): Promise<DwsMember[]> {
  try {
    const raw = await dwsJson<unknown>(['chat', 'group', 'members', '--id', group]);
    const items = unwrapList(raw);
    return items.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const obj = entry as Record<string, unknown>;
      const userId = pickString(obj, 'userId', 'staffId', 'openUserId', 'id');
      if (!userId) return [];
      return [
        {
          username: userId,
          nickname: pickString(obj, 'nick', 'nickname') || undefined,
          display_name: pickString(obj, 'displayName', 'name') || undefined,
        },
      ];
    });
  } catch {
    return [];
  }
}
