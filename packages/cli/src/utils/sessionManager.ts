/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getProjectTempDir } from '@google/gemini-cli-core';
import { HistoryItem } from '../ui/types.js';

export interface SessionData {
  sessionId: string;
  startTime: string;
  endTime: string;
  history: HistoryItem[];
}

function getSessionsDir(projectRoot: string): string {
  return path.join(getProjectTempDir(projectRoot), 'sessions');
}

export async function saveSession(
  history: HistoryItem[],
  sessionId: string,
  projectRoot: string,
  startTime: Date,
  endTime: Date,
): Promise<void> {
  const dir = getSessionsDir(projectRoot);
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.json`);
  const data: SessionData = {
    sessionId,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
    history,
  };
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf-8');
}

export async function listSessions(projectRoot: string): Promise<SessionData[]> {
  const dir = getSessionsDir(projectRoot);
  try {
    const files = await fs.readdir(dir);
    const sessions: SessionData[] = [];
    for (const f of files) {
      if (!f.endsWith('.json')) continue;
      const raw = await fs.readFile(path.join(dir, f), 'utf-8');
      sessions.push(JSON.parse(raw) as SessionData);
    }
    return sessions.sort(
      (a, b) => new Date(b.endTime).getTime() - new Date(a.endTime).getTime(),
    );
  } catch {
    return [];
  }
}

export async function loadSession(
  sessionId: string,
  projectRoot: string,
): Promise<SessionData | null> {
  const file = path.join(getSessionsDir(projectRoot), `${sessionId}.json`);
  try {
    const raw = await fs.readFile(file, 'utf-8');
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}
