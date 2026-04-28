// GET /api/pending
// Returns the queue of files waiting to be ingested.
//
// Response: { items: [{ id, name, size, uploadedAt, downloadUrl }, ...] }
//   - id is the blob pathname; pass it back to /api/pending/[id] to ack.
//   - downloadUrl is the public Blob URL; the random suffix makes it
//     practically unguessable, and we still gate the listing behind a token.
//
// Auth: Authorization: Bearer <INGEST_TOKEN>

import { list } from '@vercel/blob';
import { checkAuth } from './_auth.js';

export default async function handler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'method not allowed' });
    }

    const auth = checkAuth(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    try {
        const result = await list({ prefix: 'pending/' });
        const items = result.blobs.map(b => ({
            id: b.pathname,
            name: stripPrefix(b.pathname),
            size: b.size,
            uploadedAt: b.uploadedAt,
            downloadUrl: b.url
        })).sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));

        return res.status(200).json({ items });
    } catch (err) {
        return res.status(500).json({ error: `blob list failed: ${err.message}` });
    }
}

// "pending/1714305612345-companies-abc123.xlsx" → "companies.xlsx"
// We store as "<timestamp>-<safeName>-<randomSuffix>.<ext>" but only need to
// reconstruct a display name. Strip the leading prefix + timestamp + trailing
// random suffix added by Vercel Blob.
function stripPrefix(pathname) {
    const base = pathname.replace(/^pending\//, '');
    const m = /^\d+-(.+?)-[A-Za-z0-9]+(\.[^.]+)?$/.exec(base);
    if (m) return m[1] + (m[2] || '');
    return base;
}
