/**
 * BlueFlame Financial Extractor — Main Application Controller
 * ─────────────────────────────────────────────────
 * Global Variables:
 *   REST_API_ENDPOINT  →  Base URL for all API calls
 *   API_TOKEN          →  Auth token (X-Api-Key header)
 *   USER_ID            →  User email / unique ID (sent in request bodies)
 *
 * Features:
 *   - Bot prompt field in Upload tab for Bot Request extraction method
 *   - Auto-status polling after every POST (GET /functions/status/{call_id})
 *   - Postman-style Params + Headers + Body tabs in API Explorer
 *   - Prettify JSON button, body type selector (JSON/Raw/None)
 *   - API Calls log tab (hideable) with full request/response detail
 */

(function () {
    'use strict';

    const client = new BlueFlameClient();
    const state = {
        activeTab: 'upload',
        fileQueue: [],
        submissions: JSON.parse(localStorage.getItem('bf_submissions') || '[]'),
        extractions: JSON.parse(localStorage.getItem('bf_extractions') || '[]'),
        selectedExtractions: new Set(),
        configVisible: false,
        apiCallsVisible: false,
        detailOpen: false,
        currentExtraction: null,
        currentCallDetail: null,
        explorerResponseTab: 'body',
        currentEndpoint: null
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    document.addEventListener('DOMContentLoaded', () => {
        initNavigation();
        initUploadTab();
        initReviewTab();
        initExportTab();
        initApiExplorer();
        initApiCallsTab();
        initConfigTab();
        initThemeToggle();
        updateConnectionStatus();
        // No demo data — extractions are populated from real API responses
        renderReviewGrid();
        renderExportSelections();
        renderRecentSubmissions();
        updateApiCallsBadge();
    });

    // ============================================
    // NAVIGATION
    // ============================================
    function initNavigation() {
        $$('.nav-item').forEach(item => {
            item.addEventListener('click', () => switchTab(item.dataset.tab));
        });
        $('#btnMenu').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

        $('#btnToggleConfig').addEventListener('click', () => {
            state.configVisible = !state.configVisible;
            $('#configNavItem').style.display = state.configVisible ? 'flex' : 'none';
            $('#configToggleIndicator').classList.toggle('active', state.configVisible);
            if (!state.configVisible && state.activeTab === 'config') switchTab('upload');
        });

        $('#btnToggleApiCalls').addEventListener('click', () => {
            state.apiCallsVisible = !state.apiCallsVisible;
            $('#apiCallsNavItem').style.display = state.apiCallsVisible ? 'flex' : 'none';
            $('#apiCallsToggleIndicator').classList.toggle('active', state.apiCallsVisible);
            if (!state.apiCallsVisible && state.activeTab === 'api-calls') switchTab('upload');
        });

        document.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-goto]');
            if (btn) switchTab(btn.dataset.goto);
        });
    }

    function switchTab(tab) {
        state.activeTab = tab;
        $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
        $$('.tab-content').forEach(t => t.classList.toggle('active', t.id === `tab-${tab}`));
        const names = {
            upload: 'Upload Documents', review: 'Review Extractions',
            export: 'Export & Email', 'api-explorer': 'API Explorer',
            'api-calls': 'API Calls', config: 'Configuration'
        };
        $('#breadcrumb span').textContent = names[tab] || tab;
        $('#sidebar').classList.remove('open');
        if (tab === 'api-explorer') syncExplorerGlobals();
        if (tab === 'api-calls') renderApiCallsList();
    }

    // ============================================
    // THEME
    // ============================================
    function initThemeToggle() {
        const saved = localStorage.getItem('bf_theme') || 'light';
        document.documentElement.setAttribute('data-theme', saved);
        updateThemeIcon(saved);
        $('#btnThemeToggle').addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('bf_theme', next);
            updateThemeIcon(next);
        });
    }
    function updateThemeIcon(theme) {
        $('#btnThemeToggle i').className = theme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // ============================================
    // UPLOAD TAB — with Bot Prompt & Auto-Status
    // ============================================
    function initUploadTab() {
        const dropzone = $('#uploadDropzone');
        const fileInput = $('#fileInput');
        $('#btnBrowseFiles').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => { addFilesToQueue(Array.from(e.target.files)); fileInput.value = ''; });
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); addFilesToQueue(Array.from(e.dataTransfer.files)); });
        $$('.upload-type-selector .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                $$('.upload-type-selector .chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                fileInput.setAttribute('accept', chip.dataset.type === 'pdf' ? '.pdf' : chip.dataset.type === 'excel' ? '.xls,.xlsx,.csv' : '.pdf,.xls,.xlsx,.csv');
            });
        });
        $('#btnClearQueue').addEventListener('click', () => { state.fileQueue = []; renderFileQueue(); updateSubmitButton(); });
        $('#btnSubmitExtraction').addEventListener('click', submitForExtraction);

        // Extraction method is now always LLM — no method selector needed
    }

    function addFilesToQueue(files) {
        const allowed = ['.pdf', '.xls', '.xlsx', '.csv'];
        files.forEach(file => {
            const ext = '.' + file.name.split('.').pop().toLowerCase();
            if (allowed.includes(ext)) {
                state.fileQueue.push({ id: generateId(), file, name: file.name, size: file.size, type: ext.replace('.', ''), status: 'queued' });
            } else { showToast(`Unsupported file type: ${file.name}`, 'warning'); }
        });
        renderFileQueue();
        updateSubmitButton();
    }

    function renderFileQueue() {
        const container = $('#fileQueue');
        if (state.fileQueue.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-inbox"></i><p>No files queued</p></div>';
            return;
        }
        container.innerHTML = state.fileQueue.map(f => {
            const ic = f.type === 'pdf' ? 'pdf' : (f.type === 'csv' ? 'csv' : 'excel');
            const in_ = f.type === 'pdf' ? 'fa-file-pdf' : (f.type === 'csv' ? 'fa-file-csv' : 'fa-file-excel');
            return `<div class="file-queue-item" data-id="${f.id}"><div class="file-icon ${ic}"><i class="fas ${in_}"></i></div><div class="file-info"><div class="file-name" title="${f.name}">${f.name}</div><div class="file-size">${formatFileSize(f.size)}</div></div><span class="file-remove" data-id="${f.id}"><i class="fas fa-times"></i></span></div>`;
        }).join('');
        container.querySelectorAll('.file-remove').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                state.fileQueue = state.fileQueue.filter(f => f.id !== btn.dataset.id);
                renderFileQueue();
                updateSubmitButton();
            });
        });
    }

    function updateSubmitButton() {
        $('#btnSubmitExtraction').disabled = state.fileQueue.length === 0;
    }

    /**
     * Submit files for extraction.
     * Flow: Upload → Extract (Scan/QnA/LLM/Bot) → Auto-poll Status
     */
    async function submitForExtraction() {
        const files = state.fileQueue;
        if (files.length === 0) return;
        if (!client.isConfigured()) {
            showToast('Please configure REST_API_ENDPOINT and API_TOKEN in the Configuration tab first.', 'warning');
            return;
        }
        const docType = $('#docTypeSelect').value;
        const entity = $('#entityName').value;
        const period = $('#reportingPeriod').value;
        const btn = $('#btnSubmitExtraction');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Processing...';

        // Show status polling section
        const pollSection = $('#statusPollSection');
        const pollLog = $('#statusPollLog');
        pollSection.style.display = 'block';
        pollLog.innerHTML = '';

        function addPollLogEntry(icon, text, cls) {
            const entry = document.createElement('div');
            entry.className = 'status-poll-entry' + (cls ? ' ' + cls : '');
            entry.innerHTML = `<i class="fas ${icon}"></i> <span>${text}</span> <span class="poll-time">${new Date().toLocaleTimeString()}</span>`;
            pollLog.appendChild(entry);
            pollLog.scrollTop = pollLog.scrollHeight;
        }

        for (const fileItem of files) {
            fileItem.status = 'uploading';
            let callId = null;
            const docId = generateDocumentId(fileItem.name);

            try {
                // ── Step 1: Extract text from file client-side ──
                addPollLogEntry('fa-file-export', `Extracting text from ${fileItem.name}...`, '');
                let fileText = await client.fileToText(fileItem.file);

                // Truncate very large documents to avoid API limits
                const MAX_CHARS = 100000;
                if (fileText.length > MAX_CHARS) {
                    addPollLogEntry('fa-exclamation-triangle', `Document text is ${fileText.length} chars — truncating to ${MAX_CHARS}`, 'poll-warning');
                    fileText = fileText.substring(0, MAX_CHARS);
                }

                addPollLogEntry('fa-check-circle', `Text extracted (${fileText.length} chars). Sending LLM request...`, 'poll-success');

                // ── Step 2: POST /functions/llm with text in prompt ──
                const customInstructions = $('#customPromptInput')?.value?.trim() || '';
                const prompt = `Analyze and extract all financial metrics from the following ${formatDocType(docType)}.` +
                    (entity ? ` Entity: ${entity}.` : '') +
                    (period ? ` Period: ${period}.` : '') +
                    ` Map each extracted value to the appropriate financial statement line item using these categories:\n` +
                    `Balance Sheet: Cash & Equivalents, Accounts Receivable, Inventory, Other Current Assets, PP&E (Net), Intangibles & Goodwill, Other Non-Current Assets, Total Assets, Accounts Payable, Accrued Expenses, Short-Term Debt, Other Current Liabilities, Long-Term Debt, Other Non-Current Liabilities, Total Liabilities, Owner's Equity / Retained Earnings, Total Liabilities & Equity.\n` +
                    `Income Statement: Revenue, COGS, Gross Profit, SG&A, D&A, Other Operating Expenses, Operating Income (EBIT), Interest Expense, Other Income / (Expense), Pre-Tax Income, Tax Expense, Net Income.\n` +
                    `Cash Flow: Net Income, D&A Add-Back, Changes in Working Capital, Cash from Operations (CFO), CapEx, Acquisitions / Divestitures, Cash from Investing (CFI), Debt Issuance / Repayment, Equity Issuance / Distributions, Cash from Financing (CFF), Net Change in Cash.\n` +
                    `Return as a JSON array where each item has: { "field": "<internal line item>", "statement": "BS|IS|CF", "category": "<category>", "value": <number or string>, "period": "<period>", "source_label": "<original label from document>" }.\n` +
                    `Flag any items that don't map to the above schema as "UNMAPPED".` +
                    (customInstructions ? `\n\nAdditional instructions: ${customInstructions}` : '') +
                    `\n\n--- Document Content ---\n${fileText}`;

                const extractResult = await client.sendLLMRequest(prompt, '', {
                    temperature: 0.2,
                    max_tokens: 4096
                });

                let extractionOutput = null;

                if (extractResult && extractResult.ok) {
                    callId = client._extractCallId(extractResult.data);
                    addPollLogEntry('fa-check-circle', `LLM request accepted. call_id: ${callId || 'none'}`, 'poll-success');

                    // ── Step 3: Poll GET /output/{id} until complete ──
                    if (callId) {
                        addPollLogEntry('fa-satellite-dish', `Polling status for call_id: ${callId}...`, 'poll-info');
                        $('#statusPollBadge').textContent = 'Polling...';
                        $('#statusPollBadge').className = 'status-poll-badge polling';

                        const statusResult = await client.pollStatus(callId, (update) => {
                            addPollLogEntry('fa-sync-alt', `Status poll #${update.attempt}: ${update.status || 'pending'}`, 'poll-info');
                            $('#statusPollBadge').textContent = `Poll #${update.attempt}: ${update.status || 'pending'}`;
                        });

                        if (statusResult && (statusResult.ok || statusResult.data?.output != null)) {
                            const finalStatus = statusResult.data?.status || 'unknown';
                            extractionOutput = statusResult.data?.output;
                            const hasOutput = extractionOutput != null;
                            addPollLogEntry('fa-flag-checkered', `Final status: ${finalStatus}${hasOutput ? ' (output received)' : ''}`, ['completed', 'complete', 'success', 'done'].includes(finalStatus.toLowerCase()) || hasOutput ? 'poll-success' : 'poll-warning');
                            $('#statusPollBadge').textContent = finalStatus;
                            $('#statusPollBadge').className = 'status-poll-badge ' + (['completed', 'complete', 'success', 'done'].includes(finalStatus.toLowerCase()) || hasOutput ? 'completed' : 'failed');

                            if (hasOutput) {
                                addPollLogEntry('fa-database', `Output captured for review.`, 'poll-success');
                            }
                        } else {
                            addPollLogEntry('fa-times-circle', `Polling ended: ${statusResult?.statusText || 'timeout'}`, 'poll-error');
                            $('#statusPollBadge').textContent = 'Timeout';
                            $('#statusPollBadge').className = 'status-poll-badge failed';
                        }
                    } else {
                        addPollLogEntry('fa-info-circle', 'No call_id returned — skipping status poll', 'poll-warning');
                    }
                } else {
                    addPollLogEntry('fa-times-circle', `Request failed: ${extractResult?.status} ${extractResult?.statusText}`, 'poll-error');
                }

                fileItem.status = extractionOutput != null ? 'success' : (callId ? 'processing' : 'error');
                addExtractionRecord(fileItem, docId, callId, 'llm', extractionOutput);
            } catch (err) {
                fileItem.status = 'error';
                addPollLogEntry('fa-times-circle', `Error: ${fileItem.name} — ${err.message}`, 'poll-error');
                showToast(`Error: ${fileItem.name} — ${err.message}`, 'error');
                addExtractionRecord(fileItem, docId, null, 'llm', null);
            }
        }

        $('#statusPollBadge').textContent = 'Complete';
        $('#statusPollBadge').className = 'status-poll-badge completed';

        const submission = {
            id: generateId(),
            files: files.map(f => f.name),
            docType, entity, period, method: 'llm',
            time: new Date().toISOString(),
            status: files.every(f => f.status === 'success') ? 'completed' : 'partial'
        };
        state.submissions.unshift(submission);
        if (state.submissions.length > 50) state.submissions = state.submissions.slice(0, 50);
        localStorage.setItem('bf_submissions', JSON.stringify(state.submissions));

        state.fileQueue = [];
        renderFileQueue();
        renderRecentSubmissions();
        renderReviewGrid();
        renderExportSelections();
        updateSubmitButton();
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-rocket"></i> Submit for Extraction';
        showToast('All documents submitted for extraction!', 'success');
    }

    function addExtractionRecord(fileItem, docId, callId, method, apiOutput) {
        const parsed = parseExtractionOutput(apiOutput);
        const statusMap = { success: 'completed', processing: 'processing', error: 'failed' };
        state.extractions.unshift({
            id: generateId(), documentId: docId, callId, extractionMethod: method,
            fileName: fileItem.name, fileType: fileItem.type, fileSize: fileItem.size,
            docType: $('#docTypeSelect').value,
            entity: $('#entityName').value || 'Unknown Entity',
            period: $('#reportingPeriod').value || 'N/A',
            status: statusMap[fileItem.status] || 'failed',
            confidence: parsed.confidence,
            datapoints: parsed.datapoints,
            datapointCount: parsed.datapoints.length,
            rawOutput: apiOutput,
            submittedBy: client.name || client.userId || client.email || 'User',
            userId: client.userId,
            createdAt: new Date().toISOString(),
            completedAt: fileItem.status === 'success' ? new Date().toISOString() : null
        });
        localStorage.setItem('bf_extractions', JSON.stringify(state.extractions));
    }

    function renderRecentSubmissions() {
        const container = $('#recentSubmissions');
        if (state.submissions.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-clock"></i><p>No recent submissions</p></div>';
            return;
        }
        container.innerHTML = state.submissions.slice(0, 10).map(s => {
            const sc = s.status === 'completed' ? 'connected' : 'connecting';
            return `<div class="submission-item"><span class="submission-status status-dot ${sc}"></span><div class="submission-info"><div class="submission-name">${s.files.join(', ')}</div><div class="submission-time">${getTimeAgo(s.time)} · ${{ scan: 'Scan', qna: 'QnA', llm: 'LLM', bot: 'Bot' }[s.method] || 'Scan'} · ${s.entity || 'No entity'}</div></div></div>`;
        }).join('');
    }

    // ============================================
    // REVIEW TAB
    // ============================================
    function initReviewTab() {
        $('#reviewSearch').addEventListener('input', renderReviewGrid);
        $('#reviewStatusFilter').addEventListener('change', renderReviewGrid);
        $('#reviewTypeFilter').addEventListener('change', renderReviewGrid);
        $('#btnRefreshExtractions').addEventListener('click', async () => {
            showToast('Refreshing...', 'info');
            await pollExtractionStatuses();
            renderReviewGrid();
        });
        $('#btnCloseDetail').addEventListener('click', closeDetailPanel);
        $$('.detail-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.detail-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                renderDetailContent(tab.dataset.detail);
            });
        });
        $('#btnApproveExtraction').addEventListener('click', () => {
            if (state.currentExtraction) {
                state.currentExtraction.status = 'approved';
                saveExtractions();
                renderReviewGrid();
                renderExportSelections();
                showToast('Extraction approved!', 'success');
                closeDetailPanel();
            }
        });
        $('#btnReprocess').addEventListener('click', async () => {
            if (state.currentExtraction) {
                const ext = state.currentExtraction;
                showToast('Reprocessing...', 'info');
                try {
                    const r = await client.sendScanRequest(ext.documentId, ext.docType);
                    const newCallId = client._extractCallId(r.data);
                    if (newCallId) {
                        ext.callId = newCallId;
                        showToast(`Reprocess submitted. call_id: ${newCallId}. Auto-polling status...`, 'info');
                        // Auto-poll status for the reprocess
                        const statusResult = await client.pollStatus(newCallId);
                        if (statusResult && statusResult.ok) {
                            const s = statusResult.data?.status || '';
                            if (['completed', 'success', 'done'].includes(s.toLowerCase())) {
                                ext.status = 'completed';
                                ext.completedAt = new Date().toISOString();
                                showToast('Reprocess completed!', 'success');
                            } else {
                                ext.status = 'processing';
                                showToast(`Reprocess status: ${s}`, 'info');
                            }
                        }
                    } else {
                        ext.status = 'processing';
                    }
                    saveExtractions();
                    renderReviewGrid();
                } catch (e) {
                    showToast(`Reprocess failed: ${e.message}`, 'error');
                }
            }
        });
    }

    function renderReviewGrid() {
        const search = ($('#reviewSearch')?.value || '').toLowerCase();
        const statusFilter = $('#reviewStatusFilter')?.value || 'all';
        const typeFilter = $('#reviewTypeFilter')?.value || 'all';
        let filtered = state.extractions.filter(ext => {
            if (search && !ext.fileName.toLowerCase().includes(search) && !ext.entity.toLowerCase().includes(search)) return false;
            if (statusFilter !== 'all' && ext.status !== statusFilter) return false;
            if (typeFilter !== 'all' && ext.docType !== typeFilter) return false;
            return true;
        });
        const grid = $('#extractionsGrid');
        if (filtered.length === 0) {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-database"></i><h3>No Extractions Found</h3><p>Upload documents to begin extracting financial data</p><button class="btn btn-primary" data-goto="upload"><i class="fas fa-upload"></i> Upload Documents</button></div>';
            return;
        }
        grid.innerHTML = filtered.map(ext => {
            const ml = { scan: 'Scan', qna: 'QnA', llm: 'LLM', bot: 'Bot' }[ext.extractionMethod] || 'LLM';
            return `<div class="extraction-card" data-id="${ext.id}"><div class="extraction-card-header"><h4 title="${ext.fileName}">${ext.fileName}</h4><div class="extraction-card-actions">${getStatusBadge(ext.status)}<button class="btn-icon btn-delete-extraction" data-id="${ext.id}" title="Delete extraction"><i class="fas fa-trash-alt"></i></button></div></div><div class="extraction-meta"><span><i class="fas fa-building"></i> ${ext.entity}</span><span><i class="fas fa-calendar"></i> ${ext.period}</span><span><i class="fas fa-clock"></i> ${getTimeAgo(ext.createdAt)}</span><span><i class="fas fa-cog"></i> ${ml}</span></div><div class="extraction-stats"><div class="extraction-stat"><div class="stat-value">${ext.datapointCount}</div><div class="stat-label">Datapoints</div></div><div class="extraction-stat"><div class="stat-value">${ext.confidence}%</div><div class="stat-label">Confidence</div></div><div class="extraction-stat"><div class="stat-value">${ext.fileType?.toUpperCase()}</div><div class="stat-label">Format</div></div></div></div>`;
        }).join('');
        grid.querySelectorAll('.extraction-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-extraction')) return;
                const ext = state.extractions.find(e => e.id === card.dataset.id);
                if (ext) openDetailPanel(ext);
            });
        });
        grid.querySelectorAll('.btn-delete-extraction').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Delete this extraction?')) deleteExtraction(btn.dataset.id);
            });
        });
    }

    function openDetailPanel(ext) {
        state.currentExtraction = ext;
        state.detailOpen = true;
        $('#detailTitle').textContent = ext.fileName;
        $('#detailPanel').classList.add('open');
        $$('.detail-tab').forEach(t => t.classList.toggle('active', t.dataset.detail === 'summary'));
        renderDetailContent('summary');
    }

    function closeDetailPanel() {
        state.detailOpen = false;
        state.currentExtraction = null;
        $('#detailPanel').classList.remove('open');
    }

    function renderDetailContent(view) {
        const ext = state.currentExtraction;
        if (!ext) return;
        const container = $('#detailContent');
        const ml = { scan: 'Scan Request', qna: 'QnA Request', llm: 'LLM Request', bot: 'Bot Request' }[ext.extractionMethod] || 'Scan Request';
        switch (view) {
            case 'summary':
                container.innerHTML = `<div class="summary-grid"><div class="summary-item"><label>Document</label><div class="value">${ext.fileName}</div></div><div class="summary-item"><label>Status</label><div class="value">${getStatusBadge(ext.status)}</div></div><div class="summary-item"><label>Entity</label><div class="value">${ext.entity}</div></div><div class="summary-item"><label>Period</label><div class="value">${ext.period}</div></div><div class="summary-item"><label>Doc Type</label><div class="value">${formatDocType(ext.docType)}</div></div><div class="summary-item"><label>Method</label><div class="value">${ml}</div></div><div class="summary-item"><label>Confidence</label><div class="value">${ext.confidence}%</div></div><div class="summary-item"><label>Datapoints</label><div class="value">${ext.datapointCount}</div></div><div class="summary-item"><label>File Size</label><div class="value">${formatFileSize(ext.fileSize)}</div></div><div class="summary-item"><label>User ID</label><div class="value text-muted" style="font-size:11px;">${ext.userId || '—'}</div></div><div class="summary-item"><label>Document ID</label><div class="value text-muted" style="font-size:11px;word-break:break-all;">${ext.documentId}</div></div><div class="summary-item"><label>Call ID</label><div class="value text-muted" style="font-size:11px;word-break:break-all;">${ext.callId || '—'}</div></div></div>${ext.callId ? '<button class="btn btn-secondary btn-sm mt-2" id="btnCheckCallStatus"><i class="fas fa-sync-alt"></i> Check Call Status</button>' : ''}`;
                const bs = container.querySelector('#btnCheckCallStatus');
                if (bs) bs.addEventListener('click', async () => {
                    bs.disabled = true;
                    bs.innerHTML = '<span class="spinner"></span> Checking...';
                    const r = await client.getCallStatus(ext.callId);
                    showToast(r.ok ? `Status: ${JSON.stringify(r.data).substring(0, 120)}` : `Error: ${r.statusText}`, r.ok ? 'info' : 'error');
                    bs.disabled = false;
                    bs.innerHTML = '<i class="fas fa-sync-alt"></i> Check Call Status';
                });
                break;
            case 'mapped': {
                if (!ext.datapoints || ext.datapoints.length === 0) {
                    container.innerHTML = '<div class="empty-state small"><i class="fas fa-table"></i><p>No datapoints extracted</p></div>';
                    return;
                }
                const { mapped } = classifyDatapoints(ext.datapoints);
                if (mapped.length === 0) {
                    container.innerHTML = '<div class="empty-state small"><i class="fas fa-check-circle"></i><p>No mapped datapoints — check the Unmapped tab</p></div>';
                    return;
                }
                container.innerHTML = renderMappedDatapoints(mapped);
                break;
            }
            case 'unmapped': {
                if (!ext.datapoints || ext.datapoints.length === 0) {
                    container.innerHTML = '<div class="empty-state small"><i class="fas fa-table"></i><p>No datapoints extracted</p></div>';
                    return;
                }
                const { unmapped } = classifyDatapoints(ext.datapoints);
                if (unmapped.length === 0) {
                    container.innerHTML = '<div class="empty-state small"><i class="fas fa-check-circle" style="color:var(--color-brand)"></i><p>All datapoints mapped successfully!</p></div>';
                    return;
                }
                container.innerHTML = renderUnmappedDatapoints(unmapped);
                break;
            }
            case 'raw':
                // Show the raw API output if available, otherwise show the full extraction record
                const rawData = ext.rawOutput != null ? ext.rawOutput : ext;
                container.innerHTML = `<div class="json-display">${typeof rawData === 'string' ? escapeHtml(rawData) : JSON.stringify(rawData, null, 2)}</div>`;
                break;
        }
    }

    async function pollExtractionStatuses() {
        for (const ext of state.extractions) {
            if (ext.callId && ext.status === 'processing') {
                try {
                    const r = await client.getCallStatus(ext.callId);
                    if (r.ok && r.data) {
                        const s = String(r.data.status || r.data.state || '').toLowerCase();
                        if (['completed', 'success', 'done'].includes(s)) {
                            ext.status = 'completed';
                            ext.completedAt = new Date().toISOString();
                            showToast(`${ext.fileName} completed!`, 'success');
                        } else if (['failed', 'error'].includes(s)) {
                            ext.status = 'failed';
                        }
                    }
                } catch (e) { /* swallow */ }
            }
        }
        saveExtractions();
    }

    function saveExtractions() {
        localStorage.setItem('bf_extractions', JSON.stringify(state.extractions));
    }

    // ============================================
    // EXPORT TAB
    // ============================================
    function initExportTab() {
        $('#btnSelectAll').addEventListener('click', () => {
            state.extractions.forEach(e => state.selectedExtractions.add(e.id));
            renderExportSelections();
            renderExportPreview();
        });
        $('#btnDeselectAll').addEventListener('click', () => {
            state.selectedExtractions.clear();
            renderExportSelections();
            renderExportPreview();
        });
        $$('.export-format-selector .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                $$('.export-format-selector .chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                renderExportPreview();
            });
        });
        $('#btnSendEmail').addEventListener('click', handleSendEmail);
        $('#btnDownloadExport').addEventListener('click', handleDownloadExport);
    }

    function renderExportSelections() {
        const container = $('#exportSelections');
        const completed = state.extractions.filter(e => e.status === 'completed' || e.status === 'approved');
        if (completed.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-database"></i><p>No completed extractions available</p></div>';
            return;
        }
        container.innerHTML = completed.map(ext => {
            const checked = state.selectedExtractions.has(ext.id) ? 'checked' : '';
            const sel = state.selectedExtractions.has(ext.id) ? 'selected' : '';
            return `<div class="export-selection-item ${sel}" data-id="${ext.id}"><input type="checkbox" ${checked} data-id="${ext.id}"><div style="flex:1;"><div style="font-weight:600;font-size:12px;">${ext.fileName}</div><div style="font-size:11px;color:var(--text-tertiary);">${ext.entity} · ${ext.period} · ${ext.datapointCount} datapoints</div></div><button class="btn-icon btn-delete-export" data-id="${ext.id}" title="Delete extraction"><i class="fas fa-trash-alt"></i></button></div>`;
        }).join('');
        container.querySelectorAll('.export-selection-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-export')) return;
                const id = item.dataset.id;
                if (state.selectedExtractions.has(id)) state.selectedExtractions.delete(id);
                else state.selectedExtractions.add(id);
                renderExportSelections();
                renderExportPreview();
            });
        });
        container.querySelectorAll('.btn-delete-export').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (confirm('Delete this extraction?')) deleteExtraction(btn.dataset.id);
            });
        });
    }

    function renderExportPreview() {
        const container = $('#exportPreview');
        const format = document.querySelector('.export-format-selector .chip.active')?.dataset.format || 'table';
        const selected = state.extractions.filter(e => state.selectedExtractions.has(e.id));
        if (selected.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-eye-slash"></i><p>Select extractions to preview</p></div>';
            return;
        }
        const allDp = [];
        selected.forEach(ext => {
            (ext.datapoints || []).forEach(dp => {
                allDp.push({ ...dp, entity: ext.entity, period: ext.period, document: ext.fileName });
            });
        });
        switch (format) {
            case 'table':
                container.innerHTML = `<table class="preview-table"><thead><tr><th>Document</th><th>Entity</th><th>Field</th><th>Value</th><th>Confidence</th></tr></thead><tbody>${allDp.map(dp => `<tr><td>${dp.document}</td><td>${dp.entity}</td><td>${dp.label}</td><td style="font-weight:600;color:var(--color-brand)">${dp.value}</td><td>${dp.confidence}%</td></tr>`).join('')}</tbody></table>`;
                break;
            case 'json':
                container.innerHTML = `<div class="json-display">${JSON.stringify(allDp, null, 2)}</div>`;
                break;
            case 'csv':
                let csv = 'Document,Entity,Period,Field,Value,Confidence\n';
                allDp.forEach(dp => { csv += `"${dp.document}","${dp.entity}","${dp.period}","${dp.label}","${dp.value}",${dp.confidence}\n`; });
                container.innerHTML = `<div class="json-display">${csv}</div>`;
                break;
        }
    }

    async function handleSendEmail() {
        const to = $('#emailTo').value;
        if (!to) { showToast('Enter a recipient email', 'warning'); return; }
        if (state.selectedExtractions.size === 0) { showToast('Select extractions to export', 'warning'); return; }
        const btn = $('#btnSendEmail');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Sending...';
        const selected = state.extractions.filter(e => state.selectedExtractions.has(e.id));
        try {
            const result = await client.sendBotRequest(
                `Send an email to ${to} with subject "${$('#emailSubject').value || 'Financial Data Extract'}" containing the extracted financial data. Format: ${$('#emailFormat').value}.`,
                selected[0]?.documentId || ''
            );
            // Auto-poll status for the bot request
            const callId = client._extractCallId(result.data);
            if (callId) {
                showToast(`Email request submitted. Polling status (call_id: ${callId})...`, 'info');
                await client.pollStatus(callId);
            }
            showToast(`Email request sent to ${to}`, 'success');
        } catch (e) {
            showToast(`Email failed: ${e.message}`, 'error');
        }
        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-paper-plane"></i> Send Email';
    }

    function handleDownloadExport() {
        if (state.selectedExtractions.size === 0) { showToast('Select extractions to export', 'warning'); return; }
        const format = document.querySelector('.export-format-selector .chip.active')?.dataset.format || 'json';
        const selected = state.extractions.filter(e => state.selectedExtractions.has(e.id));
        const allDp = [];
        selected.forEach(ext => {
            (ext.datapoints || []).forEach(dp => {
                allDp.push({ document: ext.fileName, entity: ext.entity, period: ext.period, field: dp.label, value: dp.value, confidence: dp.confidence });
            });
        });
        let content, mimeType, extension;
        if (format === 'csv') {
            content = 'Document,Entity,Period,Field,Value,Confidence\n';
            allDp.forEach(dp => { content += `"${dp.document}","${dp.entity}","${dp.period}","${dp.field}","${dp.value}",${dp.confidence}\n`; });
            mimeType = 'text/csv'; extension = 'csv';
        } else {
            content = JSON.stringify(allDp, null, 2);
            mimeType = 'application/json'; extension = 'json';
        }
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `blueflame-extraction-${new Date().toISOString().slice(0, 10)}.${extension}`;
        a.click(); URL.revokeObjectURL(url);
        showToast(`Downloaded ${extension.toUpperCase()} export`, 'success');
    }

    // ============================================
    // API EXPLORER — Postman-style with Params, Body Types, Auto-Status
    // ============================================
    function initApiExplorer() {
        renderApiCategories();
        syncExplorerGlobals();

        $('#btnSendRequest').addEventListener('click', sendApiRequest);

        // Explorer tabs (Params | Headers | Body | Auto-Status)
        $$('.explorer-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.explorer-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.explorerTab;
                $$('.explorer-tab-content').forEach(c => c.style.display = 'none');
                const targetEl = $(`#explorerTab${target.charAt(0).toUpperCase() + target.slice(1)}`);
                if (targetEl) targetEl.style.display = 'block';
            });
        });

        $('#btnAddHeader').addEventListener('click', () => addKvRow('headersEditor', '', '', true));
        $('#btnAddParam').addEventListener('click', () => addKvRow('paramsEditor', '', '', true));

        // Prettify JSON button
        $('#btnPrettifyBody').addEventListener('click', () => {
            const textarea = $('#apiBodyContent');
            try {
                const parsed = JSON.parse(textarea.value);
                textarea.value = JSON.stringify(parsed, null, 2);
                showToast('JSON prettified', 'success');
            } catch (e) {
                showToast('Invalid JSON — cannot prettify', 'warning');
            }
        });

        // Response tabs
        $$('.response-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                $$('.response-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                state.explorerResponseTab = tab.dataset.resp;
                $('#apiResponse').style.display = tab.dataset.resp === 'body' ? 'block' : 'none';
                $('#apiResponseHeaders').style.display = tab.dataset.resp === 'headers' ? 'block' : 'none';
                $('#apiResponseStatusResult').style.display = tab.dataset.resp === 'status-result' ? 'block' : 'none';
            });
        });

        // Global vars in Explorer — sync bidirectionally
        ['explorerRestEndpoint', 'explorerApiToken', 'explorerUserId'].forEach(id => {
            const el = $(`#${id}`);
            if (el) {
                el.addEventListener('change', () => {
                    if (id === 'explorerRestEndpoint') {
                        window.BF_GLOBALS.REST_API_ENDPOINT = el.value.trim();
                        localStorage.setItem('bf_rest_api_endpoint', el.value.trim());
                        client.restApiEndpoint = el.value.trim();
                    } else if (id === 'explorerApiToken') {
                        window.BF_GLOBALS.API_TOKEN = el.value.trim();
                        localStorage.setItem('bf_api_token', el.value.trim());
                        client.apiToken = el.value.trim();
                    } else if (id === 'explorerUserId') {
                        window.BF_GLOBALS.USER_ID = el.value.trim();
                        localStorage.setItem('bf_user_id', el.value.trim());
                        client.userId = el.value.trim();
                    }
                    syncExplorerGlobals();
                });
            }
        });

        // Toggle token visibility
        const btnToggle = $('#btnExplorerToggleToken');
        if (btnToggle) {
            btnToggle.addEventListener('click', () => {
                const inp = $('#explorerApiToken');
                const ic = btnToggle.querySelector('i');
                if (inp.type === 'password') { inp.type = 'text'; ic.className = 'fas fa-eye-slash'; }
                else { inp.type = 'password'; ic.className = 'fas fa-eye'; }
            });
        }
    }

    function syncExplorerGlobals() {
        const epInput = $('#explorerRestEndpoint');
        const tkInput = $('#explorerApiToken');
        const uidInput = $('#explorerUserId');
        if (epInput) epInput.value = window.BF_GLOBALS.REST_API_ENDPOINT || '';
        if (tkInput) tkInput.value = window.BF_GLOBALS.API_TOKEN || '';
        if (uidInput) uidInput.value = window.BF_GLOBALS.USER_ID || '';

        // Auth preview
        const preview = $('#apiAuthKeyPreview');
        if (preview) {
            const k = window.BF_GLOBALS.API_TOKEN;
            if (k) {
                preview.textContent = k.length > 12 ? k.substring(0, 6) + '••••••' + k.substring(k.length - 4) : '••••••••';
                preview.className = 'api-auth-key-preview has-key';
            } else {
                preview.textContent = 'No token set';
                preview.className = 'api-auth-key-preview';
            }
        }

        updateResolvedExample();
    }

    function updateResolvedExample() {
        const el = $('#resolvedExample');
        if (el) el.textContent = (window.BF_GLOBALS.REST_API_ENDPOINT || 'https://...') + '/functions/scan';
    }

    function renderApiCategories() {
        const container = $('#apiCategories');
        let html = '';
        Object.entries(BLUEFLAME_API).forEach(([key, category]) => {
            html += `<div class="api-category"><div class="api-category-title"><i class="${category.icon}"></i> ${category.label}</div>`;
            category.endpoints.forEach(ep => {
                html += `<div class="api-endpoint-item" data-endpoint="${ep.id}"><span class="method-badge ${ep.method.toLowerCase()}">${ep.method}</span><span>${ep.name}</span></div>`;
            });
            html += '</div>';
        });
        container.innerHTML = html;
        container.querySelectorAll('.api-endpoint-item').forEach(item => {
            item.addEventListener('click', () => {
                $$('.api-endpoint-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                loadEndpointInExplorer(item.dataset.endpoint);
            });
        });
    }

    function addKvRow(editorId, key, value, enabled, description) {
        const editor = $(`#${editorId}`);
        const row = document.createElement('div');
        row.className = 'kv-row';
        row.innerHTML = `<label class="kv-col-check"><input type="checkbox" class="kv-enabled" ${enabled ? 'checked' : ''}></label><input type="text" value="${escapeAttr(key)}" placeholder="${editorId === 'paramsEditor' ? 'Param name' : 'Header name'}" class="kv-key"><input type="text" value="${escapeAttr(value)}" placeholder="Value" class="kv-value"><input type="text" value="${escapeAttr(description || '')}" placeholder="Description" class="kv-desc"><button class="btn-icon kv-remove" title="Remove"><i class="fas fa-times"></i></button>`;
        row.querySelector('.kv-remove').addEventListener('click', () => { row.remove(); if (editorId === 'headersEditor') updateHeaderCount(); });
        row.querySelector('.kv-enabled').addEventListener('change', () => {
            row.classList.toggle('kv-disabled', !row.querySelector('.kv-enabled').checked);
        });
        if (!enabled) row.classList.add('kv-disabled');
        editor.appendChild(row);
        if (editorId === 'headersEditor') updateHeaderCount();
    }

    function updateHeaderCount() {
        const rows = $$('#headersEditor .kv-row');
        const enabled = Array.from(rows).filter(r => r.querySelector('.kv-enabled')?.checked).length;
        $('#headerCount').textContent = `(${enabled}/${rows.length})`;
    }

    function loadEndpointInExplorer(endpointId) {
        const ep = getAllEndpoints().find(e => e.id === endpointId);
        if (!ep) return;
        state.currentEndpoint = ep;

        $('#apiEndpointTitle').textContent = `${ep.name} — ${ep.description}`;
        $('#apiMethod').value = ep.method;

        const templateUrl = '{{REST_API_ENDPOINT}}' + ep.path;
        $('#apiUrl').value = templateUrl;

        const vars = {
            document_id: '<document_id>',
            call_id: '<call_id>',
            email: client.email,
            name: client.name,
            USER_ID: client.userId
        };
        $('#apiBodyContent').value = ep.body ? resolveTemplateVars(ep.body, vars) : '';

        // Load headers
        const headersEditor = $('#headersEditor');
        headersEditor.innerHTML = '';
        (ep.headers || []).forEach(h => {
            addKvRow('headersEditor', h.key, h.value, h.enabled !== false, h.description || '');
        });
        updateHeaderCount();

        // Clear params
        $('#paramsEditor').innerHTML = '';

        // Set body type radio based on method
        if (ep.method === 'GET') {
            document.querySelector('input[name="bodyType"][value="none"]').checked = true;
        } else {
            document.querySelector('input[name="bodyType"][value="json"]').checked = true;
        }

        // Auto-status checkbox
        $('#autoStatusEnabled').checked = ep.autoStatus !== false;

        syncExplorerGlobals();

        // Clear response areas
        $('#apiResponse').innerHTML = '<pre><code>// Click "Send" to execute this request</code></pre>';
        $('#apiResponseHeaders').innerHTML = '<pre><code>// Response headers will appear here</code></pre>';
        $('#apiResponseStatusResult').innerHTML = '<pre><code>// Auto-status polling result will appear here after POST requests</code></pre>';
        $('#responseMeta').innerHTML = '';
        $('#explorerAutoStatusLog').innerHTML = '<div class="empty-state small"><i class="fas fa-satellite-dish"></i><p>Status polling log will appear here after a POST request</p></div>';

        // Switch to Headers tab
        $$('.explorer-tab').forEach(t => t.classList.toggle('active', t.dataset.explorerTab === 'headers'));
        $$('.explorer-tab-content').forEach(c => c.style.display = 'none');
        $('#explorerTabHeaders').style.display = 'block';
    }

    /**
     * Build query string from the Params KV editor
     */
    function buildQueryString() {
        const params = [];
        $$('#paramsEditor .kv-row').forEach(row => {
            const enabled = row.querySelector('.kv-enabled')?.checked;
            if (!enabled) return;
            const key = row.querySelector('.kv-key').value.trim();
            const value = row.querySelector('.kv-value').value.trim();
            if (key) params.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
        });
        return params.length > 0 ? '?' + params.join('&') : '';
    }

    /**
     * Send the API request with auto-status polling for POST requests.
     */
    async function sendApiRequest() {
        const method = $('#apiMethod').value;
        let url = $('#apiUrl').value;
        const bodyType = document.querySelector('input[name="bodyType"]:checked')?.value || 'json';
        let body = bodyType === 'none' ? null : $('#apiBodyContent').value;

        if (!url) { showToast('Please enter a URL', 'warning'); return; }

        // Resolve global template variables in URL
        url = resolveTemplateVars(url);

        // Append query params from Params tab
        url += buildQueryString();

        // Resolve template variables in body
        if (body) body = resolveTemplateVars(body);

        // Collect enabled headers, resolving template vars
        const headers = {};
        $$('#headersEditor .kv-row').forEach(row => {
            const enabled = row.querySelector('.kv-enabled')?.checked;
            if (!enabled) return;
            const key = row.querySelector('.kv-key').value.trim();
            let value = row.querySelector('.kv-value').value.trim();
            if (key) {
                value = resolveTemplateVars(value);
                headers[key] = value;
            }
        });

        const autoStatusEnabled = $('#autoStatusEnabled').checked;
        const btn = $('#btnSendRequest');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span>';

        // Send the request
        const result = await client.sendRawRequest(method, url, headers, body || null, autoStatusEnabled);

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Send';

        // Display response meta
        const meta = $('#responseMeta');
        meta.innerHTML = result.ok
            ? `<span class="status-ok">${result.status} ${result.statusText}</span> · ${result.elapsed}ms`
            : `<span class="status-err">${result.status} ${result.statusText}</span> · ${result.elapsed}ms`;

        // Display response body
        const responseStr = typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : String(result.data);
        $('#apiResponse').innerHTML = `<pre><code>${escapeHtml(responseStr)}</code></pre>`;

        // Display response headers
        if (result.headers && Object.keys(result.headers).length > 0) {
            const hdrStr = Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
            $('#apiResponseHeaders').innerHTML = `<pre><code>${escapeHtml(hdrStr)}</code></pre>`;
        }

        // ── AUTO-STATUS POLLING for POST requests ──
        if (autoStatusEnabled && method === 'POST' && result.ok) {
            const callId = result.callId || client._extractCallId(result.data);
            if (callId) {
                const pollInterval = parseInt($('#autoStatusInterval').value) || 3000;
                const maxRetries = parseInt($('#autoStatusMaxRetries').value) || 20;
                client.statusPollInterval = pollInterval;
                client.statusPollMaxRetries = maxRetries;

                // Switch to Auto-Status response tab
                $$('.response-tab').forEach(t => t.classList.toggle('active', t.dataset.resp === 'status-result'));
                $('#apiResponse').style.display = 'none';
                $('#apiResponseHeaders').style.display = 'none';
                $('#apiResponseStatusResult').style.display = 'block';
                $('#apiResponseStatusResult').innerHTML = `<pre><code>// Polling status for call_id: ${callId}...</code></pre>`;

                // Update Auto-Status tab log
                const logContainer = $('#explorerAutoStatusLog');
                logContainer.innerHTML = '';
                function addStatusLog(text, cls) {
                    const div = document.createElement('div');
                    div.className = 'auto-status-log-entry' + (cls ? ' ' + cls : '');
                    div.innerHTML = `<span class="auto-status-time">${new Date().toLocaleTimeString()}</span> ${text}`;
                    logContainer.appendChild(div);
                    logContainer.scrollTop = logContainer.scrollHeight;
                }
                addStatusLog(`POST returned call_id: <code>${callId}</code>. Starting auto-poll...`, 'log-info');

                // Poll
                const statusResult = await client.pollStatus(callId, (update) => {
                    addStatusLog(`Poll #${update.attempt}: status = <strong>${update.status || 'pending'}</strong>`, 'log-info');
                    meta.innerHTML += ` · <span style="color:var(--color-info)">poll #${update.attempt}: ${update.status || 'pending'}</span>`;
                });

                if (statusResult && statusResult.ok) {
                    const finalStatusStr = typeof statusResult.data === 'object' ? JSON.stringify(statusResult.data, null, 2) : String(statusResult.data);
                    $('#apiResponseStatusResult').innerHTML = `<pre><code>${escapeHtml(finalStatusStr)}</code></pre>`;
                    const finalStatus = statusResult.data?.status || 'unknown';
                    addStatusLog(`Final: <strong>${finalStatus}</strong>`, ['completed', 'success', 'done'].includes(finalStatus.toLowerCase()) ? 'log-success' : 'log-warning');
                    meta.innerHTML = result.ok
                        ? `<span class="status-ok">${result.status}</span> · ${result.elapsed}ms · <span class="status-ok">Status: ${finalStatus}</span>`
                        : meta.innerHTML;
                } else {
                    const errStr = typeof statusResult?.data === 'object' ? JSON.stringify(statusResult.data, null, 2) : String(statusResult?.data || 'Polling timeout');
                    $('#apiResponseStatusResult').innerHTML = `<pre><code>${escapeHtml(errStr)}</code></pre>`;
                    addStatusLog(`Polling ended: ${statusResult?.statusText || 'timeout'}`, 'log-error');
                }
            } else {
                $('#apiResponseStatusResult').innerHTML = `<pre><code>// No call_id found in response — auto-status not triggered</code></pre>`;
            }
        }

        updateApiCallsBadge();
    }

    // ============================================
    // API CALLS TAB (Hideable)
    // ============================================
    function initApiCallsTab() {
        $('#apiCallsSearch').addEventListener('input', renderApiCallsList);
        $('#apiCallsFilterSource').addEventListener('change', renderApiCallsList);
        $('#apiCallsFilterStatus').addEventListener('change', renderApiCallsList);
        $('#btnClearApiCalls').addEventListener('click', () => {
            if (confirm('Clear all API call logs?')) {
                window.apiCallLog = [];
                localStorage.removeItem('bf_api_call_log');
                renderApiCallsList();
                updateApiCallsBadge();
                showToast('API call log cleared', 'info');
            }
        });
        $('#btnExportApiCalls').addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(window.apiCallLog, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `blueflame-api-calls-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('API calls exported', 'success');
        });
        $('#btnCloseCallDetail').addEventListener('click', () => {
            $('#apiCallDetailDrawer').classList.remove('open');
            state.currentCallDetail = null;
        });

        window.addEventListener('api-call-logged', () => {
            updateApiCallsBadge();
            if (state.activeTab === 'api-calls') renderApiCallsList();
        });
    }

    function updateApiCallsBadge() {
        const badge = $('#apiCallsBadge');
        if (badge) badge.textContent = window.apiCallLog.length;
    }

    function renderApiCallsList() {
        const search = ($('#apiCallsSearch')?.value || '').toLowerCase();
        const sourceFilter = $('#apiCallsFilterSource')?.value || 'all';
        const statusFilter = $('#apiCallsFilterStatus')?.value || 'all';

        let filtered = window.apiCallLog.filter(call => {
            if (search) {
                const haystack = `${call.method} ${call.url} ${call.status} ${call.statusText}`.toLowerCase();
                if (!haystack.includes(search)) return false;
            }
            if (sourceFilter !== 'all' && call.source !== sourceFilter) return false;
            if (statusFilter !== 'all') {
                if (statusFilter === 'success' && !(call.status >= 200 && call.status < 300)) return false;
                if (statusFilter === 'client-error' && !(call.status >= 400 && call.status < 500)) return false;
                if (statusFilter === 'server-error' && !(call.status >= 500)) return false;
                if (statusFilter === 'network-error' && call.status !== 0) return false;
            }
            return true;
        });

        const container = $('#apiCallsList');
        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-exchange-alt"></i><h3>No API Calls</h3><p>API calls will appear here as you interact with BlueFlame</p></div>';
            return;
        }

        container.innerHTML = `
            <div class="api-calls-table">
                <div class="api-calls-table-header">
                    <span class="acol-status">Status</span>
                    <span class="acol-method">Method</span>
                    <span class="acol-url">URL</span>
                    <span class="acol-time">Time</span>
                    <span class="acol-elapsed">Duration</span>
                    <span class="acol-source">Source</span>
                </div>
                <div class="api-calls-table-body">
                    ${filtered.map(call => {
                        const statusClass = call.ok ? 'call-success' : (call.status === 0 ? 'call-network-error' : (call.status >= 400 && call.status < 500 ? 'call-client-error' : 'call-server-error'));
                        const srcIcon = call.source === 'explorer' ? 'fa-code' : 'fa-cog';
                        const srcLabel = call.source === 'explorer' ? 'Explorer' : 'App';
                        const shortUrl = call.url.replace(/^https?:\/\/[^/]+/, '');
                        return `<div class="api-call-row ${statusClass}" data-id="${call.id}">
                            <span class="acol-status"><span class="call-status-badge ${statusClass}">${call.status || 'ERR'}</span></span>
                            <span class="acol-method"><span class="method-badge ${call.method.toLowerCase()}">${call.method}</span></span>
                            <span class="acol-url" title="${escapeAttr(call.url)}">${shortUrl}</span>
                            <span class="acol-time">${new Date(call.timestamp).toLocaleTimeString()}</span>
                            <span class="acol-elapsed">${call.elapsed}ms</span>
                            <span class="acol-source"><i class="fas ${srcIcon}"></i> ${srcLabel}</span>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;

        container.querySelectorAll('.api-call-row').forEach(row => {
            row.addEventListener('click', () => {
                const call = window.apiCallLog.find(c => c.id === row.dataset.id);
                if (call) openCallDetail(call);
            });
        });
    }

    function openCallDetail(call) {
        state.currentCallDetail = call;
        const drawer = $('#apiCallDetailDrawer');
        drawer.classList.add('open');
        $('#apiCallDetailTitle').textContent = `${call.method} ${call.url.replace(/^https?:\/\/[^/]+/, '')}`;

        const body = $('#apiCallDetailBody');
        body.innerHTML = `
            <div class="call-detail-section">
                <div class="call-detail-summary">
                    <div class="call-detail-meta">
                        <span class="call-status-badge ${call.ok ? 'call-success' : (call.status === 0 ? 'call-network-error' : 'call-client-error')}">${call.status || 'ERR'}</span>
                        <span class="method-badge ${call.method.toLowerCase()}">${call.method}</span>
                        <span class="call-detail-elapsed">${call.elapsed}ms</span>
                        <span class="call-detail-time">${new Date(call.timestamp).toLocaleString()}</span>
                    </div>
                    <div class="call-detail-url"><code>${escapeHtml(call.url)}</code></div>
                </div>
            </div>
            <div class="call-detail-section">
                <h4><i class="fas fa-arrow-up"></i> Request Headers</h4>
                <div class="call-detail-headers">
                    ${call.requestHeaders ? Object.entries(call.requestHeaders).map(([k, v]) => `<div class="call-header-row"><span class="call-header-key">${escapeHtml(k)}</span><span class="call-header-value">${escapeHtml(v)}</span></div>`).join('') : '<span class="text-muted">No headers</span>'}
                </div>
            </div>
            ${call.requestBody ? `<div class="call-detail-section"><h4><i class="fas fa-arrow-up"></i> Request Body</h4><div class="json-display">${escapeHtml(call.requestBody)}</div></div>` : ''}
            <div class="call-detail-section">
                <h4><i class="fas fa-arrow-down"></i> Response Headers</h4>
                <div class="call-detail-headers">
                    ${call.responseHeaders ? Object.entries(call.responseHeaders).map(([k, v]) => `<div class="call-header-row"><span class="call-header-key">${escapeHtml(k)}</span><span class="call-header-value">${escapeHtml(v)}</span></div>`).join('') : '<span class="text-muted">No headers</span>'}
                </div>
            </div>
            <div class="call-detail-section">
                <h4><i class="fas fa-arrow-down"></i> Response Body</h4>
                <div class="json-display">${escapeHtml(call.responseBody || '(empty)')}</div>
            </div>`;
    }

    // ============================================
    // CONFIGURATION TAB — 3 Global Variables + Email/Name
    // ============================================
    function initConfigTab() {
        restoreConfigFields();

        // Auto-sync email → USER_ID
        $('#cfgEmail').addEventListener('input', () => {
            const email = $('#cfgEmail').value.trim();
            const userIdField = $('#cfgUserId');
            // Only auto-sync if USER_ID is empty or matches the old email
            if (!userIdField.value || userIdField.value === client.email) {
                userIdField.value = email;
            }
        });

        // Save & Connect
        $('#btnSaveCredentials').addEventListener('click', () => {
            const endpoint = $('#cfgRestEndpoint').value.trim();
            const token = $('#cfgApiToken').value.trim();
            const userId = $('#cfgUserId').value.trim();
            const name = $('#cfgName').value.trim();
            const email = $('#cfgEmail').value.trim();

            if (!endpoint) { showToast('REST_API_ENDPOINT is required', 'warning'); return; }
            if (!token) { showToast('API_TOKEN is required', 'warning'); return; }

            client.restApiEndpoint = endpoint;
            client.apiToken = token;
            client.userId = userId || email;  // Default USER_ID to email
            client.name = name;
            client.email = email;
            client.lastConnected = new Date().toISOString();
            client.saveConfig();

            window.BF_GLOBALS.REST_API_ENDPOINT = endpoint;
            window.BF_GLOBALS.API_TOKEN = token;
            window.BF_GLOBALS.USER_ID = userId || email;

            updateConnectionStatus();
            updateConfigStatusPanel();
            syncExplorerGlobals();

            showToast('Configuration saved! Global variables updated across all requests.', 'success');
            $('#credentialStatus').textContent = 'Configured';
            $('#credentialStatus').className = 'badge success';
        });

        // Test Connection
        $('#btnTestConnection').addEventListener('click', async () => {
            const endpoint = $('#cfgRestEndpoint').value.trim();
            const token = $('#cfgApiToken').value.trim();
            if (!endpoint || !token) { showToast('Enter REST_API_ENDPOINT and API_TOKEN first', 'warning'); return; }

            const btn = $('#btnTestConnection');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Testing...';

            client.restApiEndpoint = endpoint;
            client.apiToken = token;
            client.userId = $('#cfgUserId').value.trim() || $('#cfgEmail').value.trim();
            client.name = $('#cfgName').value.trim();
            client.email = $('#cfgEmail').value.trim();
            client.saveConfig();

            window.BF_GLOBALS.REST_API_ENDPOINT = endpoint;
            window.BF_GLOBALS.API_TOKEN = token;
            window.BF_GLOBALS.USER_ID = client.userId;

            updateConnectionStatus('connecting');

            try {
                const r = await client.testConnection();
                if (r.ok) {
                    showToast('Connection successful!', 'success');
                    updateConnectionStatus('connected');
                    $('#credentialStatus').textContent = 'Connected';
                    $('#credentialStatus').className = 'badge success';
                } else {
                    showToast(`Connection failed: ${r.status} ${r.statusText}`, 'error');
                    updateConnectionStatus('disconnected');
                }
            } catch (e) {
                showToast(`Error: ${e.message}`, 'error');
                updateConnectionStatus('disconnected');
            }

            updateConfigStatusPanel();
            syncExplorerGlobals();
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-plug"></i> Test Connection';
        });

        // Clear All
        $('#btnClearCredentials').addEventListener('click', () => {
            if (confirm('Clear all API credentials and global variables?')) {
                client.clearConfig();
                restoreConfigFields();
                updateConnectionStatus();
                updateConfigStatusPanel();
                syncExplorerGlobals();
                showToast('Credentials cleared', 'info');
                $('#credentialStatus').textContent = 'Not Configured';
                $('#credentialStatus').className = 'badge';
            }
        });

        // Toggle token visibility
        $('#btnToggleApiToken').addEventListener('click', () => {
            const i = $('#cfgApiToken');
            const ic = $('#btnToggleApiToken i');
            if (i.type === 'password') { i.type = 'text'; ic.className = 'fas fa-eye-slash'; }
            else { i.type = 'password'; ic.className = 'fas fa-eye'; }
        });

        // Danger Zone
        $('#btnResetAll').addEventListener('click', () => {
            if (confirm('Clear ALL settings and data?')) {
                localStorage.clear();
                client.clearConfig();
                state.extractions = [];
                state.submissions = [];
                state.selectedExtractions.clear();
                window.apiCallLog = [];
                restoreConfigFields();
                updateConnectionStatus();
                updateConfigStatusPanel();
                syncExplorerGlobals();
                renderReviewGrid();
                renderExportSelections();
                renderRecentSubmissions();
                renderApiCallsList();
                updateApiCallsBadge();
                showToast('All settings cleared', 'warning');
            }
        });
        $('#btnPurgeCache').addEventListener('click', () => {
            if (confirm('Purge all cached extraction data?')) {
                state.extractions = [];
                state.submissions = [];
                localStorage.removeItem('bf_extractions');
                localStorage.removeItem('bf_submissions');
                renderReviewGrid();
                renderExportSelections();
                renderRecentSubmissions();
                showToast('Cache purged', 'warning');
            }
        });

        updateConfigStatusPanel();
    }

    function restoreConfigFields() {
        $('#cfgRestEndpoint').value = window.BF_GLOBALS.REST_API_ENDPOINT || 'https://api.blueflame.ai/prod/client/v1';
        $('#cfgApiToken').value = window.BF_GLOBALS.API_TOKEN || '';
        $('#cfgUserId').value = window.BF_GLOBALS.USER_ID || '';
        $('#cfgName').value = client.name || '';
        $('#cfgEmail').value = client.email || '';

        if (client.isConfigured()) {
            $('#credentialStatus').textContent = 'Configured';
            $('#credentialStatus').className = 'badge success';
        } else {
            $('#credentialStatus').textContent = 'Not Configured';
            $('#credentialStatus').className = 'badge';
        }
    }

    function updateConfigStatusPanel() {
        // API Connection
        const sApi = $('#statusIconApi'), tApi = $('#statusTextApi');
        if (client.lastConnected && client.isConfigured()) {
            sApi.className = 'config-status-icon status-green';
            tApi.textContent = 'Connected';
        } else if (client.isConfigured()) {
            sApi.className = 'config-status-icon status-yellow';
            tApi.textContent = 'Configured — not verified';
        } else {
            sApi.className = 'config-status-icon status-red';
            tApi.textContent = 'Not connected';
        }

        // REST_API_ENDPOINT
        const sEp = $('#statusIconEndpoint'), tEp = $('#statusTextEndpoint');
        if (window.BF_GLOBALS.REST_API_ENDPOINT) {
            sEp.className = 'config-status-icon status-green';
            tEp.textContent = window.BF_GLOBALS.REST_API_ENDPOINT;
        } else {
            sEp.className = 'config-status-icon status-red';
            tEp.textContent = 'Not set';
        }

        // API_TOKEN
        const sAuth = $('#statusIconAuth'), tAuth = $('#statusTextAuth');
        if (window.BF_GLOBALS.API_TOKEN) {
            sAuth.className = 'config-status-icon status-green';
            const k = window.BF_GLOBALS.API_TOKEN;
            tAuth.textContent = `X-Api-Key: ${k.length > 12 ? k.substring(0, 6) + '••••' + k.substring(k.length - 4) : '••••••••'}`;
        } else {
            sAuth.className = 'config-status-icon status-red';
            tAuth.textContent = 'No token configured';
        }

        // USER_ID
        const sUid = $('#statusIconUserId'), tUid = $('#statusTextUserId');
        if (window.BF_GLOBALS.USER_ID) {
            sUid.className = 'config-status-icon status-green';
            tUid.textContent = window.BF_GLOBALS.USER_ID;
        } else {
            sUid.className = 'config-status-icon status-yellow';
            tUid.textContent = 'Not set (will default to email)';
        }

        // User Profile
        const sUser = $('#statusIconUser'), tUser = $('#statusTextUser');
        if (client.name && client.email) {
            sUser.className = 'config-status-icon status-green';
            tUser.textContent = `${client.name} (${client.email})`;
        } else if (client.email) {
            sUser.className = 'config-status-icon status-yellow';
            tUser.textContent = client.email;
        } else {
            sUser.className = 'config-status-icon status-red';
            tUser.textContent = 'Not set';
        }

        // Connected info box
        const info = $('#configConnectedInfo');
        if (client.isConfigured()) {
            info.style.display = 'block';
            $('#infoUserName').textContent = client.name || '—';
            $('#infoUserEmail').textContent = client.email || '—';
            $('#infoUserId').textContent = client.userId || '—';
            $('#infoEndpoint').textContent = window.BF_GLOBALS.REST_API_ENDPOINT || '—';
            $('#infoLastConnected').textContent = client.lastConnected ? new Date(client.lastConnected).toLocaleString() : 'Never';
        } else {
            info.style.display = 'none';
        }
    }

    function updateConnectionStatus(status) {
        const dot = $('.status-dot');
        const text = $('.status-text');
        dot.className = 'status-dot';
        if (status === 'connected' || (client.lastConnected && client.isConfigured())) {
            dot.classList.add('connected');
            text.textContent = 'Connected';
        } else if (status === 'connecting') {
            dot.classList.add('connecting');
            text.textContent = 'Connecting...';
        } else if (client.isConfigured()) {
            dot.classList.add('disconnected');
            text.textContent = client.userId || client.email?.split('@')[0] || 'Configured';
        } else {
            dot.classList.add('disconnected');
            text.textContent = 'Not Connected';
        }
    }

    // ============================================
    // TOAST
    // ============================================
    function showToast(message, type = 'info') {
        const container = $('#toastContainer');
        const icons = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `<i class="fas ${icons[type]}"></i><span class="toast-message">${message}</span><button class="toast-close"><i class="fas fa-times"></i></button>`;
        container.appendChild(toast);
        toast.querySelector('.toast-close').addEventListener('click', () => toast.remove());
        setTimeout(() => {
            toast.style.transition = 'opacity 0.3s, transform 0.3s';
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(100%)';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    // ============================================
    // DEMO DATA (removed — extractions now use real API output)
    // ============================================

    /**
     * Parse real extraction output from the API into datapoints.
     * Handles various output formats: object with fields, array of items,
     * string (bot response text), or nested structures.
     * Returns { datapoints: [...], confidence: number }
     */
    function parseExtractionOutput(output) {
        const empty = { datapoints: [], confidence: 0 };
        if (output == null) return empty;

        // If output is a string, try to parse as JSON first
        let data = output;
        if (typeof data === 'string') {
            try { data = JSON.parse(data); } catch (e) {
                // Plain text response (e.g. bot reply) — return as single datapoint
                return {
                    datapoints: [{ label: 'Response', value: data, confidence: 100, page: null }],
                    confidence: 100
                };
            }
        }

        // If it's an array, treat each element as a datapoint
        if (Array.isArray(data)) {
            const dps = data.map((item, i) => normalizeDatapoint(item, i));
            return { datapoints: dps, confidence: avgConfidence(dps) };
        }

        // If it's an object, look for common wrapper patterns
        if (typeof data === 'object') {
            // Check for nested arrays: data.results, data.datapoints, data.fields, data.items, data.extractions
            const arrayField = data.results || data.datapoints || data.fields || data.items
                || data.extractions || data.data || data.extracted_data || data.records;
            if (Array.isArray(arrayField)) {
                const dps = arrayField.map((item, i) => normalizeDatapoint(item, i));
                return { datapoints: dps, confidence: avgConfidence(dps) };
            }

            // Check if output has a text/message field (bot-style response)
            if (data.message || data.text || data.answer || data.response) {
                const text = data.message || data.text || data.answer || data.response;
                return {
                    datapoints: [{ label: 'Response', value: String(text), confidence: 100, page: null }],
                    confidence: 100
                };
            }

            // Treat each key-value pair as a datapoint
            const entries = Object.entries(data).filter(([k]) =>
                !['status', 'id', 'call_id', 'user_id', 'metadata', 'error', 'quota'].includes(k)
            );
            if (entries.length > 0) {
                const dps = entries.map(([key, val], i) => ({
                    label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                    value: typeof val === 'object' ? JSON.stringify(val) : String(val),
                    confidence: 100,
                    page: null
                }));
                return { datapoints: dps, confidence: 100 };
            }
        }

        return empty;
    }

    /** Normalize a single datapoint from various API formats */
    function normalizeDatapoint(item, index) {
        if (typeof item === 'string') {
            return { label: `Item ${index + 1}`, value: item, confidence: 100, page: null };
        }
        if (typeof item !== 'object') {
            return { label: `Item ${index + 1}`, value: String(item), confidence: 100, page: null };
        }
        return {
            label: item.label || item.field || item.name || item.key || item.metric || `Field ${index + 1}`,
            value: item.value != null ? String(item.value) : (item.result || item.answer || item.text || '—'),
            confidence: item.confidence != null ? Number(item.confidence) : (item.score != null ? Math.round(item.score * 100) : 100),
            page: item.page || item.page_number || item.source_page || null
        };
    }

    function avgConfidence(datapoints) {
        if (datapoints.length === 0) return 0;
        const sum = datapoints.reduce((acc, dp) => acc + (dp.confidence || 0), 0);
        return Number((sum / datapoints.length).toFixed(1));
    }

    // ============================================
    // FINANCIAL STATEMENT MAPPING ENGINE
    // ============================================

    /** Canonical line items per statement */
    const SCHEMA_MAP = {
        BS: {
            name: 'Balance Sheet',
            icon: 'fa-balance-scale',
            items: {
                'Cash & Equivalents': 'Current Assets',
                'Accounts Receivable': 'Current Assets',
                'Inventory': 'Current Assets',
                'Other Current Assets': 'Current Assets',
                'PP&E (Net)': 'Non-Current Assets',
                'Intangibles & Goodwill': 'Non-Current Assets',
                'Other Non-Current Assets': 'Non-Current Assets',
                'Total Assets': '—',
                'Accounts Payable': 'Current Liabilities',
                'Accrued Expenses': 'Current Liabilities',
                'Short-Term Debt': 'Current Liabilities',
                'Other Current Liabilities': 'Current Liabilities',
                'Long-Term Debt': 'Non-Current Liabilities',
                'Other Non-Current Liabilities': 'Non-Current Liabilities',
                'Total Liabilities': '—',
                "Owner's Equity / Retained Earnings": 'Equity',
                'Total Liabilities & Equity': '—'
            }
        },
        IS: {
            name: 'Income Statement',
            icon: 'fa-chart-line',
            items: {
                'Revenue': 'Top Line',
                'COGS': 'Direct Costs',
                'Gross Profit': '—',
                'SG&A': 'Operating Expenses',
                'D&A': 'Operating Expenses',
                'Other Operating Expenses': 'Operating Expenses',
                'Operating Income (EBIT)': '—',
                'Interest Expense': 'Below the Line',
                'Other Income / (Expense)': 'Below the Line',
                'Pre-Tax Income': '—',
                'Tax Expense': 'Tax',
                'Net Income': 'Bottom Line'
            }
        },
        CF: {
            name: 'Cash Flow Statement',
            icon: 'fa-money-bill-wave',
            items: {
                'Net Income': 'Operating',
                'D&A Add-Back': 'Operating',
                'Changes in Working Capital': 'Operating',
                'Cash from Operations (CFO)': '—',
                'CapEx': 'Investing',
                'Acquisitions / Divestitures': 'Investing',
                'Cash from Investing (CFI)': '—',
                'Debt Issuance / Repayment': 'Financing',
                'Equity Issuance / Distributions': 'Financing',
                'Cash from Financing (CFF)': '—',
                'Net Change in Cash': '—'
            }
        }
    };

    /** Fuzzy matching keywords → canonical line item + statement */
    const LABEL_ALIASES = [
        { patterns: ['cash', 'liquidity', 'cash & short-term', 'cash equiv'], field: 'Cash & Equivalents', stmt: 'BS' },
        { patterns: ['trade receivable', 'net receivable', 'a/r', 'accounts receivable', 'ar'], field: 'Accounts Receivable', stmt: 'BS' },
        { patterns: ['inventory', 'finished goods', 'raw material', 'wip', 'stock'], field: 'Inventory', stmt: 'BS' },
        { patterns: ['prepaid', 'deposit', 'other current asset', 'other ca'], field: 'Other Current Assets', stmt: 'BS' },
        { patterns: ['pp&e', 'ppe', 'fixed asset', 'tangible asset', 'property plant', 'net ppe'], field: 'PP&E (Net)', stmt: 'BS' },
        { patterns: ['goodwill', 'intangible', 'customer relationship', 'ip', 'patent'], field: 'Intangibles & Goodwill', stmt: 'BS' },
        { patterns: ['total asset'], field: 'Total Assets', stmt: 'BS' },
        { patterns: ['trade payable', 'a/p', 'accounts payable', 'ap'], field: 'Accounts Payable', stmt: 'BS' },
        { patterns: ['accrued', 'accrual', 'accrued comp', 'accrued liabilit'], field: 'Accrued Expenses', stmt: 'BS' },
        { patterns: ['revolver', 'current portion ltd', 'line of credit', 'short-term debt', 'short term debt'], field: 'Short-Term Debt', stmt: 'BS' },
        { patterns: ['term loan', 'senior secured', 'notes payable', 'bond', 'long-term debt', 'long term debt', 'ltd'], field: 'Long-Term Debt', stmt: 'BS' },
        { patterns: ['total liabilit'], field: 'Total Liabilities', stmt: 'BS' },
        { patterns: ['member equity', 'partner capital', 'retained earning', 'shareholder equity', 'owner equity', 'stockholder equity', 'total equity'], field: "Owner's Equity / Retained Earnings", stmt: 'BS' },
        { patterns: ['total liabilities & equity', 'total liabilities and equity', 'total l&e', 'total l & e'], field: 'Total Liabilities & Equity', stmt: 'BS' },
        { patterns: ['net sales', 'total revenue', 'gross revenue', 'revenue', 'net revenue', 'sales'], field: 'Revenue', stmt: 'IS' },
        { patterns: ['cost of sales', 'cost of revenue', 'cost of goods', 'cogs', 'direct cost'], field: 'COGS', stmt: 'IS' },
        { patterns: ['gross profit', 'gross margin'], field: 'Gross Profit', stmt: 'IS' },
        { patterns: ['sg&a', 'sga', 'selling expense', 'g&a', 'general & admin', 'overhead', 'opex', 'operating expense'], field: 'SG&A', stmt: 'IS' },
        { patterns: ['depreciation', 'amortization', 'd&a', 'da'], field: 'D&A', stmt: 'IS' },
        { patterns: ['operating income', 'ebit', 'income from operation'], field: 'Operating Income (EBIT)', stmt: 'IS' },
        { patterns: ['interest expense', 'interest cost', 'debt service'], field: 'Interest Expense', stmt: 'IS' },
        { patterns: ['other income', 'other expense', 'non-operating'], field: 'Other Income / (Expense)', stmt: 'IS' },
        { patterns: ['pre-tax', 'pretax', 'income before tax', 'ebt'], field: 'Pre-Tax Income', stmt: 'IS' },
        { patterns: ['income tax', 'tax expense', 'provision for tax'], field: 'Tax Expense', stmt: 'IS' },
        { patterns: ['net income', 'net profit', 'net earning', 'bottom line'], field: 'Net Income', stmt: 'IS' },
        { patterns: ['ebitda'], field: 'EBITDA', stmt: 'IS' },
        { patterns: ['earnings per share', 'eps'], field: 'EPS', stmt: 'IS' },
        { patterns: ['d&a add-back', 'depreciation add', 'amortization add'], field: 'D&A Add-Back', stmt: 'CF' },
        { patterns: ['working capital', 'change in a/r', 'change in inventory', 'change in a/p', 'delta'], field: 'Changes in Working Capital', stmt: 'CF' },
        { patterns: ['cash from operation', 'cfo', 'operating cash'], field: 'Cash from Operations (CFO)', stmt: 'CF' },
        { patterns: ['capex', 'capital expenditure', 'purchase of pp&e', 'purchases of ppe'], field: 'CapEx', stmt: 'CF' },
        { patterns: ['acquisition', 'divestiture'], field: 'Acquisitions / Divestitures', stmt: 'CF' },
        { patterns: ['cash from invest', 'cfi', 'investing cash'], field: 'Cash from Investing (CFI)', stmt: 'CF' },
        { patterns: ['debt issuance', 'debt repayment', 'borrowing', 'debt proceed', 'repayment'], field: 'Debt Issuance / Repayment', stmt: 'CF' },
        { patterns: ['dividend', 'distribution', 'buyback', 'equity issuance'], field: 'Equity Issuance / Distributions', stmt: 'CF' },
        { patterns: ['cash from financing', 'cff', 'financing cash'], field: 'Cash from Financing (CFF)', stmt: 'CF' },
        { patterns: ['net change in cash', 'change in cash', 'ending cash'], field: 'Net Change in Cash', stmt: 'CF' }
    ];

    /**
     * Attempt to map a datapoint label to a canonical line item.
     * Returns { field, statement, category } or null if no match.
     */
    function fuzzyMapDatapoint(dp) {
        // If the LLM already tagged it with statement + field, validate it
        const dpField = (dp.field || dp.label || '').trim();
        const dpStmt = (dp.statement || '').toUpperCase();

        if (dpStmt && SCHEMA_MAP[dpStmt]) {
            const schemaItems = SCHEMA_MAP[dpStmt].items;
            // Direct match against schema
            for (const [canonical, category] of Object.entries(schemaItems)) {
                if (canonical.toLowerCase() === dpField.toLowerCase()) {
                    return { field: canonical, statement: dpStmt, category };
                }
            }
        }

        // Fuzzy match against alias table
        const normalized = dpField.toLowerCase().replace(/[^a-z0-9\s\/&()-]/g, '').trim();
        if (!normalized) return null;

        for (const alias of LABEL_ALIASES) {
            for (const pattern of alias.patterns) {
                if (normalized.includes(pattern) || pattern.includes(normalized)) {
                    const category = SCHEMA_MAP[alias.stmt]?.items?.[alias.field] || '—';
                    return { field: alias.field, statement: alias.stmt, category };
                }
            }
        }

        return null;
    }

    /**
     * Classify datapoints into mapped and unmapped buckets.
     * Attempts fuzzy mapping for each datapoint.
     */
    function classifyDatapoints(datapoints) {
        const mapped = [];
        const unmapped = [];

        datapoints.forEach(dp => {
            const match = fuzzyMapDatapoint(dp);
            if (match) {
                mapped.push({
                    ...dp,
                    field: match.field,
                    statement: match.statement,
                    category: match.category,
                    source_label: dp.source_label || dp.label || dp.field || ''
                });
            } else {
                unmapped.push({
                    ...dp,
                    source_label: dp.source_label || dp.label || dp.field || ''
                });
            }
        });

        return { mapped, unmapped };
    }

    /** Render mapped datapoints grouped by financial statement */
    function renderMappedDatapoints(mapped) {
        const stmtOrder = ['IS', 'BS', 'CF'];
        const groups = {};
        mapped.forEach(dp => {
            const key = dp.statement || 'OTHER';
            if (!groups[key]) groups[key] = [];
            groups[key].push(dp);
        });

        let html = `<div class="mapped-summary"><span class="badge success">${mapped.length} mapped</span></div>`;
        stmtOrder.forEach(key => {
            if (!groups[key] || groups[key].length === 0) return;
            const schema = SCHEMA_MAP[key];
            html += `<div class="stmt-group"><h4 class="stmt-group-title"><i class="fas ${schema.icon}"></i> ${schema.name} <span class="stmt-count">(${groups[key].length})</span></h4>`;
            html += `<table class="datapoint-table"><thead><tr><th>Line Item</th><th>Category</th><th>Value</th><th>Period</th><th>Source Label</th></tr></thead><tbody>`;

            // Order by schema order
            const schemaKeys = Object.keys(schema.items);
            groups[key].sort((a, b) => {
                const ai = schemaKeys.indexOf(a.field);
                const bi = schemaKeys.indexOf(b.field);
                return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
            });

            groups[key].forEach(dp => {
                html += `<tr>`;
                html += `<td><strong>${escapeHtml(dp.field)}</strong></td>`;
                html += `<td><span class="category-badge">${escapeHtml(dp.category)}</span></td>`;
                html += `<td class="datapoint-value">${escapeHtml(String(dp.value ?? ''))}</td>`;
                html += `<td>${escapeHtml(dp.period || '—')}</td>`;
                html += `<td class="text-muted" style="font-size:11px;">${escapeHtml(dp.source_label || '—')}</td>`;
                html += `</tr>`;
            });
            html += `</tbody></table></div>`;
        });
        return html;
    }

    /** Render unmapped datapoints */
    function renderUnmappedDatapoints(unmapped) {
        let html = `<div class="mapped-summary"><span class="badge danger">${unmapped.length} unmapped</span> <span class="text-muted" style="font-size:12px;">These items could not be matched to the financial statement schema at ≥85% confidence.</span></div>`;
        html += `<table class="datapoint-table"><thead><tr><th>Original Label</th><th>Value</th><th>Period</th><th>Confidence</th></tr></thead><tbody>`;
        unmapped.forEach(dp => {
            const label = dp.field || dp.label || dp.source_label || '—';
            const cc = (dp.confidence || 0) >= 90 ? 'confidence-high' : (dp.confidence || 0) >= 70 ? 'confidence-medium' : 'confidence-low';
            html += `<tr class="unmapped-row">`;
            html += `<td>${escapeHtml(label)}</td>`;
            html += `<td class="datapoint-value">${escapeHtml(String(dp.value ?? ''))}</td>`;
            html += `<td>${escapeHtml(dp.period || '—')}</td>`;
            html += `<td><span class="datapoint-confidence ${cc}">${dp.confidence != null ? dp.confidence + '%' : '—'}</span></td>`;
            html += `</tr>`;
        });
        html += `</tbody></table>`;
        return html;
    }

    // ============================================
    // DELETE EXTRACTIONS
    // ============================================
    function deleteExtraction(id) {
        state.extractions = state.extractions.filter(e => e.id !== id);
        state.selectedExtractions.delete(id);
        saveExtractions();
        renderReviewGrid();
        renderExportSelections();
        renderExportPreview();
        showToast('Extraction deleted', 'info');
    }

    // ============================================
    // UTILITIES
    // ============================================
    function generateId() { return 'bf-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }
    /** Generate a unique document ID from the filename + timestamp, distinct from call/task IDs */
    function generateDocumentId(fileName) {
        const slug = (fileName || 'doc').replace(/[^a-zA-Z0-9]/g, '').substring(0, 12).toLowerCase();
        return 'doc-' + slug + '-' + Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
    }
    function formatFileSize(bytes) { if (!bytes) return '0 B'; const s = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + s[i]; }
    function getTimeAgo(d) { const s = Math.floor((new Date() - new Date(d)) / 1000); if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return new Date(d).toLocaleDateString(); }
    function getStatusBadge(s) { const m = { completed: '<span class="badge success">Completed</span>', approved: '<span class="badge success">Approved</span>', processing: '<span class="badge info">Processing</span>', failed: '<span class="badge danger">Failed</span>', pending: '<span class="badge">Pending</span>', success: '<span class="badge success">Success</span>', partial: '<span class="badge">Partial</span>' }; return m[s] || `<span class="badge">${s || 'Unknown'}</span>`; }
    /**
     * Extract document_id from an upload output response.
     * Searches common field names in object or JSON-string output.
     * Returns null if no document_id can be found.
     */
    function extractDocumentId(output) {
        if (!output) return null;
        let obj = output;
        if (typeof output === 'string') {
            try { obj = JSON.parse(output); } catch (e) { return null; }
        }
        if (typeof obj !== 'object') return null;
        // Check common field names for the document identifier
        return obj.document_id || obj.documentId || obj.doc_id || obj.docId
            || obj.file_id || obj.fileId || obj.key || null;
    }

    function formatDocType(t) { return { income_statement: 'Income Statement', balance_sheet: 'Balance Sheet', cash_flow: 'Cash Flow Statement', trial_balance: 'Trial Balance', general_ledger: 'General Ledger', other: 'Other' }[t] || t; }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    $('#btnRefresh')?.addEventListener('click', () => {
        switch (state.activeTab) {
            case 'review': pollExtractionStatuses().then(renderReviewGrid); break;
            case 'api-calls': renderApiCallsList(); break;
            default: showToast('Refreshed', 'info');
        }
    });

})();
