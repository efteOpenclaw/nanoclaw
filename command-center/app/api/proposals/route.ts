import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { PromotionProposalRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);

    const db = getDb();
    let rows: PromotionProposalRow[];

    if (statusFilter) {
      rows = db
        .prepare(
          'SELECT * FROM promotion_proposals WHERE status = ? ORDER BY proposed_at DESC LIMIT ?',
        )
        .all(statusFilter, limit) as PromotionProposalRow[];
    } else {
      rows = db
        .prepare(
          'SELECT * FROM promotion_proposals ORDER BY proposed_at DESC LIMIT ?',
        )
        .all(limit) as PromotionProposalRow[];
    }

    return NextResponse.json({ proposals: rows });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 },
    );
  }
}
