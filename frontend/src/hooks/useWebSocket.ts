/** WebSocket hook */

import { useEffect, useRef, useState } from 'react';
import type { WSEvent } from '../types';

export function useWebSocket(url: string | null, onEvent: (event: WSEvent) => void) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!url) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // 开发模式直接连后端 8080，生产模式走同域
    const host = window.location.port === '5173' ? `${window.location.hostname}:8080` : window.location.host;
    const wsUrl = url.startsWith('ws') ? url : `${protocol}//${host}${url}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onerror = () => setConnected(false);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WSEvent;
        onEventRef.current(data);
      } catch {
        // ignore non-JSON messages
      }
    };

    const heartbeat = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send('ping');
    }, 30000);

    return () => {
      clearInterval(heartbeat);
      ws.close();
    };
  }, [url]);

  return { connected };
}
