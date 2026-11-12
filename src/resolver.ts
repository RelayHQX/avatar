import { AvatarCache } from './cache.js';
import {
    DEFAULT_PROVIDER_IDS,
    extractDomain,
    getAvatarColor,
    getInitials,
    isConsumerDomain,
    normalizeRequest,
    toAvatarResolution,
} from './identity.js';
import { BUILT_IN_PROVIDERS, hashEmailSha256, probeImage } from './providers.js';
import type {
    AvatarProvider,
    AvatarProviderContext,
    AvatarProviderResult,
    AvatarRequest,
    AvatarResolution,
    AvatarResolver,
    AvatarResolverOptions,
} from './types.js';

const NO_PROVIDER_RESULT = Symbol('no avatar provider result');

function resolveWithTimeout(
    provider: AvatarProvider,
    request: AvatarRequest,
    context: AvatarProviderContext,
    timeoutMs: number,
    parentSignal?: AbortSignal,
): Promise<AvatarProviderResult | null> {
    const controller = new AbortController();
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout>;
        const cleanup = () => {
            clearTimeout(timeout);
            parentSignal?.removeEventListener('abort', abortFromParent);
        };
        const finishResolve = (value: AvatarProviderResult | null) => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve(value);
        };
        const finishReject = (error: unknown) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(error);
        };
        const abortFromParent = () => {
            const reason = parentSignal?.reason ?? new Error('Avatar resolution aborted.');
            controller.abort(reason);
            finishReject(reason);
        };
        timeout = setTimeout(() => {
            const error = new Error(`Avatar provider "${provider.id}" timed out after ${timeoutMs}ms.`);
            controller.abort(error);
            finishReject(error);
        }, timeoutMs);
        parentSignal?.addEventListener('abort', abortFromParent, { once: true });

        if (parentSignal?.aborted) {
            abortFromParent();
        } else {
            Promise.resolve()
                .then(() =>
                    provider.resolve(request, {
                        ...context,
                        signal: controller.signal,
                    }),
                )
                .then(finishResolve, finishReject);
        }
    });
}

async function resolveWithPolicy(
    providers: AvatarProvider[],
    request: AvatarRequest,
    context: AvatarProviderContext,
    timeoutMs: number,
    policy: NonNullable<AvatarResolverOptions['policy']>,
): Promise<AvatarResolution | null> {
    // Let probeImage's own timeout abort and settle before the provider deadline fires.
    const providerTimeoutMs = timeoutMs + 25;
    const makeResolution = (
        provider: AvatarProvider,
        providerResult: AvatarProviderResult | null,
    ) => toAvatarResolution(request, providerResult, provider.id);
    const accept = (result: AvatarResolution | null) =>
        result && (policy !== 'verified-only' || result.verified) ? result : null;

    if (policy !== 'fastest') {
        for (const provider of providers) {
            if (context.signal?.aborted) {
                throw context.signal.reason ?? new Error('Avatar resolution aborted.');
            }
            const providerResult = await resolveWithTimeout(
                provider,
                request,
                context,
                providerTimeoutMs,
                context.signal,
            );
            const resolution = accept(makeResolution(provider, providerResult));
            if (resolution) return resolution;
        }
        return null;
    }

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(context.signal?.reason);
    context.signal?.addEventListener('abort', abortFromCaller, { once: true });
    const fastestContext = { ...context, signal: controller.signal };
    try {
        const attempts = providers.map(async (provider) => {
            const providerResult = await resolveWithTimeout(
                provider,
                request,
                fastestContext,
                providerTimeoutMs,
                controller.signal,
            );
            const resolution = makeResolution(provider, providerResult);
            if (!resolution) throw NO_PROVIDER_RESULT;
            return resolution;
        });
        try {
            return await Promise.any(attempts);
        } catch (error) {
            if (error instanceof AggregateError && error.errors.every((item) => item === NO_PROVIDER_RESULT)) {
                return null;
            }
            throw error;
        }
    } finally {
        controller.abort();
        context.signal?.removeEventListener('abort', abortFromCaller);
    }
}

function createFallback(request: AvatarRequest): AvatarResolution {
    const email = request.email ?? '';
    return {
        url: null,
        source: 'initials',
        verified: false,
        initials: getInitials(request.name, email),
        avatarBgColor: getAvatarColor(email || request.name || 'default'),
    };
}

export function createAvatarResolver(options: AvatarResolverOptions = {}): AvatarResolver {
    const cache = new AvatarCache(options.cache ?? {});
    const fetcher = options.fetch ?? globalThis.fetch;
    const timeoutMs = options.timeoutMs ?? 1200;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new RangeError('Avatar timeoutMs must be a positive number.');
    }
    const policy = options.policy ?? 'priority';
    if (!['priority', 'fastest', 'verified-only'].includes(policy)) {
        throw new RangeError(`Unsupported avatar resolution policy: ${String(policy)}.`);
    }
    const providers = (options.providers ?? DEFAULT_PROVIDER_IDS).map((provider) => {
        if (typeof provider !== 'string') {
            if (!provider || typeof provider.resolve !== 'function') {
                throw new TypeError('Custom avatar providers must implement resolve().');
            }
            return provider;
        }
        const builtIn = BUILT_IN_PROVIDERS[provider];
        if (!builtIn) throw new RangeError(`Unknown avatar provider: ${provider}.`);
        return builtIn;
    });
    const inFlight = new Map<string, Promise<AvatarResolution>>();

    const resolveRequest = async (request: AvatarRequest): Promise<AvatarResolution> => {
        const email = request.email ?? '';
        const domain = email ? extractDomain(email) ?? '' : '';
        const context: AvatarProviderContext = {
            fetch: fetcher,
            hashEmail: options.hashEmail ?? hashEmailSha256,
            isConsumerDomain: isConsumerDomain(domain),
            probeImage: (url, signal) => probeImage(fetcher, url, timeoutMs, signal),
            signal: request.signal,
            timeoutMs,
        };
        const result = await resolveWithPolicy(providers, request, context, timeoutMs, policy);
        const resolution = result ?? createFallback(request);
        await cache.set(request, resolution);
        return resolution;
    };

    return {
        async initialize() {
            await cache.initialize();
        },
        getCached(request) {
            return cache.get(normalizeRequest(request));
        },
        async clearCache() {
            await cache.clear();
        },
        async resolve(input) {
            const request = normalizeRequest(input);
            if (input.signal?.aborted) {
                throw input.signal.reason ?? new Error('Avatar resolution aborted.');
            }
            await cache.initialize();
            const cached = cache.get(request);
            if (cached) return cached;

            const key = cache.keyFor(request);
            if (!input.signal) {
                const pending = inFlight.get(key);
                if (pending) return pending;
            }

            const pending = resolveRequest(request);
            if (!input.signal) inFlight.set(key, pending);
            try {
                return await pending;
            } finally {
                if (inFlight.get(key) === pending) inFlight.delete(key);
            }
        },
    };
}

export const defaultAvatarResolver = createAvatarResolver();

export async function resolveSenderAvatar(params: {
    email: string;
    name?: string;
    existingAvatarUrl?: string;
}): Promise<AvatarResolution> {
    return defaultAvatarResolver.resolve(params);
}

export function getCachedAvatar(email: string, name?: string): AvatarResolution | null {
    const cached = defaultAvatarResolver.getCached({ email, name });
    return cached?.url ? cached : null;
}
