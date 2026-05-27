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
  // dws v1.0.26 returns createTime as a date string "yyyy-MM-dd HH:mm:ss";
  // earlier docs implied ms epoch. Handle both. Downstream stores seconds.
  let ts = 0;
  const createTimeRaw = obj['createTime'] ?? obj['createTimestamp'] ?? obj['sendTime'] ?? obj['timestamp'] ?? obj['msgTimestamp'];
  if (typeof createTimeRaw === 'number' && Number.isFinite(createTimeRaw)) {
    ts = createTimeRaw;
  } else if (typeof createTimeRaw === 'string' && createTimeRaw) {
    // Interpret "yyyy-MM-dd HH:mm:ss" as Asia/Shanghai (DingTalk's home tz).
    const m = createTimeRaw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const utcMs = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 8, +m[5], +m[6]);
      ts = Math.floor(utcMs / 1000);
    } else {
      const parsed = Date.parse(createTimeRaw);
      if (Number.isFinite(parsed)) ts = Math.floor(parsed / 1000);
    }
  }
  if (ts > 1e12) ts = Math.floor(ts / 1000);
  const sender = pickString(obj, 'senderName', 'senderNick', 'sender', 'senderUserName');
  const sender_id = pickString(
    obj,
    'senderId',
    'senderUserId',
    'senderStaffId',
    'openSenderId',
    'senderOpenDingTalkId',
  );
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

// Pulls group messages in a [since, until] window using dws's
// `chat message list`. The API returns messages in descending createTime
// order; we paginate BACKWARDS from `until` with --forward=false, using the
// oldest message in each page as the next cursor.
// Parses a "yyyy-MM-dd" or "yyyy-MM-dd HH:mm:ss" string as Asia/Shanghai local
// time and returns Unix seconds. Bare dates use start-of-day for `since` and
// end-of-day for `until`, mirroring DingTalk's calendar-day semantics.
function parseShanghaiSeconds(input: string, role: 'since' | 'until'): number {
  if (!input) return NaN;
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  if (dateOnly) {
    const [, y, mo, d] = dateOnly;
    const h = role === 'until' ? 23 : 0;
    const mi = role === 'until' ? 59 : 0;
    const s = role === 'until' ? 59 : 0;
    return Math.floor(Date.UTC(+y, +mo - 1, +d, h - 8, mi, s) / 1000);
  }
  const full = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(input);
  if (full) {
    const [, y, mo, d, h, mi, s] = full;
    return Math.floor(Date.UTC(+y, +mo - 1, +d, +h - 8, +mi, +s) / 1000);
  }
  const parsed = Date.parse(input);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : NaN;
}

function shanghaiDateTimeString(input: string, role: 'since' | 'until'): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return role === 'until' ? `${input} 23:59:59` : `${input} 00:00:00`;
  }
  return input;
}

export async function dwsHistory(
  group: string,
  since: string,
  until: string,
  // The original wx-cli wrapper accepted up to 50_000 in a single call. dws
  // enforces a much smaller per-page cap (~100); we paginate to reach the
  // caller's intended total.
  totalLimit = 5000,
  pageLimit = 100,
): Promise<DwsMessage[]> {
  const cappedPageLimit = Math.max(1, Math.min(pageLimit, 100));
  const maxMessages = Math.max(cappedPageLimit, totalLimit);
  const sinceSec = parseShanghaiSeconds(since, 'since');
  const untilSec = parseShanghaiSeconds(until, 'until');
  if (!Number.isFinite(sinceSec) || !Number.isFinite(untilSec)) {
    throw new Error(`dwsHistory: bad time range ${since} ${until}`);
  }
  const out: DwsMessage[] = [];
  const seen = new Set<string>();
  // dws expects "yyyy-MM-dd HH:mm:ss" in Shanghai local time; pad bare dates.
  let cursor = shanghaiDateTimeString(until, 'until');
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
      String(cappedPageLimit),
      // cobra bool flag: only `--forward=false` syntax sets it to false;
      // `--forward false` would treat "false" as a positional arg.
      '--forward=false',
    ]);
    const items = unwrapList(raw);
    if (items.length === 0) break;
    let pageMin = Number.POSITIVE_INFINITY;
    let pageMax = 0;
    let added = 0;
    for (const entry of items) {
      const msg = parseMessage(entry);
      if (!msg || seen.has(msg.message_id)) continue;
      if (msg.timestamp <= 0) continue;
      if (msg.timestamp < sinceSec || msg.timestamp > untilSec) {
        if (msg.timestamp < pageMin) pageMin = msg.timestamp;
        if (msg.timestamp > pageMax) pageMax = msg.timestamp;
        continue;
      }
      seen.add(msg.message_id);
      out.push(msg);
      added += 1;
      if (msg.timestamp < pageMin) pageMin = msg.timestamp;
      if (msg.timestamp > pageMax) pageMax = msg.timestamp;
    }
    const hasMore =
      raw && typeof raw === 'object' && (raw as Record<string, unknown>)['hasMore'] === true;
    // Stop once the page's oldest message is already older than `since` — we've covered the window.
    if (!hasMore || added === 0 || pageMin <= sinceSec || out.length >= maxMessages) {
      // Allow one more page if we did add some messages but did not yet cross `since`.
      if (hasMore && added > 0 && pageMin > sinceSec && out.length < maxMessages) {
        cursor = toIsoTime(pageMin - 1) || cursor;
        continue;
      }
      break;
    }
    cursor = toIsoTime(pageMin - 1) || cursor;
  }
  out.sort((a, b) => a.timestamp - b.timestamp);
  return out;
}

export interface DwsConversationBundle {
  open_conversation_id: string;
  title: string;
  is_group: boolean;
  messages: DwsMessage[];
}

// Pulls every conversation (groups + DMs) in [since, until] via the cross-
// conversation `list-all` endpoint. Returns one bundle per conversation
// envelope so callers can auto-discover new chatrooms and save aliases.
export async function dwsHistoryAll(
  since: string,
  until: string,
  pageLimit = 100,
  maxPages = 50,
): Promise<DwsConversationBundle[]> {
  const sinceStr = shanghaiDateTimeString(since, 'since');
  const untilStr = shanghaiDateTimeString(until, 'until');
  const cappedPageLimit = Math.max(1, Math.min(pageLimit, 100));
  const bundles = new Map<string, DwsConversationBundle>();
  let cursor = '0';
  let safety = 0;
  while (safety < maxPages) {
    safety += 1;
    const raw = await dwsJson<unknown>([
      'chat',
      'message',
      'list-all',
      '--start',
      sinceStr,
      '--end',
      untilStr,
      '--limit',
      String(cappedPageLimit),
      '--cursor',
      cursor,
    ]);
    const result =
      raw && typeof raw === 'object' ? (raw as Record<string, unknown>)['result'] : null;
    const envelopes = ((result && typeof result === 'object'
      ? (result as Record<string, unknown>)['conversationMessagesList']
      : null) ?? []) as unknown[];
    let addedAny = false;
    for (const env of envelopes) {
      if (!env || typeof env !== 'object') continue;
      const e = env as Record<string, unknown>;
      const cid = pickString(e, 'openConversationId', 'open_conversation_id', 'id');
      if (!cid) continue;
      const title = pickString(e, 'title', 'chatName', 'name');
      const singleChat = Boolean(e['singleChat']);
      const rawMessages = (e['messages'] ?? []) as unknown[];
      const bundle =
        bundles.get(cid) ??
        ({
          open_conversation_id: cid,
          title,
          is_group: !singleChat,
          messages: [],
        } as DwsConversationBundle);
      const seen = new Set(bundle.messages.map((m) => m.message_id));
      for (const entry of rawMessages) {
        const msg = parseMessage(entry);
        if (!msg || seen.has(msg.message_id)) continue;
        bundle.messages.push(msg);
        seen.add(msg.message_id);
        addedAny = true;
      }
      if (title && !bundle.title) bundle.title = title;
      bundles.set(cid, bundle);
    }
    const hasMore =
      result && typeof result === 'object' && (result as Record<string, unknown>)['hasMore'] === true;
    const nextCursor =
      result && typeof result === 'object'
        ? (result as Record<string, unknown>)['nextCursor']
        : null;
    if (!hasMore || !addedAny || nextCursor === null || nextCursor === undefined) break;
    cursor = String(nextCursor);
    if (!cursor || cursor === '0') break;
  }
  // sort each bundle ascending
  for (const b of bundles.values()) b.messages.sort((a, b) => a.timestamp - b.timestamp);
  return Array.from(bundles.values());
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
