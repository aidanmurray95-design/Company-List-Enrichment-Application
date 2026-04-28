// POST /api/ingest
// Service uploads a single file here. Body is the raw file bytes; filename
// comes from the X-File-Name header. The file is stored in Vercel Blob
// under prefix "pending/" with a random suffix so listings can find it.
//
// Auth: Authorization: Bearer <INGEST_TOKEN>
// Body size cap: ~4.5 MB on Hobby, ~32 MB on Pro (Vercel function limit).

import { put } from '@vercel/blob';
import { checkAuth } from './_auth.js';

export const config = {
    api: {
        bodyParser: false  // we want the raw bytes
    }
};

async function readRawBody(req) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    return Buffer.concat(chunks);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        return res.status(405).json({ error: 'method not allowed' });
    }

    const auth = checkAuth(req);
    if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

    const fileName = req.headers['x-file-name'];
    if (!fileName || typeof fileName !== 'string') {
        return res.status(400).json({ error: 'X-File-Name header required' });
    }

    const safeName = fileName.replace(/[^\w.\-]+/g, '_');

    let body;
    try { body = await readRawBody(req); }
    catch (err) { return res.status(400).json({ error: `read body failed: ${err.message}` }); }

    if (body.length === 0) return res.status(400).json({ error: 'empty body' });

    try {
        const blob = await put(`pending/${Date.now()}-${safeName}`, body, {
            access: 'public',
            addRandomSuffix: true,
            contentType: req.headers['content-type'] || 'application/octet-stream'
        });
        return res.status(200).json({
            id: blob.pathname,           // e.g. "pending/1714305612345-companies-abc123.xlsx"
            name: fileName,
            size: body.length,
            uploadedAt: new Date().toISOString()
        });
    } catch (err) {
        return res.status(500).json({ error: `blob upload failed: ${err.message}` });
    }
}
