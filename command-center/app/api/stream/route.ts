import { NextResponse } from 'next/server';
import { STATUS_API } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      const poll = async () => {
        try {
          const res = await fetch(`${STATUS_API}/status`, {
            signal: AbortSignal.timeout(4000),
          });
          if (res.ok) {
            const json = await res.json();
            sendEvent(JSON.stringify(json));
          }
        } catch {
          sendEvent(
            JSON.stringify({ error: 'host_unreachable', timestamp: Date.now() }),
          );
        }
      };

      await poll();
      const interval = setInterval(poll, 5000);

      controller.enqueue(encoder.encode(': connected\n\n'));

      return () => clearInterval(interval);
    },
    cancel() {
      // client disconnected
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
