import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStorageAdapter } from './src/cache.js';
import { createAvatarResolver } from './src/resolver.js';
import type {
    AvatarResolution,
    AvatarResolver,
    AvatarResolverOptions,
} from './src/types.js';

const asyncStorageAdapter = createAsyncStorageAdapter(AsyncStorage);

/**
 * Creates a resolver with React Native AsyncStorage persistence enabled by default.
 * Set `cache: false` to disable caching, or provide cache.storage to override the adapter.
 */
export function createReactNativeAvatarResolver(
    options: AvatarResolverOptions = {},
): AvatarResolver {
    const cache: AvatarResolverOptions['cache'] = options.cache === false
        ? false
        : {
            ...(options.cache ?? {}),
            storage: options.cache?.storage ?? asyncStorageAdapter,
        };
    return createAvatarResolver({ ...options, cache });
}

/**
 * Default React Native resolver, hydrated from AsyncStorage on first use.
 */
export const reactNativeAvatarResolver = createReactNativeAvatarResolver();

export async function resolveSenderAvatar(params: {
    email: string;
    name?: string;
    existingAvatarUrl?: string;
}): Promise<AvatarResolution> {
    return reactNativeAvatarResolver.resolve(params);
}

export function getCachedAvatar(email: string, name?: string): AvatarResolution | null {
    const cached = reactNativeAvatarResolver.getCached({ email, name });
    return cached?.url ? cached : null;
}

export function initializeReactNativeAvatarCache(): Promise<void> {
    return reactNativeAvatarResolver.initialize();
}
