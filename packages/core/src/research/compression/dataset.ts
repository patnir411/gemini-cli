/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { CompressionTask } from './contextCompressionHarness.js';

// Helper to generate dummy code
const generateCode = (lines: number) => Array(lines).fill('const x = 1;').join('\n');

export const COMPRESSION_DATASET: CompressionTask[] = [
  {
    id: 'task-1-bugfix',
    prompt: "Fix the null pointer exception in the auth handler",
    files: [
      { path: 'src/auth/handler.ts', content: `export function handle() { throw new Error("oops"); }`, isRelevant: true },
      { path: 'src/auth/types.ts', content: `export type Auth = { id: string };`, isRelevant: true },
      { path: 'src/utils/logger.ts', content: generateCode(50), isRelevant: false },
      { path: 'src/components/Button.tsx', content: generateCode(100), isRelevant: false },
      { path: 'src/database/schema.sql', content: generateCode(200), isRelevant: false },
    ]
  },
  {
    id: 'task-2-feature',
    prompt: "Add a new 'Settings' page to the router",
    files: [
      { path: 'src/App.tsx', content: `import { Router } from './router';`, isRelevant: true },
      { path: 'src/router.ts', content: `export const routes = [];`, isRelevant: true },
      { path: 'src/pages/Settings.tsx', content: `export const Settings = () => <div />;`, isRelevant: true },
      { path: 'src/utils/math.ts', content: generateCode(50), isRelevant: false },
      { path: 'src/styles/global.css', content: generateCode(300), isRelevant: false },
      { path: 'README.md', content: "Documentation...", isRelevant: false },
    ]
  }
];
