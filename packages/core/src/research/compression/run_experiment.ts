/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ContextCompressionHarness } from './contextCompressionHarness.js';
import { COMPRESSION_DATASET } from './dataset.js';

async function main() {
  console.log('--- Starting Context Compression Experiment ---');
  
  // Force Mock Mode for determinism
  process.env['GOOGLE_API_KEY'] = 'mock-key';

  const harness = new ContextCompressionHarness();
  
  let totalOriginal = 0;
  let totalCompressed = 0;
  let totalRecall = 0;

  for (const task of COMPRESSION_DATASET) {
    console.log(`\nRunning Task: ${task.id}`);
    const result = await harness.runTask(task);
    
    console.log(`  Original Tokens: ${result.originalTokens}`);
    console.log(`  Compressed Tokens: ${result.compressedTokens}`);
    console.log(`  Ratio: ${(result.compressionRatio * 100).toFixed(1)}%`);
    console.log(`  Recall: ${(result.recall * 100).toFixed(1)}%`);
    console.log(`  Precision: ${(result.precision * 100).toFixed(1)}%`);

    totalOriginal += result.originalTokens;
    totalCompressed += result.compressedTokens;
    totalRecall += result.recall;
  }

  const avgRecall = totalRecall / COMPRESSION_DATASET.length;
  const globalRatio = totalCompressed / totalOriginal;

  console.log('\n--- Experiment Summary ---');
  console.log(`Global Compression Ratio: ${(globalRatio * 100).toFixed(1)}% (Lower is better)`);
  console.log(`Average Recall: ${(avgRecall * 100).toFixed(1)}% (Higher is better)`);
  
  if (globalRatio < 0.5 && avgRecall > 0.8) {
      console.log('SUCCESS: Significant compression with high recall.');
  } else {
      console.log('RESULT: Trade-off needs optimization.');
  }
}

main();
