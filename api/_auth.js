// Shared bearer-token check for all /api/* routes that handle ingest data.
// Token is read from Vercel env var INGEST_TOKEN. If unset, all calls are
// rejected (fail-closed) so an accidentally deployed endpoint is not open.
export function checkAuth(req) {
    const expected = process.env.INGEST_TOKEN;
    if (!expected) return { ok: false, status: 503, error: 'INGEST_TOKEN not configured on server' };

    const header = req.headers['authorization'] || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return { ok: false, status: 401, error: 'missing bearer token' };

    // Constant-time-ish compare to avoid trivial timing leaks. Tokens are short
    // enough that this is fine without a crypto library.
    const got = match[1];
    if (got.length !== expected.length) return { ok: false, status: 403, error: 'invalid token' };
    let diff = 0;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ expected.charCodeAt(i);
    if (diff !== 0) return { ok: false, status: 403, error: 'invalid token' };

    return { ok: true };
}
