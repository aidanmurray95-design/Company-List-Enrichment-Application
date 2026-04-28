// DELETE /api/pending/[id]
//   Acks (deletes) a file from the queue once the browser has processed it.
//
// The id is URL-encoded "pending/<...>" (the blob pathname returned by /api/pending).
// We re-prefix with "pending/" if it's missing, since some clients strip slashes.
//
// Auth: Authorization: Bearer <INGEST_TOKEN>

import { del } from '@vercel/blob';
import { checkAuth } from '../_auth.js';

export default async function handler(req, res) {
    if (req.method !== 'DELETE') {
        res.setHeader('Allow', 'DELETE');
        return res.status(405).json({ error: 'method not allowed' });
    }

    const auth = checkAuth(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    let id = req.query.id;
    if (Array.isArray(id)) id = id[0];
    if (!id || typeof id !== 'string') return res.status(400).json({ error: 'id required' });

    if (!id.startsWith('pending/')) id = `pending/${id}`;

    // Hard guard: refuse anything that escapes the pending/ prefix.
    if (id.includes('..') || id.includes('//')) {
        return res.status(400).json({ error: 'invalid id' });
    }

    try {
        await del(id);
        return res.status(200).json({ ok: true });
    } catch (err) {
        return res.status(500).json({ error: `blob delete failed: ${err.message}` });
    }
}
