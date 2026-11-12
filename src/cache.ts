import { defaultCacheKey, normalizeRequest } from './identity.js';
import type {
    AsyncStorageLike,
    AvatarCacheOptions,
    AvatarRequest,
    AvatarResolution,
    AvatarStorageAdapter,
} from './types.js';

const DEFAULT_STORAGE_KEY = '@rhq/avatar/cache/v1';

interface CachedAvatar {
    value: AvatarResolution;
    expiresAt: number;
}

export function createAsyncStorageAdapter(storage: AsyncStorageLike): AvatarStorageAdapter {
    return {
        getItem: (key) => storage.getItem(key),
        setItem: (key, value) => storage.setItem(key, value),
        ...(storage.removeItem ? { removeItem: (key: string) => storage.removeItem!(key) } : {}),
    };
}

function isResolution(value: unknown): value is AvatarResolution {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<AvatarResolution>;
    return (
        (candidate.url === null || typeof candidate.url === 'string') &&
        typeof candidate.source === 'string' &&
        typeof candidate.verified === 'boolean' &&
        typeof candidate.initials === 'string' &&
        typeof candidate.avatarBgColor === 'string'
    );
}

export class AvatarCache {
    readonly enabled: boolean;
    private readonly maxEntries: number;
    private readonly positiveTtlMs: number;
    private readonly negativeTtlMs: number;
    private readonly storage?: AvatarStorageAdapter;
    private readonly storageKey: string;
    private readonly makeKey: (request: AvatarRequest) => string;
    private readonly entries = new Map<string, CachedAvatar>();
    private initialization?: Promise<void>;

    constructor(options: false | AvatarCacheOptions = {}) {
        const cacheOptions = options === false ? { enabled: false } : options;
        this.enabled = options !== false && cacheOptions.enabled !== false;
        this.maxEntries = cacheOptions.maxEntries ?? 500;
        const positiveTtl = cacheOptions.ttl ?? 86400;
        const negativeTtl = cacheOptions.negativeTtl ?? 3600;
        if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) {
            throw new RangeError('Avatar cache maxEntries must be a positive integer.');
        }
        if (!Number.isFinite(positiveTtl) || positiveTtl < 0) {
            throw new RangeError('Avatar cache ttl must be a non-negative number of seconds.');
        }
        if (!Number.isFinite(negativeTtl) || negativeTtl < 0) {
            throw new RangeError('Avatar cache negativeTtl must be a non-negative number of seconds.');
        }
        this.positiveTtlMs = positiveTtl * 1000;
        this.negativeTtlMs = negativeTtl * 1000;
        this.storage = cacheOptions.storage;
        this.storageKey = cacheOptions.storageKey ?? DEFAULT_STORAGE_KEY;
        this.makeKey = cacheOptions.key ?? defaultCacheKey;
    }

    get(request: AvatarRequest): AvatarResolution | null {
        if (!this.enabled) return null;
        const key = this.keyFor(request);
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key);
            return null;
        }
        this.entries.delete(key);
        this.entries.set(key, entry);
        return entry.value;
    }

    async set(request: AvatarRequest, value: AvatarResolution): Promise<void> {
        if (!this.enabled) return;
        const ttl = value.url ? this.positiveTtlMs : this.negativeTtlMs;
        if (ttl <= 0) return;
        this.entries.set(this.keyFor(request), { value, expiresAt: Date.now() + ttl });
        this.trim();
        await this.persist();
    }

    keyFor(request: AvatarRequest): string {
        const key = this.makeKey(normalizeRequest(request));
        if (typeof key !== 'string' || !key) {
            throw new TypeError('Avatar cache key function must return a non-empty string.');
        }
        return key;
    }

    async initialize(): Promise<void> {
        if (!this.enabled || !this.storage) return;
        if (!this.initialization) {
            this.initialization = (async () => {
                const raw = await this.storage!.getItem(this.storageKey);
                if (!raw) return;
                const parsed: unknown = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    throw new Error('Avatar cache storage contains an invalid entry list.');
                }
                for (const item of parsed) {
                    if (
                        Array.isArray(item) &&
                        typeof item[0] === 'string' &&
                        item[1] &&
                        typeof item[1].expiresAt === 'number' &&
                        isResolution(item[1].value) &&
                        item[1].expiresAt > Date.now()
                    ) {
                        this.entries.set(item[0], item[1] as CachedAvatar);
                    }
                }
                this.trim();
            })();
        }
        await this.initialization;
    }

    async clear(): Promise<void> {
        this.entries.clear();
        if (!this.enabled || !this.storage) return;
        if (this.storage.removeItem) await this.storage.removeItem(this.storageKey);
        else await this.storage.setItem(this.storageKey, '[]');
        this.initialization = undefined;
    }

    private trim(): void {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    private async persist(): Promise<void> {
        if (!this.storage) return;
        const now = Date.now();
        const validEntries = Array.from(this.entries.entries())
            .filter(([, entry]) => entry.expiresAt > now);
        await this.storage.setItem(this.storageKey, JSON.stringify(validEntries));
    }
}
