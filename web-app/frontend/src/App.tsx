import React, { useEffect, useState } from 'react';

export default function App() {
  const [messages, setMessages] = useState<string[]>([]);
  const [input, setInput] = useState('');
  const [ws, setWs] = useState<WebSocket | null>(null);

  useEffect(() => {
    const socket = new WebSocket('ws://localhost:3000');
    socket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'stream_update') {
        setMessages((prev) => [...prev, msg.payload.textChunk]);
      }
    };
    setWs(socket);
    return () => socket.close();
  }, []);

  const send = () => {
    if (!ws) return;
    ws.send(JSON.stringify({ type: 'chat_message', payload: { query: input } }));
    setInput('');
  };

  return (
    <div>
      <div id="messages">
        {messages.map((m, i) => (
          <div key={i}>{m}</div>
        ))}
      </div>
      <input value={input} onChange={(e) => setInput(e.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
}
