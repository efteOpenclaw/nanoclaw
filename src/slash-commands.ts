/**
 * Slash command registry — host-side commands intercepted before container.
 *
 * Two kinds of slash commands exist in this system:
 *   - Host-side (registered here): handled by nanoclaw before the container sees the message.
 *     Examples: /remote-control, /remote-control-end, /help
 *   - Container-side (pass-through): unknown slash commands are stored and forwarded to Claude
 *     Code running inside the container. Examples: /compact, /transcribe
 *
 * To add a host-side command: call registerCommand() at module init time.
 * To let a command reach the container: simply don't register it here.
 */

import { logger } from './logger.js';
import type { Channel, NewMessage, RegisteredGroup } from './types.js';

export interface CommandContext {
  command: string;
  args: string;
  chatJid: string;
  msg: NewMessage;
  group: RegisteredGroup | undefined;
  channel: Channel;
}

export interface SlashCommand {
  description: string;
  /** If true, rejected with an error when called outside the main group. */
  mainOnly?: boolean;
  handle: (ctx: CommandContext) => Promise<void>;
}

const registry = new Map<string, SlashCommand>();

export function registerCommand(name: string, cmd: SlashCommand): void {
  if (!name.startsWith('/')) {
    throw new Error(`Command name must start with '/': ${name}`);
  }
  registry.set(name, cmd);
  logger.debug({ command: name }, 'slash-command registered');
}

/**
 * Returns true if this content looks like a slash command (starts with '/').
 * Pass-through commands also start with '/' — callers should check isHostCommand
 * to decide whether to intercept.
 */
export function isSlashCommand(content: string): boolean {
  return content.startsWith('/');
}

/**
 * Returns true if there is a host-side handler registered for this command.
 */
export function isHostCommand(command: string): boolean {
  return registry.has(command);
}

/**
 * Parse the command name and args from a slash command message.
 * e.g. "/foo bar baz" → { command: "/foo", args: "bar baz" }
 */
export function parseSlashCommand(content: string): { command: string; args: string } {
  const trimmed = content.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { command: trimmed, args: '' };
  }
  return {
    command: trimmed.slice(0, spaceIdx),
    args: trimmed.slice(spaceIdx + 1).trim(),
  };
}

/**
 * Dispatch a host-side slash command.
 * Returns true if the command was handled (caller should not forward to container).
 * Returns false if no handler is registered (caller should pass through to container).
 */
export async function dispatchSlashCommand(ctx: CommandContext): Promise<boolean> {
  const cmd = registry.get(ctx.command);
  if (!cmd) return false;

  if (cmd.mainOnly && !ctx.group?.isMain) {
    await ctx.channel.sendMessage(
      ctx.chatJid,
      `${ctx.command} is only available in the main group.`,
    );
    logger.warn(
      { command: ctx.command, chatJid: ctx.chatJid },
      'slash-command rejected: not main group',
    );
    return true;
  }

  try {
    await cmd.handle(ctx);
  } catch (err) {
    logger.error({ err, command: ctx.command }, 'slash-command handler error');
    await ctx.channel.sendMessage(ctx.chatJid, `${ctx.command} failed: ${err}`).catch(() => {});
  }

  return true;
}

/**
 * Return a formatted list of all registered host-side commands.
 */
export function listCommands(): string {
  if (registry.size === 0) return 'No host-side commands registered.';
  const lines = Array.from(registry.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, cmd]) => `${name}${cmd.mainOnly ? ' (main only)' : ''} — ${cmd.description}`);
  return lines.join('\n');
}
