#!/usr/bin/env node
// Direct test of CLI initialization with Ollama

import { createContentGenerator, createContentGeneratorConfig, AuthType } from './packages/core/dist/index.js';

console.log('Testing Ollama integration through CLI layer...\n');

// Mock config object
const mockConfig = {
  getProxy: () => undefined,
};

try {
  console.log('1. Creating content generator config...');
  const config = await createContentGeneratorConfig(
    mockConfig,
    AuthType.USE_OLLAMA
  );
  console.log('   Config created:', JSON.stringify(config, null, 2));

  console.log('\n2. Creating content generator...');
  const generator = await createContentGenerator(config, mockConfig);
  console.log('   Generator created successfully!');

  console.log('\n3. Testing generateContent...');
  const response = await generator.generateContent(
    {
      model: 'gemma3:2b',
      contents: [{ role: 'user', parts: [{ text: 'Say hello in 5 words' }] }],
    },
    'test-id'
  );

  console.log('   ✅ Response:', response.candidates?.[0]?.content?.parts?.[0]?.text);
  console.log('\n🎉 Full CLI layer integration test PASSED!');
} catch (error) {
  console.error('\n❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
}
