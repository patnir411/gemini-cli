/**
 * State type definitions for the visualization system
 */

export enum ToolCallStatus {
  VALIDATING = 'validating',
  SCHEDULED = 'scheduled',
  AWAITING_APPROVAL = 'awaiting_approval',
  EXECUTING = 'executing',
  SUCCESS = 'success',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

export enum CompressionStatus {
  COMPRESSED = 'compressed',
  NOOP = 'noop',
  FAILED = 'failed',
}

export enum LoopType {
  TOOL_CALLS = 'tool_calls',
  CONTENT = 'content',
  LLM_DETECTED = 'llm_detected',
}

export interface ToolCallInfo {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolCallStatus;
  startTime: number;
  endTime?: number;
  duration?: number;
  result?: unknown;
  error?: string;
}

export interface ToolCallState {
  callId: string;
  name: string;
  status: ToolCallStatus;
  timestamp: number;
  duration?: number;
}

export interface ToolCallHistory {
  callId: string;
  name: string;
  status: ToolCallStatus;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
}

export interface SessionState {
  turnCount: number;
  maxTurns: number;
  currentModel: string | null;
  sequenceModel: string | null;
  promptId: string;
  isInFallbackMode: boolean;
}

export interface ReActLoopState {
  currentTurn: number;
  isLooping: boolean;
  iterationCount: number;
  pendingToolCalls: ToolCallInfo[];
  finishReason?: string;
}

export interface ToolExecutionState {
  activeTools: Map<string, ToolCallState>;
  history: ToolCallHistory[];
}

export interface LoopDetectionState {
  toolCallLoopCount: number;
  contentLoopCount: number;
  llmCheckInterval: number;
  lastCheckTurn: number;
  disabledForSession: boolean;
  detectedLoops: Array<{
    type: LoopType;
    timestamp: number;
    details: string;
  }>;
}

export interface TokenState {
  total: number;
  prompt: number;
  output: number;
  cached: number;
  thoughts: number;
  tools: number;
  limit: number;
  utilization: number; // 0-100%
}

export interface CompressionState {
  lastAttempt?: {
    originalTokenCount: number;
    newTokenCount: number;
    status: CompressionStatus;
    timestamp: number;
  };
  history: Array<{
    timestamp: number;
    originalTokenCount: number;
    newTokenCount: number;
    status: CompressionStatus;
    reductionPercentage: number;
  }>;
}

export interface ModelRoutingState {
  currentModel: string | null;
  isLocked: boolean;
  routingHistory: Array<{
    timestamp: number;
    fromModel: string | null;
    toModel: string;
    reason: string;
  }>;
  perModelMetrics: Map<string, {
    requestCount: number;
    successCount: number;
    errorCount: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    totalTokens: number;
  }>;
}

export interface PerformanceMetrics {
  apiLatencyMs: number;
  toolExecutionMs: number;
  eventsPerSecond: number;
  memoryUsageMb: number;
}

export interface VisualizationState {
  session: SessionState;
  reactLoop: ReActLoopState;
  toolExecution: ToolExecutionState;
  loopDetection: LoopDetectionState;
  tokens: TokenState;
  compression: CompressionState;
  modelRouting: ModelRoutingState;
  performance: PerformanceMetrics;
  lastUpdated: number;
}
