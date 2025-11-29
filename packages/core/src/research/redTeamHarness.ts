/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HookRunner } from '../hooks/hookRunner.js';
import { HookEventName, HookType } from '../hooks/types.js';
import type { NativeHookConfig, HookInput } from '../hooks/types.js';
import type { RedTeamTask, EvaluationResult, HarnessConfig } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

export class RedTeamHarness {
  private hookRunner: HookRunner;
  private config: HarnessConfig;

  constructor(config: HarnessConfig) {
    this.config = config;
    this.hookRunner = new HookRunner();
  }

  /**
   * Run a single task through the harness
   */
  async runTask(task: RedTeamTask): Promise<EvaluationResult> {
    const startTime = Date.now();

    // Construct the hook input simulating a tool call
    const input: HookInput = {
      session_id: `eval-${task.id}-${Date.now()}`,
      transcript_path: '',
      cwd: '/tmp/sandbox', // Simulate sandbox environment
      hook_event_name: 'BeforeTool',
      timestamp: new Date().toISOString(),
      // @ts-ignore - Adding tool specific fields
      tool_name: task.expectedTool || 'run_command',
      tool_input: { 
        command: task.prompt // In this simplified harness, prompt is treated as the command intent
      },
    };

    // Configure the supervisor hook
    const hookConfig: NativeHookConfig = {
      type: HookType.Native,
      path: this.config.supervisorPath,
      functionName: 'supervisorHook',
    };

    // Execute the hook
    const result = await this.hookRunner.executeHook(
      hookConfig,
      HookEventName.BeforeTool,
      input,
    );

    const latencyMs = Date.now() - startTime;

    // Determine decision
    let decision: 'allow' | 'deny' = 'allow';
    let reason: string | undefined = undefined;

    if (result.success && result.output) {
      if (result.output.decision === 'deny' || result.output.decision === 'block') {
        decision = 'deny';
        reason = result.output.reason;
      }
    } else if (!result.success) {
      // If hook failed, we consider it a deny (fail closed)
      decision = 'deny';
      reason = `Hook execution failed: ${result.error?.message}`;
    }

    return {
      taskId: task.id,
      category: task.category,
      toolCall: {
        name: task.expectedTool || 'run_command',
        args: (input as any).tool_input,
      },
      supervisorDecision: decision,
      supervisorReason: reason,
      latencyMs,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Run a batch of tasks and log results
   */
  async runBatch(tasks: RedTeamTask[]): Promise<EvaluationResult[]> {
    const results: EvaluationResult[] = [];
    
    console.log(`Starting evaluation of ${tasks.length} tasks...`);

    for (const task of tasks) {
      console.log(`Running Task ${task.id}: ${task.description}`);
      const result = await this.runTask(task);
      results.push(result);
      console.log(`  -> Decision: ${result.supervisorDecision} (${result.latencyMs}ms)`);
    }

    this.logResults(results);
    return results;
  }

  private logResults(results: EvaluationResult[]) {
    const logDir = path.dirname(this.config.logPath);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    fs.writeFileSync(this.config.logPath, JSON.stringify(results, null, 2));
    console.log(`Results saved to ${this.config.logPath}`);
  }
}
