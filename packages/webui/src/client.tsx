import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const wsRef = useRef<WebSocket>();

  useEffect(() => {
    const ws = new WebSocket(`ws://${window.location.host}`);
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'stream_update') {
        setMessages((m) => [...m, data.payload.textChunk]);
      } else if (data.type === 'tool_request') {
        // for simplicity auto-accept
        ws.send(
          JSON.stringify({
            type: 'tool_confirmation',
            payload: { callId: data.payload.callId, outcome: 'accept' },
          }),
        );
      }
    };
    wsRef.current = ws;
  }, []);

  const send = () => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'chat_message', payload: { query: input } }));
    setInput('');
  };

  return (
    <div>
      <div id="chat" style={{ height: '300px', overflow: 'auto', border: '1px solid #ccc' }}>
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} />
      <button onClick={send}>Send</button>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
