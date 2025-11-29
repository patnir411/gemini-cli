/**
 * DAGBuilder - Constructs execution flow DAG from event stream
 * Tracks hierarchical relationships: Turns → Agents → Subagents → Tools
 */

import type { EnrichedEvent } from '../types/events.js';
import { EventType } from '../types/events.js';
import type { DAGNode, DAGGraph } from '../types/dag.js';
import { DAGNodeType, DAGNodeStatus } from '../types/dag.js';

export class DAGBuilder {
  private graph: DAGGraph;
  private turnStack: string[] = []; // Stack of current turn IDs
  private agentStack: string[] = []; // Stack for agent hierarchy

  constructor() {
    this.graph = {
      nodes: new Map(),
      edges: [],
      rootNodes: [],
      currentNode: null,
    };
  }

  /**
   * Process an event and update the DAG
   */
  processEvent(event: EnrichedEvent): void {
    console.log('[DAGBuilder] Processing event:', event.type);

    switch (event.type) {
      case EventType.TURN_STARTED:
        this.handleTurnStarted(event);
        break;

      case EventType.TURN_COMPLETED:
        this.handleTurnCompleted(event);
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

      default:
        // Log unhandled events for debugging
        if (event.type.toString().includes('tool') || event.type.toString().includes('agent')) {
          console.log('[DAGBuilder] Unhandled event type:', event.type);
        }
    }

    console.log('[DAGBuilder] Graph now has', this.graph.nodes.size, 'nodes');
  }

  private handleTurnStarted(event: EnrichedEvent): void {
    const turnId = `turn-${event.context.sessionTurnCount}`;

    console.log('[DAGBuilder] Creating turn node:', turnId);

    const turnNode: DAGNode = {
      id: turnId,
      type: DAGNodeType.TURN,
      label: `Turn ${event.context.sessionTurnCount}`,
      status: DAGNodeStatus.RUNNING,
      startTime: event.timestamp,
      children: [],
      metadata: {
        model: event.context.currentModel || undefined,
      },
    };

    this.graph.nodes.set(turnId, turnNode);
    this.graph.rootNodes.push(turnId);
    this.graph.currentNode = turnId;
    this.turnStack.push(turnId);

    console.log('[DAGBuilder] Turn node created. Total nodes:', this.graph.nodes.size);
  }

  private handleTurnCompleted(event: EnrichedEvent): void {
    const turnId = this.turnStack[this.turnStack.length - 1];
    if (!turnId) return;

    const node = this.graph.nodes.get(turnId);
    if (node) {
      node.status = DAGNodeStatus.SUCCESS;
      node.endTime = event.timestamp;
      node.metadata.duration = event.timestamp - node.startTime;
    }

    this.turnStack.pop();
  }

  private handleToolCallRequest(event: EnrichedEvent): void {
    const payload = event.payload as any;

    console.log('[DAGBuilder] Tool call request payload:', payload);

    if (!payload || !payload.value) {
      console.warn('[DAGBuilder] Tool call request missing value');
      return;
    }

    const tool = payload.value;
    const toolId = tool.callId || `tool-${event.timestamp}`;

    console.log('[DAGBuilder] Creating tool node:', toolId, tool.name);

    // Determine parent (current turn or agent)
    const parentId = this.agentStack[this.agentStack.length - 1] ||
                     this.turnStack[this.turnStack.length - 1];

    // Check if this is a subagent (tool name ends with 'agent' or specific agents)
    const isAgent = tool.name.includes('agent') ||
                    tool.name === 'codebase_investigator';

    const nodeType = isAgent ? DAGNodeType.AGENT : DAGNodeType.TOOL;

    const toolNode: DAGNode = {
      id: toolId,
      type: nodeType,
      label: tool.name,
      status: DAGNodeStatus.RUNNING,
      startTime: event.timestamp,
      parentId,
      children: [],
      metadata: {
        toolName: tool.name,
        args: tool.args,
        agentName: isAgent ? tool.name : undefined,
      },
    };

    this.graph.nodes.set(toolId, toolNode);

    // Add to parent's children
    if (parentId) {
      const parent = this.graph.nodes.get(parentId);
      if (parent && !parent.children.includes(toolId)) {
        parent.children.push(toolId);

        // Add edge
        this.graph.edges.push({
          from: parentId,
          to: toolId,
          type: isAgent ? 'subagent' : 'sequence',
        });
      }
    }

    // If agent, push to agent stack for nesting
    if (isAgent) {
      this.agentStack.push(toolId);
    }

    this.graph.currentNode = toolId;
  }

  private handleToolCallResponse(event: EnrichedEvent): void {
    const payload = event.payload as any;
    if (!payload || !payload.value) return;

    const callId = payload.value.callId;
    const node = this.graph.nodes.get(callId);

    if (node) {
      const hasError = payload.value.error || payload.value.errorType;
      node.status = hasError ? DAGNodeStatus.ERROR : DAGNodeStatus.SUCCESS;
      node.endTime = event.timestamp;
      node.metadata.duration = event.timestamp - node.startTime;
      node.metadata.result = payload.value.resultDisplay || payload.value.result;
      node.metadata.error = payload.value.error;

      // Pop from agent stack if this was an agent
      if (node.type === DAGNodeType.AGENT && this.agentStack[this.agentStack.length - 1] === callId) {
        this.agentStack.pop();
      }
    }
  }

  private handleStreamFinished(event: EnrichedEvent): void {
    const payload = event.payload as any;
    const turnId = this.turnStack[this.turnStack.length - 1];

    if (turnId) {
      const turnNode = this.graph.nodes.get(turnId);
      if (turnNode) {
        turnNode.metadata.tokens = payload?.value?.usageMetadata?.totalTokenCount ||
                                   payload?.usageMetadata?.totalTokenCount || 0;
      }
    }
  }

  /**
   * Get current DAG graph
   */
  getGraph(): DAGGraph {
    // Return serializable copy
    return {
      nodes: this.graph.nodes,
      edges: [...this.graph.edges],
      rootNodes: [...this.graph.rootNodes],
      currentNode: this.graph.currentNode,
    };
  }

  /**
   * Clear the DAG (for new session)
   */
  clear(): void {
    this.graph.nodes.clear();
    this.graph.edges = [];
    this.graph.rootNodes = [];
    this.graph.currentNode = null;
    this.turnStack = [];
    this.agentStack = [];
  }
}
