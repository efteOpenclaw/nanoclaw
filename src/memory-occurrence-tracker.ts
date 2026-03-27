/**
 * Memory Occurrence Tracker
 *
 * Tracks occurrence counts of terms/concepts in agent corrections and memory.
 * Stored in git-tracked vault files per user decision.
 *
 * Format: agent/{name}/self-improving/occurrence-counter.md
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { vaultWriteQueue } from './vault-write-queue.js';

export interface OccurrenceWindow {
  start: string; // ISO date (YYYY-MM-DD)
  end: string; // ISO date (YYYY-MM-DD)
  counts: Record<string, number>;
}

export interface OccurrenceCounter {
  updated: string;
  windows: OccurrenceWindow[];
}

const COUNTER_FILENAME = 'occurrence-counter.md';
const WINDOW_SIZE_DAYS = 7;

/**
 * Parse occurrence counter from markdown
 */
function parseCounter(content: string): OccurrenceCounter {
  try {
    // Extract YAML frontmatter
    const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    if (!match) {
      return { updated: new Date().toISOString(), windows: [] };
    }

    const yamlText = match[1];
    const frontmatter: Record<string, unknown> = {};

    for (const line of yamlText.split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const value = line.slice(colonIdx + 1).trim();
        if (key === 'updated') {
          frontmatter[key] = value;
        }
        // windows is parsed from body
      }
    }

    // Parse windows from body (simplified - windows are in body as JSON for now)
    const body = match[2].trim();
    let windows: OccurrenceWindow[] = [];
    if (body) {
      try {
        windows = JSON.parse(body);
      } catch {
        windows = [];
      }
    }

    return {
      updated: (frontmatter.updated as string) || new Date().toISOString(),
      windows,
    };
  } catch (err) {
    logger.error({ err }, 'Failed to parse occurrence counter');
    return { updated: new Date().toISOString(), windows: [] };
  }
}

/**
 * Serialize counter to markdown
 */
function serializeCounter(counter: OccurrenceCounter): string {
  const yaml = `---\nupdated: ${counter.updated}\n---\n`;
  const body = JSON.stringify(counter.windows, null, 2);
  return yaml + '\n' + body + '\n';
}

/**
 * Load occurrence counter for an agent
 */
export function loadOccurrenceCounter(
  vaultRoot: string,
  agentName: string,
): OccurrenceCounter {
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    COUNTER_FILENAME,
  );
  const fullPath = path.join(vaultRoot, vaultPath);

  if (!fs.existsSync(fullPath)) {
    return { updated: new Date().toISOString(), windows: [] };
  }

  const content = fs.readFileSync(fullPath, 'utf-8');
  return parseCounter(content);
}

/**
 * Get or create current window
 */
function getCurrentWindow(counter: OccurrenceCounter): OccurrenceWindow {
  const today = new Date().toISOString().split('T')[0];

  // Find window containing today
  let window = counter.windows.find((w) => today >= w.start && today <= w.end);

  if (!window) {
    // Create new window
    const start = today;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + WINDOW_SIZE_DAYS);
    const end = endDate.toISOString().split('T')[0];

    window = { start, end, counts: {} };
    counter.windows.push(window);

    // Keep only last 4 windows (28 days)
    if (counter.windows.length > 4) {
      counter.windows = counter.windows.slice(-4);
    }
  }

  return window;
}

/**
 * Increment occurrence count for a term
 */
export async function incrementOccurrence(
  vaultRoot: string,
  agentName: string,
  term: string,
  commitMessage?: string,
): Promise<number> {
  const counter = loadOccurrenceCounter(vaultRoot, agentName);
  const window = getCurrentWindow(counter);

  // Increment count
  window.counts[term] = (window.counts[term] || 0) + 1;
  const newCount = window.counts[term];

  counter.updated = new Date().toISOString();

  // Write via queue
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    COUNTER_FILENAME,
  );

  vaultWriteQueue.enqueue({
    path: vaultPath,
    content: serializeCounter(counter),
    mode: 'overwrite',
    priority: 'P1',
    source: 'memory-occurrence-tracker',
    commitMessage:
      commitMessage || `track: "${term}" now at ${newCount} occurrences`,
  });

  logger.debug({ agentName, term, count: newCount }, 'Occurrence incremented');
  return newCount;
}

/**
 * Check if term qualifies for promotion
 */
export function checkPromotionEligibility(
  counter: OccurrenceCounter,
  term: string,
  threshold: number,
): { eligible: boolean; totalOccurrences: number; windowInfo: string } {
  let totalOccurrences = 0;
  const now = new Date();

  // Count occurrences in last 7 days
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 7);
  const cutoff = cutoffDate.toISOString().split('T')[0];

  for (const window of counter.windows) {
    if (window.end >= cutoff) {
      totalOccurrences += window.counts[term] || 0;
    }
  }

  const eligible = totalOccurrences >= threshold;

  return {
    eligible,
    totalOccurrences,
    windowInfo: `last 7 days (≥${threshold} needed)`,
  };
}

/**
 * Scan corrections.md for new occurrences
 */
export async function scanCorrectionsForOccurrences(
  vaultRoot: string,
  agentName: string,
): Promise<string[]> {
  const correctionsPath = path.join(
    vaultRoot,
    'agent',
    agentName,
    'self-improving',
    'corrections.md',
  );

  if (!fs.existsSync(correctionsPath)) {
    return [];
  }

  const content = fs.readFileSync(correctionsPath, 'utf-8');
  const terms: string[] = [];

  // Extract correction headers (## YYYY-MM-DD - description)
  const regex = /^##\s+\d{4}-\d{2}-\d{2}\s+-\s+(.+)$/gm;
  let match;

  while ((match = regex.exec(content)) !== null) {
    const description = match[1].toLowerCase();
    // Extract key terms (simplified - extract first 2-3 words)
    const keyTerms = description
      .split(/\s+/)
      .slice(0, 3)
      .join(' ')
      .replace(/[^\w\s]/g, '');
    if (keyTerms) {
      terms.push(keyTerms);
    }
  }

  logger.debug(
    { agentName, count: terms.length },
    'Scanned corrections for occurrences',
  );
  return terms;
}

/**
 * Initialize occurrence counter for an agent
 */
export async function initializeOccurrenceCounter(
  vaultRoot: string,
  agentName: string,
): Promise<void> {
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    COUNTER_FILENAME,
  );
  const fullPath = path.join(vaultRoot, vaultPath);

  if (fs.existsSync(fullPath)) {
    return;
  }

  const counter: OccurrenceCounter = {
    updated: new Date().toISOString(),
    windows: [],
  };

  vaultWriteQueue.enqueue({
    path: vaultPath,
    content: serializeCounter(counter),
    mode: 'overwrite',
    priority: 'P2',
    source: 'memory-occurrence-tracker',
    commitMessage: `track: initialize occurrence counter for ${agentName}`,
  });

  logger.info({ agentName }, 'Occurrence counter initialized');
}
