/**
 * SessionManager - Accesses Gemini CLI session history from ~/.gemini/
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';

export interface SessionInfo {
  id: string;
  fileName: string;
  startTime: string;
  lastUpdated: string;
  messageCount: number;
  firstUserMessage: string;
  model?: string;
}

export interface ConversationRecord {
  sessionId: string;
  projectHash: string;
  startTime: string;
  lastUpdated: string;
  messages: MessageRecord[];
}

export interface MessageRecord {
  id: string;
  timestamp: string;
  type: 'user' | 'gemini' | 'info' | 'error' | 'warning';
  content: any;
  model?: string;
  toolCalls?: any[];
  tokens?: {
    input: number;
    output: number;
    cached: number;
    total: number;
  };
}

export class SessionManager {
  private geminiDir: string;

  constructor() {
    this.geminiDir = path.join(os.homedir(), '.gemini');
  }

  /**
   * Get project hash from project path
   */
  private getProjectHash(projectPath: string): string {
    return crypto.createHash('sha256').update(projectPath).digest('hex');
  }

  /**
   * Get sessions directory for a project
   */
  private getProjectSessionsDir(projectPath: string): string {
    const hash = this.getProjectHash(projectPath);
    return path.join(this.geminiDir, 'tmp', hash, 'chats');
  }

  /**
   * List all sessions for a project
   */
  async listSessions(projectPath: string): Promise<SessionInfo[]> {
    const sessionsDir = this.getProjectSessionsDir(projectPath);

    try {
      const files = await fs.readdir(sessionsDir);
      const sessionFiles = files.filter(f => f.startsWith('session-') && f.endsWith('.json'));

      const sessions: SessionInfo[] = [];

      for (const file of sessionFiles) {
        try {
          const filePath = path.join(sessionsDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const session: ConversationRecord = JSON.parse(content);

          // Find first user message
          const firstUserMsg = session.messages.find(m => m.type === 'user');
          const firstUserText = firstUserMsg ? this.extractTextFromContent(firstUserMsg.content) : '';

          // Find most common model
          const models = session.messages
            .filter(m => m.type === 'gemini' && m.model)
            .map(m => m.model!);
          const mostCommonModel = this.getMostCommon(models);

          sessions.push({
            id: session.sessionId,
            fileName: file,
            startTime: session.startTime,
            lastUpdated: session.lastUpdated,
            messageCount: session.messages.length,
            firstUserMessage: firstUserText.substring(0, 100),
            model: mostCommonModel,
          });
        } catch (err) {
          console.error('[SessionManager] Error reading session file:', file, err);
        }
      }

      // Sort by last updated (newest first)
      sessions.sort((a, b) => new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime());

      return sessions;
    } catch (err) {
      console.error('[SessionManager] Error listing sessions:', err);
      return [];
    }
  }

  /**
   * Load a specific session
   */
  async loadSession(projectPath: string, sessionId: string): Promise<ConversationRecord | null> {
    const sessionsDir = this.getProjectSessionsDir(projectPath);

    try {
      const files = await fs.readdir(sessionsDir);
      const sessionFile = files.find(f => f.includes(sessionId.substring(0, 8)));

      if (!sessionFile) {
        console.error('[SessionManager] Session not found:', sessionId);
        return null;
      }

      const filePath = path.join(sessionsDir, sessionFile);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      console.error('[SessionManager] Error loading session:', err);
      return null;
    }
  }

  /**
   * Convert session to events for replay
   */
  convertSessionToEvents(session: ConversationRecord): any[] {
    const events: any[] = [];
    let turnCount = 0;

    session.messages.forEach((msg) => {
      if (msg.type === 'user') {
        turnCount++;
        events.push({
          type: 'turn_started',
          turnCount,
          timestamp: new Date(msg.timestamp).getTime(),
        });
      }

      if (msg.type === 'gemini') {
        if (msg.model) {
          events.push({
            type: 'model_info',
            model: msg.model,
            timestamp: new Date(msg.timestamp).getTime(),
          });
        }

        if (msg.toolCalls) {
          msg.toolCalls.forEach(tool => {
            events.push({
              type: 'stream_tool_call_request',
              value: tool,
              timestamp: new Date(msg.timestamp).getTime(),
            });
          });
        }

        if (msg.tokens) {
          events.push({
            type: 'stream_finished',
            value: {
              reason: 'STOP',
              usageMetadata: {
                promptTokenCount: msg.tokens.input,
                candidatesTokenCount: msg.tokens.output,
                cachedContentTokenCount: msg.tokens.cached,
                totalTokenCount: msg.tokens.total,
              },
            },
            timestamp: new Date(msg.timestamp).getTime(),
          });
        }
      }
    });

    return events;
  }

  private extractTextFromContent(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(p => p.text)
        .map(p => p.text)
        .join(' ');
    }
    return '';
  }

  private getMostCommon(arr: string[]): string | undefined {
    if (arr.length === 0) return undefined;

    const counts = new Map<string, number>();
    arr.forEach(item => {
      counts.set(item, (counts.get(item) || 0) + 1);
    });

    let maxCount = 0;
    let mostCommon = arr[0];
    counts.forEach((count, item) => {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = item;
      }
    });

    return mostCommon;
  }
}
