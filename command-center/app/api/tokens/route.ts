import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { TokenUsageLogRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const groupId = url.searchParams.get('group_id');
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);

    const db = getDb();
    let rows: TokenUsageLogRow[];

    if (groupId) {
      rows = db
        .prepare(
          'SELECT * FROM token_usage_logs WHERE group_id = ? ORDER BY recorded_at DESC LIMIT ?',
        )
        .all(groupId, limit) as TokenUsageLogRow[];
    } else {
      rows = db
        .prepare(
          'SELECT * FROM token_usage_logs ORDER BY recorded_at DESC LIMIT ?',
        )
        .all(limit) as TokenUsageLogRow[];
    }

    return NextResponse.json({ logs: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 },
    );
  }
}
