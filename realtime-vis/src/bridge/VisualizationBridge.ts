/**
 * VisualizationBridge - Main orchestrator for real-time monitoring
 * Connects Gemini CLI events to the visualization dashboard
 */

import { EventAggregator } from './EventAggregator.js';
import { StateTracker } from './StateTracker.js';
import type { WebSocketServer } from '../server/WebSocketServer.js';
import type { RawEvent } from '../types/events.js';

export interface VisualizationBridgeConfig {
  wsServer: WebSocketServer;
  enablePerformanceMonitoring?: boolean;
}

export class VisualizationBridge {
  private eventAggregator: EventAggregator;
  private stateTracker: StateTracker;
  private wsServer: WebSocketServer;
  private isInitialized: boolean = false;
  private performanceMonitor?: NodeJS.Timeout;

  constructor(config: VisualizationBridgeConfig) {
    this.wsServer = config.wsServer;
    this.eventAggregator = new EventAggregator();
    this.stateTracker = new StateTracker();

    // Connect state tracker to event aggregator for context enrichment
    const self = this;
    this.eventAggregator.setStateTracker({
      get turnCount() { return self.stateTracker.turnCount; },
      get currentModel() { return self.stateTracker.currentModel; },
      get promptId() { return self.stateTracker.promptId; },
    });

    // Forward state changes to WebSocket clients
    this.stateTracker.on('state-changed', (state) => {
      this.wsServer.broadcastState(state);
    });

    // Start performance monitoring if enabled
    if (config.enablePerformanceMonitoring) {
      this.startPerformanceMonitoring();
    }

    console.log('[VisualizationBridge] Initialized');
  }

  /**
   * Initialize the bridge (called after construction if needed for async setup)
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('[VisualizationBridge] Already initialized');
      return;
    }

    this.isInitialized = true;

    // Emit session started event
    this.captureEvent({
      type: 'session_started',
      timestamp: Date.now(),
    });

    console.log('[VisualizationBridge] Ready to capture events');
  }

  /**
   * Capture a raw event, enrich it, update state, and broadcast
   */
  captureEvent(rawEvent: RawEvent): void {
    try {
      console.log('[VisualizationBridge] Capturing event:', rawEvent.type);

      // Enrich the event
      const enrichedEvent = this.eventAggregator.enrich(rawEvent);
      console.log('[VisualizationBridge] Event enriched:', enrichedEvent.type);

      // Update state
      this.stateTracker.update(enrichedEvent);
      console.log('[VisualizationBridge] State updated');

      // Broadcast to connected clients
      this.wsServer.broadcast(enrichedEvent);
      console.log('[VisualizationBridge] Event broadcast to', this.wsServer.getStats().connectedClients, 'clients');
    } catch (error) {
      console.error('[VisualizationBridge] Error capturing event:', error);
      // Don't throw - we don't want to break Gemini CLI if visualization fails
    }
  }

  /**
   * Capture stream events (content, thoughts, tool calls, etc.)
   */
  captureStreamEvent(event: RawEvent): void {
    this.captureEvent(event);
  }

  /**
   * Capture turn start event
   */
  captureTurnStarted(turnCount: number): void {
    this.captureEvent({
      type: 'turn_started',
      turnCount,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture turn completed event
   */
  captureTurnCompleted(turnCount: number, finishReason?: string): void {
    this.captureEvent({
      type: 'turn_completed',
      turnCount,
      finishReason,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture tool state transition
   */
  captureToolStateTransition(
    callId: string,
    name: string,
    status: string,
    details?: { duration?: number; success?: boolean; error?: string }
  ): void {
    const eventType = `tool_${status}` as string;

    this.captureEvent({
      type: eventType,
      callId,
      name,
      status,
      ...details,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture token usage update
   */
  captureTokenUpdate(tokens: {
    total?: number;
    prompt?: number;
    output?: number;
    cached?: number;
    thoughts?: number;
    tools?: number;
    limit?: number;
  }): void {
    this.captureEvent({
      type: 'telemetry_token_update',
      ...tokens,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture API request event
   */
  captureApiRequest(model: string, promptId: string): void {
    this.captureEvent({
      type: 'telemetry_api_request',
      model,
      promptId,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture API response event
   */
  captureApiResponse(model: string, latencyMs: number, tokens?: number): void {
    this.captureEvent({
      type: 'telemetry_api_response',
      model,
      latencyMs,
      tokens,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture loop detection event
   */
  captureLoopDetected(loopType: string, details?: {
    toolCallCount?: number;
    contentCount?: number;
    confidence?: number;
  }): void {
    this.captureEvent({
      type: 'loop_detected',
      loopType,
      ...details,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture compression event
   */
  captureCompression(
    originalTokenCount: number,
    newTokenCount: number,
    status: string
  ): void {
    this.captureEvent({
      type: 'compression_completed',
      originalTokenCount,
      newTokenCount,
      status,
      timestamp: Date.now(),
    });
  }

  /**
   * Capture model selection event
   */
  captureModelSelected(
    model: string,
    fromModel: string | null,
    reason: string,
    isLocked: boolean
  ): void {
    this.captureEvent({
      type: 'model_selected',
      model,
      fromModel,
      toModel: model,
      reason,
      isLocked,
      timestamp: Date.now(),
    });
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    this.performanceMonitor = setInterval(() => {
      const memUsage = process.memoryUsage();

      this.stateTracker.updatePerformanceMetrics({
        memoryUsageMb: memUsage.heapUsed / 1024 / 1024,
      });

      // Calculate events per second
      const stats = this.eventAggregator.getStats();
      const recentEvents = this.eventAggregator.getRecentEvents(100);

      if (recentEvents.length > 1) {
        const timeSpan =
          (recentEvents[recentEvents.length - 1].timestamp - recentEvents[0].timestamp) /
          1000;
        const eventsPerSecond = timeSpan > 0 ? recentEvents.length / timeSpan : 0;

        this.stateTracker.updatePerformanceMetrics({
          eventsPerSecond,
        });
      }

      // Use stats variable to avoid unused warning
      void stats;
    }, 5000); // Update every 5 seconds
  }

  /**
   * Get aggregator statistics
   */
  getStats(): {
    eventStats: ReturnType<EventAggregator['getStats']>;
    wsStats: ReturnType<WebSocketServer['getStats']>;
  } {
    const stats = {
      eventStats: this.eventAggregator.getStats(),
      wsStats: this.wsServer.getStats(),
    };
    return stats;
  }

  /**
   * Get current state
   */
  getCurrentState(): ReturnType<StateTracker['getState']> {
    return this.stateTracker.getState();
  }

  /**
   * Clean shutdown
   */
  shutdown(): void {
    console.log('[VisualizationBridge] Shutting down...');

    if (this.performanceMonitor) {
      clearInterval(this.performanceMonitor);
    }

    // Emit session ended event
    this.captureEvent({
      type: 'session_ended',
      timestamp: Date.now(),
    });

    this.isInitialized = false;
    console.log('[VisualizationBridge] Shutdown complete');
  }
}
