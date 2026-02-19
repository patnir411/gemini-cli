/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {Request, Response, NextFunction} from 'express';
import {getAuth} from 'firebase-admin/auth';
import {initializeApp, cert, getApps} from 'firebase-admin/app';
import {createLogger} from '../logger.js';

const logger = createLogger('auth');

// Initialize Firebase Admin SDK (once)
if (getApps().length === 0) {
  const serviceAccount = process.env['FIREBASE_SERVICE_ACCOUNT'];
  if (serviceAccount) {
    initializeApp({
      credential: cert(JSON.parse(serviceAccount)),
    });
  } else {
    // Falls back to Application Default Credentials on GCP
    initializeApp();
  }
}

/**
 * Express middleware that validates Firebase Auth ID tokens.
 * Attaches the decoded user (uid, email) to req.user.
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // Allow health check without auth
  if (req.path === '/health') {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({error: 'Missing or invalid Authorization header'});
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = await getAuth().verifyIdToken(token);
    (req as unknown as Record<string, unknown>)['user'] = {
      uid: decoded.uid,
      email: decoded.email,
    };
    next();
  } catch (err) {
    logger.error('Token verification failed', {error: err});
    res.status(401).json({error: 'Invalid or expired token'});
  }
}

/**
 * Development-only middleware that skips Firebase Auth.
 * Uses a static user identity for local testing.
 */
export function devAuthMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  (req as unknown as Record<string, unknown>)['user'] = {
    uid: 'dev-user-001',
    email: 'dev@localhost',
  };
  next();
}
