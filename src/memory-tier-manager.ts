/**
 * Memory Tier Manager - HOT tier loading and management
 *
 * Handles:
 * - Loading HOT memory at session start
 * - Validating line count (≤100)
 * - Warning on overflow (no auto-modify per user decision)
 * - YAML frontmatter parsing/updating
 */

import fs from 'fs';
import path from 'path';
import { logger } from './logger.js';
import { vaultWriteQueue } from './vault-write-queue.js';

export interface HotMemoryConfig {
  promotion_threshold: number;
  promotion_window_days: number;
  demotion_warm_days: number;
  demotion_cold_days: number;
  hot_memory_line_limit: number;
  last_updated?: string;
}

export interface HotMemoryData {
  config: HotMemoryConfig;
  content: string;
  lineCount: number;
  vaultPath: string;
}

const DEFAULT_CONFIG: HotMemoryConfig = {
  promotion_threshold: 3,
  promotion_window_days: 7,
  demotion_warm_days: 30,
  demotion_cold_days: 90,
  hot_memory_line_limit: 100,
  last_updated: new Date().toISOString(),
};

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlText = match[1];
  const body = match[2];

  const frontmatter: Record<string, unknown> = {};
  for (const line of yamlText.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      // Parse numbers
      if (/^\d+$/.test(value)) {
        frontmatter[key] = parseInt(value, 10);
      } else if (/^\d+\.\d+$/.test(value)) {
        frontmatter[key] = parseFloat(value);
      } else {
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * Serialize config to YAML frontmatter
 */
function serializeFrontmatter(config: HotMemoryConfig): string {
  const lines = ['---'];
  for (const [key, value] of Object.entries(config)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('---\n');
  return lines.join('\n');
}

/**
 * Load HOT memory for an agent
 */
export function loadHotMemory(
  vaultRoot: string,
  agentName: string,
): HotMemoryData {
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    'hot-memory.md',
  );
  const fullPath = path.join(vaultRoot, vaultPath);

  if (!fs.existsSync(fullPath)) {
    logger.warn({ agentName, vaultPath }, 'HOT memory file not found, creating');
    // Return default with empty content
    return {
      config: { ...DEFAULT_CONFIG },
      content: '',
      lineCount: 0,
      vaultPath,
    };
  }

  const fileContent = fs.readFileSync(fullPath, 'utf-8');
  const { frontmatter, body } = parseFrontmatter(fileContent);

  // Merge with defaults
  const config: HotMemoryConfig = {
    ...DEFAULT_CONFIG,
    ...(frontmatter as Partial<HotMemoryConfig>),
  };

  const lineCount = body.split('\n').filter((line) => line.trim()).length;

  logger.debug(
    { agentName, lineCount, limit: config.hot_memory_line_limit },
    'HOT memory loaded',
  );

  // Check overflow
  if (lineCount > config.hot_memory_line_limit) {
    logger.warn(
      {
        agentName,
        lineCount,
        limit: config.hot_memory_line_limit,
        overflow: lineCount - config.hot_memory_line_limit,
      },
      'HOT memory exceeds limit - user action required',
    );
  }

  return {
    config,
    content: body,
    lineCount,
    vaultPath,
  };
}

/**
 * Check if HOT memory exceeds limit and return warning message
 */
export function checkHotOverflow(
  data: HotMemoryData,
): { exceeded: boolean; message?: string } {
  if (data.lineCount > data.config.hot_memory_line_limit) {
    const overflow = data.lineCount - data.config.hot_memory_line_limit;
    return {
      exceeded: true,
      message:
        `⚠️ HOT memory overflow: ${data.lineCount} lines ` +
        `(limit: ${data.config.hot_memory_line_limit}, overflow: ${overflow}).\n` +
        `Please review and archive older entries to WARM tier.`,
    };
  }
  return { exceeded: false };
}

/**
 * Append content to HOT memory
 */
export async function appendToHotMemory(
  vaultRoot: string,
  agentName: string,
  content: string,
  commitMessage?: string,
): Promise<void> {
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    'hot-memory.md',
  );
  const fullPath = path.join(vaultRoot, vaultPath);

  let existingContent = '';
  let config = { ...DEFAULT_CONFIG };

  if (fs.existsSync(fullPath)) {
    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const parsed = parseFrontmatter(fileContent);
    existingContent = parsed.body;
    config = { ...DEFAULT_CONFIG, ...(parsed.frontmatter as Partial<HotMemoryConfig>) };
  }

  // Update timestamp
  config.last_updated = new Date().toISOString();

  const newContent = existingContent + '\n' + content;
  const lineCount = newContent.split('\n').filter((line) => line.trim()).length;

  // Check overflow before writing
  if (lineCount > config.hot_memory_line_limit) {
    logger.warn(
      {
        agentName,
        lineCount,
        limit: config.hot_memory_line_limit,
      },
      'HOT memory append would exceed limit',
    );
  }

  const fullContent = serializeFrontmatter(config) + newContent;

  // Write via vault write queue (P1 priority - agent memory)
  vaultWriteQueue.enqueue({
    path: vaultPath,
    content: fullContent,
    mode: 'overwrite',
    priority: 'P1',
    source: 'memory-tier-manager',
    commitMessage: commitMessage || `mem: update HOT memory (${lineCount} lines)`,
  });

  logger.info({ agentName, lineCount, vaultPath }, 'HOT memory append queued');
}

/**
 * Get HOT memory config for an agent
 */
export function getHotMemoryConfig(
  vaultRoot: string,
  agentName: string,
): HotMemoryConfig {
  const data = loadHotMemory(vaultRoot, agentName);
  return data.config;
}

/**
 * Create initial HOT memory file with proper structure
 */
export async function initializeHotMemory(
  vaultRoot: string,
  agentName: string,
): Promise<void> {
  const vaultPath = path.join(
    'agent',
    agentName,
    'self-improving',
    'hot-memory.md',
  );
  const fullPath = path.join(vaultRoot, vaultPath);

  if (fs.existsSync(fullPath)) {
    logger.debug({ agentName }, 'HOT memory already initialized');
    return;
  }

  const config = { ...DEFAULT_CONFIG };
  const content = `# HOT Memory - ${agentName}

## Session 1 - ${new Date().toISOString().split('T')[0]}

Initial HOT memory created.\n`;

  const fullContent = serializeFrontmatter(config) + content;

  vaultWriteQueue.enqueue({
    path: vaultPath,
    content: fullContent,
    mode: 'overwrite',
    priority: 'P1',
    source: 'memory-tier-manager',
    commitMessage: `mem: initialize HOT memory for ${agentName}`,
  });

  logger.info({ agentName, vaultPath }, 'HOT memory initialized');
}
