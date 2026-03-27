/**
 * Memory Archive System
 *
 * Handles demotion of memory items from HOT → WARM → COLD
 * Per SPEC-06: 30 days for HOT→WARM, 90 days for WARM→COLD
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { vaultWriteQueue } from './vault-write-queue.js';
import { loadHotMemory } from './memory-tier-manager.js';

export interface DemotionCandidate {
  vaultPath: string;
  tier: 'HOT' | 'WARM';
  lastAccessed: Date;
  daysSinceAccess: number;
  content: string;
}

/**
 * Find demotion candidates from HOT tier
 */
export function findHotDemotions(
  vaultRoot: string,
  agentName: string,
  demotionDays: number = 30,
): DemotionCandidate[] {
  const candidates: DemotionCandidate[] = [];
  const hotMemory = loadHotMemory(vaultRoot, agentName);

  // Parse HOT memory content for dated entries
  const lines = hotMemory.content.split('\n');
  const entryRegex = /^##\s+(\d{4}-\d{2}-\d{2})/;
  let currentDate: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const match = line.match(entryRegex);
    if (match) {
      // Process previous entry
      if (currentDate && currentContent.length > 0) {
        const lastAccessed = new Date(currentDate);
        const daysSince = Math.floor(
          (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysSince >= demotionDays) {
          candidates.push({
            vaultPath: `agent/${agentName}/self-improving/hot-memory.md`,
            tier: 'HOT',
            lastAccessed,
            daysSinceAccess: daysSince,
            content: currentContent.join('\n'),
          });
        }
      }

      currentDate = match[1];
      currentContent = [line];
    } else if (currentDate) {
      currentContent.push(line);
    }
  }

  // Process final entry
  if (currentDate && currentContent.length > 0) {
    const lastAccessed = new Date(currentDate);
    const daysSince = Math.floor(
      (Date.now() - lastAccessed.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysSince >= demotionDays) {
      candidates.push({
        vaultPath: `agent/${agentName}/self-improving/hot-memory.md`,
        tier: 'HOT',
        lastAccessed,
        daysSinceAccess: daysSince,
        content: currentContent.join('\n'),
      });
    }
  }

  logger.debug(
    { agentName, count: candidates.length },
    'Found HOT demotion candidates',
  );
  return candidates;
}

/**
 * Find demotion candidates from WARM tier (projects/domains)
 */
export function findWarmDemotions(
  vaultRoot: string,
  agentName: string,
  demotionDays: number = 90,
): DemotionCandidate[] {
  const candidates: DemotionCandidate[] = [];
  const warmDirs = ['projects', 'domains'];

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
      const stat = fs.statSync(filePath);
      const daysSince = Math.floor(
        (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysSince >= demotionDays) {
        const content = fs.readFileSync(filePath, 'utf-8');
        candidates.push({
          vaultPath: `agent/${agentName}/self-improving/${dir}/${file}`,
          tier: 'WARM',
          lastAccessed: stat.mtime,
          daysSinceAccess: daysSince,
          content,
        });
      }
    }
  }

  logger.debug(
    { agentName, count: candidates.length },
    'Found WARM demotion candidates',
  );
  return candidates;
}

/**
 * Demote HOT item to WARM
 */
export async function demoteHotToWarm(
  vaultRoot: string,
  agentName: string,
  candidate: DemotionCandidate,
): Promise<void> {
  const targetDir = path.join(
    vaultRoot,
    'agent',
    agentName,
    'self-improving',
    'archive',
  );

  // Create archive dir if needed
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Generate filename from content hash
  const timestamp = candidate.lastAccessed.toISOString().split('T')[0];
  const safeName = candidate.content
    .split('\n')[0]
    .replace(/[^\w]/g, '_')
    .slice(0, 30);
  const filename = `${timestamp}_${safeName}.md`;
  const targetPath = path.join(targetDir, filename);

  // Write to COLD archive
  const content = `# Archived from HOT\n\n**Original tier:** HOT\n**Archived:** ${new Date().toISOString()}\n**Last accessed:** ${candidate.lastAccessed.toISOString()}\n**Days inactive:** ${candidate.daysSinceAccess}\n\n---\n\n${candidate.content}`;

  fs.writeFileSync(targetPath, content);

  // Queue vault write
  const vaultPath = `agent/${agentName}/self-improving/archive/${filename}`;
  vaultWriteQueue.enqueue({
    path: vaultPath,
    content,
    mode: 'overwrite',
    priority: 'P2',
    source: 'memory-archive',
    commitMessage: `archive: demote HOT entry to COLD (${safeName})`,
  });

  logger.info(
    { agentName, filename, days: candidate.daysSinceAccess },
    'Demoted HOT to COLD',
  );
}

/**
 * Demote WARM item to COLD
 */
export async function demoteWarmToCold(
  vaultRoot: string,
  agentName: string,
  candidate: DemotionCandidate,
): Promise<void> {
  const sourcePath = path.join(vaultRoot, candidate.vaultPath);
  const targetDir = path.join(
    vaultRoot,
    'agent',
    agentName,
    'self-improving',
    'archive',
  );

  // Create archive dir if needed
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Move file to archive
  const filename = path.basename(candidate.vaultPath);
  const timestamp = candidate.lastAccessed.toISOString().split('T')[0];
  const newFilename = `${timestamp}_${filename}`;
  const targetPath = path.join(targetDir, newFilename);

  // Add archive header
  const content = `# Archived from WARM\n\n**Original path:** ${candidate.vaultPath}\n**Original tier:** WARM\n**Archived:** ${new Date().toISOString()}\n**Last accessed:** ${candidate.lastAccessed.toISOString()}\n**Days inactive:** ${candidate.daysSinceAccess}\n\n---\n\n${candidate.content}`;

  fs.writeFileSync(targetPath, content);
  fs.unlinkSync(sourcePath);

  // Queue vault write
  const vaultPath = `agent/${agentName}/self-improving/archive/${newFilename}`;
  vaultWriteQueue.enqueue({
    path: vaultPath,
    content,
    mode: 'overwrite',
    priority: 'P2',
    source: 'memory-archive',
    commitMessage: `archive: demote WARM to COLD (${filename})`,
  });

  logger.info(
    { agentName, filename, days: candidate.daysSinceAccess },
    'Demoted WARM to COLD',
  );
}

/**
 * Query COLD archive
 */
export function queryColdArchive(
  vaultRoot: string,
  agentName: string,
  keyword: string,
): Array<{ filename: string; preview: string; archivedAt: string }> {
  const archiveDir = path.join(
    vaultRoot,
    'agent',
    agentName,
    'self-improving',
    'archive',
  );

  if (!fs.existsSync(archiveDir)) {
    return [];
  }

  const results: Array<{
    filename: string;
    preview: string;
    archivedAt: string;
  }> = [];

  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith('.md'));
  const keywordLower = keyword.toLowerCase();

  for (const file of files) {
    const filePath = path.join(archiveDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    if (content.toLowerCase().includes(keywordLower)) {
      // Extract archived date from header
      const dateMatch = content.match(/\*\*Archived:\*\* (.+)/);
      const archivedAt = dateMatch ? dateMatch[1] : 'unknown';

      results.push({
        filename: file,
        preview: content.slice(0, 200),
        archivedAt,
      });
    }
  }

  return results;
}

/**
 * Run daily demotion scan
 */
export async function runDailyDemotionScan(
  vaultRoot: string,
  agentName: string,
  hotDemotionDays: number = 30,
  warmDemotionDays: number = 90,
): Promise<{
  hotDemoted: number;
  warmDemoted: number;
}> {
  let hotDemoted = 0;
  let warmDemoted = 0;

  // Scan HOT
  const hotCandidates = findHotDemotions(vaultRoot, agentName, hotDemotionDays);
  for (const candidate of hotCandidates) {
    await demoteHotToWarm(vaultRoot, agentName, candidate);
    hotDemoted++;
  }

  // Scan WARM
  const warmCandidates = findWarmDemotions(vaultRoot, agentName, warmDemotionDays);
  for (const candidate of warmCandidates) {
    await demoteWarmToCold(vaultRoot, agentName, candidate);
    warmDemoted++;
  }

  logger.info(
    { agentName, hotDemoted, warmDemoted },
    'Daily demotion scan complete',
  );

  return { hotDemoted, warmDemoted };
}

/**
 * Create WARM tier directories
 */
export function createWarmDirectories(
  vaultRoot: string,
  agentName: string,
): void {
  const dirs = [
    path.join(vaultRoot, 'agent', agentName, 'self-improving', 'projects'),
    path.join(vaultRoot, 'agent', agentName, 'self-improving', 'domains'),
    path.join(vaultRoot, 'agent', agentName, 'self-improving', 'archive'),
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      logger.info({ dir }, 'Created WARM/COLD directory');
    }
  }
}
