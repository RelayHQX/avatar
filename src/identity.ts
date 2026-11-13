import type { AvatarProviderResult, AvatarRequest, AvatarResolution } from './types.js';

const AVATAR_PALETTE = [
    '#3B82F6',
    '#10B981',
    '#8B5CF6',
    '#EC4899',
    '#F59E0B',
    '#06B6D4',
    '#6366F1',
    '#14B8A6',
    '#F97316',
    '#64748B',
];

const CONSUMER_DOMAINS = new Set([
    'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com', 'outlook.com',
    'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
    'protonmail.com', 'zoho.com', 'mail.com', 'gmx.com', 'fastmail.com', 'tutanota.com',
    'tuta.io', 'yandex.com', 'yandex.ru',
]);

export const DEFAULT_PROVIDER_IDS: AvatarResolution['source'][] = [
    'existing',
    'domain',
    'gravatar',
    'unavatar',
    'libravatar',
];

export function normalizeRequest(request: AvatarRequest): AvatarRequest {
    return {
        ...request,
        email: (request.email ?? '').trim().toLowerCase(),
        name: request.name?.trim() || undefined,
        existingAvatarUrl: request.existingAvatarUrl?.trim() || undefined,
    };
}

export function defaultCacheKey(request: AvatarRequest): string {
    const email = request.email ? request.email.trim().toLowerCase() : '';
    const name = request.name ? request.name.trim() : '';
    const existing = request.existingAvatarUrl ? request.existingAvatarUrl.trim() : '';
    return email + ':' + name + ':' + existing;
}

export function sanitizeAvatarUrl(url?: unknown): string | undefined {
    if (typeof url !== 'string') return undefined;
    const trimmed = url.trim();
    const lower = trimmed.toLowerCase();
    if (
        lower.includes('logo.clearbit.com') ||
        lower.includes('ui-avatars.com') ||
        lower.includes('example.com')
    ) {
        return undefined;
    }
    return trimmed || undefined;
}

export function getAvatarColor(key: string): string {
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = (hash << 5) - hash + key.charCodeAt(i);
        hash |= 0;
    }
    return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export function getInitials(name?: string, email?: string): string {
    if (name && name.trim().length > 0) {
        const parts = name.trim().split(/\s+/);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return parts[0].slice(0, 2).toUpperCase();
    }
    if (email && email.includes('@')) {
        return email.split('@')[0].slice(0, 2).toUpperCase();
    }
    return 'U';
}

export function getRootDomain(domain: string): string {
    if (!domain) return '';
    const parts = domain.toLowerCase().split('.');
    if (parts.length <= 2) return domain.toLowerCase();
    const lastTwo = parts.slice(-2).join('.');
    const commonTwoPartTlds = ['co.uk', 'com.au', 'co.jp', 'co.in', 'com.br', 'com.sg'];
    if (commonTwoPartTlds.includes(lastTwo) && parts.length > 3) {
        return parts.slice(-3).join('.');
    }
    return lastTwo;
}

export function extractDomain(email: string): string | null {
    if (!email || !email.includes('@')) return null;
    const rawDomain = email.slice(email.lastIndexOf('@') + 1).trim().toLowerCase();
    return rawDomain || null;
}

export function isConsumerDomain(domain: string): boolean {
    return CONSUMER_DOMAINS.has(getRootDomain(domain));
}

export function toAvatarResolution(
    request: AvatarRequest,
    result: AvatarProviderResult | null,
    source: AvatarResolution['source'],
): AvatarResolution | null {
    const url = sanitizeAvatarUrl(result?.url);
    if (!result || !url) return null;
    const email = request.email ?? '';
    const fallbackUrls = result.fallbackUrls?.map(sanitizeAvatarUrl).filter((value): value is string => Boolean(value));
    return {
        url,
        ...(fallbackUrls?.length ? { fallbackUrls } : {}),
        source,
        verified: result.verified ?? false,
        initials: getInitials(request.name, email),
        avatarBgColor: getAvatarColor(email || request.name || 'default'),
    };
}

export function getAvatarQueryKey(email?: string, name?: string, existingAvatarUrl?: string) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    return ['avatar_v6', normalizedEmail || name || 'unknown', existingAvatarUrl || ''] as const;
}
