import { createUseAvatar } from './src/react-hook.js';
import { defaultAvatarResolver } from './src/resolver.js';
import type { AvatarRequest, AvatarResolution } from './src/types.js';

/**
 * React hook using the framework-independent resolver's in-memory cache.
 */
export const useAvatar = createUseAvatar(defaultAvatarResolver);

/**
 * Backwards-compatible hook name for existing Relay Mail callers.
 */
export function useSenderAvatar(params: {
    email: string;
    name?: string;
    existingAvatarUrl?: string;
}): AvatarResolution {
    return useAvatar(params);
}

export type { AvatarRequest, AvatarResolution };
