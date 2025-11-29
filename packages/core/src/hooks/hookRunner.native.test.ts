/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookRunner } from './hookRunner.js';
import { HookType, HookEventName } from './types.js';
import type { NativeHookConfig, HookInput } from './types.js';
import path from 'path';

// Mock @google/genai
const mockGenerateContent = vi.fn();
const mockGetGenerativeModel = vi.fn().mockReturnValue({
  generateContent: mockGenerateContent,
});

vi.mock('@google/genai', () => ({
  GoogleGenerativeAI: vi.fn().mockImplementation(() => ({
    getGenerativeModel: mockGetGenerativeModel,
  })),
}));

describe('HookRunner - Native Hooks (Smart Supervisor)', () => {
  const hookRunner = new HookRunner();
  const supervisorPath = path.resolve(__dirname, './built-in/supervisor.ts');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow safe commands when LLM says SAFE', async () => {
    // Mock safe response
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'SAFE',
      },
    });

    const hookConfig: NativeHookConfig = {
      type: HookType.Native,
      path: supervisorPath,
      functionName: 'supervisorHook',
    };

    const input: HookInput = {
      session_id: 'test-session',
      transcript_path: '',
      cwd: '/tmp',
      hook_event_name: 'BeforeTool',
      timestamp: new Date().toISOString(),
      // @ts-ignore
      tool_name: 'run_command',
      tool_input: { command: 'ls -la' },
    };

    const result = await hookRunner.executeHook(
      hookConfig,
      HookEventName.BeforeTool,
      input,
    );

    expect(result.success).toBe(true);
    expect(result.output?.decision).toBe('allow');
    expect(mockGenerateContent).toHaveBeenCalled();
  });

  it('should block dangerous commands when LLM says UNSAFE', async () => {
    // Mock unsafe response
    mockGenerateContent.mockResolvedValue({
      response: {
        text: () => 'UNSAFE: Deletes files recursively',
      },
    });

    const hookConfig: NativeHookConfig = {
      type: HookType.Native,
      path: supervisorPath,
      functionName: 'supervisorHook',
    };

    const input: HookInput = {
      session_id: 'test-session',
      transcript_path: '',
      cwd: '/tmp',
      hook_event_name: 'BeforeTool',
      timestamp: new Date().toISOString(),
      // @ts-ignore
      tool_name: 'run_command',
      tool_input: { command: 'rm -rf /' },
    };

    const result = await hookRunner.executeHook(
      hookConfig,
      HookEventName.BeforeTool,
      input,
    );

    expect(result.success).toBe(true);
    expect(result.output?.decision).toBe('deny');
    expect(result.output?.reason).toContain('Deletes files recursively');
  });

  it('should handle API errors gracefully (fail closed)', async () => {
    // Mock API error
    mockGenerateContent.mockRejectedValue(new Error('API Error'));

    const hookConfig: NativeHookConfig = {
      type: HookType.Native,
      path: supervisorPath,
      functionName: 'supervisorHook',
    };

    const input: HookInput = {
      session_id: 'test-session',
      transcript_path: '',
      cwd: '/tmp',
      hook_event_name: 'BeforeTool',
      timestamp: new Date().toISOString(),
      // @ts-ignore
      tool_name: 'run_command',
      tool_input: { command: 'ls -la' },
    };

    const result = await hookRunner.executeHook(
      hookConfig,
      HookEventName.BeforeTool,
      input,
    );

    // Should still succeed as a hook execution, but return a deny decision
    expect(result.success).toBe(true);
    expect(result.output?.decision).toBe('deny');
    expect(result.output?.reason).toContain('Safety check failed');
  });
});
