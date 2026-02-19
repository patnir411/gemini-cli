/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import {SessionManager} from './sessions/sessionManager.js';
import {authMiddleware, devAuthMiddleware} from './middleware/auth.js';
import {conversationRouter} from './routes/conversations.js';
import {settingsRouter} from './routes/settings.js';
import {createLogger} from './logger.js';
import type {ServerConfig} from './types.js';

const logger = createLogger('server');

const isDev = process.env['NODE_ENV'] !== 'production';

function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env['PORT'] ?? '8443', 10),
    geminiApiKey: process.env['GEMINI_API_KEY'] ?? '',
    defaultModel: process.env['DEFAULT_MODEL'] ?? 'gemini-2.5-pro',
    firebaseProjectId: process.env['FIREBASE_PROJECT_ID'],
    maxSessionsPerUser: parseInt(process.env['MAX_SESSIONS_PER_USER'] ?? '10', 10),
    sessionTimeoutMs: parseInt(
      process.env['SESSION_TIMEOUT_MS'] ?? String(30 * 60 * 1000),
      10
    ),
  };
}

export function createApp(config?: ServerConfig) {
  const serverConfig = config ?? loadConfig();
  const app = express();

  // Middleware
  app.use(express.json({limit: '1mb'}));

  // CORS for iOS app
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, Accept'
    );
    if (_req.method === 'OPTIONS') {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Auth middleware (dev mode skips Firebase verification)
  app.use(isDev ? devAuthMiddleware : authMiddleware);

  // Health check (no auth required - handled in authMiddleware)
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      version: '0.1.0',
      uptime: process.uptime(),
    });
  });

  // Session manager (bridges to gemini-cli-core)
  const sessionManager = new SessionManager(serverConfig);

  // Routes
  app.use('/api/v1/conversations', conversationRouter(sessionManager));
  app.use('/api/v1/settings', settingsRouter());

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    sessionManager.shutdown();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return {app, sessionManager};
}

// Start the server when run directly
const isMainModule =
  typeof process.argv[1] === 'string' &&
  process.argv[1].includes('server');

if (isMainModule) {
  const serverConfig = loadConfig();
  const {app} = createApp(serverConfig);

  app.listen(serverConfig.port, () => {
    logger.info(
      `Gemini Mobile API server running on port ${serverConfig.port} (${isDev ? 'development' : 'production'} mode)`
    );
    logger.info(`Default model: ${serverConfig.defaultModel}`);
    logger.info(
      `Max sessions per user: ${serverConfig.maxSessionsPerUser}`
    );
  });
}
