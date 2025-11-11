#!/usr/bin/env node
/**
 * Mock Ollama API Server for Testing
 *
 * Implements a minimal Ollama-compatible API to test the Gemini CLI integration
 * without requiring actual Ollama installation.
 */

import http from 'http';

const PORT = 11434;

// Mock chat response
function createChatResponse(model, message, stream = false) {
  if (stream) {
    return [
      {
        model: model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'Hello! ' },
        done: false,
      },
      {
        model: model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'I am a mock ' },
        done: false,
      },
      {
        model: model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'Ollama server. ' },
        done: false,
      },
      {
        model: model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: 'Your integration works!' },
        done: false,
      },
      {
        model: model,
        created_at: new Date().toISOString(),
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 15,
        eval_count: 25,
      },
    ];
  }

  return {
    model: model,
    created_at: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: 'Hello! I am a mock Ollama server. Your integration works perfectly! The message you sent was: ' + message,
    },
    done: true,
    done_reason: 'stop',
    total_duration: 1234567890,
    load_duration: 123456,
    prompt_eval_count: 15,
    prompt_eval_duration: 234567,
    eval_count: 25,
    eval_duration: 876543,
  };
}

// Mock embeddings response
function createEmbeddingResponse(model) {
  // Generate random embedding (384 dimensions for testing)
  const embedding = Array.from({ length: 384 }, () => Math.random() * 2 - 1);

  return {
    embedding: embedding,
  };
}

// Mock tags (list models) response
function createTagsResponse() {
  return {
    models: [
      {
        name: 'gemma3:2b',
        modified_at: new Date().toISOString(),
        size: 1600000000,
        digest: 'mock-digest-gemma3-2b',
      },
      {
        name: 'llama3.2:3b',
        modified_at: new Date().toISOString(),
        size: 2000000000,
        digest: 'mock-digest-llama32-3b',
      },
      {
        name: 'qwen2.5-coder:3b',
        modified_at: new Date().toISOString(),
        size: 1900000000,
        digest: 'mock-digest-qwen25-3b',
      },
    ],
  };
}

const server = http.createServer((req, res) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // GET /api/tags - List models
  if (req.method === 'GET' && req.url === '/api/tags') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(createTagsResponse()));
    return;
  }

  // POST /api/chat - Chat completion
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const model = data.model || 'gemma3:2b';
        const stream = data.stream || false;
        const lastMessage = data.messages?.[data.messages.length - 1]?.content || 'Hello';

        console.log(`  Model: ${model}, Stream: ${stream}`);
        console.log(`  Message: ${lastMessage.substring(0, 100)}...`);

        if (stream) {
          // Streaming response
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });

          const chunks = createChatResponse(model, lastMessage, true);
          let i = 0;

          const interval = setInterval(() => {
            if (i < chunks.length) {
              res.write(JSON.stringify(chunks[i]) + '\n');
              i++;
            } else {
              clearInterval(interval);
              res.end();
            }
          }, 50); // 50ms between chunks
        } else {
          // Non-streaming response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(createChatResponse(model, lastMessage, false)));
        }
      } catch (error) {
        console.error('Error processing chat request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // POST /api/embeddings - Generate embeddings
  if (req.method === 'POST' && req.url === '/api/embeddings') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const model = data.model || 'nomic-embed-text';

        console.log(`  Model: ${model}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(createEmbeddingResponse(model)));
      } catch (error) {
        console.error('Error processing embeddings request:', error);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // 404 for unknown endpoints
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n' + '='.repeat(60));
  console.log('🎭 Mock Ollama Server Started');
  console.log('='.repeat(60));
  console.log(`\nListening on: http://127.0.0.1:${PORT}`);
  console.log('\nAvailable endpoints:');
  console.log('  GET  /api/tags       - List available models');
  console.log('  POST /api/chat       - Chat completion');
  console.log('  POST /api/embeddings - Generate embeddings');
  console.log('\nMock models available:');
  console.log('  - gemma3:2b (recommended)');
  console.log('  - llama3.2:3b');
  console.log('  - qwen2.5-coder:3b');
  console.log('\nPress Ctrl+C to stop');
  console.log('='.repeat(60) + '\n');
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${PORT} is already in use.`);
    console.error('Is Ollama already running? Try: pkill ollama\n');
  } else {
    console.error('Server error:', error);
  }
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down mock Ollama server...\n');
  server.close(() => {
    process.exit(0);
  });
});
