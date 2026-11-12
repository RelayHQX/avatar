# @relayhq/avatar

**Universal avatar discovery and resolution engine.**

Resolve profile images for people, email addresses, organizations, and domains with a configurable provider pipeline. The core works in TypeScript applications, browsers, React Native/Expo, Node.js, and Bun.

## Features

- Existing avatar URL support, domain favicons, Gravatar, Unavatar, and Libravatar.
- Consumer email domain detection and deterministic initials/background colors.
- Extensible provider plugins and configurable resolution order.
- Priority, fastest-available, and verified-only resolution policies.
- Bounded LRU caching, including expiring negative results.
- AsyncStorage persistence by default through an optional React Native-only entry point.
- Custom cache identity/storage keys, request deduplication, timeouts, and cancellation.
- Optional TanStack Query React hooks.

Avatar discovery is not email authentication. A domain logo or provider avatar does **not** verify the sender's identity.

## Install

```sh
npm install @relayhq/avatar
```

## Core usage

```ts
import { createAvatarResolver } from '@relayhq/avatar';

const avatars = createAvatarResolver({
  cache: {
    maxEntries: 1000,
    ttl: 86400,       // successful results: one day
    negativeTtl: 3600, // no-avatar results: one hour
  },
  providers: ['existing', 'domain', 'gravatar', 'unavatar', 'libravatar'],
});

const avatar = await avatars.resolve({
  email: 'hello@linear.app',
  name: 'Linear',
});

// avatar.url, avatar.initials, avatar.avatarBgColor, avatar.source
```

The default `priority` policy tries providers in the supplied order. Choose `fastest` to run providers concurrently and use the first available result, or `verified-only` to skip results whose provider has not marked them verified. Built-in discovery providers are not identity verification methods; verified-only is most useful with application-specific providers that can make a meaningful verification decision.

The resolver uses an in-memory cache by default. It requires no AsyncStorage installation and is safe to import in non-React and non-React-Native environments. Turn caching off with `cache: false`.

The returned `AvatarResolution` shape remains compatible with the original Relay Mail resolver:

```ts
interface AvatarResolution {
  url: string | null;
  fallbackUrls?: string[];
  source: 'existing' | 'gravatar' | 'libravatar' | 'bimi' | 'domain' | 'unavatar' | 'initials';
  verified: boolean;
  initials: string;
  avatarBgColor: string;
}
```

`resolveSenderAvatar`, `getCachedAvatar`, `getAvatarQueryKey`, `getInitials`, `getAvatarColor`, `getRootDomain`, `extractDomain`, and `sanitizeAvatarUrl` remain available from the package root. The default `resolveSenderAvatar` keeps the existing `{ email, name?, existingAvatarUrl? }` request shape.

## React and React Native

Install React and TanStack Query in your application, then import hooks from the optional web/general React entry point:

```sh
npm install react @tanstack/react-query
```

```tsx
import { useAvatar } from '@relayhq/avatar/react';

function SenderAvatar({ email, name }: { email: string; name: string }) {
  const avatar = useAvatar({ email, name });
  return (
    <Avatar
      uri={avatar.url}
      initials={avatar.initials}
      backgroundColor={avatar.avatarBgColor}
    />
  );
}
```

`useSenderAvatar({ email, name, existingAvatarUrl })` is also exported from `@relayhq/avatar/react` with the previous hook's return shape. Keeping hooks on a separate entry point prevents importing the core from pulling in React or TanStack Query.

## React Native AsyncStorage cache

React Native applications can use the native-only entry point. It uses AsyncStorage by default for persistent cache hydration and writes; the core and regular React entry never import AsyncStorage.

```ts
import { createReactNativeAvatarResolver } from '@relayhq/avatar/react-native';
import { useAvatar } from '@relayhq/avatar/react-native/react';

const avatars = createReactNativeAvatarResolver({
  cache: {
    maxEntries: 1000,
    ttl: 86400,
    negativeTtl: 3600,
    storageKey: '@my-app/avatar-cache',
  },
});

await avatars.initialize(); // optional: call during app startup
const avatar = await avatars.resolve({ email: 'hello@example.org', name: 'Hello' });
```

The AsyncStorage peer is only needed when importing `@relayhq/avatar/react-native`. That entry also exports `resolveSenderAvatar` and `getCachedAvatar`, bound to the AsyncStorage-backed default resolver. The optional hook entry at `@relayhq/avatar/react-native/react` also requires React and TanStack Query; its `useAvatar` and `useSenderAvatar` hooks share the same resolver. Set `cache: false` to disable caching or `cache.enabled: false` to disable it while keeping other resolver options.

The regular framework-independent resolver defaults to bounded in-memory caching. To persist outside React Native, supply an adapter implementing `getItem` and `setItem`; storage and malformed-data errors are surfaced. `createAsyncStorageAdapter(storage)` is also exported from the core package for explicit adapter wiring.

## Cache keys

The React Native storage key is configurable with `cache.storageKey`. For full control over per-avatar cache identity, provide `cache.key`; it receives the normalized request and must return a non-empty string:

```ts
const avatars = createAvatarResolver({
  cache: {
    key: ({ email }) => `sender:${email}`,
  },
});
```

By default the memory cache identity includes normalized email, name, and `existingAvatarUrl`, so changes to a supplied contact photo cannot return a stale result.

## Custom providers

Providers can be registered directly and ordered with built-ins. Return `null` to let the next provider try. Custom providers receive request cancellation and shared network/hash helpers.

```ts
import { createAvatarResolver } from '@relayhq/avatar';

const avatars = createAvatarResolver({
  providers: [
    'existing',
    {
      id: 'domain',
      async resolve({ email }) {
        if (!email?.endsWith('@example.org')) return null;
        return { url: 'https://cdn.example.org/avatar.png' };
      },
    },
    'gravatar',
  ],
});
```

Each resolver instance has its own cache and in-flight request map. Resolution results are cached with a bounded least-recently-used policy. `signal` on a resolve request cancels that caller's provider work; requests with independent signals are not deduplicated.

## API

- `createAvatarResolver(options)` creates an isolated resolver.
- `resolver.resolve({ email?, name?, existingAvatarUrl?, signal? })` resolves an avatar.
- `resolver.getCached(request)` synchronously reads a non-expired result, including a negative result.
- `resolver.clearCache()` clears memory and persistent storage.
- `resolver.initialize()` loads persisted entries explicitly.
- `createAsyncStorageAdapter(storage)` adapts AsyncStorage-compatible objects.

## Development and publishing

```sh
npm install
npm test
npm run build
npm pack --dry-run
npm run benchmark
```

The performance test prints cold-resolution latency and the average time per in-memory cache hit. `npm run benchmark` runs a longer deterministic benchmark with a simulated provider delay; provider/network latency in production varies by device and network.

After confirming the package contents and npm account/organization access, publish the public scoped package with:

```sh
npm run release
```

`npm run publish:npm` is an alias. Both build and run the test suite as part of npm's `prepublishOnly` lifecycle before publishing.
