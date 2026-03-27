'use client';

import type { PromotionProposalRow } from '@/lib/types';

interface Props {
  proposals: PromotionProposalRow[];
}

export function ProposalList({ proposals }: Props) {
  if (proposals.length === 0) {
    return (
      <div style={{ color: '#555', fontSize: 13, padding: 16 }}>
        No pending proposals.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {proposals.map((p) => (
        <div
          key={p.id}
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
            <span style={{ fontWeight: 600, fontSize: 14, color: '#e0e0e0' }}>
              {p.term}
            </span>
            <StatusBadge status={p.status} />
          </div>

          <div
            style={{
              fontSize: 12,
              color: '#888',
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
            }}
          >
            <div>
              <span style={{ color: '#666' }}>ID: </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {p.id}
              </span>
            </div>
            <div>
              <span style={{ color: '#666' }}>Source: </span>
              <span style={{ fontFamily: 'monospace', fontSize: 11 }}>
                {p.source_path}
              </span>
            </div>
            <div>
              <span style={{ color: '#666' }}>Occurrences: </span>
              {p.occurrence_count}x in 7 days
            </div>
            <div>
              <span style={{ color: '#666' }}>Proposed: </span>
              {formatTime(p.proposed_at)}
            </div>
          </div>

          {p.source_content && (
            <div
              style={{
                marginTop: 8,
                padding: 8,
                backgroundColor: '#0a0a0a',
                borderRadius: 4,
                fontSize: 11,
                color: '#777',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
                maxHeight: 80,
                overflow: 'hidden',
              }}
            >
              {p.source_content.slice(0, 200)}
              {p.source_content.length > 200 && '...'}
            </div>
          )}

          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: '#555',
              fontStyle: 'italic',
            }}
          >
            Reply in chat: YES {p.id} / NO {p.id}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    pending: { bg: '#1c1917', fg: '#f59e0b' },
    accepted: { bg: '#052e16', fg: '#22c55e' },
    rejected: { bg: '#2a1215', fg: '#ef4444' },
  };
  const c = colors[status] || { bg: '#1a1a1a', fg: '#666' };

  return (
    <span
      style={{
        backgroundColor: c.bg,
        color: c.fg,
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 500,
      }}
    >
      {status}
    </span>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('en-GB', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
