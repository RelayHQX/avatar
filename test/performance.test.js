import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { createAvatarResolver } from '../dist/index.js';

test('resolution latency and cached lookup stay within the performance budget', async () => {
  const resolver = createAvatarResolver({
    providers: [{
      id: 'domain',
      resolve: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { url: 'https://cdn.example.net/avatar.png' };
      },
    }],
  });
  const request = { email: 'performance@gmail.com' };

  const coldStart = performance.now();
  await resolver.resolve(request);
  const coldMs = performance.now() - coldStart;

  const hitCount = 1000;
  const warmStart = performance.now();
  for (let index = 0; index < hitCount; index++) {
    await resolver.resolve(request);
  }
  const warmTotalMs = performance.now() - warmStart;
  const warmAverageMs = warmTotalMs / hitCount;

  console.log(
    `Avatar timing: cold=${coldMs.toFixed(2)}ms; ` +
    `${hitCount} cached resolutions=${warmTotalMs.toFixed(2)}ms ` +
    `(${warmAverageMs.toFixed(4)}ms each)`,
  );
  assert.ok(coldMs >= 5, 'cold measurement should include the test provider latency');
  assert.ok(coldMs < 1000, 'cold resolution exceeded the one-second test budget');
  assert.ok(warmTotalMs < 500, '1000 in-memory cache hits exceeded the 500ms test budget');
});
