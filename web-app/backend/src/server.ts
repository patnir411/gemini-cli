import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Config, AuthType, CoreToolScheduler, GeminiEventType, ServerGeminiStreamEvent, ToolConfirmationOutcome } from '@google/gemini-cli-core';
import { v4 as uuidv4 } from 'uuid';

function mapEvent(event: ServerGeminiStreamEvent) {
  switch (event.type) {
    case GeminiEventType.Content:
      return { type: 'stream_update', payload: { textChunk: event.value } };
    case GeminiEventType.ToolCallConfirmation:
      return {
        type: 'tool_request',
        payload: {
          callId: event.value.request.callId,
          toolName: event.value.request.name,
          description: '',
          details: event.value.details,
        },
      };
    case GeminiEventType.Error:
      return { type: 'error', payload: { message: event.value.error.message } };
    default:
      return { type: 'debug', payload: event };
  }
}

async function createSession() {
  const sessionId = uuidv4();
  const config = new Config({
    sessionId,
    targetDir: process.cwd(),
    debugMode: false,
    model: 'gemini-1.0-pro',
    cwd: process.cwd(),
  });
  await config.initialize();
  await config.refreshAuth(process.env.GEMINI_AUTH as AuthType | undefined);
  const client = config.getGeminiClient();

  const scheduler = new CoreToolScheduler({
    toolRegistry: config.getToolRegistry(),
    approvalMode: config.getApprovalMode(),
    outputUpdateHandler: () => {},
    onAllToolCallsComplete: () => {},
    onToolCallsUpdate: () => {},
    getPreferredEditor: () => undefined,
    config,
  });

  return { client, scheduler, config };
}

async function main() {
  const app = express();
  const server = createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(express.static('../frontend/dist'));

  wss.on('connection', async (ws) => {
    const { client, scheduler } = await createSession();

    ws.on('message', async (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'chat_message') {
        const controller = new AbortController();
        try {
          for await (const event of client.sendMessageStream(
            [{ text: msg.payload.query }],
            controller.signal,
          )) {
            if (event.type === GeminiEventType.ToolCallRequest) {
              await scheduler.schedule(event.value, controller.signal);
            } else {
              ws.send(JSON.stringify(mapEvent(event)));
            }
          }
        } catch (err) {
          ws.send(
            JSON.stringify({ type: 'error', payload: { message: String(err) } }),
          );
        }
      } else if (msg.type === 'tool_confirmation') {
        const { callId, outcome } = msg.payload;
        await scheduler.handleConfirmationResponse(
          callId,
          async () => {},
          outcome as ToolConfirmationOutcome,
          new AbortController().signal,
        );
      }
    });
  });

  server.listen(3000, () => {
    console.log('BFF listening on port 3000');
  });
}

main().catch((err) => {
  console.error(err);
});
