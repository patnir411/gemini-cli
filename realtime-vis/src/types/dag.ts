/**
 * DAG (Directed Acyclic Graph) type definitions for execution flow visualization
 */

export enum DAGNodeType {
  TURN = 'turn',
  AGENT = 'agent',
  TOOL = 'tool',
  RESPONSE = 'response',
}

export enum DAGNodeStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCESS = 'success',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

export interface DAGNode {
  id: string;                    // Unique identifier (turnId, callId, agentId)
  type: DAGNodeType;
  label: string;                 // Display name
  status: DAGNodeStatus;
  startTime: number;
  endTime?: number;
  parentId?: string;             // Parent node ID (for hierarchy)
  children: string[];            // Child node IDs
  metadata: {
    model?: string;
    duration?: number;
    tokens?: number;
    args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
    agentName?: string;
    toolName?: string;
  };
}

export interface DAGEdge {
  from: string;                  // Source node ID
  to: string;                    // Target node ID
  type: 'sequence' | 'parallel' | 'subagent';
}

export interface DAGGraph {
  nodes: Map<string, DAGNode>;
  edges: DAGEdge[];
  rootNodes: string[];           // Top-level turn nodes
  currentNode: string | null;    // Currently executing node
}

export interface DAGLayout {
  nodePositions: Map<string, { x: number; y: number }>;
  width: number;
  height: number;
}
