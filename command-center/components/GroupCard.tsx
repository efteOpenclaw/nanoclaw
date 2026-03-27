'use client';

import type { ActiveContainer, TokenUsageLogRow } from '@/lib/types';

interface GroupInfo {
  name: string;
  folder: string;
  trigger: string;
  added_at: string;
  requiresTrigger?: boolean;
  isMain?: boolean;
}

interface Props {
  jid: string;
  group: GroupInfo;
  container: ActiveContainer | null;
  sessionId: string | null;
  tokenSnapshot: TokenUsageLogRow | null;
}

export function GroupCard({
  jid,
  group,
  container,
  sessionId,
  tokenSnapshot,
}: Props) {
  const isActive = !!container;
  const isMain = group.isMain;
  const statusColor = isActive ? '#22c55e' : '#555';
  const statusLabel = isActive ? 'Active' : 'Idle';

  return (
    <div
      style={{
        border: `1px solid ${isMain ? '#3b82f6' : '#222'}`,
        borderRadius: 8,
        padding: 16,
        backgroundColor: '#111',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: statusColor,
              display: 'inline-block',
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 14 }}>{group.name}</span>
          {isMain && (
            <span
              style={{
                fontSize: 10,
                color: '#3b82f6',
                border: '1px solid #3b82f6',
                borderRadius: 4,
                padding: '1px 5px',
                textTransform: 'uppercase',
              }}
            >
              main
            </span>
          )}
        </div>
        <span style={{ fontSize: 12, color: '#666' }}>{statusLabel}</span>
      </div>

      <div
        style={{
          fontSize: 12,
          color: '#888',
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        <Row label="Folder" value={group.folder} />
        <Row
          label="Trigger"
          value={group.requiresTrigger === false ? 'none' : group.trigger}
        />
        <Row label="JID" value={truncate(jid, 36)} />
        {sessionId && <Row label="Session" value={truncate(sessionId, 20)} />}
        {container?.containerName && (
          <Row label="Container" value={container.containerName} />
        )}
        {container?.pid && <Row label="PID" value={String(container.pid)} />}
        {tokenSnapshot && (
          <Row
            label="Tokens"
            value={`${tokenSnapshot.tokens_used.toLocaleString()} used`}
            valueColor={
              tokenSnapshot.exceeded
                ? '#ef4444'
                : tokenSnapshot.approaching
                  ? '#f59e0b'
                  : '#888'
            }
          />
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  valueColor,
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: '#666' }}>{label}</span>
      <span
        style={{
          color: valueColor || '#aaa',
          fontFamily: 'monospace',
          fontSize: 11,
        }}
      >
        {value}
      </span>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
}
