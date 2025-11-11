#!/usr/bin/env node
/**
 * Simple test script to verify Ollama integration works
 */

import { OllamaContentGenerator } from './packages/core/dist/src/core/ollamaContentGenerator.js';

const generator = new OllamaContentGenerator('http://localhost:11434', {});

console.log('🧪 Testing Ollama Integration...\n');

// Test 1: Non-streaming generation
console.log('Test 1: Non-streaming generation');
try {
  const response = await generator.generateContent(
    {
      model: 'gemma3:2b',
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Say hello in exactly 5 words' }],
        },
      ],
    },
    'test-prompt-1',
  );

  console.log('✅ Success!');
  console.log('Response:', response.candidates?.[0]?.content?.parts?.[0]?.text);
  console.log(
    'Tokens:',
    response.usageMetadata?.totalTokenCount,
    '(estimated)\n',
  );
} catch (error) {
  console.error('❌ Error:', error.message, '\n');
}

// Test 2: Streaming generation
console.log('Test 2: Streaming generation');
try {
  const stream = await generator.generateContentStream(
    {
      model: 'gemma3:2b',
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Count to 5' }],
        },
      ],
    },
    'test-prompt-2',
  );

  console.log('✅ Streaming started...');
  let fullText = '';
  for await (const chunk of stream) {
    const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (text) {
      fullText += text;
      process.stdout.write(text);
    }
  }
  console.log('\n✅ Stream complete!\n');
} catch (error) {
  console.error('❌ Error:', error.message, '\n');
}

// Test 3: Token counting
console.log('Test 3: Token counting');
try {
  const tokenResponse = await generator.countTokens({
    model: 'gemma3:2b',
    contents: [
      {
        role: 'user',
        parts: [{ text: 'This is a test message for token counting' }],
      },
    ],
  });

  console.log('✅ Token count:', tokenResponse.totalTokens, '(estimated)\n');
} catch (error) {
  console.error('❌ Error:', error.message, '\n');
}

console.log('🎉 All tests complete!');
