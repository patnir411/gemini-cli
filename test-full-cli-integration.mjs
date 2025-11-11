#!/usr/bin/env node
/**
 * Full integration test with proper Config object
 */

import { Config } from './packages/core/dist/index.js';
import { AuthType } from './packages/core/dist/index.js';

console.log('🧪 Testing Full CLI Integration with Ollama...\n');

async function test() {
  try {
    // Create a minimal but valid Config
    const config = new Config({
      sessionId: 'test-session',
      targetDir: process.cwd(),
      cwd: process.cwd(),
      debugMode: false,
      model: 'gemma3:2b',
      usageStatisticsEnabled: false, // Disable telemetry for test
    });

    console.log('1. Initializing with Ollama auth type...');
    await config.init(AuthType.USE_OLLAMA);
    console.log('   ✅ Config initialized');

    console.log('\n2. Getting content generator...');
    const generator = config.getContentGenerator();
    console.log('   ✅ Generator retrieved');

    console.log('\n3. Testing generateContent...');
    const response = await generator.generateContent(
      {
        model: 'gemma3:2b',
        contents: [{ role: 'user', parts: [{ text: 'Say hello in exactly 5 words' }] }],
      },
      'test-prompt-id'
    );

    const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
    console.log('   ✅ Response:', text);
    console.log('   📊 Tokens:', response.usageMetadata?.totalTokenCount);

    console.log('\n4. Testing streaming...');
    const stream = await generator.generateContentStream(
      {
        model: 'gemma3:2b',
        contents: [{ role: 'user', parts: [{ text: 'Count to 3' }] }],
      },
      'test-stream-id'
    );

    process.stdout.write('   Stream output: ');
    for await (const chunk of stream) {
      const chunkText = chunk.candidates?.[0]?.content?.parts?.[0]?.text || '';
      process.stdout.write(chunkText);
    }
    console.log('\n   ✅ Streaming works!');

    console.log('\n🎉 FULL CLI INTEGRATION TEST PASSED!');
    console.log('\n✅ Ollama integration is fully functional with gemini-cli!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('\nStack:', error.stack);
    process.exit(1);
  }
}

test();
