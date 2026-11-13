const HASH_CACHE = new Map<string, string>();
const MAX_HASH_CACHE = 2048;

const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));
const utf8Encoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

interface NodeCryptoLike {
    createHash?: (algorithm: string) => { update(data: string): { digest(encoding: string): string } };
}

let nodeCryptoCreateHash: ((algo: string) => { update(data: string): { digest(enc: string): string } }) | null | undefined;

async function getNodeCreateHash() {
    if (nodeCryptoCreateHash !== undefined) return nodeCryptoCreateHash;
    const globalProcess = (globalThis as unknown as { process?: { versions?: { node?: string } } }).process;
    if (typeof globalProcess !== 'undefined' && globalProcess.versions?.node) {
        try {
            const specifier = 'node:crypto';
            const mod = (await import(specifier)) as NodeCryptoLike;
            nodeCryptoCreateHash = mod.createHash ?? null;
            return nodeCryptoCreateHash;
        } catch {
            nodeCryptoCreateHash = null;
            return null;
        }
    }
    nodeCryptoCreateHash = null;
    return null;
}

function cacheHash(email: string, hash: string): void {
    if (HASH_CACHE.size >= MAX_HASH_CACHE) {
        const oldest = HASH_CACHE.keys().next().value;
        if (oldest !== undefined) HASH_CACHE.delete(oldest);
    }
    HASH_CACHE.set(email, hash);
}

export async function hashEmailSha256(email: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    const cached = HASH_CACHE.get(normalized);
    if (cached) return cached;

    const cryptoApi = globalThis.crypto;
    if (cryptoApi) {
        const nodeCreateHash = await getNodeCreateHash();
        if (nodeCreateHash) {
            const hash = nodeCreateHash('sha256').update(normalized).digest('hex');
            cacheHash(normalized, hash);
            return hash;
        }

        if (cryptoApi.subtle) {
            const bytes = encodeUtf8(normalized);
            const input = new Uint8Array(bytes.length);
            input.set(bytes);
            const digest = await cryptoApi.subtle.digest('SHA-256', input.buffer);
            const hash = formatHex(new Uint8Array(digest));
            cacheHash(normalized, hash);
            return hash;
        }
    }

    const bytes = encodeUtf8(normalized);
    const hash = sha256(bytes);
    cacheHash(normalized, hash);
    return hash;
}

function encodeUtf8(value: string): Uint8Array {
    if (utf8Encoder) {
        return utf8Encoder.encode(value);
    }
    const bytes: number[] = [];
    for (const character of value) {
        const codePoint = character.codePointAt(0)!;
        if (codePoint <= 0x7f) bytes.push(codePoint);
        else if (codePoint <= 0x7ff) {
            bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
        } else if (codePoint <= 0xffff) {
            bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
        } else {
            bytes.push(
                0xf0 | (codePoint >> 18),
                0x80 | ((codePoint >> 12) & 0x3f),
                0x80 | ((codePoint >> 6) & 0x3f),
                0x80 | (codePoint & 0x3f),
            );
        }
    }
    return Uint8Array.from(bytes);
}

function formatHex(bytes: Uint8Array): string {
    let result = '';
    for (let i = 0; i < bytes.length; i++) {
        result += HEX_TABLE[bytes[i]];
    }
    return result;
}

function sha256(bytes: Uint8Array): string {
    const k = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
        0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
        0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
        0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
        0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
        0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
        0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
    ];
    const bitLength = bytes.length * 8;
    const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
    const padded = new Uint8Array(paddedLength);
    padded.set(bytes);
    padded[bytes.length] = 0x80;
    const data = new DataView(padded.buffer);
    data.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    data.setUint32(paddedLength - 4, bitLength >>> 0);

    const hash = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    ];
    const words = new Uint32Array(64);
    const rotateRight = (value: number, amount: number) => (value >>> amount) | (value << (32 - amount));

    for (let offset = 0; offset < paddedLength; offset += 64) {
        for (let i = 0; i < 16; i++) words[i] = data.getUint32(offset + i * 4);
        for (let i = 16; i < 64; i++) {
            const x = words[i - 15];
            const y = words[i - 2];
            const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
            const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
            words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
        }
        let [a, b, c, d, e, f, g, h] = hash;
        for (let i = 0; i < 64; i++) {
            const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
            const choice = (e & f) ^ (~e & g);
            const temp1 = (h + sum1 + choice + k[i] + words[i]) >>> 0;
            const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
            const majority = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (sum0 + majority) >>> 0;
            h = g;
            g = f;
            f = e;
            e = (d + temp1) >>> 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) >>> 0;
        }
        hash[0] = (hash[0] + a) >>> 0;
        hash[1] = (hash[1] + b) >>> 0;
        hash[2] = (hash[2] + c) >>> 0;
        hash[3] = (hash[3] + d) >>> 0;
        hash[4] = (hash[4] + e) >>> 0;
        hash[5] = (hash[5] + f) >>> 0;
        hash[6] = (hash[6] + g) >>> 0;
        hash[7] = (hash[7] + h) >>> 0;
    }
    let hex = '';
    for (let i = 0; i < 8; i++) {
        const val = hash[i];
        hex += HEX_TABLE[(val >>> 24) & 0xff] +
               HEX_TABLE[(val >>> 16) & 0xff] +
               HEX_TABLE[(val >>> 8) & 0xff] +
               HEX_TABLE[val & 0xff];
    }
    return hex;
}
