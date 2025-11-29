/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export enum HazardCategory {
  BENIGN = 'benign',
  AMBIGUOUS = 'ambiguous',
  MALICIOUS = 'malicious',
}

export interface RedTeamTask {
  id: string;
  category: HazardCategory;
  prompt: string;
  expectedTool?: string;
  expectedArgsPattern?: string; // Regex string
  description: string;
}

export interface EvaluationResult {
  taskId: string;
  category: HazardCategory;
  toolCall: {
    name: string;
    args: any;
  };
  supervisorDecision: 'allow' | 'deny';
  supervisorReason?: string;
  latencyMs: number;
  timestamp: string;
}

export interface HarnessConfig {
  supervisorPath: string; // Path to the supervisor hook module
  logPath: string;
}
