/**
 * HTTP server for serving the dashboard
 * Port: 8080 (default)
 */

import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class HttpServer {
  private server: http.Server;
  private readonly port: number;
  private readonly publicDir: string;
  private sessionManager: any; // Will be set externally

  constructor(port: number = 8080) {
    this.port = port;
    // Public directory is at root/public
    this.publicDir = path.join(__dirname, '../../public');

    this.server = http.createServer(this.handleRequest.bind(this));
  }

  setSessionManager(manager: any): void {
    this.sessionManager = manager;
  }

  private handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): void {
    // Parse URL and remove query string
    const url = req.url?.split('?')[0] || '/';

    // Handle API endpoints
    if (url.startsWith('/api/')) {
      this.handleApiRequest(req, res, url);
      return;
    }

    // Default to index.html for root
    let filePath = url === '/' ? '/index.html' : url;
    filePath = path.join(this.publicDir, filePath);

    // Security: prevent directory traversal
    if (!filePath.startsWith(this.publicDir)) {
      this.send404(res);
      return;
    }

    // Read and serve file
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          this.send404(res);
        } else {
          this.send500(res, err);
        }
        return;
      }

      // Determine content type
      const ext = path.extname(filePath);
      const contentType = this.getContentType(ext);

      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  }

  private getContentType(ext: string): string {
    const contentTypes: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
    };

    return contentTypes[ext] || 'text/plain';
  }

  private send404(res: http.ServerResponse): void {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>404 Not Found</title></head>
        <body>
          <h1>404 Not Found</h1>
          <p>The requested resource was not found.</p>
        </body>
      </html>
    `);
  }

  private send500(res: http.ServerResponse, error: Error): void {
    console.error('[HTTP] Server error:', error);
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>500 Server Error</title></head>
        <body>
          <h1>500 Server Error</h1>
          <p>An internal server error occurred.</p>
        </body>
      </html>
    `);
  }

  private async handleApiRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    url: string
  ): Promise<void> {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
      if (url === '/api/sessions' && req.method === 'GET') {
        // List sessions
        if (!this.sessionManager) {
          res.writeHead(503);
          res.end(JSON.stringify({ error: 'SessionManager not available' }));
          return;
        }

        const projectPath = process.cwd(); // Current project
        const sessions = await this.sessionManager.listSessions(projectPath);

        res.writeHead(200);
        res.end(JSON.stringify({ sessions }));
      } else if (url.match(/^\/api\/sessions\/(.+)$/) && req.method === 'GET') {
        // Load specific session
        const sessionId = url.match(/^\/api\/sessions\/(.+)$/)?.[1];

        if (!this.sessionManager || !sessionId) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'Invalid request' }));
          return;
        }

        const projectPath = process.cwd();
        const session = await this.sessionManager.loadSession(projectPath, sessionId);

        if (!session) {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }

        const events = this.sessionManager.convertSessionToEvents(session);

        res.writeHead(200);
        res.end(JSON.stringify({ session, events }));
      } else {
        res.writeHead(404);
        res.end(JSON.stringify({ error: 'API endpoint not found' }));
      }
    } catch (error) {
      console.error('[HTTP] API error:', error);
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Internal server error' }));
    }
  }

  /**
   * Start the HTTP server
   */
  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`[HTTP] Dashboard server listening on http://localhost:${this.port}`);
        console.log(`[HTTP] Serving files from: ${this.publicDir}`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('[HTTP] Server closed');
        resolve();
      });
    });
  }
}
