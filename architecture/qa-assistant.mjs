#!/usr/bin/env node
/**
 * Gemini CLI Architecture Q&A Assistant
 *
 * An interactive AI assistant that answers questions about the Gemini CLI architecture
 * using Gemini 2.5 Flash with extended thinking capabilities.
 *
 * Usage:
 *   node qa-assistant.mjs "your question here"
 *   node qa-assistant.mjs --interactive
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import readline from 'readline';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ANSI color codes for better output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
};

/**
 * Extract text content from HTML files
 */
function extractTextFromHTML(html) {
  // Remove script and style tags
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Load all architecture documentation
 */
async function loadArchitectureDocs() {
  const docs = {};

  // Read README
  try {
    const readmePath = path.join(__dirname, 'README.md');
    docs['README'] = await fs.readFile(readmePath, 'utf-8');
  } catch (error) {
    console.warn(`${colors.yellow}Warning: Could not read README.md${colors.reset}`);
  }

  // Read HTML docs
  const docsDir = path.join(__dirname, 'docs');
  const diagramsDir = path.join(__dirname, 'diagrams');

  try {
    const docFiles = await fs.readdir(docsDir);
    for (const file of docFiles) {
      if (file.endsWith('.html')) {
        const filePath = path.join(docsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = file.replace('.html', '');
        docs[name] = extractTextFromHTML(content);
      }
    }
  } catch (error) {
    console.warn(`${colors.yellow}Warning: Could not read docs directory${colors.reset}`);
  }

  try {
    const diagramFiles = await fs.readdir(diagramsDir);
    for (const file of diagramFiles) {
      if (file.endsWith('.html')) {
        const filePath = path.join(diagramsDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const name = 'diagram-' + file.replace('.html', '');
        docs[name] = extractTextFromHTML(content);
      }
    }
  } catch (error) {
    console.warn(`${colors.yellow}Warning: Could not read diagrams directory${colors.reset}`);
  }

  return docs;
}

/**
 * Create context string from documentation
 */
function createContext(docs) {
  let context = "# Gemini CLI Architecture Documentation\n\n";
  context += "You are an AI assistant that helps developers understand the Gemini CLI architecture.\n";
  context += "Below is the complete architecture documentation. Use it to answer questions accurately and thoroughly.\n\n";

  for (const [name, content] of Object.entries(docs)) {
    context += `## ${name}\n\n`;
    // Limit each doc to prevent token overflow
    const truncatedContent = content.slice(0, 15000);
    context += truncatedContent;
    context += "\n\n---\n\n";
  }

  return context;
}

/**
 * Call Gemini API using curl (as shown in the snippet)
 */
async function askGemini(question, context) {
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error('GEMINI_API_KEY environment variable is not set');
  }

  const MODEL_ID = "gemini-2.0-flash-exp";
  const GENERATE_CONTENT_API = "streamGenerateContent";

  const fullPrompt = `${context}\n\n---\n\nQuestion: ${question}\n\nPlease provide a detailed, accurate answer based on the architecture documentation above. Include specific file references, code examples, and technical details where relevant.`;

  // Create request payload
  const requestPayload = {
    contents: [
      {
        role: "user",
        parts: [
          {
            text: fullPrompt
          }
        ]
      }
    ],
    generationConfig: {
      thinkingConfig: {
        thinkingBudget: -1
      },
      temperature: 0.7,
      topP: 0.95,
      topK: 40
    }
  };

  // Write request to temp file
  const tempFile = path.join(__dirname, '.qa-request.json');
  await fs.writeFile(tempFile, JSON.stringify(requestPayload, null, 2));

  return new Promise((resolve, reject) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:${GENERATE_CONTENT_API}?key=${apiKey}`;

    const curl = spawn('curl', [
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', `@${tempFile}`,
      url
    ]);

    let responseData = '';
    let errorData = '';

    curl.stdout.on('data', (data) => {
      responseData += data.toString();
    });

    curl.stderr.on('data', (data) => {
      errorData += data.toString();
    });

    curl.on('close', async (code) => {
      // Clean up temp file
      try {
        await fs.unlink(tempFile);
      } catch (e) {
        // Ignore cleanup errors
      }

      if (code !== 0) {
        reject(new Error(`curl failed with code ${code}: ${errorData}`));
        return;
      }

      try {
        // Parse streaming JSON response
        const lines = responseData.split('\n').filter(line => line.trim());
        let fullText = '';
        let thinking = '';

        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);

            if (chunk.candidates && chunk.candidates[0]) {
              const content = chunk.candidates[0].content;

              if (content && content.parts) {
                for (const part of content.parts) {
                  if (part.text) {
                    fullText += part.text;
                  }
                  if (part.thought) {
                    thinking += part.thought + '\n';
                  }
                }
              }
            }
          } catch (e) {
            // Skip invalid JSON lines
          }
        }

        resolve({ text: fullText, thinking });
      } catch (error) {
        reject(new Error(`Failed to parse response: ${error.message}`));
      }
    });
  });
}

/**
 * Format and display the answer
 */
function displayAnswer(answer) {
  console.log(`\n${colors.bright}${colors.green}━━━ Answer ━━━${colors.reset}\n`);

  if (answer.thinking && answer.thinking.trim()) {
    console.log(`${colors.dim}${colors.yellow}[Thinking process]${colors.reset}`);
    console.log(`${colors.dim}${answer.thinking.trim()}${colors.reset}\n`);
  }

  console.log(answer.text);
  console.log(`\n${colors.bright}${colors.green}━━━━━━━━━━━━━${colors.reset}\n`);
}

/**
 * Interactive mode
 */
async function interactiveMode(docs, context) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`${colors.bright}${colors.cyan}╔════════════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║  Gemini CLI Architecture Q&A Assistant            ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}║  Powered by Gemini 2.5 Flash with Thinking        ║${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}╚════════════════════════════════════════════════════╝${colors.reset}\n`);

  console.log(`${colors.green}Ask questions about the Gemini CLI architecture.${colors.reset}`);
  console.log(`${colors.dim}Type 'exit' or 'quit' to leave.${colors.reset}\n`);

  const ask = () => {
    rl.question(`${colors.bright}${colors.blue}❯${colors.reset} `, async (question) => {
      const trimmedQuestion = question.trim();

      if (!trimmedQuestion) {
        ask();
        return;
      }

      if (trimmedQuestion.toLowerCase() === 'exit' || trimmedQuestion.toLowerCase() === 'quit') {
        console.log(`\n${colors.cyan}Goodbye!${colors.reset}\n`);
        rl.close();
        return;
      }

      try {
        console.log(`\n${colors.dim}Thinking...${colors.reset}`);
        const answer = await askGemini(trimmedQuestion, context);
        displayAnswer(answer);
      } catch (error) {
        console.error(`${colors.red}Error: ${error.message}${colors.reset}\n`);
      }

      ask();
    });
  };

  ask();
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for API key
  if (!process.env.GEMINI_API_KEY) {
    console.error(`${colors.red}Error: GEMINI_API_KEY environment variable is not set${colors.reset}`);
    console.error(`\nPlease set your API key:`);
    console.error(`  export GEMINI_API_KEY="your-api-key-here"\n`);
    process.exit(1);
  }

  // Load documentation
  console.log(`${colors.dim}Loading architecture documentation...${colors.reset}`);
  const docs = await loadArchitectureDocs();
  const docCount = Object.keys(docs).length;
  console.log(`${colors.green}✓ Loaded ${docCount} documentation files${colors.reset}\n`);

  // Create context
  const context = createContext(docs);

  // Check mode
  if (args.length === 0 || args[0] === '--interactive' || args[0] === '-i') {
    // Interactive mode
    await interactiveMode(docs, context);
  } else {
    // Single question mode
    const question = args.join(' ');
    console.log(`${colors.bright}${colors.blue}Question:${colors.reset} ${question}\n`);
    console.log(`${colors.dim}Thinking...${colors.reset}`);

    try {
      const answer = await askGemini(question, context);
      displayAnswer(answer);
    } catch (error) {
      console.error(`${colors.red}Error: ${error.message}${colors.reset}\n`);
      process.exit(1);
    }
  }
}

// Run
main().catch(error => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  process.exit(1);
});
