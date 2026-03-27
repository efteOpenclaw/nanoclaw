// CC-side types mirroring the nanoclaw DB schema (read-only views).

export interface RegisteredGroupRow {
  jid: string;
  name: string;
  folder: string;
  trigger_pattern: string;
  added_at: string;
  container_config: string | null;
  requires_trigger: number | null;
  is_main: number | null;
}

export interface SessionRow {
  group_folder: string;
  session_id: string;
}

export interface ScheduledTaskRow {
  id: string;
  group_folder: string;
  chat_jid: string;
  prompt: string;
  script: string | null;
  schedule_type: string;
  schedule_value: string;
  context_mode: string;
  next_run: string | null;
  last_run: string | null;
  last_result: string | null;
  status: string;
  created_at: string;
}

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

export interface ActiveContainer {
  groupJid: string;
  containerName: string | null;
  pid: number | null;
}

/** Shape returned by the host status API on port 3001 /status */
export interface StatusApiResponse {
  groups: Record<
    string,
    {
      name: string;
      folder: string;
      trigger: string;
      added_at: string;
      requiresTrigger?: boolean;
      isMain?: boolean;
    }
  >;
  sessions: Record<string, string>;
  tasks: ScheduledTaskRow[];
  containers: ActiveContainer[];
  tokenSnapshots: TokenUsageLogRow[];
  pendingProposals: PromotionProposalRow[];
  timestamp: number;
}
