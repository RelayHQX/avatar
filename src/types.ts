export interface AvatarResolution {
    url: string | null;
    fallbackUrls?: string[];
    source: 'existing' | 'gravatar' | 'libravatar' | 'bimi' | 'domain' | 'unavatar' | 'initials';
    verified: boolean;
    initials: string;
    avatarBgColor: string;
}

export interface AvatarRequest {
    email?: string;
    name?: string;
    existingAvatarUrl?: string;
    signal?: AbortSignal;
}

export interface AvatarProviderContext {
    fetch: typeof fetch;
    hashEmail: (email: string) => Promise<string>;
    isConsumerDomain: boolean;
    probeImage: (url: string, signal?: AbortSignal) => Promise<boolean>;
    signal?: AbortSignal;
    timeoutMs: number;
}

export interface AvatarProviderResult {
    url: string;
    fallbackUrls?: string[];
    verified?: boolean;
}

export interface AvatarProvider {
    id: AvatarResolution['source'];
    resolve(
        request: AvatarRequest,
        context: AvatarProviderContext,
    ): AvatarProviderResult | null | Promise<AvatarProviderResult | null>;
}

export type AvatarProviderOption = AvatarProvider['id'] | AvatarProvider;

export interface AvatarStorageAdapter {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem?(key: string): Promise<void>;
}

export interface AsyncStorageLike {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem?(key: string): Promise<void>;
}

export interface AvatarCacheOptions {
    enabled?: boolean;
    maxEntries?: number;
    ttl?: number;
    negativeTtl?: number;
    storage?: AvatarStorageAdapter;
    storageKey?: string;
    key?: (request: AvatarRequest) => string;
}

export interface AvatarResolverOptions {
    cache?: false | AvatarCacheOptions;
    providers?: AvatarProviderOption[];
    policy?: 'priority' | 'fastest' | 'verified-only';
    fetch?: typeof fetch;
    timeoutMs?: number;
    hashEmail?: (email: string) => Promise<string>;
}

export interface AvatarResolver {
    resolve(request: AvatarRequest): Promise<AvatarResolution>;
    getCached(request: AvatarRequest): AvatarResolution | null;
    clearCache(): Promise<void>;
    initialize(): Promise<void>;
}
