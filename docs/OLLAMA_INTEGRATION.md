# Ollama Integration Guide

This document describes how to use Gemini CLI with local Ollama models.

## Overview

Ollama integration allows you to run Gemini CLI entirely locally using Ollama models instead of Google's cloud APIs. This provides:

- **Complete Privacy**: All data stays on your machine
- **No API Costs**: Free inference (hardware costs only)
- **Lower Latency**: Faster responses for smaller models
- **Offline Capability**: Works without internet connection
- **Model Choice**: Use any Ollama-compatible model

## Prerequisites

### 1. Install Ollama

**macOS/Linux:**
```bash
curl -fsSL https://ollama.com/install.sh | sh
```

**Windows:**
Download from [ollama.com](https://ollama.com/download)

**Verify installation:**
```bash
ollama --version
```

### 2. Pull a Model

Download a model suitable for code assistance:

```bash
# Recommended for code (3B parameters, fast)
ollama pull llama3.2

# Better quality (8B parameters, slower)
ollama pull codellama

# For embeddings (required for some features)
ollama pull nomic-embed-text
```

View available models at [ollama.com/library](https://ollama.com/library)

### 3. Start Ollama Server

```bash
ollama serve
```

The server will run at `http://localhost:11434` by default.

## Configuration

### Option 1: Environment Variables (Recommended)

```bash
# Set the base URL (optional if using default)
export OLLAMA_BASE_URL=http://localhost:11434

# Run Gemini CLI with Ollama
gemini-cli chat --auth-type=ollama --model=llama3.2
```

### Option 2: Remote Ollama Instance

If Ollama is running on a different machine:

```bash
export OLLAMA_BASE_URL=http://192.168.1.100:11434
gemini-cli chat --auth-type=ollama --model=llama3.2
```

### Option 3: Custom Port

If Ollama is running on a non-standard port:

```bash
# Start Ollama on custom port
OLLAMA_HOST=0.0.0.0:8080 ollama serve

# Configure Gemini CLI
export OLLAMA_BASE_URL=http://localhost:8080
gemini-cli chat --auth-type=ollama --model=llama3.2
```

## Usage Examples

### Basic Chat

```bash
gemini-cli chat --auth-type=ollama --model=llama3.2
```

### With Specific Ollama Model

```bash
# Use CodeLlama for better code understanding
gemini-cli chat --auth-type=ollama --model=codellama

# Use Mistral
gemini-cli chat --auth-type=ollama --model=mistral

# Use Llama 3.1 (larger model)
gemini-cli chat --auth-type=ollama --model=llama3.1:70b
```

### Non-Interactive Mode

```bash
echo "Explain async/await in JavaScript" | gemini-cli chat --auth-type=ollama --model=llama3.2 --non-interactive
```

### With Generation Parameters

```bash
gemini-cli chat --auth-type=ollama --model=llama3.2 \
  --temperature=0.7 \
  --max-output-tokens=2048
```

## Feature Support

### ✅ Fully Supported Features

- **Text generation**: Chat and content creation
- **Streaming responses**: Real-time output
- **Multi-turn conversations**: Context maintenance
- **Tool/function calling**: With compatible models
- **Image input**: With vision models (e.g., `llava`)
- **Embeddings**: With embedding models
- **Code understanding**: Full support
- **File operations**: All file tools work

### ⚠️ Partially Supported Features

| Feature | Status | Notes |
|---------|--------|-------|
| **Token counting** | Estimation | Uses approximate counting (85-95% accurate) |
| **Function calling** | Model-dependent | Works with models that support tools |
| **Multimodal input** | Vision only | Images supported, audio/video not supported |

### ❌ Unsupported Features (Google-Specific)

These features require Google Cloud services and won't work with Ollama:

- Code Assist user tiers and experiments
- Google OAuth authentication
- Telemetry to Google servers (local telemetry still works)
- Safety ratings
- Grounding
- Context caching (use model's native context instead)

## Model Recommendations

### For Code Tasks

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| `codellama:7b` | 4GB | Fast | Good | General coding |
| `codellama:13b` | 7GB | Medium | Better | Complex code |
| `codellama:34b` | 19GB | Slow | Best | Production code |
| `deepseek-coder` | 7GB | Fast | Excellent | Code generation |

### For General Chat

| Model | Size | Speed | Quality | Use Case |
|-------|------|-------|---------|----------|
| `llama3.2:3b` | 2GB | Very Fast | Good | Quick questions |
| `llama3.1:8b` | 5GB | Fast | Better | General use |
| `llama3.1:70b` | 40GB | Slow | Best | Complex reasoning |
| `mistral:7b` | 4GB | Fast | Good | Balanced |

### For Embeddings

| Model | Size | Use Case |
|-------|------|----------|
| `nomic-embed-text` | 274MB | Recommended for text |
| `mxbai-embed-large` | 670MB | Higher quality |

## Performance Tuning

### Hardware Requirements

**Minimum:**
- 8GB RAM
- 2GB free disk space
- CPU only (slow)

**Recommended:**
- 16GB+ RAM
- 10GB+ free disk space
- NVIDIA GPU with 6GB+ VRAM

**Optimal:**
- 32GB+ RAM
- 50GB+ free disk space
- NVIDIA GPU with 24GB+ VRAM

### Optimization Tips

**1. Use Quantized Models**
```bash
# 4-bit quantization (faster, less quality)
ollama pull llama3.2:3b-q4

# 8-bit quantization (balanced)
ollama pull llama3.2:3b-q8
```

**2. Adjust Context Window**
```bash
# Reduce context for faster responses
gemini-cli chat --auth-type=ollama --model=llama3.2 --max-input-tokens=2048
```

**3. Enable GPU Acceleration**
```bash
# Ensure CUDA/ROCm is installed
nvidia-smi  # Check GPU availability

# Ollama automatically uses GPU if available
```

**4. Increase Concurrent Requests**
```bash
# Allow more parallel requests
export OLLAMA_NUM_PARALLEL=4
ollama serve
```

## Troubleshooting

### Connection Errors

**Error:** `Cannot connect to Ollama at http://localhost:11434`

**Solutions:**
1. Verify Ollama is running:
   ```bash
   curl http://localhost:11434/api/tags
   ```

2. Start Ollama server:
   ```bash
   ollama serve
   ```

3. Check firewall settings

### Model Not Found

**Error:** `model 'xyz' not found`

**Solutions:**
1. Pull the model:
   ```bash
   ollama pull xyz
   ```

2. List available models:
   ```bash
   ollama list
   ```

### Slow Performance

**Solutions:**
1. Use a smaller model:
   ```bash
   ollama pull llama3.2:3b  # Smaller, faster
   ```

2. Enable GPU if available
3. Reduce context window
4. Use quantized models

### Out of Memory

**Error:** `failed to allocate memory`

**Solutions:**
1. Use smaller model
2. Reduce `num_ctx`:
   ```bash
   ollama run llama3.2 --num-ctx 2048
   ```
3. Close other applications
4. Use quantized version

## Comparison: Ollama vs Gemini API

| Aspect | Ollama | Gemini API |
|--------|--------|------------|
| **Privacy** | ✅ Fully local | ⚠️ Data sent to Google |
| **Cost** | ✅ Free (hardware only) | 💰 Pay per token |
| **Latency** | ✅ 50-500ms | ⏱️ 200-2000ms |
| **Setup** | ⚠️ Requires installation | ✅ API key only |
| **Quality** | ⚠️ Model dependent | ✅ State-of-the-art |
| **Context** | ⚠️ 2k-128k tokens | ✅ Up to 2M tokens |
| **Multimodal** | ⚠️ Limited | ✅ Full support |
| **Scalability** | ⚠️ Local hardware | ✅ Cloud-scale |

## Advanced Configuration

### Custom System Prompts

```bash
gemini-cli chat --auth-type=ollama --model=llama3.2 \
  --system="You are an expert Python developer. Provide concise, production-ready code."
```

### Combining with MCP Servers

```bash
# Use Ollama with MCP servers
gemini-cli chat --auth-type=ollama --model=codellama \
  --mcp-servers="filesystem,database"
```

### Docker Deployment

```yaml
# docker-compose.yml
version: '3'
services:
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama:/root/.ollama
    environment:
      - OLLAMA_NUM_PARALLEL=4

  gemini-cli:
    image: gemini-cli
    environment:
      - OLLAMA_BASE_URL=http://ollama:11434
    command: chat --auth-type=ollama --model=llama3.2

volumes:
  ollama:
```

## API Compatibility

Ollama implements an OpenAI-compatible API. The Gemini CLI Ollama adapter translates between:

**Gemini Format:**
```json
{
  "contents": [{"role": "user", "parts": [{"text": "Hello"}]}],
  "generationConfig": {"temperature": 0.7}
}
```

**Ollama Format:**
```json
{
  "messages": [{"role": "user", "content": "Hello"}],
  "options": {"temperature": 0.7}
}
```

This conversion is handled automatically - no manual translation needed.

## Security Considerations

1. **Local Only**: By default, Ollama binds to `localhost` (secure)
2. **Remote Access**: If exposing Ollama remotely, use:
   - Authentication (reverse proxy with auth)
   - HTTPS/TLS encryption
   - Firewall rules
3. **Model Trust**: Only use models from trusted sources
4. **Data Privacy**: Local = private, but monitor disk space for logs

## Contributing

To improve Ollama integration:
- Report issues at [github.com/anthropics/gemini-cli/issues](https://github.com/anthropics/gemini-cli/issues)
- Test with different models and configurations
- Submit PRs for additional features

## Resources

- [Ollama Documentation](https://github.com/ollama/ollama/blob/main/docs)
- [Model Library](https://ollama.com/library)
- [Ollama API Reference](https://github.com/ollama/ollama/blob/main/docs/api.md)
- [Gemini CLI Documentation](../README.md)
