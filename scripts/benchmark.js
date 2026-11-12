import { performance } from 'node:perf_hooks';
import { createAvatarResolver } from '../dist/index.js';

const resolver = createAvatarResolver({
  providers: [{
    id: 'domain',
    resolve: async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { url: 'https://cdn.example.net/avatar.png' };
    },
  }],
});
const request = { email: 'benchmark@gmail.com', name: 'Avatar Benchmark' };

const coldStart = performance.now();
await resolver.resolve(request);
const coldMs = performance.now() - coldStart;

const iterations = 10000;
const warmStart = performance.now();
for (let index = 0; index < iterations; index++) {
  await resolver.resolve(request);
}
const warmTotalMs = performance.now() - warmStart;

console.log(`Cold resolver load: ${coldMs.toFixed(2)} ms`);
console.log(
  `Warm memory-cache loads: ${iterations} in ${warmTotalMs.toFixed(2)} ms ` +
  `(${(warmTotalMs / iterations).toFixed(4)} ms/load)`,
);
