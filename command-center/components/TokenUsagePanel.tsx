'use client';

import type { TokenUsageLogRow } from '@/lib/types';

interface Props {
  snapshots: TokenUsageLogRow[];
}

export function TokenUsagePanel({ snapshots }: Props) {
  if (snapshots.length === 0) {
    return (
      <div style={{ color: '#555', fontSize: 13, padding: 16 }}>
        No token usage data yet.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {snapshots.map((s) => {
        const total = s.tokens_used + s.tokens_remaining;
        const pct = total > 0 ? Math.min(100, Math.round((s.tokens_used / total) * 100)) : 0;
        const barColor = s.exceeded
          ? '#ef4444'
          : s.approaching
            ? '#f59e0b'
            : '#22c55e';

        return (
          <div
            key={`${s.group_id}-${s.id}`}
            style={{
              border: '1px solid #222',
              borderRadius: 8,
              padding: 14,
              backgroundColor: '#111',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 500 }}>
                {truncateJid(s.group_id)}
              </span>
              <span style={{ fontSize: 12, color: '#666' }}>
                {formatTime(s.recorded_at)}
              </span>
            </div>

            {/* Progress bar */}
            <div
              style={{
                height: 6,
                backgroundColor: '#1a1a1a',
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 6,
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  backgroundColor: barColor,
                  borderRadius: 3,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#888',
              }}
            >
              <span>{s.tokens_used.toLocaleString()} used</span>
              <span>{s.tokens_remaining.toLocaleString()} remaining</span>
            </div>

            {/* Flags */}
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              {s.approaching === 1 && (
                <Flag label="approaching" color="#f59e0b" />
              )}
              {s.exceeded === 1 && <Flag label="exceeded" color="#ef4444" />}
              {s.should_flush === 1 && <Flag label="flush" color="#a855f7" />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Flag({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        color,
        border: `1px solid ${color}`,
        borderRadius: 4,
        padding: '1px 5px',
        textTransform: 'uppercase',
      }}
    >
      {label}
    </span>
  );
}

function truncateJid(jid: string): string {
  if (jid.includes('@')) return jid.split('@')[0].slice(0, 20);
  if (jid.startsWith('tg:')) return jid;
  if (jid.startsWith('dc:')) return jid;
  return jid.slice(0, 24);
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return iso;
  }
}
