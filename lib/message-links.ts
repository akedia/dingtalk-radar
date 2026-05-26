import { db } from './db';
import type { MessageRow } from './messages-store';

export type MessageLinkSource = 'dingtalk_card' | 'plain_url' | 'public_search' | 'manual';

export interface ParsedMessageLink {
  url: string;
  canonical_url: string;
  title: string | null;
  description: string | null;
  domain: string;
  source: MessageLinkSource;
  raw_kind: string;
  confidence: number;
}

type LinkInput = Pick<
  MessageRow,
  'chatroom_id' | 'message_id' | 'date' | 'sender' | 'content' | 'time' | 'timestamp'
>;

export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num: string) => String.fromCodePoint(Number.parseInt(num, 10)));
}

export function cleanUrl(raw: string): string {
  return decodeHtmlEntities(raw)
    .replace(/[),，。；;!?！？、\]}>]+$/g, '')
    .replace(/\.{3,}$/g, '')
    .trim();
}

export function normalizeUrl(raw: string): string | null {
  if (!raw || raw.includes('...') || raw.includes('…')) return null;
  try {
    const u = new URL(cleanUrl(raw));
    u.hash = '';
    for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm']) {
      u.searchParams.delete(key);
    }
    return u.toString();
  } catch {
    return null;
  }
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// DingTalk rich-card message payloads (rendered to text by dws.ts) carry
// `"url":"..."` and friends. Detect those so we can tag the link source as
// `dingtalk_card` instead of plain text.
const JSON_URL_KEYS = [
  'url',
  'messageUrl',
  'pcMessageUrl',
  'detailUrl',
  'webUrl',
  'mediaUrl',
];

function extractCardUrls(content: string): Array<{ url: string; key: string }> {
  const out: Array<{ url: string; key: string }> = [];
  for (const key of JSON_URL_KEYS) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:https?:)?\\/\\/[^"]+)"`, 'gi');
    for (const m of content.matchAll(re)) out.push({ url: m[1], key });
  }
  return out;
}

function extractCardTitle(content: string): string | null {
  for (const key of ['title', 'subject', 'text']) {
    const m = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (m && m[1].trim()) return m[1].trim().slice(0, 160);
  }
  return null;
}

function extractCardDescription(content: string): string | null {
  for (const key of ['text', 'content', 'desc', 'description', 'singleTitle']) {
    const m = content.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    if (m && m[1].trim()) return m[1].trim().slice(0, 240);
  }
  return null;
}

export function extractMessageLinks(content: string): ParsedMessageLink[] {
  if (!content) return [];
  const decoded = decodeHtmlEntities(content);
  const looksLikeJson = /["{]/.test(decoded) && /"[a-z]+"\s*:/i.test(decoded);
  const cardTitle = looksLikeJson ? extractCardTitle(decoded) : null;
  const cardDesc = looksLikeJson ? extractCardDescription(decoded) : null;

  const candidates: Array<{ url: string; source: MessageLinkSource; raw_kind: string; confidence: number }> = [];

  if (looksLikeJson) {
    for (const c of extractCardUrls(decoded)) {
      candidates.push({
        url: c.url,
        source: 'dingtalk_card',
        raw_kind: `card_${c.key}`,
        confidence: 0.98,
      });
    }
  }

  for (const m of decoded.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const rawUrl = cleanUrl(m[0]);
    candidates.push({
      url: rawUrl,
      source: looksLikeJson ? 'dingtalk_card' : 'plain_url',
      raw_kind: looksLikeJson ? 'card_text_url' : 'plain_url',
      confidence: 0.9,
    });
  }

  const out = new Map<string, ParsedMessageLink>();
  for (const c of candidates) {
    const canonical = normalizeUrl(c.url);
    if (!canonical) continue;
    const domain = domainOf(canonical);
    if (!domain) continue;
    const existing = out.get(canonical);
    if (existing && existing.confidence >= c.confidence) continue;
    out.set(canonical, {
      url: cleanUrl(c.url),
      canonical_url: canonical,
      title: cardTitle,
      description: cardDesc,
      domain,
      source: c.source,
      raw_kind: c.raw_kind,
      confidence: c.confidence,
    });
  }

  return Array.from(out.values());
}

const upsertMessageLink = () =>
  db().prepare(`
    INSERT INTO message_links (
      chatroom_id, message_id, date, sender, time, timestamp,
      url, canonical_url, title, description, domain, source, raw_kind, confidence, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(chatroom_id, message_id, canonical_url) DO UPDATE SET
      url = excluded.url,
      title = COALESCE(excluded.title, message_links.title),
      description = COALESCE(excluded.description, message_links.description),
      domain = excluded.domain,
      source = excluded.source,
      raw_kind = excluded.raw_kind,
      confidence = excluded.confidence
  `);

export function upsertLinksForMessage(message: LinkInput): number {
  const links = extractMessageLinks(message.content);
  if (links.length === 0) return 0;
  const stmt = upsertMessageLink();
  let changed = 0;
  for (const link of links) {
    const r = stmt.run(
      message.chatroom_id,
      message.message_id,
      message.date,
      message.sender ?? '',
      message.time ?? '',
      message.timestamp ?? 0,
      link.url,
      link.canonical_url,
      link.title,
      link.description,
      link.domain,
      link.source,
      link.raw_kind,
      link.confidence,
      Date.now(),
    );
    changed += r.changes;
  }
  return changed;
}

export function upsertResolvedLinkForMessage(input: {
  chatroom_id: string;
  message_id: string;
  url: string;
  title?: string | null;
  description?: string | null;
  source: Extract<MessageLinkSource, 'public_search' | 'manual'>;
  confidence?: number;
}): { ok: boolean; error?: string } {
  const message = db()
    .prepare(
      `SELECT chatroom_id, message_id, sender, content, time, timestamp, type, date
       FROM messages
       WHERE chatroom_id = ? AND message_id = ?`,
    )
    .get(input.chatroom_id, input.message_id) as MessageRow | undefined;

  if (!message) return { ok: false, error: 'message not found' };

  const canonical = normalizeUrl(input.url);
  if (!canonical) return { ok: false, error: 'invalid url' };

  const domain = domainOf(canonical);
  if (!domain) return { ok: false, error: 'invalid domain' };

  upsertMessageLink().run(
    message.chatroom_id,
    message.message_id,
    message.date,
    message.sender ?? '',
    message.time ?? '',
    message.timestamp ?? 0,
    cleanUrl(input.url),
    canonical,
    input.title?.trim() || extractCardTitle(message.content),
    input.description?.trim() || null,
    domain,
    input.source,
    input.source,
    input.confidence ?? (input.source === 'manual' ? 0.95 : 0.72),
    Date.now(),
  );

  return { ok: true };
}

export function backfillMessageLinks(since?: string, until?: string): { scanned: number; links: number } {
  const clauses = ["(content LIKE '%http%' OR content LIKE '%\"url\"%')"];
  const params: string[] = [];
  if (since) {
    clauses.push('date >= ?');
    params.push(since);
  }
  if (until) {
    clauses.push('date <= ?');
    params.push(until);
  }

  const rows = db()
    .prepare(
      `SELECT chatroom_id, message_id, sender, content, time, timestamp, type, date
       FROM messages
       WHERE ${clauses.join(' AND ')}
       ORDER BY timestamp DESC`,
    )
    .all(...params) as MessageRow[];

  let links = 0;
  const tx = db().transaction(() => {
    for (const row of rows) links += upsertLinksForMessage(row);
  });
  tx();
  return { scanned: rows.length, links };
}
