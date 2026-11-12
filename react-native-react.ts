import { createUseAvatar } from './src/react-hook.js';
import { reactNativeAvatarResolver } from './react-native.js';
import type { AvatarResolution } from './src/types.js';

/**
 * React hook backed by the AsyncStorage-persisted React Native resolver.
 */
export const useAvatar = createUseAvatar(reactNativeAvatarResolver);

export function useSenderAvatar(params: {
    email: string;
    name?: string;
    existingAvatarUrl?: string;
}): AvatarResolution {
    return useAvatar(params);
}
