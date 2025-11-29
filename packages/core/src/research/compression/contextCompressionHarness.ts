/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// import { GoogleGenerativeAI } from '@google/genai';

export interface FileChunk {
  path: string;
  content: string;
  isRelevant: boolean; // Ground truth
}

export interface CompressionTask {
  id: string;
  prompt: string;
  files: FileChunk[];
}

export interface CompressionResult {
  taskId: string;
  originalTokens: number;
  compressedTokens: number;
  compressionRatio: number;
  recall: number; // Percentage of relevant files kept
  precision: number; // Percentage of kept files that are relevant
  latencyMs: number;
}

export class ContextCompressionHarness {
  private genAI: any;

  constructor() {
    // Lazy init handled in method
  }

  private async getModel() {
    if (!this.genAI) {
        // Mock or Real
        if (!process.env['GOOGLE_API_KEY'] || process.env['GOOGLE_API_KEY'] === 'mock-key') {
            return null; // Mock mode
        }
        const mod = await import('@google/genai') as any;
        const GoogleGenerativeAI = mod.GoogleGenerativeAI || mod.default?.GoogleGenerativeAI;
        this.genAI = new GoogleGenerativeAI(process.env['GOOGLE_API_KEY']);
    }
    return this.genAI ? this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' }) : null;
  }

  /**
   * The "Selector Model" Logic
   * Scores each file based on relevance to the prompt.
   */
  async selectContext(prompt: string, files: FileChunk[]): Promise<FileChunk[]> {
    const selected: FileChunk[] = [];
    const model = await this.getModel();

    // Mock Mode Logic
    if (!model) {
        // Simulate a smart selector: It "knows" what's relevant based on simple heuristics or ground truth for the experiment
        // For this experiment, let's simulate a model that is 80% accurate
        for (const file of files) {
            // Simulate 80% recall, 80% precision
            const isActuallyRelevant = file.isRelevant;
            const random = Math.random();
            
            let kept = false;
            if (isActuallyRelevant) {
                kept = random < 0.9; // 90% Recall
            } else {
                kept = random < 0.2; // 20% False Positive rate
            }

            if (kept) selected.push(file);
        }
        return selected;
    }

    // Real Model Logic (Batched for speed in real impl, but sequential here for simplicity)
    for (const file of files) {
        const selectionPrompt = `
You are a Context Selector.
User Prompt: "${prompt}"
File Path: "${file.path}"
File Content Preview: "${file.content.substring(0, 200)}..."

Is this file relevant to answering the user prompt?
Reply exactly "YES" or "NO".
`;
        try {
            const result = await model.generateContent(selectionPrompt);
            const decision = result.response.text().trim().toUpperCase();
            if (decision.includes('YES')) {
                selected.push(file);
            }
        } catch (e) {
            console.error(`Model failed for ${file.path}`, e);
        }
    }

    return selected;
  }

  async runTask(task: CompressionTask): Promise<CompressionResult> {
    const startTime = Date.now();
    
    // 1. Run Selection
    const selectedFiles = await this.selectContext(task.prompt, task.files);
    
    const latencyMs = Date.now() - startTime;

    // 2. Calculate Metrics
    // Simple token proxy: 1 char = 0.25 tokens
    const originalTokens = task.files.reduce((acc, f) => acc + f.content.length * 0.25, 0);
    const compressedTokens = selectedFiles.reduce((acc, f) => acc + f.content.length * 0.25, 0);
    
    const relevantFiles = task.files.filter(f => f.isRelevant);
    const keptRelevant = selectedFiles.filter(f => f.isRelevant);
    const keptIrrelevant = selectedFiles.filter(f => !f.isRelevant);

    const recall = relevantFiles.length > 0 ? keptRelevant.length / relevantFiles.length : 1;
    const precision = selectedFiles.length > 0 ? keptRelevant.length / selectedFiles.length : 0;

    return {
        taskId: task.id,
        originalTokens,
        compressedTokens,
        compressionRatio: originalTokens > 0 ? compressedTokens / originalTokens : 1,
        recall,
        precision,
        latencyMs
    };
  }
}
