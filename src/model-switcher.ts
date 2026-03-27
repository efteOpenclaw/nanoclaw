/**
 * Model switcher — discover available models and switch per group.
 *
 * Active model is stored in the group's settings.json env block so each
 * container picks it up on the next invocation without a restart.
 */
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { readEnvFile } from './env.js';
import { logger } from './logger.js';

function settingsFilePath(groupFolder: string): string {
  return path.join(DATA_DIR, 'sessions', groupFolder, '.claude', 'settings.json');
}

/** Read the active model for a group. Falls back to .env ANTHROPIC_MODEL. */
export function getGroupModel(groupFolder: string): string {
  const filePath = settingsFilePath(groupFolder);
  if (fs.existsSync(filePath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (settings.env?.ANTHROPIC_MODEL) return settings.env.ANTHROPIC_MODEL;
    } catch {
      // malformed settings.json — fall through
    }
  }
  const env = readEnvFile(['ANTHROPIC_MODEL']);
  return env.ANTHROPIC_MODEL || 'unknown';
}

/** Persist the active model for a group into its settings.json. */
export function setGroupModel(groupFolder: string, model: string): void {
  const filePath = settingsFilePath(groupFolder);
  let settings: Record<string, unknown> = {};
  if (fs.existsSync(filePath)) {
    try {
      settings = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      // corrupt file — start fresh
    }
  }
  const env = (settings.env as Record<string, string>) ?? {};
  env.ANTHROPIC_MODEL = model;
  settings.env = env;
  fs.writeFileSync(filePath, JSON.stringify(settings, null, 2) + '\n');
  logger.info({ groupFolder, model }, 'Model switched');
}

/**
 * Fetch available models from the OpenAI-compatible /v1/models endpoint.
 * baseUrl should include the /v1 prefix (e.g. "http://127.0.0.1:32768/v1").
 * Returns an empty array on failure — callers should degrade gracefully.
 */
export async function fetchAvailableModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/models`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: { id: string }[] };
    const models = (data.data ?? []).map((m) => m.id).sort();
    logger.debug({ count: models.length }, 'Fetched available models');
    return models;
  } catch (err) {
    logger.warn({ err, baseUrl }, 'Could not fetch models list');
    return [];
  }
}

/**
 * Arrange models into rows of `perRow` buttons each.
 * Marks the active model with a checkmark so the user knows what's current.
 */
export function buildModelButtons(
  models: string[],
  activeModel: string,
  perRow = 2,
): Array<Array<{ label: string; callbackData: string }>> {
  const rows: Array<Array<{ label: string; callbackData: string }>> = [];
  for (let i = 0; i < models.length; i += perRow) {
    rows.push(
      models.slice(i, i + perRow).map((m) => ({
        label: m === activeModel ? `✓ ${m}` : m,
        callbackData: `okti:model:${m}`,
      })),
    );
  }
  return rows;
}
