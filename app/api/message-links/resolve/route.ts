import { NextRequest, NextResponse } from 'next/server';
import { upsertResolvedLinkForMessage } from '@/lib/message-links';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    chatroom_id?: string;
    message_id?: string;
    url?: string;
    title?: string;
    description?: string;
    source?: 'public_search' | 'manual';
    confidence?: number;
  };

  if (!body.chatroom_id || !Number.isInteger(body.message_id) || !body.url) {
    return NextResponse.json(
      { ok: false, error: 'chatroom_id, message_id and url are required' },
      { status: 400 },
    );
  }

  const messageId = body.message_id;
  if (messageId === undefined) {
    return NextResponse.json({ ok: false, error: 'message_id is required' }, { status: 400 });
  }

  const source = body.source ?? 'manual';
  if (source !== 'manual' && source !== 'public_search') {
    return NextResponse.json({ ok: false, error: 'invalid source' }, { status: 400 });
  }

  const result = upsertResolvedLinkForMessage({
    chatroom_id: body.chatroom_id,
    message_id: messageId,
    url: body.url,
    title: body.title,
    description: body.description,
    source,
    confidence: body.confidence,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
