/**
 * Event type definitions for the visualization system
 */

export enum EventType {
  // Session events
  SESSION_STARTED = 'session_started',
  SESSION_ENDED = 'session_ended',

  // Turn events
  TURN_STARTED = 'turn_started',
  TURN_COMPLETED = 'turn_completed',

  // Model events
  MODEL_INFO = 'model_info',

  // Stream events
  STREAM_CONTENT = 'stream_content',
  STREAM_THOUGHT = 'stream_thought',
  STREAM_TOOL_CALL_REQUEST = 'stream_tool_call_request',
  STREAM_TOOL_CALL_RESPONSE = 'stream_tool_call_response',
  STREAM_FINISHED = 'stream_finished',
  STREAM_ERROR = 'stream_error',

  // Tool execution events
  TOOL_VALIDATING = 'tool_validating',
  TOOL_SCHEDULED = 'tool_scheduled',
  TOOL_AWAITING_APPROVAL = 'tool_awaiting_approval',
  TOOL_EXECUTING = 'tool_executing',
  TOOL_SUCCESS = 'tool_success',
  TOOL_ERROR = 'tool_error',
  TOOL_CANCELLED = 'tool_cancelled',

  // Telemetry events
  TELEMETRY_TOKEN_UPDATE = 'telemetry_token_update',
  TELEMETRY_API_REQUEST = 'telemetry_api_request',
  TELEMETRY_API_RESPONSE = 'telemetry_api_response',
  TELEMETRY_API_ERROR = 'telemetry_api_error',

  // Core events
  CORE_USER_FEEDBACK = 'core_user_feedback',
  CORE_MODEL_CHANGED = 'core_model_changed',
  CORE_CONSOLE_LOG = 'core_console_log',
  CORE_OUTPUT = 'core_output',
  CORE_FALLBACK_MODE_CHANGED = 'core_fallback_mode_changed',

  // Loop detection events
  LOOP_DETECTED = 'loop_detected',
  LOOP_PATTERN_DETECTED = 'loop_pattern_detected',
  LOOP_LLM_CHECK = 'loop_llm_check',

  // Compression events
  COMPRESSION_TRIGGERED = 'compression_triggered',
  COMPRESSION_COMPLETED = 'compression_completed',
  COMPRESSION_FAILED = 'compression_failed',

  // Model routing events
  MODEL_SELECTED = 'model_selected',
  MODEL_FALLBACK = 'model_fallback',
}

export enum EventSource {
  STREAM = 'stream',
  TOOL = 'tool',
  TELEMETRY = 'telemetry',
  CORE = 'core',
  LOOP_DETECTION = 'loop_detection',
  COMPRESSION = 'compression',
  MODEL_ROUTING = 'model_routing',
}

export enum ArchitectureLayer {
  UI = 'ui',
  CLIENT = 'client',
  CHAT = 'chat',
  TURN = 'turn',
  TOOL = 'tool',
  EXTERNAL = 'external',
}

export enum EventCategory {
  DATA_FLOW = 'data_flow',
  STATE_CHANGE = 'state_change',
  METRIC = 'metric',
  ERROR = 'error',
  DEBUG = 'debug',
}

export interface EventContext {
  sessionTurnCount: number;
  currentModel: string | null;
  promptId: string;
  traceId?: string;
}

export interface EventMeta {
  layer: ArchitectureLayer;
  category: EventCategory;
}

export interface EnrichedEvent {
  id: string;
  timestamp: number;
  type: EventType;
  source: EventSource;
  payload: unknown;
  context: EventContext;
  meta: EventMeta;
}

export interface RawEvent {
  type?: string;
  [key: string]: unknown;
}
