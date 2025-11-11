/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CountTokensParameters,
  CountTokensResponse,
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from '@google/genai';
import type { ContentGenerator } from './contentGenerator.js';
import type { Config } from '../config/config.js';
import {
  convertToOllamaRequest,
  convertToGeminiResponse,
  convertStreamChunkToGeminiResponse,
  type OllamaResponse,
  type OllamaStreamChunk,
} from './ollamaConverter.js';
import { debugLogger } from '../utils/debugLogger.js';
import { estimateTokenCount } from './ollamaTokenizer.js';

/**
 * Ollama embeddings request format
 */
interface OllamaEmbeddingRequest {
  model: string;
  prompt: string;
  options?: {
    num_ctx?: number;
  };
}

/**
 * Ollama embeddings response format
 */
interface OllamaEmbeddingResponse {
  embedding: number[];
}

/**
 * ContentGenerator implementation for Ollama API
 *
 * Provides integration with local Ollama models while implementing
 * the same ContentGenerator interface used by Gemini/Vertex AI.
 */
export class OllamaContentGenerator implements ContentGenerator {
  private readonly baseUrl: string;

  constructor(baseUrl: string, _config: Config) {
    // Config reserved for future use (logging, telemetry, etc.)
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
  }

  /**
   * Generate content using Ollama API (non-streaming)
   */
  async generateContent(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<GenerateContentResponse> {
    const ollamaRequest = convertToOllamaRequest(request, false);

    try {
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
        signal: request.config?.abortSignal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama API error (${response.status}): ${errorText}`,
        );
      }

      const ollamaResponse: OllamaResponse = await response.json();
      return convertToGeminiResponse(ollamaResponse);
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw error;
        }
        if (error.message.includes('ECONNREFUSED')) {
          throw new Error(
            `Cannot connect to Ollama at ${this.baseUrl}. ` +
              `Please ensure Ollama is running (try: ollama serve)`,
          );
        }
      }
      throw error;
    }
  }

  /**
   * Generate content using Ollama API (streaming)
   */
  async generateContentStream(
    request: GenerateContentParameters,
    _userPromptId: string,
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const ollamaRequest = convertToOllamaRequest(request, true);

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(ollamaRequest),
      signal: request.config?.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('Ollama response body is null');
    }

    return this.parseStreamingResponse(response.body);
  }

  /**
   * Parse Ollama streaming response (newline-delimited JSON)
   */
  private async *parseStreamingResponse(
    body: ReadableStream<Uint8Array>,
  ): AsyncGenerator<GenerateContentResponse> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let isFirst = true;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;

          try {
            const chunk: OllamaStreamChunk = JSON.parse(line);
            const geminiResponse = convertStreamChunkToGeminiResponse(
              chunk,
              isFirst,
            );
            isFirst = false;

            // Only yield if there's actual content
            const hasParts =
              geminiResponse.candidates?.[0]?.content?.parts &&
              geminiResponse.candidates[0].content.parts.length > 0;
            if (hasParts || chunk.done) {
              yield geminiResponse;
            }
          } catch (error) {
            debugLogger.debug('Failed to parse Ollama stream chunk:', error);
            // Continue processing other chunks
          }
        }
      }

      // Process any remaining data in buffer
      if (buffer.trim() !== '') {
        try {
          const chunk: OllamaStreamChunk = JSON.parse(buffer);
          yield convertStreamChunkToGeminiResponse(chunk, false);
        } catch (error) {
          debugLogger.debug(
            'Failed to parse final Ollama stream chunk:',
            error,
          );
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Count tokens in the request
   *
   * Note: Ollama doesn't have a direct token counting API.
   * This provides an estimation based on the content.
   */
  async countTokens(
    request: CountTokensParameters,
  ): Promise<CountTokensResponse> {
    // Extract text from all contents
    let totalText = '';

    // Check if systemInstruction is in config
    if (request.config?.systemInstruction) {
      const systemContent = request.config.systemInstruction as Content;
      if (systemContent.parts) {
        for (const part of systemContent.parts) {
          if ('text' in part && part.text) {
            totalText += part.text + ' ';
          }
        }
      }
    }

    // Handle ContentListUnion - could be array or single item
    const contentsArray = Array.isArray(request.contents)
      ? request.contents
      : [request.contents];

    for (const content of contentsArray) {
      const contentObj = content as Content;
      if (contentObj.parts) {
        for (const part of contentObj.parts) {
          if ('text' in part && part.text) {
            totalText += part.text + ' ';
          }
        }
      }
    }

    const estimatedTokens = estimateTokenCount(totalText);

    return {
      totalTokens: estimatedTokens,
    };
  }

  /**
   * Generate embeddings using Ollama
   */
  async embedContent(
    request: EmbedContentParameters,
  ): Promise<EmbedContentResponse> {
    // Extract text from contents (note: plural)
    let text = '';

    // Handle ContentListUnion - could be array or single item
    const contentsArray = Array.isArray(request.contents)
      ? request.contents
      : [request.contents];

    for (const content of contentsArray) {
      const contentObj = content as Content;
      if (contentObj.parts) {
        for (const part of contentObj.parts) {
          if ('text' in part && part.text) {
            text += part.text + ' ';
          }
        }
      }
    }

    if (!text.trim()) {
      throw new Error('No text content found for embedding');
    }

    const ollamaRequest: OllamaEmbeddingRequest = {
      model: request.model,
      prompt: text.trim(),
    };

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(ollamaRequest),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Ollama embeddings API error (${response.status}): ${errorText}`,
        );
      }

      const ollamaResponse: OllamaEmbeddingResponse = await response.json();

      // Return embeddings (plural) with ContentEmbedding format
      return {
        embeddings: [
          {
            values: ollamaResponse.embedding,
          },
        ],
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('ECONNREFUSED')) {
        throw new Error(
          `Cannot connect to Ollama at ${this.baseUrl}. ` +
            `Please ensure Ollama is running (try: ollama serve)`,
        );
      }
      throw error;
    }
  }

  /**
   * Get the base URL for this Ollama instance
   */
  getBaseUrl(): string {
    return this.baseUrl;
  }
}
