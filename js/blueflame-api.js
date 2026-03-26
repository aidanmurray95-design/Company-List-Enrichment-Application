/**
 * BlueFlame API Client
 * ─────────────────────────────────────────────────
 * Authentication: Authorization: Bearer <token>
 *
 * Global Variables:
 *   REST_API_ENDPOINT  →  Base URL for all API calls
 *   API_TOKEN          →  Auth token sent via Authorization: Bearer header
 *   USER_ID            →  User's email (unique identifier)
 *
 * Auto-Status Polling:
 *   After every POST request, if the response contains a call_id (id),
 *   the client automatically polls POST /functions/status with
 *   {"call_id": "<id>"} in the body until completion.
 *   All BlueFlame API endpoints are POST and return async results.
 */

window.apiCallLog = JSON.parse(localStorage.getItem('bf_api_call_log') || '[]');

class BlueFlameClient {
    constructor() {
        this.name = '';
        this.email = '';
        this.statusPollInterval = 20000;  // 20s between status polls
        this.statusPollMaxRetries = 15;   // 15 attempts × 20s = 5 minutes max
        this.loadConfig();
    }

    // ── Accessors for global variables ──
    get apiToken()         { return window.BF_GLOBALS.API_TOKEN; }
    set apiToken(v)        { window.BF_GLOBALS.API_TOKEN = v; localStorage.setItem('bf_api_token', v); }
    get restApiEndpoint()  { return window.BF_GLOBALS.REST_API_ENDPOINT; }
    set restApiEndpoint(v) { window.BF_GLOBALS.REST_API_ENDPOINT = v; localStorage.setItem('bf_rest_api_endpoint', v); }
    get userId()           { return window.BF_GLOBALS.USER_ID; }
    set userId(v)          { window.BF_GLOBALS.USER_ID = v; localStorage.setItem('bf_user_id', v); }

    loadConfig() {
        try {
            const cfg = JSON.parse(localStorage.getItem('bf_config') || '{}');
            this.name  = cfg.name  || '';
            this.email = cfg.email || '';
            if (cfg.restApiEndpoint) this.restApiEndpoint = cfg.restApiEndpoint;
            if (cfg.apiToken)        this.apiToken = cfg.apiToken;
            if (cfg.userId)          this.userId = cfg.userId;
            else if (cfg.email)      this.userId = cfg.email;  // USER_ID defaults to email
            this.lastConnected = cfg.lastConnected || null;
        } catch (e) {
            console.warn('BlueFlameClient: Failed to load config', e);
        }
    }

    saveConfig() {
        localStorage.setItem('bf_config', JSON.stringify({
            name: this.name,
            email: this.email,
            restApiEndpoint: this.restApiEndpoint,
            apiToken: this.apiToken,
            userId: this.userId,
            lastConnected: this.lastConnected
        }));
        localStorage.setItem('bf_rest_api_endpoint', this.restApiEndpoint);
        localStorage.setItem('bf_api_token', this.apiToken);
        localStorage.setItem('bf_user_id', this.userId);
    }

    clearConfig() {
        this.name = '';
        this.email = '';
        this.restApiEndpoint = 'https://api.blueflame.ai/prod/client/v1';
        this.apiToken = '';
        this.userId = '';
        this.lastConnected = null;
        localStorage.removeItem('bf_config');
        localStorage.removeItem('bf_rest_api_endpoint');
        localStorage.removeItem('bf_api_token');
        localStorage.removeItem('bf_user_id');
        window.BF_GLOBALS.REST_API_ENDPOINT = 'https://api.blueflame.ai/prod/client/v1';
        window.BF_GLOBALS.API_TOKEN = '';
        window.BF_GLOBALS.USER_ID = '';
    }

    isConfigured() {
        return !!(this.apiToken && this.restApiEndpoint);
    }

    buildUrl(path) {
        const base = this.restApiEndpoint.replace(/\/+$/, '');
        const cleanPath = path.startsWith('/') ? path : '/' + path;
        return base + cleanPath;
    }

    resolveBody(body) {
        if (!body) return body;
        return body
            .replace(/\{\{API_TOKEN\}\}/g, this.apiToken)
            .replace(/\{\{REST_API_ENDPOINT\}\}/g, this.restApiEndpoint)
            .replace(/\{\{USER_ID\}\}/g, this.userId)
            .replace(/\{\{email\}\}/g, this.email)
            .replace(/\{\{name\}\}/g, this.name);
    }

    getDefaultHeaders() {
        const h = { 'Content-Type': 'application/json' };
        if (this.apiToken) h['Authorization'] = 'Bearer ' + this.apiToken;
        return h;
    }

    logCall(entry) {
        window.apiCallLog.unshift(entry);
        if (window.apiCallLog.length > 200) window.apiCallLog = window.apiCallLog.slice(0, 200);
        localStorage.setItem('bf_api_call_log', JSON.stringify(window.apiCallLog));
        window.dispatchEvent(new CustomEvent('api-call-logged', { detail: entry }));
    }

    /**
     * Core request method.
     */
    async request(method, path, body = null, customHeaders = null, source = 'client') {
        const url = path.startsWith('http') ? path : this.buildUrl(path);
        const headers = customHeaders || this.getDefaultHeaders();
        const opts = { method: method.toUpperCase(), headers, mode: 'cors' };
        let requestBodyStr = null;

        if (body && ['POST', 'PUT', 'PATCH'].includes(opts.method)) {
            if (body instanceof FormData) {
                opts.body = body;
                requestBodyStr = '(FormData / binary file)';
                delete headers['Content-Type'];
            } else if (typeof body === 'string') {
                opts.body = this.resolveBody(body);
                requestBodyStr = opts.body;
            } else {
                // Inject user_id into JSON body if not present
                if (!body.user_id && this.userId) body.user_id = this.userId;
                opts.body = JSON.stringify(body);
                requestBodyStr = opts.body;
            }
        }

        const t0 = Date.now();
        const logEntry = {
            id: 'log-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
            timestamp: new Date().toISOString(),
            method: opts.method, url,
            requestHeaders: this._maskHeaders({ ...headers }),
            requestBody: requestBodyStr,
            status: null, statusText: null,
            responseHeaders: {},
            responseBody: null,
            elapsed: 0, ok: false,
            source: source
        };

        try {
            const res = await fetch(url, opts);
            const elapsed = Date.now() - t0;
            const ct = res.headers.get('content-type') || '';
            const data = ct.includes('application/json') ? await res.json() : await res.text();

            logEntry.status = res.status;
            logEntry.statusText = res.statusText;
            logEntry.responseHeaders = Object.fromEntries(res.headers.entries());
            logEntry.responseBody = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            logEntry.elapsed = elapsed;
            logEntry.ok = res.ok;
            this.logCall(logEntry);
            return { ok: res.ok, status: res.status, statusText: res.statusText, data, elapsed, headers: logEntry.responseHeaders };
        } catch (err) {
            const elapsed = Date.now() - t0;
            logEntry.status = 0;
            logEntry.statusText = 'Network Error';
            logEntry.responseBody = JSON.stringify({ error: err.message });
            logEntry.elapsed = elapsed;
            this.logCall(logEntry);
            return { ok: false, status: 0, statusText: 'Network Error', data: { error: err.message }, elapsed, headers: {} };
        }
    }

    _maskHeaders(headers) {
        const masked = { ...headers };
        if (masked['Authorization']) {
            const k = masked['Authorization'];
            // Mask the token portion after "Bearer "
            const token = k.replace(/^Bearer\s+/i, '');
            masked['Authorization'] = 'Bearer ' + (token.length > 12
                ? token.substring(0, 6) + '••••••' + token.substring(token.length - 4)
                : '••••••••');
        }
        return masked;
    }

    // ── Convenience methods ──
    async get(path)        { return this.request('GET', path); }
    async post(path, body) { return this.request('POST', path, body); }

    // ══════════════════════════════════════════════
    // AUTO-STATUS POLLING
    // After a POST, extract call_id from the response and auto-poll
    // GET /output/{call_id} until status changes from PENDING.
    // ══════════════════════════════════════════════

    /**
     * Extract a call_id from the async response.
     * BlueFlame returns {id, status, output, ...} — the `id` is the call_id.
     */
    _extractCallId(data) {
        if (!data || typeof data !== 'object') return null;
        return data.id || data.call_id || data.callId ||
               data.request_id || data.requestId ||
               (data.data && (data.data.id || data.data.call_id)) ||
               null;
    }

    /**
     * Poll GET /output/{callId} until the status changes from PENDING
     * or output is populated, or max retries reached.
     * Returns the final status response.
     * Fires 'status-poll' custom events for UI updates.
     */
    async pollStatus(callId, onUpdate) {
        if (!callId) return null;
        let retries = 0;
        while (retries < this.statusPollMaxRetries) {
            retries++;
            await this._sleep(this.statusPollInterval);
            const result = await this.getCallStatus(callId);
            const status = result.data?.status || result.data?.state || '';
            const statusLower = String(status).toLowerCase();

            // Notify UI
            window.dispatchEvent(new CustomEvent('status-poll', {
                detail: { callId, attempt: retries, result, status: statusLower }
            }));
            if (typeof onUpdate === 'function') onUpdate({ callId, attempt: retries, result, status: statusLower });

            // Terminal states
            if (['completed', 'complete', 'success', 'done', 'finished'].includes(statusLower)) {
                return result;
            }
            if (['failed', 'error', 'cancelled', 'timeout'].includes(statusLower)) {
                return result;
            }
            // If output is populated, treat as complete regardless of status string
            if (result.data?.output != null) {
                return result;
            }
        }
        // Max retries reached
        return { ok: false, status: 0, statusText: 'Polling timeout', data: { error: `Max retries (${this.statusPollMaxRetries}) reached for call_id: ${callId}` }, elapsed: 0, headers: {} };
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    /**
     * POST + Auto Status: Send a POST request, then auto-poll status if call_id returned.
     * This is the primary method used by the Upload tab and Bot request flows.
     */
    async postAndPollStatus(path, body, onUpdate) {
        const postResult = await this.post(path, body);
        if (!postResult.ok) return { postResult, statusResult: null, callId: null };

        const callId = this._extractCallId(postResult.data);
        if (!callId) return { postResult, statusResult: null, callId: null };

        // Auto-poll status
        const statusResult = await this.pollStatus(callId, onUpdate);
        return { postResult, statusResult, callId };
    }

    // ── 8 BlueFlame API commands ──

    async sendLLMRequest(prompt, context = '', params = {}, file = null) {
        const body = {
            prompt, context, user_id: this.userId,
            parameters: { temperature: params.temperature ?? 0.2, max_tokens: params.max_tokens ?? 2048, ...params }
        };
        if (file) {
            body.file = file.base64;
            body.file_name = file.name;
            body.content_type = file.contentType;
        }
        return this.post('/functions/llm', body);
    }

    async sendLLMRequestModel(model, prompt, context = '', params = {}) {
        return this.post('/functions/llm', {
            model, prompt, context, user_id: this.userId,
            parameters: { temperature: params.temperature ?? 0.1, max_tokens: params.max_tokens ?? 10000, ...params }
        });
    }

    async getAvailableModels() {
        return this.post('/functions/models', {});
    }

    async sendQnARequest(question, documentId, options = {}, file = null) {
        const body = {
            question, document_id: documentId, user_id: this.userId,
            context: options.context || '',
            options: { return_source: options.return_source ?? true, confidence_threshold: options.confidence_threshold ?? 0.7 }
        };
        if (file) {
            body.file = file.base64;
            body.file_name = file.name;
            body.content_type = file.contentType;
        }
        return this.post('/functions/qna', body);
    }

    async sendScanRequest(documentId, scanType = 'financial_statement', fields = [], options = {}, file = null) {
        const body = {
            document_id: documentId, scan_type: scanType, user_id: this.userId,
            extract_fields: fields.length > 0 ? fields : ['revenue','net_income','total_assets','total_liabilities','cash_flow','ebitda'],
            options: { extract_tables: options.extract_tables ?? true, extract_key_values: options.extract_key_values ?? true, ocr_enabled: options.ocr_enabled ?? true }
        };
        if (file) {
            body.file = file.base64;
            body.file_name = file.name;
            body.content_type = file.contentType;
        }
        return this.post('/functions/scan', body);
    }

    async sendBotRequest(message, documentId = '', sessionId = '', options = {}, file = null) {
        const body = {
            message, session_id: sessionId, document_id: documentId, user_id: this.userId,
            options: { stream: options.stream ?? false, include_sources: options.include_sources ?? true }
        };
        if (file) {
            body.file = file.base64;
            body.file_name = file.name;
            body.content_type = file.contentType;
        }
        return this.post('/functions/llm', body);
    }

    async getCallStatus(callId) {
        return this.get('/output/' + callId);
    }

    async uploadFile(file, metadata = {}) {
        // Convert file to base64 — API expects JSON, not multipart/form-data
        const base64 = await this._fileToBase64(file);
        const body = {
            file: base64,
            file_name: file.name,
            content_type: file.type || 'application/octet-stream',
            user_id: this.userId
        };
        if (Object.keys(metadata).length > 0) body.metadata = metadata;
        return this.post('/functions/upload', body);
    }

    /**
     * Convert a File to plain text, client-side.
     * .xlsx/.xls → CSV via SheetJS, .csv → read as text, .pdf → extract via pdf.js
     */
    async fileToText(file) {
        const ext = file.name.split('.').pop().toLowerCase();

        if (ext === 'csv') {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = reject;
                reader.readAsText(file);
            });
        }

        if (ext === 'xlsx' || ext === 'xls') {
            const buffer = await file.arrayBuffer();
            const workbook = XLSX.read(buffer, { type: 'array' });
            return workbook.SheetNames.map(name => {
                const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
                return workbook.SheetNames.length > 1 ? `--- Sheet: ${name} ---\n${csv}` : csv;
            }).join('\n\n');
        }

        if (ext === 'pdf') {
            const buffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
            const pages = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                pages.push(content.items.map(item => item.str).join(' '));
            }
            return pages.join('\n\n');
        }

        throw new Error(`Unsupported file type: .${ext}`);
    }

    _fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async testConnection() {
        const result = await this.getAvailableModels();
        if (result.ok) {
            this.lastConnected = new Date().toISOString();
            this.saveConfig();
        }
        return result;
    }

    /**
     * Raw request from the API Explorer — sends exactly what the user specifies.
     * If method is POST and autoStatus is enabled, auto-polls status.
     */
    async sendRawRequest(method, fullUrl, headers, body, autoStatus = false) {
        const t0 = Date.now();
        const opts = { method: method.toUpperCase(), headers: headers || {}, mode: 'cors' };
        if (body && ['POST', 'PUT', 'PATCH'].includes(opts.method)) opts.body = body;

        const logEntry = {
            id: 'log-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36),
            timestamp: new Date().toISOString(),
            method: opts.method, url: fullUrl,
            requestHeaders: { ...headers },
            requestBody: body || null,
            status: null, statusText: null,
            responseHeaders: {},
            responseBody: null,
            elapsed: 0, ok: false,
            source: 'explorer'
        };

        try {
            const res = await fetch(fullUrl, opts);
            const elapsed = Date.now() - t0;
            const ct = res.headers.get('content-type') || '';
            const data = ct.includes('application/json') ? await res.json() : await res.text();
            logEntry.status = res.status;
            logEntry.statusText = res.statusText;
            logEntry.responseHeaders = Object.fromEntries(res.headers.entries());
            logEntry.responseBody = typeof data === 'object' ? JSON.stringify(data, null, 2) : data;
            logEntry.elapsed = elapsed;
            logEntry.ok = res.ok;
            this.logCall(logEntry);

            const result = { ok: res.ok, status: res.status, statusText: res.statusText, data, elapsed, headers: logEntry.responseHeaders };

            // Auto-status for POST requests
            if (autoStatus && res.ok && opts.method === 'POST') {
                const callId = this._extractCallId(data);
                if (callId) {
                    result.callId = callId;
                    result.autoStatusTriggered = true;
                }
            }

            return result;
        } catch (err) {
            const elapsed = Date.now() - t0;
            logEntry.status = 0;
            logEntry.statusText = 'Network Error';
            logEntry.responseBody = JSON.stringify({ error: err.message });
            logEntry.elapsed = elapsed;
            this.logCall(logEntry);
            return { ok: false, status: 0, statusText: 'Network Error', data: { error: err.message }, elapsed, headers: {} };
        }
    }
}
