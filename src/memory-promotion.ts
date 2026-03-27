/**
 * Memory Promotion System
 *
 * Handles promotion of memory items from WARM to HOT tier.
 * Per user decision: asks for user confirmation before promoting.
 *
 * Flow:
 * 1. Daily scan checks occurrence counters
 * 2. When term hits threshold (3 in 7 days), create promotion proposal
 * 3. Send IPC message to container with proposal
 * 4. Container sends chat message asking user for confirmation
 * 5. User replies YES/NO
 * 6. If YES, move content to HOT memory
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { vaultWriteQueue } from './vault-write-queue.js';
import {
  loadOccurrenceCounter,
  checkPromotionEligibility,
  scanCorrectionsForOccurrences,
  incrementOccurrence,
} from './memory-occurrence-tracker.js';
import { loadHotMemory, appendToHotMemory } from './memory-tier-manager.js';
import type { Channel } from './types.js';
import {
  createProposal as dbCreateProposal,
  getProposalById as dbGetProposalById,
  getPendingProposals as dbGetPendingProposals,
  updateProposalStatus,
} from './db.js';

export interface PromotionProposal {
  id: string;
  term: string;
  sourceContent: string;
  sourcePath: string;
  occurrenceCount: number;
  proposedAt: string;
  agentName: string;
}

/**
 * Generate a unique proposal ID
 */
function generateProposalId(): string {
  return `promo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Find content related to a term in WARM storage
 */
function findWarmContent(
  vaultRoot: string,
  agentName: string,
  term: string,
): { content: string; path: string } | null {
  const warmDirs = ['projects', 'domains'];
  const termLower = term.toLowerCase();

  for (const dir of warmDirs) {
    const dirPath = path.join(
      vaultRoot,
      'agent',
      agentName,
      'self-improving',
      dir,
    );

    if (!fs.existsSync(dirPath)) {
      continue;
    }

    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.md'));

    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      if (content.toLowerCase().includes(termLower)) {
        return {
          content: content.slice(0, 500), // First 500 chars
          path: path.join('agent', agentName, 'self-improving', dir, file),
        };
      }
    }
  }

  // Check corrections.md
  const correctionsPath = path.join(
    vaultRoot,
    'agent',
    agentName,
    'self-improving',
    'corrections.md',
  );

  if (fs.existsSync(correctionsPath)) {
    const content = fs.readFileSync(correctionsPath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(termLower)) {
        // Extract surrounding context
        const start = Math.max(0, i - 2);
        const end = Math.min(lines.length, i + 5);
        return {
          content: lines.slice(start, end).join('\n'),
          path: `agent/${agentName}/self-improving/corrections.md`,
        };
      }
    }
  }

  return null;
}

/**
 * Scan for promotion candidates and create proposals
 */
export async function scanForPromotions(
  vaultRoot: string,
  agentName: string,
  threshold: number,
): Promise<PromotionProposal[]> {
  const proposals: PromotionProposal[] = [];
  const counter = loadOccurrenceCounter(vaultRoot, agentName);

  // Get all terms from current window
  const currentWindow = counter.windows[counter.windows.length - 1];
  if (!currentWindow) {
    return proposals;
  }

  for (const [term, count] of Object.entries(currentWindow.counts)) {
    const check = checkPromotionEligibility(counter, term, threshold);

    if (check.eligible) {
      // Check if already in HOT
      const hotMemory = loadHotMemory(vaultRoot, agentName);
      if (hotMemory.content.toLowerCase().includes(term.toLowerCase())) {
        logger.debug({ term, agentName }, 'Term already in HOT, skipping');
        continue;
      }

      // Find source content
      const source = findWarmContent(vaultRoot, agentName, term);
      if (!source) {
        logger.warn(
          { term, agentName },
          'Could not find source content for promotion',
        );
        continue;
      }

      const proposal: PromotionProposal = {
        id: generateProposalId(),
        term,
        sourceContent: source.content,
        sourcePath: source.path,
        occurrenceCount: check.totalOccurrences,
        proposedAt: new Date().toISOString(),
        agentName,
      };

      proposals.push(proposal);
      dbCreateProposal({
        id: proposal.id,
        agent_name: proposal.agentName,
        term: proposal.term,
        source_path: proposal.sourcePath,
        source_content: proposal.sourceContent,
        occurrence_count: proposal.occurrenceCount,
        proposed_at: proposal.proposedAt,
      });

      logger.info(
        { proposalId: proposal.id, term, count: check.totalOccurrences },
        'Created promotion proposal',
      );
    }
  }

  return proposals;
}

/**
 * Send promotion proposal to user via chat
 */
export async function sendPromotionProposal(
  proposal: PromotionProposal,
  channel: Channel,
  chatJid: string,
): Promise<void> {
  const message = [
    `🔔 *Memory Promotion Proposal*`,
    ``,
    `Term: "${proposal.term}"`,
    `Occurrences: ${proposal.occurrenceCount} in last 7 days`,
    `Source: ${proposal.sourcePath}`,
    ``,
    `Preview:`,
    '```',
    proposal.sourceContent.slice(0, 200),
    '```',
    ``,
    `Reply *YES* to promote to HOT memory,`,
    `Reply *NO* to keep in current tier.`,
    ``,
    `Proposal ID: ${proposal.id}`,
  ].join('\n');

  await channel.sendMessage(chatJid, message);

  logger.info(
    { proposalId: proposal.id, chatJid },
    'Sent promotion proposal to user',
  );
}

/**
 * Handle user response to promotion proposal
 */
export async function handlePromotionResponse(
  proposalId: string,
  accepted: boolean,
  vaultRoot: string,
): Promise<{ success: boolean; message: string }> {
  const row = dbGetProposalById(proposalId);

  if (!row) {
    return {
      success: false,
      message: `Proposal ${proposalId} not found or expired.`,
    };
  }

  if (row.status !== 'pending') {
    return {
      success: false,
      message: `Proposal ${proposalId} already ${row.status}.`,
    };
  }

  const proposal: PromotionProposal = {
    id: row.id,
    agentName: row.agent_name,
    term: row.term,
    sourcePath: row.source_path,
    sourceContent: row.source_content,
    occurrenceCount: row.occurrence_count,
    proposedAt: row.proposed_at,
  };

  if (!accepted) {
    updateProposalStatus(proposalId, 'rejected');
    logger.info({ proposalId }, 'Promotion rejected by user');
    return {
      success: true,
      message: `Kept "${proposal.term}" in current tier.`,
    };
  }

  // Promote to HOT
  try {
    const hotContent = [
      `## ${proposal.term}`,
      `Promoted from: ${proposal.sourcePath}`,
      `Occurrences: ${proposal.occurrenceCount} in 7 days`,
      `Promoted at: ${new Date().toISOString()}`,
      ``,
      `### Content`,
      proposal.sourceContent,
    ].join('\n');

    await appendToHotMemory(
      vaultRoot,
      proposal.agentName,
      hotContent,
      `mem: promote "${proposal.term}" to HOT`,
    );

    updateProposalStatus(proposalId, 'accepted');

    logger.info({ proposalId, term: proposal.term }, 'Promoted to HOT memory');

    return {
      success: true,
      message: `✅ Promoted "${proposal.term}" to HOT memory.`,
    };
  } catch (err) {
    logger.error({ err, proposalId }, 'Failed to promote to HOT');
    return {
      success: false,
      message: `Failed to promote: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Daily promotion scan task
 */
export async function runDailyPromotionScan(
  vaultRoot: string,
  agentName: string,
  channel: Channel,
  chatJid: string,
): Promise<void> {
  logger.info({ agentName }, 'Running daily promotion scan');

  // First, scan corrections for new occurrences
  const terms = await scanCorrectionsForOccurrences(vaultRoot, agentName);
  for (const term of terms) {
    await incrementOccurrence(vaultRoot, agentName, term);
  }

  // Load config to get threshold
  const { getHotMemoryConfig } = await import('./memory-tier-manager.js');
  const config = getHotMemoryConfig(vaultRoot, agentName);

  // Scan for promotion candidates
  const proposals = await scanForPromotions(
    vaultRoot,
    agentName,
    config.promotion_threshold,
  );

  // Send proposals to user
  for (const proposal of proposals) {
    await sendPromotionProposal(proposal, channel, chatJid);
  }

  if (proposals.length === 0) {
    logger.debug({ agentName }, 'No promotion candidates found');
  } else {
    logger.info(
      { agentName, count: proposals.length },
      'Sent promotion proposals',
    );
  }
}

/**
 * Check if a message is responding to a promotion proposal
 */
export function parsePromotionResponse(
  content: string,
): { proposalId: string; accepted: boolean } | null {
  const trimmed = content.trim().toUpperCase();

  // Check for YES/NO with proposal ID
  const idMatch = content.match(/promo-\d+-\w{6}/);
  if (!idMatch) {
    return null;
  }

  const proposalId = idMatch[0];

  if (trimmed.startsWith('YES') || trimmed.includes('YES')) {
    return { proposalId, accepted: true };
  }

  if (trimmed.startsWith('NO') || trimmed.includes('NO')) {
    return { proposalId, accepted: false };
  }

  return null;
}

/**
 * Get all pending proposals for an agent
 */
export function getPendingProposals(agentName: string): PromotionProposal[] {
  return dbGetPendingProposals()
    .filter((r) => r.agent_name === agentName)
    .map((r) => ({
      id: r.id,
      agentName: r.agent_name,
      term: r.term,
      sourcePath: r.source_path,
      sourceContent: r.source_content,
      occurrenceCount: r.occurrence_count,
      proposedAt: r.proposed_at,
    }));
}

