export interface AdditionalMount {
  hostPath: string; // Absolute path on host (supports ~ for home)
  containerPath?: string; // Optional — defaults to basename of hostPath. Mounted at /workspace/extra/{value}
  readonly?: boolean; // Default: true for safety
}

/**
 * Mount Allowlist - Security configuration for additional mounts
 * This file should be stored at ~/.config/nanoclaw/mount-allowlist.json
 * and is NOT mounted into any container, making it tamper-proof from agents.
 */
export interface MountAllowlist {
  // Directories that can be mounted into containers
  allowedRoots: AllowedRoot[];
  // Glob patterns for paths that should never be mounted (e.g., ".ssh", ".gnupg")
  blockedPatterns: string[];
  // If true, non-main groups can only mount read-only regardless of config
  nonMainReadOnly: boolean;
}

export interface AllowedRoot {
  // Absolute path or ~ for home (e.g., "~/projects", "/var/repos")
  path: string;
  // Whether read-write mounts are allowed under this root
  allowReadWrite: boolean;
  // Optional description for documentation
  description?: string;
}

export interface ContainerConfig {
  additionalMounts?: AdditionalMount[];
  timeout?: number; // Default: 300000 (5 minutes)
}

export interface RegisteredGroup {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  containerConfig?: ContainerConfig;
  requiresTrigger?: boolean; // Default: true for groups, false for solo chats
  isMain?: boolean; // True for the main control group (no trigger, elevated privileges)
}

export interface NewMessage {
  id: string;
  chat_jid: string;
  sender: string;
  sender_name: string;
  content: string;
  timestamp: string;
  is_from_me?: boolean;
  is_bot_message?: boolean;
  thread_id?: string;
}

export interface ScheduledTask {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script?: string | null;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode: 'group' | 'isolated';
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: 'active' | 'paused' | 'completed';
  created_at: string;
}

export interface TaskRunLog {
  task_id: string;
  run_at: string;
  duration_ms: number;
  status: 'success' | 'error';
  result: string | null;
  error: string | null;
}

// --- Inline keyboard ---

export interface InlineKeyboardButton {
  label: string;
  /** Opaque string returned in callback_query when the button is pressed. */
  callbackData: string;
}

export type CallbackAnswerFn = (toast?: string) => Promise<void>;

// --- Channel abstraction ---

export interface Channel {
  name: string;
  connect(): Promise<void>;
  sendMessage(jid: string, text: string): Promise<void>;
  isConnected(): boolean;
  ownsJid(jid: string): boolean;
  disconnect(): Promise<void>;
  // Optional: typing indicator. Channels that support it implement it.
  setTyping?(jid: string, isTyping: boolean): Promise<void>;
  // Optional: sync group/chat names from the platform.
  syncGroups?(force: boolean): Promise<void>;
  // Optional: send a message with an inline button keyboard.
  // rows[i][j] = button at row i, column j.
  sendWithKeyboard?(
    jid: string,
    text: string,
    rows: InlineKeyboardButton[][],
  ): Promise<void>;
}

// --- Vault write queue (SPEC-04/SPEC-15) ---

export type VaultWritePriority = 'P0' | 'P1' | 'P2' | 'P3';

export interface VaultWriteRequest {
  id: string;
  priority: VaultWritePriority;
  /** Relative to VAULT_PATH — e.g. "agent/okti/hot-memory.md" */
  path: string;
  content: string;
  mode: 'overwrite' | 'append';
  /** Human-readable source — e.g. "host:startup", "ipc:main" */
  source: string;
  requestedAt: Date;
  /** Defaults to "vault: write {path}" */
  commitMessage?: string;
}

export interface VaultWriteDeadLetterEntry {
  request: VaultWriteRequest;
  error: string;
  failedAt: Date;
  attempts: number;
}

// --- Callback types ---

// Callback type that channels use to deliver inbound messages
export type OnInboundMessage = (chatJid: string, message: NewMessage) => void;

// Callback for chat metadata discovery.
// name is optional — channels that deliver names inline (Telegram) pass it here;
// channels that sync names separately (via syncGroups) omit it.
export type OnChatMetadata = (
  chatJid: string,
  timestamp: string,
  name?: string,
  channel?: string,
  isGroup?: boolean,
) => void;

// SPEC-06: Promotion proposal DB row
export interface PromotionProposalRow {
  id: string;
  agent_name: string;
  term: string;
  source_path: string;
  source_content: string;
  occurrence_count: number;
  proposed_at: string;
  status: 'pending' | 'accepted' | 'rejected';
  responded_at: string | null;
}

// SPEC-06: Token usage log DB row
export interface TokenUsageLogRow {
  id: number;
  group_id: string;
  tokens_used: number;
  tokens_remaining: number;
  approaching: number;
  exceeded: number;
  should_flush: number;
  recorded_at: string;
}
