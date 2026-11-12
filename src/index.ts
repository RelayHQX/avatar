export {
    extractDomain,
    getAvatarColor,
    getAvatarQueryKey,
    getInitials,
    getRootDomain,
    sanitizeAvatarUrl,
} from './identity.js';
export { createAsyncStorageAdapter } from './cache.js';
export { createAvatarResolver, defaultAvatarResolver, getCachedAvatar, resolveSenderAvatar } from './resolver.js';
export type {
    AsyncStorageLike,
    AvatarCacheOptions,
    AvatarProvider,
    AvatarProviderContext,
    AvatarProviderOption,
    AvatarProviderResult,
    AvatarRequest,
    AvatarResolution,
    AvatarResolver,
    AvatarResolverOptions,
    AvatarStorageAdapter,
} from './types.js';
