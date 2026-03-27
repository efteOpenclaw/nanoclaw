'use client';

import { useSSE } from '@/lib/use-sse';
import { GroupCard } from '@/components/GroupCard';
import { TaskList } from '@/components/TaskList';
import { ProposalList } from '@/components/ProposalList';
import { TokenUsagePanel } from '@/components/TokenUsagePanel';

export default function Dashboard() {
  const { data, connected, error } = useSSE();

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 32,
          borderBottom: '1px solid #222',
          paddingBottom: 16,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>
          NanoClaw Command Center
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: connected
                ? error
                  ? '#f59e0b'
                  : '#22c55e'
                : '#ef4444',
              display: 'inline-block',
            }}
          />
          <span style={{ fontSize: 13, color: '#888' }}>
            {connected ? error || 'Live' : 'Disconnected'}
          </span>
          {data && (
            <span style={{ fontSize: 12, color: '#555', marginLeft: 8 }}>
              Updated {new Date(data.timestamp).toLocaleTimeString()}
            </span>
          )}
        </div>
      </div>

      {!data ? (
        <div style={{ color: '#666', textAlign: 'center', padding: 64 }}>
          Connecting to NanoClaw host...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
          {/* Groups & Agents */}
          <section>
            <SectionHeader
              title="Groups & Agents"
              count={Object.keys(data.groups).length}
            />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
                gap: 12,
              }}
            >
              {Object.entries(data.groups).map(([jid, group]) => {
                const container = data.containers.find(
                  (c) => c.groupJid === jid,
                );
                const session = data.sessions[group.folder];
                const tokenSnapshot = data.tokenSnapshots.find(
                  (t) => t.group_id === jid,
                );
                return (
                  <GroupCard
                    key={jid}
                    jid={jid}
                    group={group}
                    container={container || null}
                    sessionId={session || null}
                    tokenSnapshot={tokenSnapshot || null}
                  />
                );
              })}
            </div>
          </section>

          {/* Scheduled Tasks */}
          <section>
            <SectionHeader title="Scheduled Tasks" count={data.tasks.length} />
            <TaskList tasks={data.tasks} />
          </section>

          {/* Promotion Proposals */}
          <section>
            <SectionHeader
              title="Promotion Proposals"
              count={data.pendingProposals.length}
              label="pending"
            />
            <ProposalList proposals={data.pendingProposals} />
          </section>

          {/* Token Usage */}
          <section>
            <SectionHeader title="Token Usage" />
            <TokenUsagePanel snapshots={data.tokenSnapshots} />
          </section>
        </div>
      )}
    </div>
  );
}

function SectionHeader({
  title,
  count,
  label,
}: {
  title: string;
  count?: number;
  label?: string;
}) {
  return (
    <h2
      style={{
        fontSize: 15,
        fontWeight: 600,
        color: '#aaa',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        marginBottom: 12,
      }}
    >
      {title}
      {count !== undefined && (
        <span
          style={{
            marginLeft: 8,
            fontSize: 12,
            color: '#666',
            fontWeight: 400,
          }}
        >
          ({count}
          {label ? ` ${label}` : ''})
        </span>
      )}
    </h2>
  );
}
