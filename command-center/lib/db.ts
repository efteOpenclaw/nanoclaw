import Database from 'better-sqlite3';
import path from 'path';

let _db: Database.Database | null = null;

/**
 * Open the nanoclaw SQLite database in READ-ONLY mode.
 *
 * Path resolution:
 *   1. NANOCLAW_STORE_PATH env var (set by /build-command-center slash command)
 *   2. Default: ../store/messages.db relative to command-center/
 */
export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath =
    process.env.NANOCLAW_STORE_PATH ||
    path.resolve(process.cwd(), '..', 'store', 'messages.db');

  _db = new Database(dbPath, { readonly: true, fileMustExist: true });
  return _db;
}

/** Status API base URL (host process on port 3001). */
export const STATUS_API =
  process.env.NANOCLAW_STATUS_API || 'http://127.0.0.1:3001';
