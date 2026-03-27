import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import type { RegisteredGroupRow, SessionRow } from '@/lib/types';

export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const db = getDb();
    const groups = db
      .prepare('SELECT * FROM registered_groups')
      .all() as RegisteredGroupRow[];
    const sessions = db
      .prepare('SELECT group_folder, session_id FROM sessions')
      .all() as SessionRow[];

    const sessionsMap: Record<string, string> = {};
    for (const s of sessions) {
      sessionsMap[s.group_folder] = s.session_id;
    }

    return NextResponse.json({ groups, sessions: sessionsMap });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'DB error' },
      { status: 500 },
    );
  }
}
