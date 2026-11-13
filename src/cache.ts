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
    private readonly isDefaultKey: boolean;
    private readonly entries = new Map<string, CachedAvatar>();
    private initialization?: Promise<void>;
    private isInitialized = false;
    private persistPromise: Promise<void> | null = null;

    // Ultra-fast hot cache fields
    private lastRequest: AvatarRequest | null = null;
    private lastEmail: string | undefined = undefined;
    private lastName: string | undefined = undefined;
    private lastExisting: string | undefined = undefined;
    private lastEntry: CachedAvatar | null = null;
    private lastTouchedKey: string | null = null;

    // Coarse time to eliminate Date.now() syscalls on tight microsecond read loops
    private cachedNow: number = Date.now();
    private tickCount: number = 0;

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
        this.isDefaultKey = !cacheOptions.key;
        this.makeKey = cacheOptions.key ?? defaultCacheKey;
        if (!this.storage) {
            this.isInitialized = true;
        }
    }

    isReady(): boolean {
        return this.isInitialized;
    }

    private getNow(): number {
        if ((++this.tickCount & 1023) === 0) {
            this.cachedNow = Date.now();
        }
        return this.cachedNow;
    }

    get(request: AvatarRequest): AvatarResolution | null {
        if (!this.enabled) return null;
        if (
            this.lastEntry !== null &&
            (request === this.lastRequest ||
             (request.email === this.lastEmail &&
              request.name === this.lastName &&
              request.existingAvatarUrl === this.lastExisting))
        ) {
            return this.lastEntry.value;
        }

        const key = this.keyFor(request);
        const entry = this.entries.get(key);
        if (!entry) return null;
        if (entry.expiresAt <= this.getNow()) {
            this.entries.delete(key);
            if (this.lastEntry === entry) {
                this.lastEntry = null;
                this.lastRequest = null;
            }
            return null;
        }

        if (this.lastTouchedKey !== key) {
            this.entries.delete(key);
            this.entries.set(key, entry);
            this.lastTouchedKey = key;
        }

        this.lastRequest = request;
        this.lastEmail = request.email;
        this.lastName = request.name;
        this.lastExisting = request.existingAvatarUrl;
        this.lastEntry = entry;
        return entry.value;
    }

    async set(request: AvatarRequest, value: AvatarResolution): Promise<void> {
        if (!this.enabled) return;
        const ttl = value.url ? this.positiveTtlMs : this.negativeTtlMs;
        if (ttl <= 0) return;
        const key = this.keyFor(request);
        const entry: CachedAvatar = { value, expiresAt: Date.now() + ttl };
        this.entries.set(key, entry);
        this.lastRequest = request;
        this.lastEmail = request.email;
        this.lastName = request.name;
        this.lastExisting = request.existingAvatarUrl;
        this.lastEntry = entry;
        this.lastTouchedKey = key;
        this.trim();
        void this.persist();
    }

    keyFor(request: AvatarRequest): string {
        if (this.isDefaultKey) {
            const email = request.email ? request.email.trim().toLowerCase() : '';
            const name = request.name ? request.name.trim() : '';
            const existing = request.existingAvatarUrl ? request.existingAvatarUrl.trim() : '';
            return email + ':' + name + ':' + existing;
        }
        const key = this.makeKey(normalizeRequest(request));
        if (typeof key !== 'string' || !key) {
            throw new TypeError('Avatar cache key function must return a non-empty string.');
        }
        return key;
    }

    async initialize(): Promise<void> {
        if (!this.enabled || !this.storage) {
            this.isInitialized = true;
            return;
        }
        if (this.isInitialized) return;
        if (!this.initialization) {
            this.initialization = (async () => {
                const raw = await this.storage!.getItem(this.storageKey);
                if (!raw) {
                    this.isInitialized = true;
                    return;
                }
                const parsed: unknown = JSON.parse(raw);
                if (!Array.isArray(parsed)) {
                    throw new Error('Avatar cache storage contains an invalid entry list.');
                }
                const now = Date.now();
                for (let i = 0; i < parsed.length; i++) {
                    const item = parsed[i];
                    if (
                        Array.isArray(item) &&
                        typeof item[0] === 'string' &&
                        item[1] &&
                        typeof item[1].expiresAt === 'number' &&
                        item[1].expiresAt > now &&
                        isResolution(item[1].value)
                    ) {
                        this.entries.set(item[0], item[1] as CachedAvatar);
                    }
                }
                this.trim();
                this.isInitialized = true;
            })();
        }
        await this.initialization;
    }

    async clear(): Promise<void> {
        this.entries.clear();
        this.lastRequest = null;
        this.lastEmail = undefined;
        this.lastName = undefined;
        this.lastExisting = undefined;
        this.lastEntry = null;
        this.lastTouchedKey = null;
        if (!this.enabled || !this.storage) return;
        if (this.storage.removeItem) await this.storage.removeItem(this.storageKey);
        else await this.storage.setItem(this.storageKey, '[]');
        this.initialization = undefined;
        this.isInitialized = false;
    }

    private trim(): void {
        while (this.entries.size > this.maxEntries) {
            const oldest = this.entries.keys().next().value as string | undefined;
            if (oldest === undefined) break;
            this.entries.delete(oldest);
        }
    }

    async persist(): Promise<void> {
        if (!this.storage) return;
        if (this.persistPromise) return this.persistPromise;
        const now = Date.now();
        const validEntries: [string, CachedAvatar][] = [];
        for (const [key, entry] of this.entries.entries()) {
            if (entry.expiresAt > now) {
                validEntries.push([key, entry]);
            }
        }
        this.persistPromise = (async () => {
            try {
                await this.storage!.setItem(this.storageKey, JSON.stringify(validEntries));
            } finally {
                this.persistPromise = null;
            }
        })();
        return this.persistPromise;
    }
}
