/**
 * SPEC-04/SPEC-15: Vault Write Queue
 *
 * Host-side write queue for all vault (Obsidian) file operations.
 * Ensures writes are serialised, git-committed, and git-pushed after
 * every successful write.
 *
 * Priority lanes (P0 highest → P3 lowest):
 *   P0 — critical system writes (invariants, emergency logs)
 *   P1 — agent memory and corrections
 *   P2 — kb, calendar, task updates
 *   P3 — routine logs and low-priority notes
 *
 * Protected (additive-only) paths — overwrite is rejected, append only:
 *   system/invariants.md
 *   agent/<any>/self-improving/corrections.md
 *   evolution/changelog.md
 *
 * Usage:
 *   import { vaultWriteQueue } from './vault-write-queue.js';
 *   vaultWriteQueue.enqueue({ priority: 'P1', path: 'agent/okti/hot-memory.md',
 *     content: '...', mode: 'overwrite', source: 'host:boot' });
 */

import { exec } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import {
  VaultWriteDeadLetterEntry,
  VaultWritePriority,
  VaultWriteRequest,
} from './types.js';

const execAsync = promisify(exec);

const RETRY_DELAYS_MS = [2000, 5000, 10000];

// Patterns that only accept append mode — never overwrite
const ADDITIVE_ONLY_PATTERNS: RegExp[] = [
  /^system\/invariants\.md$/,
  /^agent\/[^/]+\/self-improving\/corrections\.md$/,
  /^evolution\/changelog\.md$/,
];

function isAdditiveOnly(relPath: string): boolean {
  return ADDITIVE_ONLY_PATTERNS.some((re) => re.test(relPath));
}

function resolveVaultPath(): string {
  const env = readEnvFile(['VAULT_PATH']);
  const raw = env['VAULT_PATH'];
  if (!raw) throw new Error('VAULT_PATH is not set in .env');
  return raw.startsWith('~/') ? path.join(os.homedir(), raw.slice(2)) : path.resolve(raw);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class VaultWriteQueue {
  private lanes: Record<VaultWritePriority, VaultWriteRequest[]> = {
    P0: [],
    P1: [],
    P2: [],
    P3: [],
  };
  private deadLetter: VaultWriteDeadLetterEntry[] = [];
  private processing = false;

  /**
   * Enqueue a vault write request.
   * Automatically starts draining if the queue is idle.
   */
  enqueue(req: Omit<VaultWriteRequest, 'id' | 'requestedAt'>): void {
    const full: VaultWriteRequest = {
      ...req,
      id: crypto.randomUUID(),
      requestedAt: new Date(),
    };
    this.lanes[full.priority].push(full);
    logger.debug(
      { id: full.id, priority: full.priority, path: full.path, source: full.source },
      'vault-write-queue: enqueued',
    );
    if (!this.processing) {
      this.drain().catch((err) =>
        logger.error({ err }, 'vault-write-queue: drain error'),
      );
    }
  }

  /** Process all pending requests, highest priority first. */
  async drain(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      let req: VaultWriteRequest | null;
      while ((req = this.dequeue()) !== null) {
        await this.processOne(req);
      }
    } finally {
      this.processing = false;
    }
  }

  /** Returns the highest-priority pending request, or null if all lanes empty. */
  private dequeue(): VaultWriteRequest | null {
    for (const priority of ['P0', 'P1', 'P2', 'P3'] as VaultWritePriority[]) {
      if (this.lanes[priority].length > 0) {
        return this.lanes[priority].shift()!;
      }
    }
    return null;
  }

  private async processOne(req: VaultWriteRequest): Promise<void> {
    let lastError = '';
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        await this.executeWrite(req);
        logger.info(
          { id: req.id, path: req.path, source: req.source, attempt },
          'vault-write-queue: write committed',
        );
        return;
      } catch (err: unknown) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn(
          { id: req.id, path: req.path, attempt, err: lastError },
          'vault-write-queue: write failed, retrying',
        );
        if (attempt < RETRY_DELAYS_MS.length) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }
    // All attempts exhausted — move to dead-letter
    this.deadLetter.push({
      request: req,
      error: lastError,
      failedAt: new Date(),
      attempts: RETRY_DELAYS_MS.length + 1,
    });
    logger.error(
      { id: req.id, path: req.path, error: lastError },
      'vault-write-queue: write moved to dead-letter after all retries',
    );
  }

  private async executeWrite(req: VaultWriteRequest): Promise<void> {
    const vaultRoot = resolveVaultPath();
    this.validatePath(req.path, req.mode, vaultRoot);

    const fullPath = path.join(vaultRoot, req.path);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });

    if (req.mode === 'overwrite') {
      fs.writeFileSync(fullPath, req.content, 'utf-8');
    } else {
      fs.appendFileSync(fullPath, req.content, 'utf-8');
    }

    const commitMsg = req.commitMessage ?? `vault: write ${req.path}`;
    await this.gitCommitPush(vaultRoot, req.path, commitMsg);
  }

  private validatePath(relPath: string, mode: 'overwrite' | 'append', vaultRoot: string): void {
    if (!relPath || relPath.trim() === '') {
      throw new Error('vault-write-queue: path must not be empty');
    }
    if (path.isAbsolute(relPath)) {
      throw new Error(`vault-write-queue: path must be relative, got "${relPath}"`);
    }
    if (relPath.includes('..')) {
      throw new Error(`vault-write-queue: path traversal detected in "${relPath}"`);
    }
    // Ensure resolved path stays within vault
    const resolved = path.resolve(vaultRoot, relPath);
    if (!resolved.startsWith(vaultRoot + path.sep) && resolved !== vaultRoot) {
      throw new Error(`vault-write-queue: path escapes vault root: "${relPath}"`);
    }
    // Additive-only protection
    if (mode === 'overwrite' && isAdditiveOnly(relPath)) {
      throw new Error(
        `vault-write-queue: "${relPath}" is additive-only — use mode "append"`,
      );
    }
  }

  private async gitCommitPush(vaultRoot: string, relPath: string, msg: string): Promise<void> {
    // Stage the specific file
    await execAsync(`git -C "${vaultRoot}" add "${relPath}"`);

    // Check if there's actually something to commit
    const { stdout: statusOut } = await execAsync(
      `git -C "${vaultRoot}" status --porcelain "${relPath}"`,
    );
    if (!statusOut.trim()) {
      // File content unchanged — nothing to commit or push
      logger.debug({ relPath }, 'vault-write-queue: no changes to commit, skipping');
      return;
    }

    await execAsync(`git -C "${vaultRoot}" commit -m ${JSON.stringify(msg)}`);
    await execAsync(`git -C "${vaultRoot}" push origin main`);
  }

  getDeadLetter(): VaultWriteDeadLetterEntry[] {
    return [...this.deadLetter];
  }

  clearDeadLetter(): void {
    this.deadLetter = [];
  }
}

export const vaultWriteQueue = new VaultWriteQueue();
