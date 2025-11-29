/**
 * WebSocket server for real-time event broadcasting
 * Port: 9333 (default)
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws';
import type { EnrichedEvent } from '../types/events.js';

export class WebSocketServer {
  private wss: WSServer;
  private clients: Set<WebSocket> = new Set();
  private eventQueue: EnrichedEvent[] = [];
  private batchInterval: NodeJS.Timeout;
  private readonly port: number;
  private readonly batchSize: number = 10;
  private readonly batchIntervalMs: number = 50;

  constructor(port: number = 9333) {
    this.port = port;
    this.wss = new WSServer({ port });

    // Set up connection handler
    this.wss.on('connection', this.handleConnection.bind(this));

    // Adaptive batching: flush events every 50ms
    this.batchInterval = setInterval(() => {
      if (this.eventQueue.length > 0) {
        this.flush();
      }
    }, this.batchIntervalMs);

    console.log(`[WebSocket] Server listening on ws://localhost:${this.port}`);
  }

  private handleConnection(ws: WebSocket): void {
    console.log('[WebSocket] Client connected');
    this.clients.add(ws);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        message: 'Connected to Gemini CLI Visualization Server',
        timestamp: Date.now(),
      })
    );

    // Handle disconnect
    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected');
      this.clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('[WebSocket] Client error:', error);
      this.clients.delete(ws);
    });

    // Handle incoming messages (for future bidirectional communication)
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        this.handleClientMessage(ws, message);
      } catch (error) {
        console.error('[WebSocket] Failed to parse message:', error);
      }
    });
  }

  private handleClientMessage(_ws: WebSocket, message: any): void {
    // Handle messages from Gemini CLI or dashboard clients
    console.log('[WebSocket] Received message type:', message?.type);

    if (message && typeof message === 'object') {
      if (message.type === 'event' || message.type === 'stream_event') {
        const event = message.event || message;
        console.log('[WebSocket] Processing event:', event.type);

        // Forward event to onEventReceived callback if set
        if (this.onEventReceived) {
          console.log('[WebSocket] Calling onEventReceived callback');
          this.onEventReceived(event);
        } else {
          console.warn('[WebSocket] No onEventReceived callback set! Events will not be processed.');
        }
      }
    }
  }

  // Callback for receiving events from Gemini CLI
  private onEventReceived?: (event: any) => void;

  /**
   * Set callback for when events are received from Gemini CLI
   */
  setEventCallback(callback: (event: any) => void): void {
    this.onEventReceived = callback;
  }

  /**
   * Broadcast an event to all connected clients
   * Events are queued and sent in batches for efficiency
   */
  broadcast(event: EnrichedEvent): void {
    this.eventQueue.push(event);

    // Immediate flush if queue is large (prevents lag spikes)
    if (this.eventQueue.length >= this.batchSize) {
      this.flush();
    }
  }

  /**
   * Flush queued events to all clients
   */
  private flush(): void {
    if (this.eventQueue.length === 0 || this.clients.size === 0) {
      return;
    }

    const batch = this.eventQueue.splice(0, this.batchSize);
    const message = JSON.stringify({
      type: 'batch',
      events: batch,
      timestamp: Date.now(),
    });

    // Broadcast to all connected clients
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch (error) {
          console.error('[WebSocket] Failed to send to client:', error);
          this.clients.delete(client);
        }
      }
    }
  }

  /**
   * Broadcast state update to all clients
   */
  broadcastState(state: unknown): void {
    // Log what we're broadcasting
    const stateObj = state as any;
    console.log('[WebSocket] Broadcasting state with dagGraph?', !!stateObj.dagGraph,
                'Nodes:', stateObj.dagGraph?.nodes?.length || 0);

    const message = JSON.stringify({
      type: 'state',
      state,
      timestamp: Date.now(),
    });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }

  /**
   * Get server statistics
   */
  getStats(): {
    connectedClients: number;
    queuedEvents: number;
    port: number;
  } {
    return {
      connectedClients: this.clients.size,
      queuedEvents: this.eventQueue.length,
      port: this.port,
    };
  }

  /**
   * Close the WebSocket server
   */
  close(): void {
    clearInterval(this.batchInterval);

    // Close all client connections
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    // Close server
    this.wss.close(() => {
      console.log('[WebSocket] Server closed');
    });
  }
}
