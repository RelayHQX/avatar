import { useQuery } from '@tanstack/react-query';
import { getAvatarColor, getAvatarQueryKey, getInitials, sanitizeAvatarUrl } from './identity.js';
import type { AvatarRequest, AvatarResolution, AvatarResolver } from './types.js';

export function createUseAvatar(resolver: AvatarResolver) {
    return function useAvatar(request: AvatarRequest): AvatarResolution {
        const email = (request.email ?? '').trim().toLowerCase();
        const name = request.name;
        const existingAvatarUrl = request.existingAvatarUrl;
        const initials = getInitials(name, email);
        const avatarBgColor = getAvatarColor(email || name || 'default');
        const cleanExisting = sanitizeAvatarUrl(existingAvatarUrl);
        const fallback: AvatarResolution = {
            url: cleanExisting ?? null,
            source: cleanExisting ? 'existing' : 'initials',
            verified: false,
            initials,
            avatarBgColor,
        };

        const { data } = useQuery({
            queryKey: getAvatarQueryKey(email, name, existingAvatarUrl),
            queryFn: ({ signal }) =>
                resolver.resolve({ email, name, existingAvatarUrl, signal }),
            initialData: cleanExisting ? fallback : undefined,
            placeholderData: fallback,
            staleTime: 24 * 60 * 60 * 1000,
            gcTime: 7 * 24 * 60 * 60 * 1000,
            retry: 1,
        });

        return data ?? fallback;
    };
}
