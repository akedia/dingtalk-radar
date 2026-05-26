import { NextResponse } from 'next/server';
import { dwsSessions } from '@/lib/dws';
import type { DwsSession } from '@/lib/dws-types';
import { listGroups, listAllTags, listFavorites, listAliases } from '@/lib/groups';
import { effectiveGroupIds } from '@/lib/group-classifier';
import { db } from '@/lib/db';
import { readConfig } from '@/lib/config';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const sessions = await loadSessions();

    const groups = listGroups();
    const tags = listAllTags();
    const favorites = new Set(listFavorites());
    const aliases = listAliases();

    const tagsByChatroom = new Map<string, number[]>();
    for (const t of tags) {
      const arr = tagsByChatroom.get(t.chatroom_id) ?? [];
      arr.push(t.group_id);
      tagsByChatroom.set(t.chatroom_id, arr);
    }

    const groupsList = sessions.filter((s) => s.is_group);

    const enriched = groupsList.map((s) => {
      const displayName = aliases.get(s.username) ?? s.chat ?? s.username;
      const groupIds = effectiveGroupIds(
        displayName,
        s.summary,
        tagsByChatroom.get(s.username) ?? [],
        groups,
      );
      return {
        chatroom_id: s.username,
        name: displayName,
        last_msg_type: s.last_msg_type,
        last_sender: s.last_sender,
        summary: s.summary,
        time: s.time,
        timestamp: s.timestamp,
        unread: s.unread,
        is_favorite: favorites.has(s.username),
        group_ids: groupIds,
      };
    });

    const memberCounts = new Map<number, number>();
    for (const g of enriched) {
      for (const groupId of g.group_ids) {
        memberCounts.set(groupId, (memberCounts.get(groupId) ?? 0) + 1);
      }
    }
    const categories = groups.map((g) => ({
      ...g,
      member_count: memberCounts.get(g.id) ?? 0,
    }));

    return NextResponse.json({
      ok: true,
      total: groupsList.length,
      groups: enriched,
      categories,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown error';
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

async function loadSessions(): Promise<DwsSession[]> {
  const cfg = readConfig();
  if (cfg.demoMode) return listLocalSessionsFallback(500);

  // dws has no global session list; we union (a) configured trackedGroups and
  // (b) every chatroom we've ever ingested into the local DB.
  const tracked = cfg.trackedGroups ?? [];
  const stubs = await dwsSessions(tracked);
  const known = listLocalSessionsFallback(500);
  const byId = new Map<string, DwsSession>();
  for (const s of stubs) byId.set(s.username, s);
  for (const s of known) {
    const existing = byId.get(s.username);
    if (existing) {
      // local DB knows the most recent message metadata; prefer it
      byId.set(s.username, { ...existing, ...s, is_group: true });
    } else {
      byId.set(s.username, s);
    }
  }
  return Array.from(byId.values());
}

function listLocalSessionsFallback(limit: number): DwsSession[] {
  const rows = db()
    .prepare(
      `
      SELECT m.chatroom_id, m.sender, m.content, m.time, m.timestamp, m.type
      FROM messages m
      JOIN (
        SELECT chatroom_id, MAX(timestamp) AS timestamp
        FROM messages
        GROUP BY chatroom_id
      ) latest
        ON latest.chatroom_id = m.chatroom_id
       AND latest.timestamp = m.timestamp
      GROUP BY m.chatroom_id
      ORDER BY m.timestamp DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    chatroom_id: string;
    sender: string;
    content: string;
    time: string;
    timestamp: number;
    type: string;
  }>;

  return rows.map((r) => ({
    chat: r.chatroom_id,
    chat_type: 'group',
    is_group: true,
    last_msg_type: r.type,
    last_sender: r.sender,
    summary: r.content,
    time: r.time,
    timestamp: r.timestamp,
    unread: 0,
    username: r.chatroom_id,
  }));
}
