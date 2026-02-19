/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  type ConfigParameters,
  type GeminiClient,
  type ServerGeminiStreamEvent,
  type ToolCallRequestInfo,
  GeminiEventType,
  getAuthTypeFromEnv,
  AuthType,
  PREVIEW_GEMINI_MODEL_AUTO,
  scheduleAgentTools,
} from '@google/gemini-cli-core';
import {v4 as uuidv4} from 'uuid';
import {createLogger} from '../logger.js';
import type {
  ConversationMetadata,
  MessageRecord,
  StreamEvent,
  ServerConfig,
} from '../types.js';
import {StreamEventType} from '../types.js';

const logger = createLogger('session-manager');

interface ConversationSession {
  id: string;
  userId: string;
  config: Config;
  client: GeminiClient;
  abortController: AbortController;
  metadata: ConversationMetadata;
  messages: MessageRecord[];
  lastActivityAt: number;
}

/**
 * SessionManager bridges the iOS mobile API to gemini-cli-core.
 *
 * Each conversation gets its own Config + GeminiClient instance,
 * reusing the exact same streaming pipeline that the CLI uses.
 */
export class SessionManager {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly serverConfig: ServerConfig;
  private cleanupInterval: NodeJS.Timeout | undefined;

  constructor(serverConfig: ServerConfig) {
    this.serverConfig = serverConfig;
    // Evict idle sessions every 5 minutes
    this.cleanupInterval = setInterval(() => this.evictIdleSessions(), 5 * 60 * 1000);
  }

  /**
   * Create a new conversation session.
   * Initializes a fresh Config + GeminiClient just like the SDK agent does.
   */
  async createConversation(
    userId: string,
    opts: {title?: string; model?: string}
  ): Promise<ConversationMetadata> {
    // Enforce per-user session limit
    const userSessionCount = [...this.sessions.values()].filter(
      (s) => s.userId === userId
    ).length;
    if (userSessionCount >= this.serverConfig.maxSessionsPerUser) {
      throw new Error(
        `Maximum sessions (${this.serverConfig.maxSessionsPerUser}) reached. Delete an existing conversation first.`
      );
    }

    const id = uuidv4();
    const model = opts.model ?? this.serverConfig.defaultModel;

    // Create a Config instance (same pattern as the SDK agent)
    const configParams: ConfigParameters = {
      sessionId: `mobile-${id}`,
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: model || PREVIEW_GEMINI_MODEL_AUTO,
      userMemory: 'You are Gemini, an AI assistant accessed through a mobile app. Be concise and helpful.',
      enableHooks: false,
      mcpEnabled: false,
      extensionsEnabled: false,
    };

    const config = new Config(configParams);

    // Initialize auth and content generator
    const authType = getAuthTypeFromEnv() || AuthType.USE_GEMINI;
    await config.refreshAuth(authType);
    await config.initialize();

    const client = config.getGeminiClient();

    const metadata: ConversationMetadata = {
      id,
      userId,
      title: opts.title ?? 'New Conversation',
      model,
      createdAt: new Date().toISOString(),
      messageCount: 0,
    };

    const session: ConversationSession = {
      id,
      userId,
      config,
      client,
      abortController: new AbortController(),
      metadata,
      messages: [],
      lastActivityAt: Date.now(),
    };

    this.sessions.set(id, session);
    logger.info(`Created conversation ${id} for user ${userId}`);

    return metadata;
  }

  /**
   * Send a message to a conversation and stream the response.
   *
   * This uses the same streaming loop as the SDK's GeminiCliAgent.sendStream():
   *   1. Send prompt to GeminiClient
   *   2. Stream events back
   *   3. Collect tool call requests
   *   4. Execute tools via scheduleAgentTools
   *   5. Feed results back to the model
   *   6. Repeat until no more tool calls
   */
  async sendMessage(
    conversationId: string,
    userId: string,
    content: string,
    onEvent: (event: StreamEvent) => void
  ): Promise<void> {
    const session = this.getSession(conversationId, userId);
    session.lastActivityAt = Date.now();

    // Record user message
    const userMessage: MessageRecord = {
      id: uuidv4(),
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    session.messages.push(userMessage);
    session.metadata.messageCount++;

    const client = session.client;
    const signal = session.abortController.signal;
    const sessionId = session.config.getSessionId();

    let fullResponseText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let request: any = [{text: content}];

    try {
      // Agentic loop: send message, handle tool calls, repeat
      while (true) {
        if (signal.aborted) break;

        const stream = client.sendMessageStream(request, signal, sessionId);
        const toolCallsToSchedule: ToolCallRequestInfo[] = [];

        for await (const event of stream) {
          this.handleStreamEvent(event, onEvent, toolCallsToSchedule, sessionId);

          if (event.type === GeminiEventType.Content) {
            fullResponseText += event.value;
          }
          if (event.type === GeminiEventType.Finished) {
            // Extract token usage from the finished event if available
            const finishedValue = event.value as Record<string, unknown>;
            if (finishedValue?.['usageMetadata']) {
              const usage = finishedValue['usageMetadata'] as Record<string, number>;
              inputTokens = usage['promptTokenCount'] ?? 0;
              outputTokens = usage['candidatesTokenCount'] ?? 0;
            }
          }
        }

        // No tool calls means the model is done
        if (toolCallsToSchedule.length === 0) {
          break;
        }

        // Execute tool calls (same as SDK agent)
        const completedCalls = await scheduleAgentTools(
          session.config,
          toolCallsToSchedule,
          {
            schedulerId: sessionId,
            signal,
          }
        );

        // Feed tool results back to the model
        request = completedCalls.flatMap(
          (call) => call.response.responseParts
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Stream error in conversation ${conversationId}`, {error: message});
      onEvent({
        event: StreamEventType.Error,
        data: {code: 'STREAM_ERROR', message},
      });
    }

    // Send done event
    onEvent({
      event: StreamEventType.Done,
      data: {
        fullResponse: fullResponseText,
        usage: {inputTokens, outputTokens},
      },
    });

    // Record assistant message
    const assistantMessage: MessageRecord = {
      id: uuidv4(),
      role: 'assistant',
      content: fullResponseText,
      createdAt: new Date().toISOString(),
      tokenUsage: {inputTokens, outputTokens},
    };
    session.messages.push(assistantMessage);
    session.metadata.messageCount++;
    session.metadata.lastMessageAt = new Date().toISOString();
  }

  /**
   * Map gemini-cli-core stream events to mobile API SSE events.
   */
  private handleStreamEvent(
    event: ServerGeminiStreamEvent,
    onEvent: (event: StreamEvent) => void,
    toolCallsToSchedule: ToolCallRequestInfo[],
    sessionId: string
  ): void {
    switch (event.type) {
      case GeminiEventType.Content:
        onEvent({
          event: StreamEventType.Token,
          data: {text: event.value},
        });
        break;

      case GeminiEventType.Thought:
        onEvent({
          event: StreamEventType.Thought,
          data: {text: event.value},
        });
        break;

      case GeminiEventType.ToolCallRequest: {
        const toolCall = event.value;
        let args = toolCall.args;
        if (typeof args === 'string') {
          args = JSON.parse(args as string);
        }
        toolCallsToSchedule.push({
          ...toolCall,
          args,
          isClientInitiated: false,
          prompt_id: sessionId,
        });
        onEvent({
          event: StreamEventType.ToolCall,
          data: {
            toolName: toolCall.name,
            args: toolCall.args,
            status: 'running',
          },
        });
        break;
      }

      case GeminiEventType.ToolCallResponse:
        onEvent({
          event: StreamEventType.ToolResult,
          data: {
            toolName: (event.value as Record<string, unknown>)['name'] ?? 'unknown',
            status: 'completed',
            result: String((event.value as Record<string, unknown>)['output'] ?? ''),
          },
        });
        break;

      case GeminiEventType.Error:
        onEvent({
          event: StreamEventType.Error,
          data: {code: 'MODEL_ERROR', message: String(event.value)},
        });
        break;

      default:
        // Other event types (Citation, ModelInfo, etc.) are not forwarded to mobile
        break;
    }
  }

  /** Cancel an active streaming response */
  cancelConversation(conversationId: string, userId: string): void {
    const session = this.getSession(conversationId, userId);
    session.abortController.abort();
    session.abortController = new AbortController();
    logger.info(`Cancelled streaming for conversation ${conversationId}`);
  }

  /** Get metadata for all conversations belonging to a user */
  listConversations(userId: string): ConversationMetadata[] {
    return [...this.sessions.values()]
      .filter((s) => s.userId === userId)
      .map((s) => s.metadata)
      .sort((a, b) => {
        const aTime = a.lastMessageAt ?? a.createdAt;
        const bTime = b.lastMessageAt ?? b.createdAt;
        return bTime.localeCompare(aTime);
      });
  }

  /** Get a conversation with its full message history */
  getConversation(
    conversationId: string,
    userId: string
  ): {metadata: ConversationMetadata; messages: MessageRecord[]} {
    const session = this.getSession(conversationId, userId);
    return {
      metadata: session.metadata,
      messages: session.messages,
    };
  }

  /** Delete a conversation and release its resources */
  deleteConversation(conversationId: string, userId: string): void {
    const session = this.sessions.get(conversationId);
    if (!session || session.userId !== userId) {
      throw new Error('Conversation not found');
    }
    session.abortController.abort();
    this.sessions.delete(conversationId);
    logger.info(`Deleted conversation ${conversationId}`);
  }

  /** Shut down the session manager and clean up all sessions */
  shutdown(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    for (const session of this.sessions.values()) {
      session.abortController.abort();
    }
    this.sessions.clear();
    logger.info('SessionManager shut down');
  }

  private getSession(conversationId: string, userId: string): ConversationSession {
    const session = this.sessions.get(conversationId);
    if (!session) {
      throw new Error(`Conversation ${conversationId} not found`);
    }
    if (session.userId !== userId) {
      throw new Error('Access denied');
    }
    return session;
  }

  private evictIdleSessions(): void {
    const now = Date.now();
    const timeout = this.serverConfig.sessionTimeoutMs;

    for (const [id, session] of this.sessions) {
      if (now - session.lastActivityAt > timeout) {
        session.abortController.abort();
        this.sessions.delete(id);
        logger.info(`Evicted idle session ${id} (user: ${session.userId})`);
      }
    }
  }
}
