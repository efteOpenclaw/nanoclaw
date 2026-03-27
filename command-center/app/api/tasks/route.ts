import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { ScheduledTaskRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const db = getDb();
    const tasks = db
      .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
      .all() as ScheduledTaskRow[];

    return NextResponse.json({ tasks });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 },
    );
  }
}
