/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Content,
  GenerateContentParameters,
  Part,
  Tool,
  FunctionDeclaration,
  GenerateContentConfig,
} from '@google/genai';
import { GenerateContentResponse, FinishReason } from '@google/genai';

/**
 * Ollama API request format for chat completion
 */
export interface OllamaRequest {
  model: string;
  messages: OllamaMessage[];
  options?: OllamaOptions;
  stream?: boolean;
  format?: string;
  tools?: OllamaTool[];
  keep_alive?: string;
}

export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[]; // base64 encoded images
  tool_calls?: OllamaToolCall[];
}

export interface OllamaOptions {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  num_predict?: number;
  stop?: string[];
  seed?: number;
  num_ctx?: number;
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}

/**
 * Ollama API response format
 */
export interface OllamaResponse {
  model: string;
  created_at: string;
  message: OllamaMessage;
  done: boolean;
  done_reason?: string;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
}

/**
 * Ollama streaming response chunk
 */
export interface OllamaStreamChunk {
  model: string;
  created_at: string;
  message?: {
    role: string;
    content: string;
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

/**
 * Convert Gemini GenerateContentParameters to Ollama request format
 */
export function convertToOllamaRequest(
  params: GenerateContentParameters,
  stream: boolean = false,
): OllamaRequest {
  const messages: OllamaMessage[] = [];

  // Add system instruction if present
  if (params.systemInstruction) {
    const systemText = extractTextFromContent(params.systemInstruction);
    if (systemText) {
      messages.push({
        role: 'system',
        content: systemText,
      });
    }
  }

  // Convert contents to messages
  for (const content of params.contents) {
    const message = convertContentToMessage(content);
    if (message) {
      messages.push(message);
    }
  }

  // Convert generation config to options
  const options = convertGenerationConfig(params.config);

  // Convert tools if present
  let tools: OllamaTool[] | undefined;
  const paramsWithTools = params as GenerateContentParameters & {
    tools?: Tool[];
  };
  if (paramsWithTools.tools && Array.isArray(paramsWithTools.tools)) {
    tools = paramsWithTools.tools
      .map((tool: Tool) => {
        if ('functionDeclarations' in tool && tool.functionDeclarations) {
          return tool.functionDeclarations.map((fn: FunctionDeclaration) =>
            convertFunctionToTool(fn),
          );
        }
        return [];
      })
      .flat();
  }

  return {
    model: params.model,
    messages,
    options,
    stream,
    tools: tools && tools.length > 0 ? tools : undefined,
  };
}

/**
 * Extract text content from a Content object
 */
function extractTextFromContent(content: Content): string {
  if (!content.parts) return '';

  return content.parts
    .map((part) => {
      if ('text' in part && part.text) {
        return part.text;
      }
      return '';
    })
    .filter((text) => text.length > 0)
    .join('\n');
}

/**
 * Convert a single Content to OllamaMessage
 */
function convertContentToMessage(content: Content): OllamaMessage | null {
  if (!content.parts || content.parts.length === 0) return null;

  // Determine role
  let role: 'user' | 'assistant' | 'tool' = 'user';
  if (content.role === 'model') {
    role = 'assistant';
  } else if (content.role === 'function') {
    role = 'tool';
  }

  // Extract text and images
  const textParts: string[] = [];
  const images: string[] = [];
  let toolCalls: OllamaToolCall[] | undefined;

  for (const part of content.parts) {
    if ('text' in part && part.text) {
      textParts.push(part.text);
    } else if ('inlineData' in part && part.inlineData) {
      // Handle inline images
      if (part.inlineData.mimeType?.startsWith('image/')) {
        images.push(part.inlineData.data);
      }
    } else if ('functionCall' in part && part.functionCall) {
      // Handle function calls
      if (!toolCalls) toolCalls = [];
      toolCalls.push({
        function: {
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
        },
      });
    } else if ('functionResponse' in part && part.functionResponse) {
      // Function responses are treated as tool role messages
      role = 'tool';
      textParts.push(JSON.stringify(part.functionResponse.response));
    }
  }

  const message: OllamaMessage = {
    role,
    content: textParts.join('\n'),
  };

  if (images.length > 0) {
    message.images = images;
  }

  if (toolCalls && toolCalls.length > 0) {
    message.tool_calls = toolCalls;
  }

  return message;
}

/**
 * Convert GenerationConfig to Ollama options
 */
function convertGenerationConfig(
  config?: GenerateContentConfig,
): OllamaOptions | undefined {
  if (!config) return undefined;

  const options: OllamaOptions = {};

  if (config.temperature !== undefined) {
    options.temperature = config.temperature;
  }
  if (config.topP !== undefined) {
    options.top_p = config.topP;
  }
  if (config.topK !== undefined) {
    options.top_k = config.topK;
  }
  if (config.maxOutputTokens !== undefined) {
    options.num_predict = config.maxOutputTokens;
  }
  if (config.stopSequences && config.stopSequences.length > 0) {
    options.stop = config.stopSequences;
  }
  if (config.seed !== undefined) {
    options.seed = config.seed;
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * Convert Gemini FunctionDeclaration to Ollama tool
 */
function convertFunctionToTool(fn: FunctionDeclaration): OllamaTool {
  return {
    type: 'function',
    function: {
      name: fn.name,
      description: fn.description || '',
      parameters: (fn.parameters as Record<string, unknown>) || {},
    },
  };
}

/**
 * Convert Ollama response to Gemini GenerateContentResponse
 */
export function convertToGeminiResponse(
  response: OllamaResponse,
): GenerateContentResponse {
  // Determine finish reason
  let finishReason: FinishReason = FinishReason.STOP;
  if (response.done_reason === 'stop') {
    finishReason = FinishReason.STOP;
  } else if (response.done_reason === 'length') {
    finishReason = FinishReason.MAX_TOKENS;
  } else if (response.done) {
    finishReason = FinishReason.STOP;
  }

  // Convert message content to parts
  const parts: Part[] = [];

  if (response.message.content) {
    parts.push({ text: response.message.content });
  }

  // Handle tool calls
  if (response.message.tool_calls) {
    for (const toolCall of response.message.tool_calls) {
      parts.push({
        functionCall: {
          name: toolCall.function.name,
          args: toolCall.function.arguments,
        },
      });
    }
  }

  const out = new GenerateContentResponse();
  out.candidates = [
    {
      content: {
        role: 'model',
        parts,
      },
      finishReason,
      index: 0,
    },
  ];
  out.usageMetadata = {
    promptTokenCount: response.prompt_eval_count || 0,
    candidatesTokenCount: response.eval_count || 0,
    totalTokenCount:
      (response.prompt_eval_count || 0) + (response.eval_count || 0),
  };
  out.modelVersion = response.model;
  return out;
}

/**
 * Convert Ollama streaming chunk to Gemini GenerateContentResponse
 */
export function convertStreamChunkToGeminiResponse(
  chunk: OllamaStreamChunk,
  _isFirst: boolean = false,
): GenerateContentResponse {
  const parts: Part[] = [];

  if (chunk.message?.content) {
    parts.push({ text: chunk.message.content });
  }

  let finishReason: FinishReason | undefined;
  if (chunk.done) {
    finishReason =
      chunk.done_reason === 'length'
        ? FinishReason.MAX_TOKENS
        : FinishReason.STOP;
  }

  const response = new GenerateContentResponse();
  response.candidates = [
    {
      content: {
        role: 'model',
        parts,
      },
      finishReason,
      index: 0,
    },
  ];
  response.modelVersion = chunk.model;

  // Add usage metadata on final chunk
  if (chunk.done) {
    response.usageMetadata = {
      promptTokenCount: chunk.prompt_eval_count || 0,
      candidatesTokenCount: chunk.eval_count || 0,
      totalTokenCount: (chunk.prompt_eval_count || 0) + (chunk.eval_count || 0),
    };
  }

  return response;
}
