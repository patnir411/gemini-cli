import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Config,
  GeminiClient,
  CoreToolScheduler,
  ToolCallConfirmationDetails,
  GeminiEventType,
  ServerGeminiStreamEvent,
  Turn,
} from '@google/gemini-cli-core';

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));

interface Session {
  config: Config;
  client: GeminiClient;
  scheduler: CoreToolScheduler;
}

function createSession(): Session {
  const config = new Config();
  const client = config.getGeminiClient();
  const scheduler = new CoreToolScheduler({
    confirm: async (details: ToolCallConfirmationDetails) => {
      return new Promise((resolve) => {
        // Wait for confirmation via websocket
        confirmationResolvers.set(details.callId, resolve);
      });
    },
    onOutput: (content: string) => {
      // no-op: streamed back to client separately
    },
  });
  return { config, client, scheduler };
}

const confirmationResolvers = new Map<string, (result: string) => void>();

wss.on('connection', (ws: WebSocket) => {
  const session = createSession();

  ws.on('message', async (data) => {
    const msg = JSON.parse(data.toString());
    switch (msg.type) {
      case 'chat_message': {
        const query = msg.payload.query;
        const abortController = new AbortController();
        const stream = session.client.sendMessageStream([{ text: query }], abortController.signal);
        for await (const event of stream) {
          handleEvent(event, ws, session);
        }
        break;
      }
      case 'tool_confirmation': {
        const { callId, outcome, modifiedContent } = msg.payload;
        const resolver = confirmationResolvers.get(callId);
        if (resolver) {
          resolver(JSON.stringify({ outcome, modifiedContent }));
          confirmationResolvers.delete(callId);
        }
        break;
      }
    }
  });
});

function handleEvent(event: ServerGeminiStreamEvent, ws: WebSocket, session: Session) {
  switch (event.type) {
    case GeminiEventType.Content: {
      ws.send(JSON.stringify({ type: 'stream_update', payload: { textChunk: event.value.text } }));
      break;
    }
    case GeminiEventType.ToolCallRequest: {
      const { toolCall } = event.value;
      if (session.scheduler.shouldConfirm(toolCall)) {
        const details = session.scheduler.getConfirmationDetails(toolCall);
        ws.send(
          JSON.stringify({
            type: 'tool_request',
            payload: {
              callId: details.callId,
              toolName: toolCall.name,
              description: toolCall.description,
              details,
            },
          }),
        );
      }
      break;
    }
  }
}

const port = process.env.PORT || 8080;
httpServer.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});
