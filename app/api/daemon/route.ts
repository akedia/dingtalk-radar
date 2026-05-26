import { NextResponse } from 'next/server';
import { dwsDaemonStatus } from '@/lib/dws';
import { cache, CK } from '@/lib/cache';

export const dynamic = 'force-dynamic';

export async function GET() {
  let s = cache.get(CK.daemon()) as Awaited<ReturnType<typeof dwsDaemonStatus>> | undefined;
  if (!s) {
    s = await dwsDaemonStatus();
    cache.set(CK.daemon(), s, 30);
  }
  return NextResponse.json({ ok: true, ...s });
}
