#!/usr/bin/env node
/**
 * Gemini CLI Real-Time Visualization Server
 * Main entry point
 */

import { WebSocketServer } from './server/WebSocketServer.js';
import { HttpServer } from './server/HttpServer.js';
import { VisualizationBridge } from './bridge/VisualizationBridge.js';
import { SessionManager } from './bridge/SessionManager.js';
import { EventType } from './types/events.js';

// Configuration from environment variables
const WS_PORT = parseInt(process.env.GEMINI_VIZ_PORT || '9333');
const HTTP_PORT = parseInt(process.env.GEMINI_VIZ_HTTP_PORT || '8080');
const DEMO_MODE = process.env.DEMO_MODE === 'true';

async function main() {
  console.log('=== Gemini CLI Real-Time Visualization Server ===\n');

  // Start WebSocket server
  const wsServer = new WebSocketServer(WS_PORT);

  // Start HTTP server
  const httpServer = new HttpServer(HTTP_PORT);

  // Initialize SessionManager
  const sessionManager = new SessionManager();
  httpServer.setSessionManager(sessionManager);

  await httpServer.start();

  // Initialize VisualizationBridge
  const bridge = new VisualizationBridge({
    wsServer,
    enablePerformanceMonitoring: true,
  });
  await bridge.initialize();

  // Set up callback to receive events from Gemini CLI
  wsServer.setEventCallback((event) => {
    bridge.captureEvent(event);
  });

  console.log('\n✅ Server ready!');
  console.log(`\n📊 Dashboard: http://localhost:${HTTP_PORT}`);
  console.log(`🔌 WebSocket: ws://localhost:${WS_PORT}`);
  console.log('\n💡 Start Gemini CLI with: GEMINI_VISUALIZATION=true npm start');
  console.log('\nPress Ctrl+C to stop\n');

  // Demo mode: Send test events every 2 seconds (only if DEMO_MODE=true)
  let demoInterval: NodeJS.Timeout | undefined;
  if (DEMO_MODE) {
    console.log('⚠️  Running in DEMO mode (sending mock events)\n');

    let eventCounter = 0;
    demoInterval = setInterval(() => {
      // Send various event types for testing
      const eventTypes = [
        EventType.STREAM_CONTENT,
        EventType.STREAM_THOUGHT,
        EventType.TOOL_VALIDATING,
        EventType.TOOL_EXECUTING,
        EventType.TOOL_SUCCESS,
      ];

      const randomType = eventTypes[eventCounter % eventTypes.length];

      bridge.captureEvent({
        type: randomType.toString(),
        message: `Demo event ${++eventCounter}`,
        data: `Test data for ${randomType}`,
        timestamp: Date.now(),
      });

      const stats = wsServer.getStats();
      if (stats.connectedClients > 0) {
        console.log(
          `[Demo] Sent event ${eventCounter} (${randomType}) to ${stats.connectedClients} client(s)`
        );
      }
    }, 2000);
  } else {
    console.log('ℹ️  Waiting for Gemini CLI connection...\n');
    console.log('   The server will receive events when you run:');
    console.log('   GEMINI_VISUALIZATION=true gemini\n');
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n\nShutting down...');
    if (demoInterval) clearInterval(demoInterval);
    bridge.shutdown();
    wsServer.close();
    await httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Export bridge for external use
export { VisualizationBridge } from './bridge/VisualizationBridge.js';
export { EventAggregator } from './bridge/EventAggregator.js';
export { StateTracker } from './bridge/StateTracker.js';

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
