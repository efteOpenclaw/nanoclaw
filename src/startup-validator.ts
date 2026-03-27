/**
 * SPEC-01: Startup Invariant Validator
 *
 * Runs after initDatabase(), before loadState() in main().
 * On any failed invariant: logs FATAL and calls process.exit(1).
 * On config checksum change: logs WARN and updates stored checksum.
 *
 * Four checks (all must pass):
 * 1. Log sink working
 * 2. Vault accessible (VAULT_PATH env var)
 * 3. Config valid + checksummed (ASSISTANT_NAME, ANTHROPIC_API_KEY, ANTHROPIC_MODEL)
 * 4. Rule registry exists at {VAULT_PATH}/system/rule-registry.md
 */
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readEnvFile } from './env.js';
import { getRouterState, setRouterState } from './db.js';
import { logger } from './logger.js';

export function runStartupValidator(): void {
  // Check 1: Log sink working
  try {
    logger.info('startup-validator: checking invariants');
  } catch (err) {
    process.stderr.write(
      `[startup-validator] FATAL: log sink is not working: ${err}\n`,
    );
    process.exit(1);
  }

  const env = readEnvFile([
    'VAULT_PATH',
    'ASSISTANT_NAME',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_MODEL',
  ]);

  // Check 2: Vault accessible
  const vaultPath = env['VAULT_PATH'];
  if (!vaultPath) {
    logger.fatal('startup-validator: VAULT_PATH is not set in .env');
    process.exit(1);
  }

  const resolvedVault = vaultPath.startsWith('~/')
    ? path.join(os.homedir(), vaultPath.slice(2))
    : path.resolve(vaultPath);

  try {
    fs.accessSync(resolvedVault, fs.constants.R_OK);
  } catch {
    logger.fatal(
      { vaultPath: resolvedVault },
      'startup-validator: vault is not accessible — create the directory or fix VAULT_PATH in .env',
    );
    process.exit(1);
  }
  logger.info({ vaultPath: resolvedVault }, 'startup-validator: vault OK');

  // Check 3: Config valid + checksummed
  const requiredKeys = ['ASSISTANT_NAME', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL'];
  const missing = requiredKeys.filter((k) => !env[k]);
  if (missing.length > 0) {
    logger.fatal(
      { missing },
      'startup-validator: required .env keys are missing or empty',
    );
    process.exit(1);
  }

  const canonical = requiredKeys.map((k) => `${k}=${env[k]}`).join('\n');
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');

  const storedChecksum = getRouterState('config_checksum');
  if (storedChecksum && storedChecksum !== checksum) {
    logger.warn(
      { previous: storedChecksum.slice(0, 8), current: checksum.slice(0, 8) },
      'startup-validator: config checksum changed — .env was modified since last run',
    );
  }
  setRouterState('config_checksum', checksum);
  logger.info(
    { checksum: checksum.slice(0, 8) },
    'startup-validator: config checksum OK',
  );

  // Check 4: Rule registry exists (SPEC-14 full impl later; existence only)
  const ruleRegistryPath = path.join(resolvedVault, 'system', 'rule-registry.md');
  if (!fs.existsSync(ruleRegistryPath)) {
    logger.fatal(
      { path: ruleRegistryPath },
      'startup-validator: rule-registry.md not found — create vault/system/rule-registry.md',
    );
    process.exit(1);
  }
  logger.info('startup-validator: rule registry OK');

  logger.info('startup-validator: all invariants satisfied');
}
