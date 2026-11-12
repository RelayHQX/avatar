import { hashEmailSha256 } from './hash.js';
import {
    extractDomain,
    getRootDomain,
    sanitizeAvatarUrl,
} from './identity.js';
import type {
    AvatarProvider,
    AvatarResolution,
} from './types.js';

export async function probeImage(
    fetcher: typeof fetch,
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
): Promise<boolean> {
    if (!url || signal?.aborted) return false;
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(signal?.reason);
    signal?.addEventListener('abort', abortFromCaller, { once: true });
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetcher(url, {
            method: 'GET',
            headers: { Accept: 'image/*,*/*', Range: 'bytes=0-0' },
            signal: controller.signal,
        });
        if (response.body) {
            try {
                await response.body.cancel();
            } catch {
                // The response body may already be closed by the runtime.
            }
        }
        return response.ok;
    } catch (error) {
        if (signal?.aborted) throw error;
        return false;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abortFromCaller);
    }
}

function existingProvider(): AvatarProvider {
    return {
        id: 'existing',
        resolve(request) {
            const url = sanitizeAvatarUrl(request.existingAvatarUrl);
            return url ? { url, verified: false } : null;
        },
    };
}

function domainProvider(): AvatarProvider {
    return {
        id: 'domain',
        resolve(request, context) {
            const domain = request.email ? extractDomain(request.email) : null;
            if (!domain || context.isConsumerDomain) return null;
            const rootDomain = getRootDomain(domain);
            return {
                url: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(rootDomain)}&sz=128`,
                fallbackUrls: [`https://unavatar.io/${encodeURIComponent(rootDomain)}?fallback=false`],
                verified: false,
            };
        },
    };
}

function gravatarProvider(): AvatarProvider {
    return {
        id: 'gravatar',
        async resolve(request, context) {
            if (!request.email) return null;
            const hash = await context.hashEmail(request.email);
            if (!hash) return null;
            const url = `https://www.gravatar.com/avatar/${hash}?d=404&s=128`;
            if (!(await context.probeImage(url, context.signal))) return null;
            return {
                url,
                fallbackUrls: [
                    `https://unavatar.io/${encodeURIComponent(request.email)}?fallback=false`,
                    `https://seccdn.libravatar.org/avatar/${hash}?d=404&s=128`,
                ],
            };
        },
    };
}

function unavatarProvider(): AvatarProvider {
    return {
        id: 'unavatar',
        async resolve(request, context) {
            if (!request.email) return null;
            const url = `https://unavatar.io/${encodeURIComponent(request.email)}?fallback=false`;
            if (!(await context.probeImage(url, context.signal))) return null;
            const hash = await context.hashEmail(request.email);
            return {
                url,
                fallbackUrls: hash
                    ? [`https://seccdn.libravatar.org/avatar/${hash}?d=404&s=128`]
                    : [],
            };
        },
    };
}

function libravatarProvider(): AvatarProvider {
    return {
        id: 'libravatar',
        async resolve(request, context) {
            if (!request.email) return null;
            const hash = await context.hashEmail(request.email);
            if (!hash) return null;
            const url = `https://seccdn.libravatar.org/avatar/${hash}?d=404&s=128`;
            return (await context.probeImage(url, context.signal)) ? { url } : null;
        },
    };
}

export const BUILT_IN_PROVIDERS: Record<AvatarResolution['source'], AvatarProvider> = {
    existing: existingProvider(),
    domain: domainProvider(),
    gravatar: gravatarProvider(),
    unavatar: unavatarProvider(),
    libravatar: libravatarProvider(),
    bimi: { id: 'bimi', resolve: () => null },
    initials: { id: 'initials', resolve: () => null },
};

export { hashEmailSha256 };
