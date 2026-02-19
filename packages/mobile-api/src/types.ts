/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/** SSE event types sent to the iOS client */
export enum StreamEventType {
  Token = 'token',
  ToolCall = 'tool-call',
  ToolResult = 'tool-result',
  Thought = 'thought',
  Done = 'done',
  Error = 'error',
}

export interface StreamEvent {
  event: StreamEventType;
  data: Record<string, unknown>;
}

export interface ConversationMetadata {
  id: string;
  userId: string;
  title: string;
  model: string;
  createdAt: string;
  lastMessageAt?: string;
  messageCount: number;
  summary?: string;
}

export interface MessageRecord {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'thought';
  content: string;
  createdAt: string;
  toolCalls?: ToolCallRecord[];
  tokenUsage?: TokenUsage;
}

export interface ToolCallRecord {
  name: string;
  arguments: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  result?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
}

export interface CreateConversationRequest {
  title?: string;
  model?: string;
}

export interface SendMessageRequest {
  content: string;
}

export interface AuthenticatedRequest {
  user: {
    uid: string;
    email?: string;
  };
}

export interface ServerConfig {
  port: number;
  geminiApiKey: string;
  defaultModel: string;
  firebaseProjectId?: string;
  maxSessionsPerUser: number;
  sessionTimeoutMs: number;
}
