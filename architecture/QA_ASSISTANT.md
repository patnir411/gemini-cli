# 🤖 Architecture Q&A Assistant

An interactive AI-powered assistant that answers questions about the Gemini CLI architecture using **Gemini 2.5 Flash** with extended thinking capabilities.

## 🌟 Features

- **AI-Powered Answers**: Uses Gemini 2.5 Flash to provide detailed, accurate answers about the architecture
- **Extended Thinking**: Leverages Gemini's thinking mode for deeper analysis
- **Interactive Mode**: Chat-like interface for asking multiple questions
- **Single Question Mode**: Quick one-off questions
- **Context-Aware**: Automatically loads all architecture documentation as context
- **Colored Output**: Beautiful terminal output with syntax highlighting

## 📋 Prerequisites

1. **Node.js**: Version 18 or later
2. **Gemini API Key**: Get one from [Google AI Studio](https://aistudio.google.com/apikey)
3. **curl**: Should be available on most systems

## 🚀 Quick Start

### 1. Set Your API Key

```bash
export GEMINI_API_KEY="your-api-key-here"
```

Add this to your `~/.bashrc` or `~/.zshrc` to make it permanent:

```bash
echo 'export GEMINI_API_KEY="your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

### 2. Run the Assistant

#### Interactive Mode (Recommended)

```bash
# From the architecture/ directory
./qa.sh

# Or directly with Node
node qa-assistant.mjs --interactive
```

#### Single Question Mode

```bash
# Ask a quick question
./qa.sh "What is the agent harness?"

# Or with Node
node qa-assistant.mjs "How does tool execution work?"
```

## 💡 Usage Examples

### Interactive Mode

```bash
$ ./qa.sh
Loading architecture documentation...
✓ Loaded 9 documentation files

╔════════════════════════════════════════════════════╗
║  Gemini CLI Architecture Q&A Assistant            ║
║  Powered by Gemini 2.5 Flash with Thinking        ║
╚════════════════════════════════════════════════════╝

Ask questions about the Gemini CLI architecture.
Type 'exit' or 'quit' to leave.

❯ What is the 6-layer architecture?

Thinking...

━━━ Answer ━━━

The Gemini CLI uses a 6-layer agent harness architecture:

1. **UI Layer** (packages/cli): React/Ink terminal components
2. **Client Layer** (GeminiClient): Orchestrates multi-turn conversations
3. **Chat Layer** (GeminiChat): Manages conversation history
4. **Turn Layer** (Turn): Processes streaming events
5. **Tool Execution Layer** (CoreToolScheduler): Executes tools
6. **External Services**: Gemini API, Vertex AI, MCP servers

[Detailed explanation continues...]

━━━━━━━━━━━━━

❯ How do tools work?

...

❯ exit
Goodbye!
```

### Single Question Mode

```bash
$ ./qa.sh "What data structures are used for tool calls?"

Question: What data structures are used for tool calls?

Thinking...

━━━ Answer ━━━

Tool calls in Gemini CLI use a state machine pattern with the following types:

1. **ValidatingToolCall** - Initial state during schema validation
2. **WaitingToolCall** - Awaiting user confirmation
3. **ExecutingToolCall** - Tool is running
4. **SuccessfulToolCall** - Completed successfully
5. **ErroredToolCall** - Execution failed
6. **CancelledToolCall** - User rejected

[Detailed code examples and references...]

━━━━━━━━━━━━━
```

## 🎯 Example Questions

Here are some example questions you can ask:

### Architecture Questions
- "What is the agent harness pattern?"
- "How do the 6 layers communicate with each other?"
- "What is the difference between GeminiClient and GeminiChat?"
- "How does loop detection work?"

### Tool System Questions
- "What built-in tools are available?"
- "How does tool confirmation work?"
- "What is the policy engine?"
- "How are MCP tools integrated?"

### Data Flow Questions
- "How does a user message flow through the system?"
- "What happens during tool execution?"
- "How is chat history managed?"
- "What is the compression flow?"

### Configuration Questions
- "What are the 4 configuration tiers?"
- "How are API keys stored?"
- "What model settings are available?"
- "How does environment variable resolution work?"

### API Integration Questions
- "How does Code Assist authentication work?"
- "What is the retry strategy?"
- "How are quota errors handled?"
- "What telemetry is collected?"

## 🔧 Technical Details

### How It Works

1. **Documentation Loading**: Automatically reads all HTML and Markdown files from the `architecture/` directory
2. **Context Building**: Extracts text content and creates a comprehensive context string
3. **API Request**: Sends your question along with the architecture documentation to Gemini 2.5 Flash
4. **Streaming Response**: Processes the streaming JSON response from the API
5. **Display**: Formats and displays the answer with syntax highlighting

### Architecture

```
qa-assistant.mjs
    ↓
Loads all architecture docs
    ↓
Creates context (README + HTML files)
    ↓
User asks question
    ↓
Sends to Gemini API via curl
    {
      contents: [user question],
      generationConfig: {
        thinkingConfig: { thinkingBudget: -1 },
        temperature: 0.7
      }
    }
    ↓
Streams response
    ↓
Displays answer with thinking process
```

### Files

- **qa-assistant.mjs**: Main Node.js application
- **qa.sh**: Shell script wrapper for easy execution
- **QA_ASSISTANT.md**: This documentation
- **.qa-request.json**: Temporary file (auto-deleted) for API requests

## ⚙️ Configuration

### Model Settings

Edit `qa-assistant.mjs` to change model or settings:

```javascript
const MODEL_ID = "gemini-2.0-flash-exp";  // Model to use
const GENERATE_CONTENT_API = "streamGenerateContent";

// Generation config
generationConfig: {
  thinkingConfig: {
    thinkingBudget: -1  // -1 = unlimited thinking
  },
  temperature: 0.7,     // Creativity (0-2)
  topP: 0.95,          // Nucleus sampling
  topK: 40             // Top-K sampling
}
```

### Context Limits

Each documentation file is truncated to 15,000 characters to prevent token overflow. Adjust in `createContext()` if needed:

```javascript
const truncatedContent = content.slice(0, 15000); // Adjust this
```

## 🐛 Troubleshooting

### API Key Issues

```bash
Error: GEMINI_API_KEY environment variable is not set
```

**Solution**: Set your API key:
```bash
export GEMINI_API_KEY="your-api-key-here"
```

### Node.js Not Found

```bash
Error: Node.js is not installed
```

**Solution**: Install Node.js 18 or later:
```bash
# Ubuntu/Debian
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# macOS
brew install node

# Windows
# Download from https://nodejs.org/
```

### curl Not Found

**Solution**: Install curl:
```bash
# Ubuntu/Debian
sudo apt-get install curl

# macOS
brew install curl

# Usually pre-installed on most systems
```

### Rate Limiting

If you hit rate limits:
1. Wait a few moments between requests
2. Check your API quota at https://aistudio.google.com/
3. Consider upgrading to a paid tier

## 🎨 Customization

### Changing Colors

Edit the `colors` object in `qa-assistant.mjs`:

```javascript
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  cyan: '\x1b[36m',    // Change these
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  // ...
};
```

### Adding More Documentation Sources

To include additional files, edit `loadArchitectureDocs()`:

```javascript
// Add custom directory
const customDir = path.join(__dirname, 'custom-docs');
const customFiles = await fs.readdir(customDir);
// ... process files
```

## 📊 Performance

- **First Request**: ~3-5 seconds (includes documentation loading)
- **Subsequent Requests**: ~2-4 seconds (documentation already loaded)
- **Token Usage**: ~30K-50K tokens per request (depending on question complexity)
- **Thinking Mode**: Adds 1-2 seconds for deeper analysis

## 🔒 Privacy & Security

- **API Key**: Never hardcode your API key. Always use environment variables.
- **Local Processing**: All documentation is processed locally before being sent to Gemini.
- **No Storage**: Conversations are not stored (unless you explicitly save them).
- **Temporary Files**: `.qa-request.json` is automatically deleted after each request.

## 🚀 Advanced Usage

### Scripting

Use in scripts for automated documentation queries:

```bash
#!/bin/bash
questions=(
  "What is the agent harness?"
  "How do tools work?"
  "What is the policy engine?"
)

for question in "${questions[@]}"; do
  echo "=== $question ==="
  ./qa.sh "$question"
  echo ""
done
```

### CI/CD Integration

Validate documentation quality in CI:

```bash
# Test that the assistant can answer key questions
./qa.sh "List all built-in tools" > output.txt
grep -q "Read" output.txt || exit 1
grep -q "Write" output.txt || exit 1
```

## 📝 License

This Q&A Assistant is part of the Gemini CLI project and follows the same license (Apache 2.0).

## 🤝 Contributing

To improve the Q&A Assistant:

1. **Better Context Extraction**: Improve HTML text extraction
2. **Smarter Truncation**: Better content summarization before sending to API
3. **Caching**: Cache frequent questions/answers
4. **Voice Mode**: Add speech-to-text and text-to-speech
5. **Web UI**: Create a web interface

## 📚 Resources

- [Gemini API Documentation](https://ai.google.dev/docs)
- [Google AI Studio](https://aistudio.google.com/)
- [Gemini API Key](https://aistudio.google.com/apikey)
- [Node.js Documentation](https://nodejs.org/docs/)

---

**Built with ❤️ using Gemini 2.5 Flash**
