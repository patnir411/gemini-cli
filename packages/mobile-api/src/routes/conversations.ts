/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import type {SessionManager} from '../sessions/sessionManager.js';
import type {AuthenticatedRequest} from '../types.js';
import {createLogger} from '../logger.js';

const logger = createLogger('conversations');

function getUser(req: Request): {uid: string; email?: string} {
  return (req as unknown as AuthenticatedRequest).user;
}

export function conversationRouter(sessionManager: SessionManager): Router {
  const router = Router();

  /**
   * POST /conversations
   * Create a new conversation.
   */
  router.post('/', async (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const {title, model} = req.body as {title?: string; model?: string};

      const metadata = await sessionManager.createConversation(user.uid, {
        title,
        model,
      });

      res.status(201).json(metadata);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create conversation', {error: message});
      res.status(400).json({error: message});
    }
  });

  /**
   * GET /conversations
   * List all conversations for the authenticated user.
   */
  router.get('/', (req: Request, res: Response) => {
    const user = getUser(req);
    const conversations = sessionManager.listConversations(user.uid);
    res.json(conversations);
  });

  /**
   * GET /conversations/:id
   * Get a specific conversation with message history.
   */
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      const conversation = sessionManager.getConversation(
        req.params['id']!,
        user.uid
      );
      res.json(conversation);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({error: message});
    }
  });

  /**
   * DELETE /conversations/:id
   * Delete a conversation.
   */
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      sessionManager.deleteConversation(req.params['id']!, user.uid);
      res.status(204).send();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({error: message});
    }
  });

  /**
   * POST /conversations/:id/messages
   * Send a message and stream the response via SSE.
   *
   * The response is a Server-Sent Events stream with these event types:
   *   - token: incremental text chunks
   *   - thought: model reasoning/thinking
   *   - tool-call: tool execution started
   *   - tool-result: tool execution completed
   *   - done: response complete with full text and token usage
   *   - error: an error occurred
   */
  router.post('/:id/messages', async (req: Request, res: Response) => {
    const user = getUser(req);
    const conversationId = req.params['id']!;
    const {content} = req.body as {content: string};

    if (!content?.trim()) {
      res.status(400).json({error: 'Message content is required'});
      return;
    }

    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
    });

    // Keep the connection alive with periodic comments
    const keepAlive = setInterval(() => {
      res.write(': keepalive\n\n');
    }, 15_000);

    // Detect client disconnect
    let clientDisconnected = false;
    req.on('close', () => {
      clientDisconnected = true;
      clearInterval(keepAlive);
    });

    try {
      await sessionManager.sendMessage(
        conversationId,
        user.uid,
        content,
        (event) => {
          if (clientDisconnected) return;
          res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
        }
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Stream error for conversation ${conversationId}`, {
        error: message,
      });
      if (!clientDisconnected) {
        res.write(
          `event: error\ndata: ${JSON.stringify({code: 'INTERNAL_ERROR', message})}\n\n`
        );
      }
    } finally {
      clearInterval(keepAlive);
      if (!clientDisconnected) {
        res.end();
      }
    }
  });

  /**
   * POST /conversations/:id/cancel
   * Cancel an active streaming response.
   */
  router.post('/:id/cancel', (req: Request, res: Response) => {
    try {
      const user = getUser(req);
      sessionManager.cancelConversation(req.params['id']!, user.uid);
      res.json({cancelled: true});
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(404).json({error: message});
    }
  });

  return router;
}
