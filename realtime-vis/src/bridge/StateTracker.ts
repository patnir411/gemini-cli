/**
 * StateTracker - Tracks comprehensive state of Gemini CLI execution
 * Maintains real-time state machine for all aspects of the agent system
 */

import { EventEmitter } from 'events';
import type { EnrichedEvent } from '../types/events.js';
import { EventType } from '../types/events.js';
import type {
  VisualizationState,
  ToolCallInfo,
  ToolCallState,
  ToolCallHistory,
  ToolCallStatus,
  CompressionStatus,
  LoopType,
} from '../types/state.js';
import {
  ToolCallStatus as TCS,
  CompressionStatus as CS,
  LoopType as LT,
} from '../types/state.js';
import { DAGBuilder } from './DAGBuilder.js';
import type { DAGGraph } from '../types/dag.js';

export class StateTracker extends EventEmitter {
  private state: VisualizationState;
  private dagBuilder: DAGBuilder;

  constructor() {
    super();

    // Initialize DAG builder
    this.dagBuilder = new DAGBuilder();

    // Initialize state
    this.state = {
      session: {
        turnCount: 0,
        maxTurns: 100,
        currentModel: null,
        sequenceModel: null,
        promptId: 'initial',
        isInFallbackMode: false,
      },
      reactLoop: {
        currentTurn: 0,
        isLooping: false,
        iterationCount: 0,
        pendingToolCalls: [],
        finishReason: undefined,
      },
      toolExecution: {
        activeTools: new Map(),
        history: [],
      },
      loopDetection: {
        toolCallLoopCount: 0,
        contentLoopCount: 0,
        llmCheckInterval: 3,
        lastCheckTurn: 0,
        disabledForSession: false,
        detectedLoops: [],
      },
      tokens: {
        total: 0,
        prompt: 0,
        output: 0,
        cached: 0,
        thoughts: 0,
        tools: 0,
        limit: 1000000, // Default 1M token limit
        utilization: 0,
      },
      compression: {
        history: [],
      },
      modelRouting: {
        currentModel: null,
        isLocked: false,
        routingHistory: [],
        perModelMetrics: new Map(),
      },
      performance: {
        apiLatencyMs: 0,
        toolExecutionMs: 0,
        eventsPerSecond: 0,
        memoryUsageMb: 0,
      },
      lastUpdated: Date.now(),
    };
  }

  /**
   * Update state based on incoming event
   */
  update(event: EnrichedEvent): void {
    this.state.lastUpdated = Date.now();

    // Update DAG
    this.dagBuilder.processEvent(event);

    switch (event.type) {
      case EventType.SESSION_STARTED:
        this.handleSessionStarted(event);
        break;

      case EventType.TURN_STARTED:
        this.handleTurnStarted();
        break;

      case EventType.TURN_COMPLETED:
        this.handleTurnCompleted();
        break;

      case EventType.STREAM_CONTENT:
        this.handleStreamContent();
        break;

      case EventType.STREAM_THOUGHT:
        this.handleStreamThought();
        break;

      case EventType.STREAM_TOOL_CALL_REQUEST:
        this.handleToolCallRequest(event);
        break;

      case EventType.STREAM_TOOL_CALL_RESPONSE:
        this.handleToolCallResponse(event);
        break;

      case EventType.STREAM_FINISHED:
        this.handleStreamFinished(event);
        break;

      case EventType.TOOL_VALIDATING:
      case EventType.TOOL_SCHEDULED:
      case EventType.TOOL_AWAITING_APPROVAL:
      case EventType.TOOL_EXECUTING:
      case EventType.TOOL_SUCCESS:
      case EventType.TOOL_ERROR:
      case EventType.TOOL_CANCELLED:
        this.handleToolStateTransition(event);
        break;

      case EventType.TELEMETRY_TOKEN_UPDATE:
        this.handleTokenUpdate(event);
        break;

      case EventType.TELEMETRY_API_RESPONSE:
        this.handleApiResponse(event);
        break;

      case EventType.MODEL_INFO:
      case EventType.CORE_MODEL_CHANGED:
        this.handleModelChanged(event);
        break;

      case EventType.CORE_FALLBACK_MODE_CHANGED:
        this.handleFallbackModeChanged(event);
        break;

      case EventType.LOOP_DETECTED:
      case EventType.LOOP_PATTERN_DETECTED:
      case EventType.LOOP_LLM_CHECK:
        this.handleLoopDetection(event);
        break;

      case EventType.COMPRESSION_TRIGGERED:
      case EventType.COMPRESSION_COMPLETED:
      case EventType.COMPRESSION_FAILED:
        this.handleCompression(event);
        break;

      case EventType.MODEL_SELECTED:
      case EventType.MODEL_FALLBACK:
        this.handleModelRouting(event);
        break;
    }

    // Emit state change event with dagGraph included
    this.emit('state-changed', this.getState());
  }

  private handleSessionStarted(_event: EnrichedEvent): void {
    this.state.session.turnCount = 0;
    this.state.session.promptId = _event.context.promptId;
  }

  private handleTurnStarted(): void {
    this.state.session.turnCount++;
    this.state.reactLoop.currentTurn++;
    this.state.reactLoop.iterationCount = 0;
    this.state.reactLoop.finishReason = undefined;
  }

  private handleTurnCompleted(): void {
    this.state.reactLoop.iterationCount = 0;
  }

  private handleStreamContent(): void {
    // Track streaming activity
    this.state.reactLoop.iterationCount++;
  }

  private handleStreamThought(): void {
    // Extended thinking mode active
  }

  private handleToolCallRequest(event: EnrichedEvent): void {
    const payload = event.payload as { callId?: string; name?: string; args?: unknown };

    if (!payload.callId || !payload.name) return;

    const toolCall: ToolCallInfo = {
      callId: payload.callId,
      name: payload.name,
      args: (payload.args as Record<string, unknown>) || {},
      status: TCS.VALIDATING,
      startTime: event.timestamp,
    };

    this.state.reactLoop.pendingToolCalls.push(toolCall);
  }

  private handleToolCallResponse(event: EnrichedEvent): void {
    const payload = event.payload as { callId?: string };

    if (!payload.callId) return;

    // Remove from pending
    this.state.reactLoop.pendingToolCalls = this.state.reactLoop.pendingToolCalls.filter(
      (tool) => tool.callId !== payload.callId
    );
  }

  private handleStreamFinished(event: EnrichedEvent): void {
    const payload = event.payload as { reason?: string };
    this.state.reactLoop.finishReason = payload.reason;
  }

  private handleToolStateTransition(event: EnrichedEvent): void {
    const payload = event.payload as {
      callId?: string;
      name?: string;
      status?: string;
      duration?: number;
      success?: boolean;
      result?: unknown;
      error?: string;
    };

    if (!payload.callId || !payload.name) return;

    const status = this.mapToolStatus(event.type);

    // Update active tools
    const toolState: ToolCallState = {
      callId: payload.callId,
      name: payload.name,
      status,
      timestamp: event.timestamp,
      duration: payload.duration,
    };

    this.state.toolExecution.activeTools.set(payload.callId, toolState);

    // If tool is terminal state, move to history
    if (
      status === TCS.SUCCESS ||
      status === TCS.ERROR ||
      status === TCS.CANCELLED
    ) {
      const history: ToolCallHistory = {
        callId: payload.callId,
        name: payload.name,
        status,
        startTime: event.timestamp - (payload.duration || 0),
        endTime: event.timestamp,
        duration: payload.duration || 0,
        success: status === TCS.SUCCESS,
      };

      this.state.toolExecution.history.push(history);
      this.state.toolExecution.activeTools.delete(payload.callId);

      // Keep only last 100 tool calls in history
      if (this.state.toolExecution.history.length > 100) {
        this.state.toolExecution.history.shift();
      }
    }
  }

  private mapToolStatus(eventType: EventType): ToolCallStatus {
    switch (eventType) {
      case EventType.TOOL_VALIDATING:
        return TCS.VALIDATING;
      case EventType.TOOL_SCHEDULED:
        return TCS.SCHEDULED;
      case EventType.TOOL_AWAITING_APPROVAL:
        return TCS.AWAITING_APPROVAL;
      case EventType.TOOL_EXECUTING:
        return TCS.EXECUTING;
      case EventType.TOOL_SUCCESS:
        return TCS.SUCCESS;
      case EventType.TOOL_ERROR:
        return TCS.ERROR;
      case EventType.TOOL_CANCELLED:
        return TCS.CANCELLED;
      default:
        return TCS.VALIDATING;
    }
  }

  private handleTokenUpdate(event: EnrichedEvent): void {
    const payload = event.payload as {
      total?: number;
      prompt?: number;
      output?: number;
      cached?: number;
      thoughts?: number;
      tools?: number;
      limit?: number;
    };

    if (payload.total !== undefined) this.state.tokens.total = payload.total;
    if (payload.prompt !== undefined) this.state.tokens.prompt = payload.prompt;
    if (payload.output !== undefined) this.state.tokens.output = payload.output;
    if (payload.cached !== undefined) this.state.tokens.cached = payload.cached;
    if (payload.thoughts !== undefined) this.state.tokens.thoughts = payload.thoughts;
    if (payload.tools !== undefined) this.state.tokens.tools = payload.tools;
    if (payload.limit !== undefined) this.state.tokens.limit = payload.limit;

    // Calculate utilization percentage
    this.state.tokens.utilization =
      this.state.tokens.limit > 0
        ? (this.state.tokens.total / this.state.tokens.limit) * 100
        : 0;
  }

  private handleApiResponse(event: EnrichedEvent): void {
    const payload = event.payload as { latencyMs?: number };

    if (payload.latencyMs !== undefined) {
      // Running average
      if (this.state.performance.apiLatencyMs === 0) {
        this.state.performance.apiLatencyMs = payload.latencyMs;
      } else {
        this.state.performance.apiLatencyMs =
          (this.state.performance.apiLatencyMs * 0.9) + (payload.latencyMs * 0.1);
      }
    }
  }

  private handleModelChanged(event: EnrichedEvent): void {
    // Handle multiple payload formats
    let model: string | undefined;

    const payload = event.payload as any;

    // Format 1: payload is string directly (ModelInfo event)
    if (typeof payload === 'string') {
      model = payload;
    }
    // Format 2: payload.value is string
    else if (payload && typeof payload.value === 'string') {
      model = payload.value;
    }
    // Format 3: payload.model
    else if (payload && typeof payload.model === 'string') {
      model = payload.model;
    }

    if (model) {
      this.state.session.currentModel = model;
      this.state.modelRouting.currentModel = model;
    }
  }

  private handleFallbackModeChanged(event: EnrichedEvent): void {
    const payload = event.payload as { isInFallbackMode?: boolean };

    if (payload.isInFallbackMode !== undefined) {
      this.state.session.isInFallbackMode = payload.isInFallbackMode;
    }
  }

  private handleLoopDetection(event: EnrichedEvent): void {
    const payload = event.payload as {
      loopType?: string;
      toolCallCount?: number;
      contentCount?: number;
      confidence?: number;
    };

    if (event.type === EventType.LOOP_DETECTED) {
      this.state.reactLoop.isLooping = true;

      // Determine loop type
      let loopType: LoopType = LT.CONTENT;
      if (payload.loopType === 'tool_calls') loopType = LT.TOOL_CALLS;
      else if (payload.loopType === 'llm_detected') loopType = LT.LLM_DETECTED;

      this.state.loopDetection.detectedLoops.push({
        type: loopType,
        timestamp: event.timestamp,
        details: `Loop detected: ${payload.loopType || 'unknown'}`,
      });

      // Keep only last 10 detected loops
      if (this.state.loopDetection.detectedLoops.length > 10) {
        this.state.loopDetection.detectedLoops.shift();
      }
    }

    if (payload.toolCallCount !== undefined) {
      this.state.loopDetection.toolCallLoopCount = payload.toolCallCount;
    }

    if (payload.contentCount !== undefined) {
      this.state.loopDetection.contentLoopCount = payload.contentCount;
    }
  }

  private handleCompression(event: EnrichedEvent): void {
    const payload = event.payload as {
      originalTokenCount?: number;
      newTokenCount?: number;
      status?: string;
    };

    if (event.type === EventType.COMPRESSION_COMPLETED) {
      const originalCount = payload.originalTokenCount || 0;
      const newCount = payload.newTokenCount || 0;
      const status = this.mapCompressionStatus(payload.status);

      this.state.compression.lastAttempt = {
        originalTokenCount: originalCount,
        newTokenCount: newCount,
        status,
        timestamp: event.timestamp,
      };

      // Add to history
      this.state.compression.history.push({
        timestamp: event.timestamp,
        originalTokenCount: originalCount,
        newTokenCount: newCount,
        status,
        reductionPercentage:
          originalCount > 0
            ? ((originalCount - newCount) / originalCount) * 100
            : 0,
      });

      // Keep only last 20 compression attempts
      if (this.state.compression.history.length > 20) {
        this.state.compression.history.shift();
      }
    }
  }

  private mapCompressionStatus(status: string | undefined): CompressionStatus {
    if (!status) return CS.NOOP;

    const normalized = status.toLowerCase();
    if (normalized.includes('compressed') || normalized.includes('success')) {
      return CS.COMPRESSED;
    }
    if (normalized.includes('fail') || normalized.includes('error')) {
      return CS.FAILED;
    }
    return CS.NOOP;
  }

  private handleModelRouting(event: EnrichedEvent): void {
    const payload = event.payload as {
      model?: string;
      fromModel?: string;
      toModel?: string;
      reason?: string;
      isLocked?: boolean;
    };

    if (event.type === EventType.MODEL_SELECTED && payload.model) {
      this.state.modelRouting.currentModel = payload.model;

      if (payload.isLocked !== undefined) {
        this.state.modelRouting.isLocked = payload.isLocked;
      }

      // Add to routing history
      if (payload.fromModel && payload.toModel) {
        this.state.modelRouting.routingHistory.push({
          timestamp: event.timestamp,
          fromModel: payload.fromModel,
          toModel: payload.toModel,
          reason: payload.reason || 'unknown',
        });

        // Keep only last 50 routing decisions
        if (this.state.modelRouting.routingHistory.length > 50) {
          this.state.modelRouting.routingHistory.shift();
        }
      }
    }

    // Update per-model metrics
    if (payload.model) {
      this.updateModelMetrics(payload.model, event);
    }
  }

  private updateModelMetrics(model: string, event: EnrichedEvent): void {
    if (!this.state.modelRouting.perModelMetrics.has(model)) {
      this.state.modelRouting.perModelMetrics.set(model, {
        requestCount: 0,
        successCount: 0,
        errorCount: 0,
        totalLatencyMs: 0,
        avgLatencyMs: 0,
        totalTokens: 0,
      });
    }

    const metrics = this.state.modelRouting.perModelMetrics.get(model)!;

    if (event.type === EventType.TELEMETRY_API_REQUEST) {
      metrics.requestCount++;
    }

    if (event.type === EventType.TELEMETRY_API_RESPONSE) {
      metrics.successCount++;
      const payload = event.payload as { latencyMs?: number; tokens?: number };

      if (payload.latencyMs) {
        metrics.totalLatencyMs += payload.latencyMs;
        metrics.avgLatencyMs = metrics.totalLatencyMs / metrics.successCount;
      }

      if (payload.tokens) {
        metrics.totalTokens += payload.tokens;
      }
    }

    if (event.type === EventType.TELEMETRY_API_ERROR) {
      metrics.errorCount++;
    }
  }

  /**
   * Get current complete state
   */
  getState(): VisualizationState & { dagGraph?: any } {
    const dagGraph = this.dagBuilder.getGraph();

    return JSON.parse(JSON.stringify({
      ...this.state,
      toolExecution: {
        ...this.state.toolExecution,
        activeTools: Array.from(this.state.toolExecution.activeTools.entries()).map(
          ([id, tool]) => ({ id, ...tool })
        ),
      },
      modelRouting: {
        ...this.state.modelRouting,
        perModelMetrics: Array.from(this.state.modelRouting.perModelMetrics.entries()).map(
          ([model, metrics]) => ({ model, ...metrics })
        ),
      },
      dagGraph: {
        nodes: Array.from(dagGraph.nodes.values()),
        edges: dagGraph.edges,
        rootNodes: dagGraph.rootNodes,
        currentNode: dagGraph.currentNode,
      },
    }));
  }

  /**
   * Get DAG graph
   */
  getDAGGraph(): DAGGraph {
    return this.dagBuilder.getGraph();
  }

  /**
   * Get current turn count
   */
  get turnCount(): number {
    return this.state.session.turnCount;
  }

  /**
   * Get current model
   */
  get currentModel(): string | null {
    return this.state.session.currentModel;
  }

  /**
   * Get current prompt ID
   */
  get promptId(): string {
    return this.state.session.promptId;
  }

  /**
   * Reset state (for new session)
   */
  reset(): void {
    this.state.session.turnCount = 0;
    this.state.reactLoop.currentTurn = 0;
    this.state.reactLoop.pendingToolCalls = [];
    this.state.toolExecution.activeTools.clear();
    this.state.toolExecution.history = [];
    this.state.loopDetection.detectedLoops = [];
    this.state.compression.history = [];
    this.state.modelRouting.routingHistory = [];
    this.state.modelRouting.perModelMetrics.clear();

    this.emit('state-changed', this.state);
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(metrics: {
    apiLatencyMs?: number;
    toolExecutionMs?: number;
    eventsPerSecond?: number;
    memoryUsageMb?: number;
  }): void {
    if (metrics.apiLatencyMs !== undefined) {
      this.state.performance.apiLatencyMs = metrics.apiLatencyMs;
    }
    if (metrics.toolExecutionMs !== undefined) {
      this.state.performance.toolExecutionMs = metrics.toolExecutionMs;
    }
    if (metrics.eventsPerSecond !== undefined) {
      this.state.performance.eventsPerSecond = metrics.eventsPerSecond;
    }
    if (metrics.memoryUsageMb !== undefined) {
      this.state.performance.memoryUsageMb = metrics.memoryUsageMb;
    }
  }
}
