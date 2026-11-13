/**
 * Legacy Avatar Engine (Identical to git commit before @rhq/avatar migration)
 * 
 * Sourced directly from git HEAD `src/services/avatarEngine.ts`.
 * Includes AsyncStorage persistence, in-memory Map, in-flight deduplication,
 * and TanStack Query cache integration.
 */
let AsyncStorageDefault = {
  async getItem() { return null; },
  async setItem() {},
  async removeItem() {},
};
try {
  const mod = await import('@react-native-async-storage/async-storage');
  AsyncStorageDefault = mod.default || mod;
} catch {
  // Use mock fallback when running in Node.js benchmark environment
}
import { QueryClient, useQuery } from '@tanstack/react-query';
import crypto from 'crypto';

export const AVATAR_CACHE_STORAGE_KEY = '@relay_avatar_cache_v6';

export const AVATAR_PALETTE = [
  '#3B82F6', '#10B981', '#8B5CF6', '#EC4899', '#F59E0B',
  '#06B6D4', '#6366F1', '#14B8A6', '#F97316', '#64748B',
];

export const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'hotmail.com',
  'outlook.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'proton.me', 'protonmail.com', 'zoho.com', 'mail.com',
  'gmx.com', 'fastmail.com', 'tutanota.com', 'tuta.io', 'yandex.com', 'yandex.ru',
]);

export function sanitizeAvatarUrl(url) {
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

export function getAvatarColor(key) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_PALETTE.length;
  return AVATAR_PALETTE[index];
}

export function getInitials(name, email) {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (email && email.includes('@')) {
    const local = email.split('@')[0];
    return local.slice(0, 2).toUpperCase();
  }
  return 'U';
}

export function getRootDomain(domain) {
  if (!domain) return '';
  const parts = domain.toLowerCase().split('.');
  if (parts.length > 2) {
    const lastTwo = parts.slice(-2).join('.');
    const commonTwoPartTLDs = ['co.uk', 'com.au', 'co.jp', 'co.in', 'com.br', 'com.sg'];
    if (commonTwoPartTLDs.includes(lastTwo) && parts.length > 3) {
      return parts.slice(-3).join('.');
    }
    return lastTwo;
  }
  return domain.toLowerCase();
}

export function extractDomain(email) {
  if (!email || !email.includes('@')) return null;
  const rawDomain = email.split('@')[1].trim().toLowerCase();
  return rawDomain || null;
}

export function getAvatarQueryKey(email, name, existingAvatarUrl) {
  const normalizedEmail = (email || '').trim().toLowerCase();
  return ['avatar_v6', normalizedEmail || name || 'unknown', existingAvatarUrl || ''];
}

/**
 * Creates an instance of the legacy avatar engine.
 * Allows custom AsyncStorage and Fetch injection for isolated benchmarks.
 */
export function createLegacyAvatarEngine(options = {}) {
  const AsyncStorage = options.storage || AsyncStorageDefault;
  const fetcher = options.fetch || globalThis.fetch;
  const queryClient = options.queryClient || new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
        gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
        retry: 1,
      },
    },
  });

  const avatarCache = new Map();
  const inFlightRequests = new Map();
  let persistTimeout = null;

  async function probeImage(url, timeoutMs = 2000) {
    if (!url) return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      // Legacy did a full GET without Range header or body stream cancellation
      const res = await fetcher(url, {
        method: 'GET',
        headers: {
          Accept: 'image/*,*/*',
        },
        signal: controller.signal,
      });
      clearTimeout(timer);

      return res.ok && res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  async function hashSha256(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  function persistAvatarCache() {
    if (persistTimeout) return;
    persistTimeout = setTimeout(async () => {
      persistTimeout = null;
      try {
        const entries = {};
        let count = 0;
        // In legacy code: simple Map iteration capped at 500
        for (const [key, val] of avatarCache.entries()) {
          if (count++ > 500) break;
          entries[key] = val;
        }
        await AsyncStorage.setItem(AVATAR_CACHE_STORAGE_KEY, JSON.stringify(entries));
      } catch {
        // Non-blocking write
      }
    }, 1000);
    if (persistTimeout?.unref) {
      persistTimeout.unref();
    }
  }

  function cleanup() {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    queryClient.clear();
  }

  async function flushPersistence() {
    if (persistTimeout) {
      clearTimeout(persistTimeout);
      persistTimeout = null;
    }
    const entries = {};
    let count = 0;
    for (const [key, val] of avatarCache.entries()) {
      if (count++ > 500) break;
      entries[key] = val;
    }
    await AsyncStorage.setItem(AVATAR_CACHE_STORAGE_KEY, JSON.stringify(entries));
  }

  async function initialize() {
    try {
      const raw = await AsyncStorage.getItem(AVATAR_CACHE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [key, val] of Object.entries(parsed)) {
          // NOTE: Legacy only restored entries where val?.url was truthy!
          if (!avatarCache.has(key) && val?.url) {
            avatarCache.set(key, val);
          }
        }
      }
    } catch {
      // Non-blocking storage hydration
    }
  }

  function getCachedAvatar(email, name) {
    const cacheKey = (email || '').trim().toLowerCase() || name || 'unknown';
    const item = avatarCache.get(cacheKey);
    // In legacy code: returns null if url is null!
    return item?.url ? item : null;
  }

  async function resolveSenderAvatar(params) {
    const { email, name, existingAvatarUrl } = params;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const rawDomain = extractDomain(normalizedEmail);
    const rootDomain = rawDomain ? getRootDomain(rawDomain) : '';
    const initials = getInitials(name, normalizedEmail);
    const avatarBgColor = getAvatarColor(normalizedEmail || name || 'default');

    const cacheKey = normalizedEmail || name || 'unknown';

    // In legacy code: cached check fails if url is null (negative result)
    const cached = avatarCache.get(cacheKey);
    if (cached && cached.url) {
      return cached;
    }

    if (inFlightRequests.has(cacheKey)) {
      return inFlightRequests.get(cacheKey);
    }

    const resolutionPromise = (async () => {
      // 1. Existing metadata / Contact photo
      const cleanExisting = sanitizeAvatarUrl(existingAvatarUrl);
      if (cleanExisting) {
        const res = {
          url: cleanExisting,
          source: 'existing',
          verified: false,
          initials,
          avatarBgColor,
        };
        avatarCache.set(cacheKey, res);
        persistAvatarCache();
        return res;
      }

      const isConsumerDomain = CONSUMER_DOMAINS.has(rootDomain);

      // 2. Business Domains
      if (rootDomain && !isConsumerDomain) {
        const googleFaviconUrl = `https://www.google.com/s2/favicons?domain=${rootDomain}&sz=128`;
        const unavatarDomainUrl = `https://unavatar.io/${rootDomain}?fallback=false`;
        const res = {
          url: googleFaviconUrl,
          fallbackUrls: [unavatarDomainUrl],
          source: 'domain',
          verified: false,
          initials,
          avatarBgColor,
        };
        avatarCache.set(cacheKey, res);
        persistAvatarCache();
        return res;
      }

      // 3. Personal Senders: Gravatar & Unavatar Lookups
      let emailHash = '';
      if (normalizedEmail) {
        try {
          emailHash = await hashSha256(normalizedEmail);
        } catch {
          emailHash = '';
        }
      }

      const gravatarUrl = emailHash ? `https://www.gravatar.com/avatar/${emailHash}?d=404&s=128` : '';
      const unavatarUrl = normalizedEmail ? `https://unavatar.io/${encodeURIComponent(normalizedEmail)}?fallback=false` : '';
      const libravatarUrl = emailHash ? `https://seccdn.libravatar.org/avatar/${emailHash}?d=404&s=128` : '';

      if (gravatarUrl) {
        const hasGravatar = await probeImage(gravatarUrl, 1200);
        if (hasGravatar) {
          const res = {
            url: gravatarUrl,
            fallbackUrls: [unavatarUrl, libravatarUrl].filter(Boolean),
            source: 'gravatar',
            verified: false,
            initials,
            avatarBgColor,
          };
          avatarCache.set(cacheKey, res);
          persistAvatarCache();
          return res;
        }
      }

      if (unavatarUrl) {
        const hasUnavatar = await probeImage(unavatarUrl, 1200);
        if (hasUnavatar) {
          const res = {
            url: unavatarUrl,
            fallbackUrls: [libravatarUrl].filter(Boolean),
            source: 'unavatar',
            verified: false,
            initials,
            avatarBgColor,
          };
          avatarCache.set(cacheKey, res);
          persistAvatarCache();
          return res;
        }
      }

      if (libravatarUrl) {
        const hasLibravatar = await probeImage(libravatarUrl, 1200);
        if (hasLibravatar) {
          const res = {
            url: libravatarUrl,
            source: 'libravatar',
            verified: false,
            initials,
            avatarBgColor,
          };
          avatarCache.set(cacheKey, res);
          persistAvatarCache();
          return res;
        }
      }

      // 6. Initials fallback
      const fallbackRes = {
        url: null,
        source: 'initials',
        verified: false,
        initials,
        avatarBgColor,
      };
      avatarCache.set(cacheKey, fallbackRes);
      persistAvatarCache();
      return fallbackRes;
    })();

    inFlightRequests.set(cacheKey, resolutionPromise);

    try {
      return await resolutionPromise;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  }

  /**
   * Executes TanStack Query resolution matching the original useSenderAvatar hook:
   * Checks getCachedAvatar -> initialData -> queryClient cache.
   */
  async function querySenderAvatar(params) {
    const { email, name, existingAvatarUrl } = params;
    const normalizedEmail = (email || '').trim().toLowerCase();
    const initials = getInitials(name, normalizedEmail);
    const avatarBgColor = getAvatarColor(normalizedEmail || name || 'default');

    const fallback = {
      url: existingAvatarUrl || null,
      source: existingAvatarUrl ? 'existing' : 'initials',
      verified: false,
      initials,
      avatarBgColor,
    };

    const cached = getCachedAvatar(normalizedEmail, name);
    const initialData = cached?.url
      ? cached
      : existingAvatarUrl
      ? {
          url: existingAvatarUrl,
          source: 'existing',
          verified: false,
          initials,
          avatarBgColor,
        }
      : undefined;

    const queryKey = getAvatarQueryKey(email, name, existingAvatarUrl);

    // If initialData is available and query is not yet in cache, set it
    if (initialData && !queryClient.getQueryData(queryKey)) {
      queryClient.setQueryData(queryKey, initialData);
    }

    return queryClient.fetchQuery({
      queryKey,
      queryFn: async () => resolveSenderAvatar({ email, name, existingAvatarUrl }),
      staleTime: 1000 * 60 * 60 * 24, // 24 hours
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days
    });
  }

  return {
    avatarCache,
    inFlightRequests,
    queryClient,
    initialize,
    getCachedAvatar,
    resolveSenderAvatar,
    querySenderAvatar,
    persistAvatarCache,
    flushPersistence,
    cleanup,
  };
}
