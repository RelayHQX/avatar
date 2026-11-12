import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createAvatarResolver,
  extractDomain,
  getAvatarColor,
  getInitials,
  getRootDomain,
  resolveSenderAvatar,
} from '../dist/index.js';

test('legacy helpers and resolution keep their public data shape', async () => {
  assert.equal(getInitials('Ada Lovelace'), 'AL');
  assert.equal(extractDomain('ada@example.com'), 'example.com');
  assert.equal(getRootDomain('mail.example.co.uk'), 'example.co.uk');
  assert.match(getAvatarColor('ada@example.com'), /^#[0-9A-F]{6}$/);

  const result = await resolveSenderAvatar({
    email: 'ada@gmail.com',
    name: 'Ada Lovelace',
    existingAvatarUrl: 'https://images.example.org/ada.png',
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'avatarBgColor',
    'initials',
    'source',
    'url',
    'verified',
  ]);
  assert.equal(result.initials, 'AL');
  assert.equal(result.source, 'existing');
  assert.equal(result.url, 'https://images.example.org/ada.png');
});

test('an existing avatar URL participates in cache identity', async () => {
  const resolver = createAvatarResolver({ providers: ['existing'] });
  const first = await resolver.resolve({
    email: 'ada@example.com',
    existingAvatarUrl: 'https://images.example.org/ada.png',
  });
  const second = await resolver.resolve({
    email: 'ada@example.com',
    existingAvatarUrl: 'https://images.example.org/ada-new.png',
  });
  assert.equal(first.url, 'https://images.example.org/ada.png');
  assert.equal(second.url, 'https://images.example.org/ada-new.png');
});

test('cache identity and persistent storage key can be configured', async () => {
  let attempts = 0;
  const persisted = new Map();
  const resolver = createAvatarResolver({
    cache: {
      key: ({ email }) => `email:${email}`,
      storageKey: 'app-avatar-records',
      storage: {
        async getItem(key) {
          return persisted.get(key) ?? null;
        },
        async setItem(key, value) {
          persisted.set(key, value);
        },
      },
    },
    providers: [{
      id: 'domain',
      resolve: ({ name }) => {
        attempts++;
        return { url: `https://cdn.example.net/${name}.png` };
      },
    }],
  });
  const first = await resolver.resolve({ email: 'person@gmail.com', name: 'first' });
  const second = await resolver.resolve({ email: 'person@gmail.com', name: 'second' });
  assert.equal(first.url, second.url);
  assert.equal(attempts, 1);
  assert.ok(persisted.has('app-avatar-records'));
});

test('negative results are cached and custom providers are supported', async () => {
  let attempts = 0;
  const resolver = createAvatarResolver({
    providers: [{
      id: 'domain',
      resolve: async () => {
        attempts++;
        return null;
      },
    }],
  });
  const request = { email: 'nobody@gmail.com' };
  const first = await resolver.resolve(request);
  const second = await resolver.resolve(request);
  assert.equal(first.source, 'initials');
  assert.equal(second.url, null);
  assert.equal(resolver.getCached(request)?.url, null);
  assert.equal(attempts, 1);
});

test('Gravatar uses SHA-256 and stops probing after a successful response', async () => {
  const requestedUrls = [];
  const email = 'ada@gmail.com';
  const resolver = createAvatarResolver({
    providers: ['gravatar'],
    fetch: async (url) => {
      requestedUrls.push(String(url));
      return new Response(null, { status: 200 });
    },
  });
  const result = await resolver.resolve({ email });
  const hash = createHash('sha256').update(email).digest('hex');
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], `https://www.gravatar.com/avatar/${hash}?d=404&s=128`);
  assert.equal(result.source, 'gravatar');
  assert.match(result.url, new RegExp(hash));
});

test('Gravatar hashing works without Web Crypto', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  try {
    const requestedUrls = [];
    const email = 'fallback@example.com';
    const resolver = createAvatarResolver({
      providers: ['gravatar'],
      fetch: async (url) => {
        requestedUrls.push(String(url));
        return new Response(null, { status: 200 });
      },
    });
    await resolver.resolve({ email });
    const hash = createHash('sha256').update(email).digest('hex');
    assert.equal(requestedUrls[0], `https://www.gravatar.com/avatar/${hash}?d=404&s=128`);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

test('custom provider execution times out', async () => {
  const resolver = createAvatarResolver({
    timeoutMs: 10,
    providers: [{
      id: 'domain',
      resolve: () => new Promise(() => {}),
    }],
  });
  await assert.rejects(
    resolver.resolve({ email: 'slow@gmail.com' }),
    /Avatar provider "domain" timed out/,
  );
});

test('fastest and verified-only resolution policies are selectable', async () => {
  const fastest = createAvatarResolver({
    policy: 'fastest',
    providers: [
      {
        id: 'domain',
        resolve: () => new Promise((resolve) =>
          setTimeout(() => resolve({ url: 'https://slow.example.org/a.png' }), 30)),
      },
      {
        id: 'unavatar',
        resolve: () => new Promise((resolve) =>
          setTimeout(() => resolve({ url: 'https://fast.example.org/a.png' }), 1)),
      },
    ],
  });
  const fastestResult = await fastest.resolve({ email: 'person@gmail.com' });
  assert.equal(fastestResult.source, 'unavatar');
  assert.equal(fastestResult.url, 'https://fast.example.org/a.png');

  const verifiedOnly = createAvatarResolver({
    policy: 'verified-only',
    providers: [
      { id: 'domain', resolve: () => ({ url: 'https://unverified.example.org/a.png' }) },
      { id: 'gravatar', resolve: () => ({ url: 'https://verified.example.org/a.png', verified: true }) },
    ],
  });
  const verifiedResult = await verifiedOnly.resolve({ email: 'person@gmail.com' });
  assert.equal(verifiedResult.source, 'gravatar');
  assert.equal(verifiedResult.verified, true);
});

test('persistent cache loads only after explicit or automatic initialization', async () => {
  const persisted = new Map();
  const storage = {
    async getItem(key) {
      return persisted.get(key) ?? null;
    },
    async setItem(key, value) {
      persisted.set(key, value);
    },
  };
  let attempts = 0;
  const provider = {
    id: 'domain',
    resolve: () => {
      attempts++;
      return { url: 'https://cdn.example.org/avatar.png' };
    },
  };
  const options = { cache: { storage }, providers: [provider] };
  const firstResolver = createAvatarResolver(options);
  await firstResolver.resolve({ email: 'person@gmail.com' });
  assert.equal(persisted.size, 1);

  const secondResolver = createAvatarResolver(options);
  const result = await secondResolver.resolve({ email: 'person@gmail.com' });
  assert.equal(result.url, 'https://cdn.example.org/avatar.png');
  assert.equal(attempts, 1);
});
