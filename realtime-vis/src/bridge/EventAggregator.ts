/**
 * EventAggregator - Enriches raw events with context and metadata
 * Central hub for event processing and enrichment
 */

import { CircularBuffer } from './CircularBuffer.js';
import type {
  EnrichedEvent,
  RawEvent,
  EventType,
  EventSource,
  ArchitectureLayer,
  EventCategory,
} from '../types/events.js';
import { EventType as ET, EventSource as ES, ArchitectureLayer as AL, EventCategory as EC } from '../types/events.js';

export class EventAggregator {
  private buffer: CircularBuffer<EnrichedEvent>;
  private eventCounter: number = 0;

  // Reference to state tracker for context enrichment
  private stateTracker?: {
    turnCount: number;
    currentModel: string | null;
    promptId: string;
  };

  constructor(bufferCapacity: number = 10000) {
    this.buffer = new CircularBuffer<EnrichedEvent>(bufferCapacity);
  }

  /**
   * Set state tracker reference for context enrichment
   */
  setStateTracker(stateTracker: {
    turnCount: number;
    currentModel: string | null;
    promptId: string;
  }): void {
    this.stateTracker = stateTracker;
  }

  /**
   * Enrich a raw event with context and metadata
   */
  enrich(rawEvent: RawEvent): EnrichedEvent {
    const enrichedEvent: EnrichedEvent = {
      id: this.generateId(),
      timestamp: Date.now(),
      type: this.mapEventType(rawEvent),
      source: this.detectSource(rawEvent),
      payload: rawEvent,
      context: {
        sessionTurnCount: this.stateTracker?.turnCount || 0,
        currentModel: this.stateTracker?.currentModel || null,
        promptId: this.stateTracker?.promptId || 'unknown',
        traceId: this.extractTraceId(rawEvent),
      },
      meta: {
        layer: this.detectLayer(rawEvent),
        category: this.detectCategory(rawEvent),
      },
    };

    // Store in buffer
    this.buffer.push(enrichedEvent);

    return enrichedEvent;
  }

  /**
   * Generate unique event ID
   */
  private generateId(): string {
    return `evt-${Date.now()}-${++this.eventCounter}`;
  }

  /**
   * Map raw event to EventType enum
   */
  private mapEventType(rawEvent: RawEvent): EventType {
    // Check if event already has a type
    if (rawEvent.type && typeof rawEvent.type === 'string') {
      const type = rawEvent.type.toLowerCase().replace(/[_\s]+/g, '_');

      // Try to match against known event types
      const eventTypeMap: Record<string, EventType> = {
        'session_started': ET.SESSION_STARTED,
        'session_ended': ET.SESSION_ENDED,
        'turn_started': ET.TURN_STARTED,
        'turn_completed': ET.TURN_COMPLETED,
        'model_info': ET.MODEL_INFO,
        'stream_content': ET.STREAM_CONTENT,
        'content': ET.STREAM_CONTENT,
        'stream_thought': ET.STREAM_THOUGHT,
        'thought': ET.STREAM_THOUGHT,
        'stream_tool_call_request': ET.STREAM_TOOL_CALL_REQUEST,
        'tool_call_request': ET.STREAM_TOOL_CALL_REQUEST,
        'stream_tool_call_response': ET.STREAM_TOOL_CALL_RESPONSE,
        'tool_call_response': ET.STREAM_TOOL_CALL_RESPONSE,
        'stream_finished': ET.STREAM_FINISHED,
        'finished': ET.STREAM_FINISHED,
        'stream_error': ET.STREAM_ERROR,
        'error': ET.STREAM_ERROR,
        'tool_validating': ET.TOOL_VALIDATING,
        'tool_scheduled': ET.TOOL_SCHEDULED,
        'tool_awaiting_approval': ET.TOOL_AWAITING_APPROVAL,
        'tool_executing': ET.TOOL_EXECUTING,
        'tool_success': ET.TOOL_SUCCESS,
        'tool_error': ET.TOOL_ERROR,
        'tool_cancelled': ET.TOOL_CANCELLED,
        'telemetry_token_update': ET.TELEMETRY_TOKEN_UPDATE,
        'telemetry_api_request': ET.TELEMETRY_API_REQUEST,
        'telemetry_api_response': ET.TELEMETRY_API_RESPONSE,
        'telemetry_api_error': ET.TELEMETRY_API_ERROR,
        'core_user_feedback': ET.CORE_USER_FEEDBACK,
        'core_model_changed': ET.CORE_MODEL_CHANGED,
        'core_console_log': ET.CORE_CONSOLE_LOG,
        'core_output': ET.CORE_OUTPUT,
        'core_fallback_mode_changed': ET.CORE_FALLBACK_MODE_CHANGED,
        'loop_detected': ET.LOOP_DETECTED,
        'loop_pattern_detected': ET.LOOP_PATTERN_DETECTED,
        'loop_llm_check': ET.LOOP_LLM_CHECK,
        'compression_triggered': ET.COMPRESSION_TRIGGERED,
        'compression_completed': ET.COMPRESSION_COMPLETED,
        'compression_failed': ET.COMPRESSION_FAILED,
        'model_selected': ET.MODEL_SELECTED,
        'model_fallback': ET.MODEL_FALLBACK,
      };

      return eventTypeMap[type] || ET.STREAM_CONTENT;
    }

    // Default fallback
    return ET.STREAM_CONTENT;
  }

  /**
   * Detect event source
   */
  private detectSource(rawEvent: RawEvent): EventSource {
    const type = rawEvent.type?.toString().toLowerCase() || '';

    if (type.includes('stream') || type.includes('content') || type.includes('thought')) {
      return ES.STREAM;
    }
    if (type.includes('tool')) {
      return ES.TOOL;
    }
    if (type.includes('telemetry')) {
      return ES.TELEMETRY;
    }
    if (type.includes('core')) {
      return ES.CORE;
    }
    if (type.includes('loop')) {
      return ES.LOOP_DETECTION;
    }
    if (type.includes('compression')) {
      return ES.COMPRESSION;
    }
    if (type.includes('model')) {
      return ES.MODEL_ROUTING;
    }

    return ES.STREAM; // Default
  }

  /**
   * Detect architecture layer
   */
  private detectLayer(rawEvent: RawEvent): ArchitectureLayer {
    const type = rawEvent.type?.toString().toLowerCase() || '';

    // UI layer events
    if (type.includes('user_feedback') || type.includes('console')) {
      return AL.UI;
    }

    // Client layer events
    if (type.includes('turn') || type.includes('session')) {
      return AL.CLIENT;
    }

    // Chat layer events
    if (type.includes('compression') || type.includes('history')) {
      return AL.CHAT;
    }

    // Turn layer events
    if (type.includes('stream') || type.includes('content') || type.includes('thought')) {
      return AL.TURN;
    }

    // Tool layer events
    if (type.includes('tool')) {
      return AL.TOOL;
    }

    // External layer events
    if (type.includes('api') || type.includes('model')) {
      return AL.EXTERNAL;
    }

    return AL.TURN; // Default to turn layer
  }

  /**
   * Detect event category
   */
  private detectCategory(rawEvent: RawEvent): EventCategory {
    const type = rawEvent.type?.toString().toLowerCase() || '';

    if (type.includes('error') || type.includes('failed')) {
      return EC.ERROR;
    }
    if (type.includes('metric') || type.includes('telemetry') || type.includes('token')) {
      return EC.METRIC;
    }
    if (type.includes('state') || type.includes('status') || type.includes('mode')) {
      return EC.STATE_CHANGE;
    }
    if (type.includes('debug') || type.includes('log')) {
      return EC.DEBUG;
    }

    return EC.DATA_FLOW; // Default
  }

  /**
   * Extract trace ID from raw event
   */
  private extractTraceId(rawEvent: RawEvent): string | undefined {
    if ('traceId' in rawEvent && typeof rawEvent.traceId === 'string') {
      return rawEvent.traceId;
    }
    if ('trace_id' in rawEvent && typeof rawEvent.trace_id === 'string') {
      return rawEvent.trace_id as string;
    }
    return undefined;
  }

  /**
   * Get recent events from buffer
   */
  getRecentEvents(limit: number = 100): EnrichedEvent[] {
    return this.buffer.getLast(limit);
  }

  /**
   * Get all events from buffer
   */
  getAllEvents(): EnrichedEvent[] {
    return this.buffer.getAll();
  }

  /**
   * Find events matching predicate
   */
  findEvents(predicate: (event: EnrichedEvent) => boolean): EnrichedEvent[] {
    return this.buffer.find(predicate);
  }

  /**
   * Get events in time range
   */
  getEventsInTimeRange(startTime: number, endTime: number): EnrichedEvent[] {
    return this.buffer.getInTimeRange(startTime, endTime, (event) => event.timestamp);
  }

  /**
   * Get buffer statistics
   */
  getStats(): {
    totalEvents: number;
    bufferSize: number;
    bufferCapacity: number;
    utilizationPercent: number;
  } {
    const bufferStats = this.buffer.getStats();
    return {
      totalEvents: this.eventCounter,
      bufferSize: bufferStats.size,
      bufferCapacity: bufferStats.capacity,
      utilizationPercent: bufferStats.utilizationPercent,
    };
  }

  /**
   * Clear all events from buffer
   */
  clear(): void {
    this.buffer.clear();
    this.eventCounter = 0;
  }
}
