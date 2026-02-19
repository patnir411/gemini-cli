/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {createLogger} from '../logger.js';

const logger = createLogger('settings');

interface UserSettings {
  model?: string;
  approvalMode?: string;
}

// In-memory settings store (replace with Firestore in production)
const userSettings = new Map<string, UserSettings>();

export function settingsRouter(): Router {
  const router = Router();

  /**
   * GET /settings
   * Get user settings.
   */
  router.get('/', (req: Request, res: Response) => {
    const uid = ((req as unknown as Record<string, Record<string, string>>)['user'])['uid'];
    const settings = userSettings.get(uid!) ?? {
      model: 'gemini-2.5-pro',
      approvalMode: 'auto_edit',
    };
    res.json(settings);
  });

  /**
   * PUT /settings
   * Update user settings.
   */
  router.put('/', (req: Request, res: Response) => {
    const uid = ((req as unknown as Record<string, Record<string, string>>)['user'])['uid'];
    const body = req.body as UserSettings;

    const existing = userSettings.get(uid!) ?? {};
    const updated = {...existing, ...body};
    userSettings.set(uid!, updated);

    logger.info(`Updated settings for user ${uid}`);
    res.json(updated);
  });

  return router;
}
