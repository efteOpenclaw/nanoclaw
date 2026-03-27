'use client';

import { useEffect, useRef, useState } from 'react';
import type { StatusApiResponse } from './types';

export function useSSE(): {
  data: StatusApiResponse | null;
  connected: boolean;
  error: string | null;
} {
  const [data, setData] = useState<StatusApiResponse | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/stream');
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
    };

    es.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.error === 'host_unreachable') {
          setError('Host process unreachable');
          return;
        }
        setData(parsed);
        setError(null);
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      setConnected(false);
      setError('SSE connection lost — reconnecting...');
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  return { data, connected, error };
}
