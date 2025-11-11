// Simplest possible end-to-end test
import { OllamaContentGenerator } from './packages/core/dist/src/core/ollamaContentGenerator.js';
import { LoggingContentGenerator } from './packages/core/dist/src/core/loggingContentGenerator.js';

// Mock minimal config
const mockConfig = {
  getUsageStatisticsEnabled: () => false,
  getContentGeneratorConfig: () => ({ authType: 'ollama' }),
};

console.log('Testing end-to-end with LoggingContentGenerator wrapper...\n');

const ollama = new OllamaContentGenerator('http://localhost:11434', mockConfig);
const generator = new LoggingContentGenerator(ollama, mockConfig);

try {
  const response = await generator.generateContent(
    { model: 'gemma3:2b', contents: [{ role: 'user', parts: [{ text: 'Say hi' }] }] },
    'test-id'
  );
  console.log('✅ SUCCESS! Response:', response.candidates?.[0]?.content?.parts?.[0]?.text);
} catch (e) {
  console.error('❌ Error:', e.message);
}
