'use client';

import type { ScheduledTaskRow } from '@/lib/types';

interface Props {
  tasks: ScheduledTaskRow[];
}

export function TaskList({ tasks }: Props) {
  if (tasks.length === 0) {
    return (
      <div style={{ color: '#555', fontSize: 13, padding: 16 }}>
        No scheduled tasks.
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr
            style={{
              borderBottom: '1px solid #222',
              color: '#666',
              textAlign: 'left',
            }}
          >
            <Th>ID</Th>
            <Th>Group</Th>
            <Th>Schedule</Th>
            <Th>Next Run</Th>
            <Th>Status</Th>
            <Th>Prompt</Th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} style={{ borderBottom: '1px solid #1a1a1a' }}>
              <Td mono>{truncate(t.id, 12)}</Td>
              <Td>{t.group_folder}</Td>
              <Td mono>
                {t.schedule_type === 'cron'
                  ? t.schedule_value
                  : `${t.schedule_type}: ${t.schedule_value}`}
              </Td>
              <Td mono>{t.next_run ? formatTime(t.next_run) : '-'}</Td>
              <Td>
                <StatusBadge status={t.status} />
              </Td>
              <Td>{truncate(t.prompt, 50)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      style={{
        padding: '8px 10px',
        fontWeight: 500,
        fontSize: 11,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <td
      style={{
        padding: '8px 10px',
        color: '#aaa',
        fontFamily: mono ? 'monospace' : 'inherit',
        fontSize: mono ? 11 : 12,
      }}
    >
      {children}
    </td>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    active: { bg: '#052e16', fg: '#22c55e' },
    paused: { bg: '#1c1917', fg: '#f59e0b' },
    completed: { bg: '#1a1a2e', fg: '#6366f1' },
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

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '...' : s;
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
