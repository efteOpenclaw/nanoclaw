/**
 * Token Monitor - Pre-Compaction Flush
 *
 * Monitors token usage during agent sessions.
 * When approaching the reserve floor (40K tokens),
 * triggers silent write to HOT memory before compaction.
 *
 * Per SPEC-06: "if it only exists in chat, it does not exist"
 */

import { logger } from './logger.js';
import { vaultWriteQueue } from './vault-write-queue.js';

export interface TokenThresholdConfig {
  reserveTokensFloor: number;
  warningThreshold: number; // Start warning at this level
}

const DEFAULT_CONFIG: TokenThresholdConfig = {
  reserveTokensFloor: 40000,
  warningThreshold: 45000,
};

// Track token counts per session/group
const sessionTokens = new Map<string, number>();
const flushTriggered = new Map<string, boolean>();

/**
 * Parse token count from container output
 * Expected format: "[TOKENS: 12345/80000]" or similar
 */
export function parseTokenCount(output: string): number | null {
  // Look for token indicators in output
  const patterns = [
    /\[TOKENS:\s*(\d+)\/\d+\]/i,
    /Tokens used:\s*(\d+)/i,
    /Context:\s*(\d+)\s*tokens/i,
    /token count[:\s]+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Update token count for a session
 */
export function updateTokenCount(groupId: string, tokenCount: number): void {
  sessionTokens.set(groupId, tokenCount);

  logger.debug(
    { groupId, tokenCount },
    'Token count updated',
  );
}

/**
 * Check if token threshold is approaching
 */
export function checkTokenThreshold(
  groupId: string,
  config: TokenThresholdConfig = DEFAULT_CONFIG,
): {
  approaching: boolean;
  exceeded: boolean;
  tokensUsed: number;
  tokensRemaining: number;
  shouldFlush: boolean;
} {
  const tokensUsed = sessionTokens.get(groupId) || 0;
  const tokensRemaining = config.reserveTokensFloor - tokensUsed;
  const approaching = tokensUsed >= config.warningThreshold;
  const exceeded = tokensUsed >= config.reserveTokensFloor;
  const alreadyFlushed = flushTriggered.get(groupId) || false;
  const shouldFlush = exceeded && !alreadyFlushed;

  return {
    approaching,
    exceeded,
    tokensUsed,
    tokensRemaining,
    shouldFlush,
  };
}

/**
 * Trigger pre-compaction flush
 * Writes important context to HOT memory before potential compaction
 */
export async function triggerPreCompactionFlush(
  vaultRoot: string,
  agentName: string,
  groupId: string,
  context: {
    summary: string;
    keyFacts: string[];
    pendingTasks: string[];
  },
): Promise<void> {
  logger.info(
    { groupId, tokensUsed: sessionTokens.get(groupId) },
    'Triggering pre-compaction flush',
  );

  // Mark as flushed to prevent multiple triggers
  flushTriggered.set(groupId, true);

  // Format flush content
  const timestamp = new Date().toISOString();
  const content = [
    `## Pre-Compaction Flush - ${timestamp.split('T')[0]}`,
    '',
    `**Session:** ${groupId}`,
    `**Tokens used:** ${sessionTokens.get(groupId) || 'unknown'}`,
    `**Trigger:** Approaching reserve floor (${DEFAULT_CONFIG.reserveTokensFloor})`,
    '',
    '### Context Summary',
    context.summary,
    '',
    '### Key Facts',
    ...context.keyFacts.map((f) => `- ${f}`),
    '',
    '### Pending Tasks',
    ...context.pendingTasks.map((t) => `- [ ] ${t}`),
    '',
    '---',
    '*Auto-saved before context compaction*',
  ].join('\n');

  // Queue write to HOT memory
  const vaultPath = `agent/${agentName}/self-improving/hot-memory.md`;

  vaultWriteQueue.enqueue({
    path: vaultPath,
    content: '\n' + content,
    mode: 'append',
    priority: 'P0', // Critical - emergency write
    source: 'token-monitor',
    commitMessage: `mem: emergency flush - context preservation`,
  });

  logger.info(
    { groupId, vaultPath },
    'Pre-compaction flush queued',
  );
}

/**
 * Reset token tracking for a session
 */
export function resetTokenTracking(groupId: string): void {
  sessionTokens.delete(groupId);
  flushTriggered.delete(groupId);
  logger.debug({ groupId }, 'Token tracking reset');
}

/**
 * Get current token stats for a session
 */
export function getTokenStats(groupId: string): {
  tokensUsed: number;
  flushed: boolean;
} {
  return {
    tokensUsed: sessionTokens.get(groupId) || 0,
    flushed: flushTriggered.get(groupId) || false,
  };
}

/**
 * Process container output for token monitoring
 * Called by container-runner when processing output
 */
export function processContainerOutput(
  groupId: string,
  output: string,
): { tokens: number | null; threshold: ReturnType<typeof checkTokenThreshold> } {
  const tokens = parseTokenCount(output);

  if (tokens !== null) {
    updateTokenCount(groupId, tokens);
  }

  const threshold = checkTokenThreshold(groupId);

  return { tokens, threshold };
}

/**
 * Create IPC message for agent to request context summary
 * Agent should respond with summary for flush
 */
export function createFlushRequestIpc(
  groupId: string,
): {
  type: 'pre_compaction_flush_request';
  groupId: string;
  tokensRemaining: number;
  timestamp: string;
} {
  const tokensUsed = sessionTokens.get(groupId) || 0;
  const tokensRemaining = DEFAULT_CONFIG.reserveTokensFloor - tokensUsed;

  return {
    type: 'pre_compaction_flush_request',
    groupId,
    tokensRemaining,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Handle flush response from agent
 */
export async function handleFlushResponse(
  vaultRoot: string,
  agentName: string,
  groupId: string,
  response: {
    summary: string;
    keyFacts: string[];
    pendingTasks: string[];
  },
): Promise<void> {
  await triggerPreCompactionFlush(vaultRoot, agentName, groupId, response);
}
