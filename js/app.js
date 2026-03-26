/**
 * BlueFlame Company Enrichment — Main Application Controller
 * ─────────────────────────────────────────────────
 * Three main functions:
 *   1. Import — Upload spreadsheet of private companies
 *   2. Enrich — Enrich company data via BlueFlame Bot API
 *   3. Visualize & Export — View enriched data, export to Excel/CSV/JSON
 *
 * Utility tabs (unchanged):
 *   4. API Explorer (Postman-style)
 *   5. API Calls Log (hideable)
 *   6. Configuration (hideable)
 */

(function () {
    'use strict';

    const client = new BlueFlameClient();
    const state = {
        activeTab: 'import',
        // Company data
        companies: JSON.parse(localStorage.getItem('bf_companies') || '[]'),
        importHistory: JSON.parse(localStorage.getItem('bf_import_history') || '[]'),
        // Import staging
        importedHeaders: [],
        importedRows: [],
        companyNameColIndex: -1,
        importFileName: '',
        columnMapping: [], // array of { original: string, mapped: string }
        // Enrich
        selectedForEnrich: new Set(),
        enrichRunning: false,
        enrichAbort: false,
        // Visualize
        selectedForVizDelete: new Set(),
        companyDetailOpen: false,
        currentCompany: null,
        // Utility tabs
        configVisible: false,
        apiCallsVisible: false,
        explorerResponseTab: 'body',
        currentEndpoint: null,
        currentCallDetail: null
    };

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    document.addEventListener('DOMContentLoaded', () => {
        initNavigation();
        initImportTab();
        initEnrichTab();
        initVisualizeTab();
        initApiExplorer();
        initApiCallsTab();
        initConfigTab();
        initThemeToggle();
        updateConnectionStatus();
        renderEnrichCompanyList();
        renderVisualizeTable();
        renderRecentImports();
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
            if (!state.configVisible && state.activeTab === 'config') switchTab('import');
        });

        $('#btnToggleApiCalls').addEventListener('click', () => {
            state.apiCallsVisible = !state.apiCallsVisible;
            $('#apiCallsNavItem').style.display = state.apiCallsVisible ? 'flex' : 'none';
            $('#apiCallsToggleIndicator').classList.toggle('active', state.apiCallsVisible);
            if (!state.apiCallsVisible && state.activeTab === 'api-calls') switchTab('import');
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
            'import': 'Import Companies', enrich: 'Enrich Data',
            visualize: 'Visualize & Export', 'api-explorer': 'API Explorer',
            'api-calls': 'API Calls', config: 'Configuration'
        };
        $('#breadcrumb span').textContent = names[tab] || tab;
        $('#sidebar').classList.remove('open');
        if (tab === 'api-explorer') syncExplorerGlobals();
        if (tab === 'api-calls') renderApiCallsList();
        if (tab === 'enrich') renderEnrichCompanyList();
        if (tab === 'visualize') renderVisualizeTable();
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
    // TAB 1: IMPORT COMPANIES
    // ============================================
    function initImportTab() {
        const dropzone = $('#uploadDropzone');
        const fileInput = $('#fileInput');
        $('#btnBrowseFiles').addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
        dropzone.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) handleFileUpload(e.target.files[0]);
            fileInput.value = '';
        });
        dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); });
        dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag-over'));
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) handleFileUpload(e.dataTransfer.files[0]);
        });

        $$('.upload-type-selector .chip').forEach(chip => {
            chip.addEventListener('click', () => {
                $$('.upload-type-selector .chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                fileInput.setAttribute('accept', chip.dataset.type === 'csv' ? '.csv' : chip.dataset.type === 'excel' ? '.xls,.xlsx' : '.xls,.xlsx,.csv');
            });
        });

        $('#companyNameColumn').addEventListener('change', (e) => {
            state.companyNameColIndex = parseInt(e.target.value);
            updateConfirmButton();
        });

        $('#btnClearImport').addEventListener('click', clearImportStaging);
        $('#btnConfirmImport').addEventListener('click', confirmImport);
    }

    async function handleFileUpload(file) {
        const ext = file.name.split('.').pop().toLowerCase();
        if (!['xlsx', 'xls', 'csv'].includes(ext)) {
            showToast(`Unsupported file type: .${ext}. Use Excel or CSV.`, 'warning');
            return;
        }

        try {
            let headers = [];
            let rows = [];

            if (ext === 'csv') {
                const text = await readFileAsText(file);
                const parsed = parseCSV(text);
                headers = parsed.headers;
                rows = parsed.rows;
            } else {
                const buffer = await file.arrayBuffer();
                const workbook = XLSX.read(buffer, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const json = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                if (json.length > 0) {
                    headers = json[0].map(h => String(h).trim());
                    // Keep any row that has at least one non-empty cell
                    // (handle 0, false, and other falsy-but-valid values)
                    rows = json.slice(1).filter(row =>
                        row.some(cell => cell != null && String(cell).trim() !== '')
                    );
                    // Pad short rows to match header count so column indices align
                    rows = rows.map(row => {
                        while (row.length < headers.length) row.push('');
                        return row;
                    });
                }
            }

            if (headers.length === 0) {
                showToast('No data found in file. Ensure the first row contains headers.', 'warning');
                return;
            }

            state.importedHeaders = headers;
            state.importedRows = rows;
            state.importFileName = file.name;
            state.companyNameColIndex = -1;
            state.columnMapping = headers.map(h => ({ original: h, mapped: h }));

            // Show preview
            $('#importPreviewSection').style.display = 'block';
            $('#importRowCount').textContent = `${rows.length} rows`;
            $('#importColCount').textContent = `${headers.length} columns`;

            // Render column mapping UI
            renderColumnMapping();

            // Populate company name column dropdown (uses mapped names)
            populateCompanyNameDropdown();

            // Auto-detect company name column using ranked matching.
            // Priority: exact matches first, then "starts with", then "contains".
            // This prevents "Parent Company" from winning over "Companies".
            const autoIdx = autoDetectCompanyNameColumn(getMappedHeaders());
            if (autoIdx >= 0) {
                $('#companyNameColumn').value = autoIdx;
                state.companyNameColIndex = autoIdx;
            }

            renderImportPreview();
            updateConfirmButton();
            showToast(`Loaded ${rows.length} rows from ${file.name}`, 'success');
        } catch (err) {
            showToast(`Error reading file: ${err.message}`, 'error');
        }
    }

    /**
     * Auto-detect the company name column from headers using ranked matching.
     * Returns the best column index, or -1 if none found.
     *
     * Priority (first match at highest tier wins):
     *   Tier 1 (exact): header IS one of the target names
     *   Tier 2 (starts with): header starts with a target keyword
     *   Tier 3 (contains): header contains a target keyword
     *
     * Within each tier, leftmost column wins (spreadsheets put names left).
     */
    function autoDetectCompanyNameColumn(headers) {
        // Exact header names that definitively mean "company name"
        const exactMatches = [
            'companies', 'company', 'company name', 'company_name',
            'name', 'firm', 'firm name', 'business name', 'entity',
            'entity name', 'organization', 'portfolio company',
            'target', 'target name', 'issuer', 'borrower'
        ];

        // Tier 1: exact match (case-insensitive, trimmed)
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].toLowerCase().trim();
            if (exactMatches.includes(h)) return i;
        }

        // Tier 2: header starts with a key term
        const startsWithTerms = ['company', 'compan', 'firm', 'business', 'entity', 'organization'];
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].toLowerCase().trim();
            if (startsWithTerms.some(t => h.startsWith(t))) return i;
        }

        // Tier 3: header contains a key term (but not as a qualifier like "Parent Company")
        const containsTerms = ['company name', 'firm name', 'business name', 'entity name'];
        for (let i = 0; i < headers.length; i++) {
            const h = headers[i].toLowerCase().trim();
            if (containsTerms.some(t => h.includes(t))) return i;
        }

        return -1;
    }

    /** Get the current mapped header names */
    function getMappedHeaders() {
        return state.columnMapping.map(m => m.mapped);
    }

    /** Populate the company name dropdown from mapped headers */
    function populateCompanyNameDropdown() {
        const select = $('#companyNameColumn');
        const prevVal = select.value;
        select.innerHTML = '<option value="">-- Select the column containing company names --</option>';
        getMappedHeaders().forEach((h, i) => {
            const opt = document.createElement('option');
            opt.value = i;
            opt.textContent = h;
            select.appendChild(opt);
        });
        // Restore previous selection if still valid
        if (prevVal !== '' && parseInt(prevVal) < state.columnMapping.length) {
            select.value = prevVal;
        }
    }

    /** Render the column mapping grid with editable dropdowns */
    function renderColumnMapping() {
        const grid = $('#columnMappingGrid');
        const section = $('#columnMappingSection');
        if (!grid || !section) return;

        section.style.display = 'block';

        grid.innerHTML = state.columnMapping.map((col, i) => {
            const changed = col.original !== col.mapped;
            const borderStyle = changed ? 'border:1px solid var(--color-brand);' : 'border:1px solid var(--border-color);';
            return `<div class="col-map-item" style="${borderStyle}border-radius:8px;padding:10px;background:var(--bg-main);">
                <div style="font-size:11px;color:var(--text-tertiary);margin-bottom:4px;">Column ${i + 1}: <strong>${escapeHtml(col.original)}</strong></div>
                <input type="text" class="form-control col-map-input" data-idx="${i}" value="${escapeAttr(col.mapped)}" placeholder="Column name" style="font-size:13px;">
                ${changed ? '<div style="font-size:10px;color:var(--color-brand);margin-top:3px;"><i class="fas fa-arrow-right"></i> Renamed from "' + escapeHtml(col.original) + '"</div>' : ''}
            </div>`;
        }).join('');

        grid.querySelectorAll('.col-map-input').forEach(input => {
            input.addEventListener('change', () => {
                const idx = parseInt(input.dataset.idx);
                const newName = input.value.trim();
                if (newName) {
                    state.columnMapping[idx].mapped = newName;
                } else {
                    // Revert to original if cleared
                    state.columnMapping[idx].mapped = state.columnMapping[idx].original;
                    input.value = state.columnMapping[idx].original;
                }
                populateCompanyNameDropdown();
                renderImportPreview();
                renderColumnMapping();
            });
        });
    }

    function renderImportPreview() {
        const container = $('#importPreviewTable');
        const headers = getMappedHeaders();
        const rows = state.importedRows.slice(0, 50); // Preview first 50 rows

        let html = '<table class="preview-table"><thead><tr>';
        html += '<th>#</th>';
        headers.forEach((h, i) => {
            const isRenamed = state.columnMapping[i] && state.columnMapping[i].original !== state.columnMapping[i].mapped;
            const highlight = i === state.companyNameColIndex ? ' style="background:var(--color-brand);color:#fff;"' : (isRenamed ? ' style="color:var(--color-brand);font-style:italic;"' : '');
            html += `<th${highlight}>${escapeHtml(h)}</th>`;
        });
        html += '</tr></thead><tbody>';
        rows.forEach((row, ri) => {
            html += '<tr>';
            html += `<td style="color:var(--text-tertiary);font-size:11px;">${ri + 1}</td>`;
            headers.forEach((_, ci) => {
                const val = row[ci] != null ? String(row[ci]) : '';
                const highlight = ci === state.companyNameColIndex ? ' style="font-weight:600;color:var(--color-brand);"' : '';
                html += `<td${highlight}>${escapeHtml(val)}</td>`;
            });
            html += '</tr>';
        });
        html += '</tbody></table>';
        if (state.importedRows.length > 50) {
            html += `<div style="padding:8px;text-align:center;font-size:12px;color:var(--text-tertiary);">Showing first 50 of ${state.importedRows.length} rows</div>`;
        }
        container.innerHTML = html;
    }

    function updateConfirmButton() {
        const btn = $('#btnConfirmImport');
        const nameCol = state.companyNameColIndex;
        const valid = nameCol >= 0 && state.importedRows.length > 0;
        // Count rows that actually have a value in the company name column
        const importableCount = valid
            ? state.importedRows.filter(row => {
                const val = Array.isArray(row) ? row[nameCol] : null;
                return val != null && String(val).trim() !== '';
            }).length
            : 0;
        btn.disabled = importableCount === 0;
        $('#confirmImportCount').textContent = importableCount;
    }

    function confirmImport() {
        if (state.companyNameColIndex < 0 || state.importedRows.length === 0) return;

        const headers = getMappedHeaders();
        const nameCol = state.companyNameColIndex;
        const newCompanies = [];
        let skipped = 0;

        for (let idx = 0; idx < state.importedRows.length; idx++) {
            const row = state.importedRows[idx];

            // Safely extract the company name — handle sparse rows,
            // numeric values, and cells that may be undefined
            let rawName = null;
            if (Array.isArray(row)) {
                rawName = nameCol < row.length ? row[nameCol] : null;
            } else if (row && typeof row === 'object') {
                // In case rows are objects keyed by header
                rawName = row[headers[nameCol]] || row[state.importedHeaders[nameCol]];
            }

            // Convert to string — handle numbers, 0, booleans
            const name = (rawName != null && rawName !== '') ? String(rawName).trim() : '';
            if (!name) {
                skipped++;
                continue;
            }

            // Store ALL columns (including the name column) as the full row record
            const fullRowData = {};
            headers.forEach((h, ci) => {
                const cellVal = Array.isArray(row) ? row[ci] : row[h];
                if (cellVal != null && String(cellVal).trim() !== '') {
                    fullRowData[h] = String(cellVal).trim();
                }
            });

            // originalData excludes the name column (for display purposes)
            const originalData = {};
            headers.forEach((h, ci) => {
                if (ci !== nameCol) {
                    const cellVal = Array.isArray(row) ? row[ci] : row[h];
                    if (cellVal != null && String(cellVal).trim() !== '') {
                        originalData[h] = String(cellVal).trim();
                    }
                }
            });

            newCompanies.push({
                id: generateId(),
                name: name,
                fullRowData: fullRowData,
                originalData: originalData,
                enrichedData: {},
                enrichStatus: 'pending',
                enrichCallId: null,
                importedAt: new Date().toISOString(),
                enrichedAt: null,
                source: state.importFileName
            });
        }

        if (skipped > 0) {
            showToast(`${skipped} rows skipped (empty company name)`, 'warning');
        }

        // Append to existing companies
        state.companies = state.companies.concat(newCompanies);
        saveCompanies();

        // Record import history
        state.importHistory.unshift({
            id: generateId(),
            fileName: state.importFileName,
            rowCount: newCompanies.length,
            time: new Date().toISOString()
        });
        if (state.importHistory.length > 20) state.importHistory = state.importHistory.slice(0, 20);
        localStorage.setItem('bf_import_history', JSON.stringify(state.importHistory));

        clearImportStaging();
        renderRecentImports();
        showToast(`Imported ${newCompanies.length} companies from ${state.importFileName}`, 'success');
    }

    function clearImportStaging() {
        state.importedHeaders = [];
        state.importedRows = [];
        state.companyNameColIndex = -1;
        state.importFileName = '';
        state.columnMapping = [];
        $('#importPreviewSection').style.display = 'none';
        $('#importPreviewTable').innerHTML = '';
        $('#companyNameColumn').innerHTML = '<option value="">-- Select the column containing company names --</option>';
        const mappingSection = $('#columnMappingSection');
        if (mappingSection) mappingSection.style.display = 'none';
    }

    function renderRecentImports() {
        const container = $('#recentImports');
        if (state.importHistory.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-clock"></i><p>No recent imports</p></div>';
            return;
        }
        container.innerHTML = state.importHistory.slice(0, 10).map(h =>
            `<div class="submission-item"><span class="submission-status status-dot connected"></span><div class="submission-info"><div class="submission-name">${escapeHtml(h.fileName)}</div><div class="submission-time">${getTimeAgo(h.time)} · ${h.rowCount} companies</div></div></div>`
        ).join('');
    }

    // ============================================
    // TAB 2: ENRICH DATA
    // ============================================
    function initEnrichTab() {
        $('#btnSelectAllEnrich').addEventListener('click', () => {
            state.companies.filter(c => c.enrichStatus !== 'enriched').forEach(c => state.selectedForEnrich.add(c.id));
            renderEnrichCompanyList();
            updateEnrichButton();
        });
        $('#btnDeselectAllEnrich').addEventListener('click', () => {
            state.selectedForEnrich.clear();
            renderEnrichCompanyList();
            updateEnrichButton();
        });
        $('#btnStartEnrichment').addEventListener('click', startEnrichment);
        $('#btnStopEnrichment').addEventListener('click', () => { state.enrichAbort = true; });
        $('#btnBulkDeleteEnrich').addEventListener('click', () => {
            const count = state.selectedForEnrich.size;
            if (count === 0) return;
            if (!confirm(`Delete ${count} selected company${count > 1 ? 'ies' : ''}?`)) return;
            state.selectedForEnrich.forEach(id => {
                state.companies = state.companies.filter(c => c.id !== id);
            });
            state.selectedForEnrich.clear();
            saveCompanies();
            renderEnrichCompanyList();
            renderVisualizeTable();
            showToast(`${count} company${count > 1 ? 'ies' : ''} deleted`, 'info');
        });
    }

    function renderEnrichCompanyList() {
        const container = $('#enrichCompanyList');
        if (state.companies.length === 0) {
            container.innerHTML = '<div class="empty-state small"><i class="fas fa-file-import"></i><p>No companies imported yet. Go to Import tab first.</p></div>';
            updateEnrichButton();
            return;
        }

        container.innerHTML = state.companies.map(c => {
            const checked = state.selectedForEnrich.has(c.id) ? 'checked' : '';
            const sel = state.selectedForEnrich.has(c.id) ? 'selected' : '';
            const statusBadge = getEnrichStatusBadge(c.enrichStatus);
            const existingKeys = Object.keys(c.originalData).slice(0, 3).join(', ');
            return `<div class="export-selection-item ${sel}" data-id="${c.id}">
                <input type="checkbox" ${checked} data-id="${c.id}">
                <div style="flex:1;">
                    <div style="font-weight:600;font-size:13px;">${escapeHtml(c.name)}</div>
                    <div style="font-size:11px;color:var(--text-tertiary);">${existingKeys ? 'Has: ' + escapeHtml(existingKeys) + (Object.keys(c.originalData).length > 3 ? '...' : '') : 'No existing data'} · ${statusBadge}</div>
                </div>
                <button class="btn-icon btn-delete-enrich" data-id="${c.id}" title="Delete company"><i class="fas fa-trash-alt"></i></button>
            </div>`;
        }).join('');

        container.querySelectorAll('.export-selection-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-enrich')) return;
                const id = item.dataset.id;
                if (state.selectedForEnrich.has(id)) state.selectedForEnrich.delete(id);
                else state.selectedForEnrich.add(id);
                renderEnrichCompanyList();
                updateEnrichButton();
            });
        });

        container.querySelectorAll('.btn-delete-enrich').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const company = state.companies.find(c => c.id === btn.dataset.id);
                if (company && confirm(`Delete "${company.name}"?`)) {
                    deleteCompany(btn.dataset.id);
                }
            });
        });

        updateEnrichButton();
    }

    function updateEnrichButton() {
        const btn = $('#btnStartEnrichment');
        btn.disabled = state.selectedForEnrich.size === 0 || state.enrichRunning;
        if (!state.enrichRunning) {
            btn.innerHTML = `<i class="fas fa-rocket"></i> Start Enrichment (${state.selectedForEnrich.size})`;
        }
        // Show/hide bulk delete
        const bulkBtn = $('#btnBulkDeleteEnrich');
        if (bulkBtn) {
            bulkBtn.style.display = state.selectedForEnrich.size > 0 ? 'inline-flex' : 'none';
            bulkBtn.innerHTML = `<i class="fas fa-trash-alt"></i> Delete Selected (${state.selectedForEnrich.size})`;
        }
    }

    /**
     * Get the company name to send to @perplexity.
     * Uses company.name — the value from the Company Name Column
     * the user explicitly selected during import.
     * Validates it's a real company name (not a number/ID).
     * Returns null if validation fails so the record is skipped.
     */
    function resolveCompanyName(company) {
        if (looksLikeCompanyName(company.name)) return company.name;
        return null;
    }

    /**
     * Returns true if a value looks like a real company name.
     * A company name:
     *   - Contains at least one letter (not purely numeric)
     *   - Is at least 2 characters long
     *   - Is not a pure number, date, currency amount, or ID
     *   - Is not an email address or URL
     */
    function looksLikeCompanyName(v) {
        if (!v || typeof v !== 'string') return false;
        const s = v.trim();
        if (s.length < 2) return false;
        // Must contain at least one letter
        if (!/[a-zA-Z]/.test(s)) return false;
        // Reject pure numbers with optional formatting ($, commas, %, etc.)
        if (/^[\s$€£¥]*[-+]?[\d,]+\.?\d*%?\s*$/.test(s)) return false;
        // Reject dates (MM/DD/YYYY, YYYY-MM-DD, etc.)
        if (/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,4}$/.test(s)) return false;
        // Reject email addresses
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return false;
        // Reject URLs
        if (/^https?:\/\//i.test(s)) return false;
        // Reject values that are mostly digits (e.g. "ID12345", "239324A")
        const digitCount = (s.match(/\d/g) || []).length;
        const letterCount = (s.match(/[a-zA-Z]/g) || []).length;
        if (digitCount > 0 && digitCount > letterCount * 2) return false;
        return true;
    }

    async function startEnrichment() {
        if (state.selectedForEnrich.size === 0) return;
        if (!client.isConfigured()) {
            showToast('Please configure API credentials in the Configuration tab first.', 'warning');
            return;
        }

        state.enrichRunning = true;
        state.enrichAbort = false;
        const btn = $('#btnStartEnrichment');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Enriching...';
        $('#btnStopEnrichment').style.display = 'block';
        $('#enrichProgressBadge').textContent = 'Running...';
        $('#enrichProgressBadge').className = 'badge info';

        const pollLog = $('#enrichPollLog');
        pollLog.innerHTML = '';

        const companiesToEnrich = state.companies.filter(c => state.selectedForEnrich.has(c.id));
        let successCount = 0;
        let failCount = 0;

        for (let i = 0; i < companiesToEnrich.length; i++) {
            if (state.enrichAbort) {
                addEnrichLog('fa-stop', `Enrichment stopped by user after ${i} companies.`, 'poll-warning');
                break;
            }

            const company = companiesToEnrich[i];
            try {
                // Logically determine the company name from the full row record
                const companyName = resolveCompanyName(company);

                if (!companyName) {
                    addEnrichLog('fa-exclamation-triangle', `[${i + 1}/${companiesToEnrich.length}] Skipped: "${company.name}" — could not determine a valid company name (value looks like a number or ID)`, 'poll-warning');
                    company.enrichStatus = 'failed';
                    failCount++;
                    saveCompanies();
                    continue;
                }

                addEnrichLog('fa-building', `[${i + 1}/${companiesToEnrich.length}] Enriching: ${companyName}${companyName !== company.name ? ' (resolved from row)' : ''}...`, '');

                const message = `@Perplexity give me the details for ${companyName} including Description, Industry, Headquarters, Employees, Revenue, Founded, Website, Executives, Ownership`;

                // Send via /functions/llm/model with model: "perplexity"
                const postResult = await client.sendLLMRequestModel('perplexity', message);

                if (!postResult.ok) {
                    throw new Error(`API error: ${postResult.status} ${postResult.statusText}`);
                }

                const callId = client._extractCallId(postResult.data);
                company.enrichCallId = callId;

                if (callId) {
                    addEnrichLog('fa-satellite-dish', `Polling status for ${company.name} (call_id: ${callId})...`, 'poll-info');

                    const statusResult = await client.pollStatus(callId, (update) => {
                        addEnrichLog('fa-sync-alt', `${company.name}: Poll #${update.attempt} — ${update.status || 'pending'}`, 'poll-info');
                    });

                    if (statusResult && (statusResult.ok || statusResult.data?.output != null)) {
                        const output = statusResult.data?.output;
                        const enriched = parseEnrichmentOutput(output);

                        if (enriched && Object.keys(enriched).length > 0) {
                            company.enrichedData = enriched;
                            company.enrichStatus = 'enriched';
                            company.enrichedAt = new Date().toISOString();
                            successCount++;
                            addEnrichLog('fa-check-circle', `${company.name}: Enriched successfully (${Object.keys(enriched).length} fields)`, 'poll-success');
                        } else {
                            company.enrichStatus = 'failed';
                            failCount++;
                            addEnrichLog('fa-exclamation-triangle', `${company.name}: Could not parse enrichment data`, 'poll-warning');
                        }
                    } else {
                        company.enrichStatus = 'failed';
                        failCount++;
                        addEnrichLog('fa-times-circle', `${company.name}: Polling timeout or error`, 'poll-error');
                    }
                } else {
                    // Try to parse inline response
                    const inlineOutput = postResult.data?.output || postResult.data?.message || postResult.data?.text || postResult.data?.response;
                    if (inlineOutput) {
                        const enriched = parseEnrichmentOutput(inlineOutput);
                        if (enriched && Object.keys(enriched).length > 0) {
                            company.enrichedData = enriched;
                            company.enrichStatus = 'enriched';
                            company.enrichedAt = new Date().toISOString();
                            successCount++;
                            addEnrichLog('fa-check-circle', `${company.name}: Enriched from inline response`, 'poll-success');
                        } else {
                            company.enrichStatus = 'failed';
                            failCount++;
                            addEnrichLog('fa-exclamation-triangle', `${company.name}: No call_id and could not parse inline response`, 'poll-warning');
                        }
                    } else {
                        company.enrichStatus = 'failed';
                        failCount++;
                        addEnrichLog('fa-info-circle', `${company.name}: No call_id returned`, 'poll-warning');
                    }
                }

                saveCompanies();
            } catch (err) {
                company.enrichStatus = 'failed';
                failCount++;
                addEnrichLog('fa-times-circle', `${company.name}: Error — ${err.message}`, 'poll-error');
                saveCompanies();
            }
        }

        // Done
        state.enrichRunning = false;
        state.enrichAbort = false;
        state.selectedForEnrich.clear();
        btn.disabled = false;
        btn.innerHTML = `<i class="fas fa-rocket"></i> Start Enrichment (0)`;
        $('#btnStopEnrichment').style.display = 'none';
        $('#enrichProgressBadge').textContent = `Done: ${successCount} enriched, ${failCount} failed`;
        $('#enrichProgressBadge').className = failCount === 0 ? 'badge success' : 'badge warning';
        addEnrichLog('fa-flag-checkered', `Enrichment complete. ${successCount} enriched, ${failCount} failed.`, 'poll-success');
        renderEnrichCompanyList();
        showToast(`Enrichment complete: ${successCount} enriched, ${failCount} failed`, successCount > 0 ? 'success' : 'warning');
    }

    function addEnrichLog(icon, text, cls) {
        const log = $('#enrichPollLog');
        const entry = document.createElement('div');
        entry.className = 'status-poll-entry' + (cls ? ' ' + cls : '');
        entry.innerHTML = `<i class="fas ${icon}"></i> <span>${text}</span> <span class="poll-time">${new Date().toLocaleTimeString()}</span>`;
        log.appendChild(entry);
        log.scrollTop = log.scrollHeight;
    }

    /** Schema fields we expect from the @perplexity LLM response */
    const ENRICH_SCHEMA = {
        'Company Description': ['company_description', 'description', 'company description', 'overview', 'summary', 'about'],
        'Industry / Sector': ['industry_sector', 'industry / sector', 'industry', 'sector', 'industry/sector', 'vertical'],
        'Headquarters': ['headquarters', 'hq', 'head_quarters', 'location', 'hq_location', 'address', 'city'],
        'Employee Count': ['employee_count', 'employees', 'employee count', 'headcount', 'num_employees', 'number_of_employees', 'team_size'],
        'Revenue Estimate': ['revenue_estimate', 'revenue estimate', 'revenue', 'annual_revenue', 'estimated_revenue', 'revenue_range'],
        'Founded Year': ['founded_year', 'founded year', 'founded', 'year_founded', 'founding_year', 'established'],
        'Website': ['website', 'url', 'web', 'homepage', 'domain', 'company_url'],
        'Key Executives': ['key_executives', 'key executives', 'executives', 'leadership', 'management', 'ceo', 'founders', 'key_people'],
        'Ownership Type': ['ownership_type', 'ownership type', 'ownership', 'company_type', 'type', 'structure', 'entity_type']
    };

    /**
     * Parse enrichment output from the @Perplexity LLM response.
     * Tries JSON first, then falls back to markdown/text extraction.
     */
    function parseEnrichmentOutput(output) {
        if (output == null) return null;

        // If object, unwrap nested message/text/response
        let raw = output;
        if (typeof raw === 'object' && raw !== null) {
            raw = raw.output || raw.message || raw.text || raw.response || raw.answer || JSON.stringify(raw);
        }
        if (typeof raw !== 'string') raw = String(raw);

        // Try 1: JSON parsing with schema mapping
        const jsonData = extractJsonFromString(raw);
        if (jsonData && typeof jsonData === 'object' && !Array.isArray(jsonData)) {
            const mapped = mapJsonToSchema(jsonData);
            if (mapped && Object.keys(mapped).length > 0) return mapped;
        }

        // Try 2: Extract structured data from markdown/text response
        return parseMarkdownResponse(raw);
    }

    /** Map a JSON object's keys to our ENRICH_SCHEMA */
    function mapJsonToSchema(data) {
        const result = {};
        const dataLower = {};
        for (const [k, v] of Object.entries(data)) {
            dataLower[k.toLowerCase().trim()] = v;
        }
        for (const [schemaField, aliases] of Object.entries(ENRICH_SCHEMA)) {
            for (const alias of aliases) {
                if (dataLower[alias] != null) {
                    const val = dataLower[alias];
                    result[schemaField] = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    break;
                }
            }
            if (!result[schemaField]) {
                for (const [dataKey, dataVal] of Object.entries(dataLower)) {
                    if (aliases.some(a => dataKey.includes(a) || a.includes(dataKey)) && dataVal != null) {
                        result[schemaField] = typeof dataVal === 'object' ? JSON.stringify(dataVal) : String(dataVal);
                        break;
                    }
                }
            }
        }
        return Object.keys(result).length > 0 ? result : null;
    }

    /**
     * Extract structured fields from a markdown/text response.
     * Looks for **Bold Label:** Value patterns and maps them to our schema.
     */
    function parseMarkdownResponse(text) {
        if (!text || text.length < 20) return null;
        const result = {};

        // Markdown extraction patterns for each schema field
        const fieldPatterns = {
            'Company Description': [
                // First paragraph after the title (often the description)
                /\n\n([A-Z][^#*\n]{30,300})/,
                /(?:description|overview|about)[:\s]*\*?\*?\s*(.{20,500}?)(?:\n\n|\n-|\n\*)/i
            ],
            'Industry / Sector': [
                /(?:specialt|industr|sector|services?)[yies]*[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i,
                /practice encompasses[^,]*(?:including|such as)\s+(.+?)(?:\.|$)/i
            ],
            'Headquarters': [
                /(?:location|address|office|headquart|situated at|located at)[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i,
                /(\d+[^,\n]*(?:St|Ave|Blvd|Rd|Dr|Way|Ln)[^,\n]*,\s*[A-Z][^,\n]*,\s*[A-Z]{2}\s+\d{5})/
            ],
            'Employee Count': [
                /(?:employee|headcount|staff|team size)[s]?[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i
            ],
            'Revenue Estimate': [
                /(?:revenue|financial)[s]?[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i,
                /total revenues?\s+of\s+(\$[\d,.]+)/i,
                /revenues?\s*(?:of|:)\s*(\$[\d,.]+\s*(?:million|billion|M|B)?)/i
            ],
            'Founded Year': [
                /(?:established|founded|filed)[:\s]*\*?\*?\s*(?:in|on)?\s*(.+?)(?:\n|$)/i,
                /established in\s+(\w+\s+\d{4})/i,
                /filed on\s+(\w+\s+\d+,?\s*\d{4})/i
            ],
            'Website': [
                /(?:website|web|homepage|url)[:\s]*\*?\*?\s*\[?([^\]\s\n]+)/i,
                /(https?:\/\/(?:www\.)?[^\s\)\]"<>]+)/i
            ],
            'Key Executives': [
                /(?:leadership|ceo|executive|management|chief)[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i,
                /([A-Z][a-z]+\s+[A-Z][a-z]+)\s+serves?\s+as\s+(?:the\s+)?(.+?)(?:\.|$)/i
            ],
            'Ownership Type': [
                /(?:legal structure|ownership|tax status|entity type|registered as)[:\s]*\*?\*?\s*(.+?)(?:\n|$)/i,
                /registered as (?:a |an )?(.+?)(?:\s+under|\.|,)/i,
                /501\(c\)\(3\)[^\n]*/i
            ]
        };

        for (const [field, patterns] of Object.entries(fieldPatterns)) {
            for (const regex of patterns) {
                const match = text.match(regex);
                if (match) {
                    let val = (match[2] ? `${match[1]} — ${match[2]}` : match[1] || match[0]).trim();
                    // Clean up markdown formatting
                    val = val.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/<[^>]+>/g, '').trim();
                    if (val.length > 2 && val.length < 500) {
                        result[field] = val;
                        break;
                    }
                }
            }
        }

        return Object.keys(result).length > 0 ? result : null;
    }

    function getEnrichStatusBadge(status) {
        const m = {
            enriched: '<span class="badge success">Enriched</span>',
            pending: '<span class="badge">Pending</span>',
            failed: '<span class="badge danger">Failed</span>'
        };
        return m[status] || '<span class="badge">Unknown</span>';
    }

    // ============================================
    // TAB 3: VISUALIZE & EXPORT
    // ============================================
    function initVisualizeTab() {
        $('#vizSearch').addEventListener('input', renderVisualizeTable);
        $('#vizStatusFilter').addEventListener('change', renderVisualizeTable);
        $('#btnExportExcel').addEventListener('click', () => exportCompanies('xlsx'));
        $('#btnExportCsv').addEventListener('click', () => exportCompanies('csv'));
        $('#btnExportJson').addEventListener('click', () => exportCompanies('json'));
        $('#btnCloseCompanyDetail').addEventListener('click', () => {
            $('#companyDetailPanel').classList.remove('open');
            state.companyDetailOpen = false;
            state.currentCompany = null;
        });
        $('#btnBulkDeleteViz').addEventListener('click', () => {
            const count = state.selectedForVizDelete.size;
            if (count === 0) return;
            if (!confirm(`Delete ${count} selected company${count > 1 ? 'ies' : ''}?`)) return;
            state.selectedForVizDelete.forEach(id => {
                state.companies = state.companies.filter(c => c.id !== id);
            });
            state.selectedForVizDelete.clear();
            saveCompanies();
            renderVisualizeTable();
            renderEnrichCompanyList();
            showToast(`${count} company${count > 1 ? 'ies' : ''} deleted`, 'info');
        });
    }

    function updateVizBulkDelete() {
        const btn = $('#btnBulkDeleteViz');
        if (btn) {
            btn.style.display = state.selectedForVizDelete.size > 0 ? 'inline-flex' : 'none';
            $('#vizDeleteCount').textContent = state.selectedForVizDelete.size;
        }
    }

    function renderVisualizeTable() {
        const container = $('#vizTableContainer');
        const search = ($('#vizSearch')?.value || '').toLowerCase();
        const statusFilter = $('#vizStatusFilter')?.value || 'all';

        let filtered = state.companies.filter(c => {
            if (search && !c.name.toLowerCase().includes(search)) {
                // Also search in original and enriched data
                const allVals = Object.values(c.originalData).concat(Object.values(c.enrichedData)).join(' ').toLowerCase();
                if (!allVals.includes(search)) return false;
            }
            if (statusFilter !== 'all' && c.enrichStatus !== statusFilter) return false;
            return true;
        });

        // Clean up stale selections
        state.selectedForVizDelete.forEach(id => {
            if (!state.companies.find(c => c.id === id)) state.selectedForVizDelete.delete(id);
        });

        $('#vizCompanyCount').textContent = `${filtered.length} companies`;
        updateVizBulkDelete();

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state"><i class="fas fa-table"></i><h3>No Company Data</h3><p>Import and enrich companies to see them here</p><button class="btn btn-primary" data-goto="import"><i class="fas fa-file-import"></i> Import Companies</button></div>';
            return;
        }

        // Gather all unique column keys
        const colSet = new Set();
        filtered.forEach(c => {
            Object.keys(c.originalData).forEach(k => colSet.add(k));
            Object.keys(c.enrichedData).forEach(k => colSet.add(k));
        });
        const columns = Array.from(colSet);

        const allChecked = filtered.length > 0 && filtered.every(c => state.selectedForVizDelete.has(c.id));

        let html = '<table class="preview-table"><thead><tr>';
        html += `<th style="position:sticky;left:0;z-index:2;background:var(--bg-card);width:32px;"><input type="checkbox" id="vizSelectAll" ${allChecked ? 'checked' : ''} title="Select all"></th>`;
        html += '<th style="position:sticky;left:32px;z-index:2;background:var(--bg-card);min-width:180px;">Company Name</th>';
        html += '<th>Status</th>';
        columns.forEach(col => {
            html += `<th>${escapeHtml(col)}</th>`;
        });
        html += '<th style="text-align:center;">Actions</th>';
        html += '</tr></thead><tbody>';

        filtered.forEach((c, idx) => {
            const statusBadge = getEnrichStatusBadge(c.enrichStatus);
            const rowChecked = state.selectedForVizDelete.has(c.id) ? 'checked' : '';
            html += `<tr class="viz-company-row" data-id="${c.id}" style="cursor:pointer;">`;
            html += `<td style="position:sticky;left:0;background:var(--bg-card);"><input type="checkbox" class="viz-row-check" data-id="${c.id}" ${rowChecked}></td>`;
            html += `<td style="position:sticky;left:32px;background:var(--bg-card);font-weight:600;">${escapeHtml(c.name)}</td>`;
            html += `<td>${statusBadge}</td>`;
            columns.forEach(col => {
                // Enriched data takes priority, fall back to original
                const val = c.enrichedData[col] != null ? c.enrichedData[col] : (c.originalData[col] || '');
                const displayVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                const isEnriched = c.enrichedData[col] != null;
                const style = isEnriched ? 'color:var(--color-brand);' : '';
                html += `<td style="${style}">${escapeHtml(displayVal)}</td>`;
            });
            html += `<td style="text-align:center;"><button class="btn-icon btn-delete-viz" data-id="${c.id}" title="Delete company"><i class="fas fa-trash-alt"></i></button></td>`;
            html += '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;

        // Select-all checkbox
        const selectAllCb = container.querySelector('#vizSelectAll');
        if (selectAllCb) {
            selectAllCb.addEventListener('change', (e) => {
                e.stopPropagation();
                if (selectAllCb.checked) {
                    filtered.forEach(c => state.selectedForVizDelete.add(c.id));
                } else {
                    filtered.forEach(c => state.selectedForVizDelete.delete(c.id));
                }
                // Update row checkboxes without full re-render
                container.querySelectorAll('.viz-row-check').forEach(cb => { cb.checked = selectAllCb.checked; });
                updateVizBulkDelete();
            });
        }

        // Row checkboxes
        container.querySelectorAll('.viz-row-check').forEach(cb => {
            cb.addEventListener('change', (e) => {
                e.stopPropagation();
                const id = cb.dataset.id;
                if (cb.checked) state.selectedForVizDelete.add(id);
                else state.selectedForVizDelete.delete(id);
                // Sync select-all state
                if (selectAllCb) selectAllCb.checked = filtered.every(c => state.selectedForVizDelete.has(c.id));
                updateVizBulkDelete();
            });
            cb.addEventListener('click', (e) => e.stopPropagation());
        });

        // Click row to open detail (but not when clicking delete or checkbox)
        container.querySelectorAll('.viz-company-row').forEach(row => {
            row.addEventListener('click', (e) => {
                if (e.target.closest('.btn-delete-viz') || e.target.closest('input[type="checkbox"]')) return;
                const company = state.companies.find(c => c.id === row.dataset.id);
                if (company) openCompanyDetail(company);
            });
        });

        // Delete buttons in table
        container.querySelectorAll('.btn-delete-viz').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const company = state.companies.find(c => c.id === btn.dataset.id);
                if (company && confirm(`Delete "${company.name}"?`)) {
                    deleteCompany(btn.dataset.id);
                }
            });
        });
    }

    function openCompanyDetail(company) {
        state.currentCompany = company;
        state.companyDetailOpen = true;
        $('#companyDetailTitle').textContent = company.name;
        $('#companyDetailPanel').classList.add('open');

        let html = '<div class="summary-grid">';
        html += `<div class="summary-item"><label>Company Name</label><div class="value">${escapeHtml(company.name)}</div></div>`;
        html += `<div class="summary-item"><label>Status</label><div class="value">${getEnrichStatusBadge(company.enrichStatus)}</div></div>`;
        html += `<div class="summary-item"><label>Source File</label><div class="value">${escapeHtml(company.source || '—')}</div></div>`;
        html += `<div class="summary-item"><label>Imported</label><div class="value">${company.importedAt ? new Date(company.importedAt).toLocaleString() : '—'}</div></div>`;
        html += `<div class="summary-item"><label>Enriched</label><div class="value">${company.enrichedAt ? new Date(company.enrichedAt).toLocaleString() : '—'}</div></div>`;
        if (company.enrichCallId) {
            html += `<div class="summary-item"><label>Call ID</label><div class="value text-muted" style="font-size:11px;word-break:break-all;">${company.enrichCallId}</div></div>`;
        }
        html += '</div>';

        // Original data
        if (Object.keys(company.originalData).length > 0) {
            html += '<h4 style="margin:16px 0 8px;"><i class="fas fa-file-import"></i> Original Data</h4>';
            html += '<table class="preview-table"><tbody>';
            Object.entries(company.originalData).forEach(([k, v]) => {
                html += `<tr><td style="font-weight:600;width:200px;">${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`;
            });
            html += '</tbody></table>';
        }

        // Enriched data
        if (Object.keys(company.enrichedData).length > 0) {
            html += '<h4 style="margin:16px 0 8px;color:var(--color-brand);"><i class="fas fa-magic"></i> Enriched Data</h4>';
            html += '<table class="preview-table"><tbody>';
            Object.entries(company.enrichedData).forEach(([k, v]) => {
                const displayVal = typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v ?? '—');
                html += `<tr><td style="font-weight:600;width:200px;color:var(--color-brand);">${escapeHtml(k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</td><td>${escapeHtml(displayVal)}</td></tr>`;
            });
            html += '</tbody></table>';
        }

        // Delete button
        html += `<div style="margin-top:20px;"><button class="btn btn-danger btn-sm" id="btnDeleteCompany"><i class="fas fa-trash"></i> Delete Company</button></div>`;

        $('#companyDetailBody').innerHTML = html;

        $('#btnDeleteCompany')?.addEventListener('click', () => {
            if (confirm(`Delete "${company.name}"?`)) {
                state.companies = state.companies.filter(c => c.id !== company.id);
                saveCompanies();
                $('#companyDetailPanel').classList.remove('open');
                renderVisualizeTable();
                renderEnrichCompanyList();
                showToast('Company deleted', 'info');
            }
        });
    }

    function exportCompanies(format) {
        const search = ($('#vizSearch')?.value || '').toLowerCase();
        const statusFilter = $('#vizStatusFilter')?.value || 'all';

        let filtered = state.companies.filter(c => {
            if (search && !c.name.toLowerCase().includes(search)) return false;
            if (statusFilter !== 'all' && c.enrichStatus !== statusFilter) return false;
            return true;
        });

        if (filtered.length === 0) {
            showToast('No companies to export', 'warning');
            return;
        }

        // Build flat rows with all columns
        const colSet = new Set();
        filtered.forEach(c => {
            Object.keys(c.originalData).forEach(k => colSet.add(k));
            Object.keys(c.enrichedData).forEach(k => colSet.add(k));
        });
        const columns = Array.from(colSet);

        const rows = filtered.map(c => {
            const row = { 'Company Name': c.name, 'Enrich Status': c.enrichStatus };
            columns.forEach(col => {
                const val = c.enrichedData[col] != null ? c.enrichedData[col] : (c.originalData[col] || '');
                row[col] = typeof val === 'object' ? JSON.stringify(val) : val;
            });
            return row;
        });

        if (format === 'json') {
            const content = JSON.stringify(rows, null, 2);
            downloadFile(content, 'application/json', `blueflame-companies-${dateStamp()}.json`);
            showToast('JSON exported', 'success');
        } else if (format === 'csv') {
            const allCols = ['Company Name', 'Enrich Status', ...columns];
            let csv = allCols.map(c => `"${c}"`).join(',') + '\n';
            rows.forEach(r => {
                csv += allCols.map(c => `"${String(r[c] || '').replace(/"/g, '""')}"`).join(',') + '\n';
            });
            downloadFile(csv, 'text/csv', `blueflame-companies-${dateStamp()}.csv`);
            showToast('CSV exported', 'success');
        } else if (format === 'xlsx') {
            // Use SheetJS to create a real Excel file
            const allCols = ['Company Name', 'Enrich Status', ...columns];
            const wsData = [allCols];
            rows.forEach(r => {
                wsData.push(allCols.map(c => r[c] || ''));
            });
            const ws = XLSX.utils.aoa_to_sheet(wsData);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Companies');
            XLSX.writeFile(wb, `blueflame-companies-${dateStamp()}.xlsx`);
            showToast('Excel file exported', 'success');
        }
    }

    // ============================================
    // API EXPLORER — Postman-style (unchanged)
    // ============================================
    function initApiExplorer() {
        renderApiCategories();
        syncExplorerGlobals();

        $('#btnSendRequest').addEventListener('click', sendApiRequest);

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

        const headersEditor = $('#headersEditor');
        headersEditor.innerHTML = '';
        (ep.headers || []).forEach(h => {
            addKvRow('headersEditor', h.key, h.value, h.enabled !== false, h.description || '');
        });
        updateHeaderCount();

        $('#paramsEditor').innerHTML = '';

        if (ep.method === 'GET') {
            document.querySelector('input[name="bodyType"][value="none"]').checked = true;
        } else {
            document.querySelector('input[name="bodyType"][value="json"]').checked = true;
        }

        $('#autoStatusEnabled').checked = ep.autoStatus !== false;
        syncExplorerGlobals();

        $('#apiResponse').innerHTML = '<pre><code>// Click "Send" to execute this request</code></pre>';
        $('#apiResponseHeaders').innerHTML = '<pre><code>// Response headers will appear here</code></pre>';
        $('#apiResponseStatusResult').innerHTML = '<pre><code>// Auto-status polling result will appear here after POST requests</code></pre>';
        $('#responseMeta').innerHTML = '';
        $('#explorerAutoStatusLog').innerHTML = '<div class="empty-state small"><i class="fas fa-satellite-dish"></i><p>Status polling log will appear here after a POST request</p></div>';

        $$('.explorer-tab').forEach(t => t.classList.toggle('active', t.dataset.explorerTab === 'headers'));
        $$('.explorer-tab-content').forEach(c => c.style.display = 'none');
        $('#explorerTabHeaders').style.display = 'block';
    }

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

    async function sendApiRequest() {
        const method = $('#apiMethod').value;
        let url = $('#apiUrl').value;
        const bodyType = document.querySelector('input[name="bodyType"]:checked')?.value || 'json';
        let body = bodyType === 'none' ? null : $('#apiBodyContent').value;

        if (!url) { showToast('Please enter a URL', 'warning'); return; }

        url = resolveTemplateVars(url);
        url += buildQueryString();
        if (body) body = resolveTemplateVars(body);

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

        const result = await client.sendRawRequest(method, url, headers, body || null, autoStatusEnabled);

        btn.disabled = false;
        btn.innerHTML = '<i class="fas fa-play"></i> Send';

        const meta = $('#responseMeta');
        meta.innerHTML = result.ok
            ? `<span class="status-ok">${result.status} ${result.statusText}</span> · ${result.elapsed}ms`
            : `<span class="status-err">${result.status} ${result.statusText}</span> · ${result.elapsed}ms`;

        const responseStr = typeof result.data === 'object' ? JSON.stringify(result.data, null, 2) : String(result.data);
        $('#apiResponse').innerHTML = `<pre><code>${escapeHtml(responseStr)}</code></pre>`;

        if (result.headers && Object.keys(result.headers).length > 0) {
            const hdrStr = Object.entries(result.headers).map(([k, v]) => `${k}: ${v}`).join('\n');
            $('#apiResponseHeaders').innerHTML = `<pre><code>${escapeHtml(hdrStr)}</code></pre>`;
        }

        if (autoStatusEnabled && method === 'POST' && result.ok) {
            const callId = result.callId || client._extractCallId(result.data);
            if (callId) {
                const pollInterval = parseInt($('#autoStatusInterval').value) || 3000;
                const maxRetries = parseInt($('#autoStatusMaxRetries').value) || 20;
                client.statusPollInterval = pollInterval;
                client.statusPollMaxRetries = maxRetries;

                $$('.response-tab').forEach(t => t.classList.toggle('active', t.dataset.resp === 'status-result'));
                $('#apiResponse').style.display = 'none';
                $('#apiResponseHeaders').style.display = 'none';
                $('#apiResponseStatusResult').style.display = 'block';
                $('#apiResponseStatusResult').innerHTML = `<pre><code>// Polling status for call_id: ${callId}...</code></pre>`;

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
    // API CALLS TAB (Hideable) — unchanged
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
            a.download = `blueflame-api-calls-${dateStamp()}.json`;
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
    // CONFIGURATION TAB — unchanged
    // ============================================
    function initConfigTab() {
        restoreConfigFields();

        $('#cfgEmail').addEventListener('input', () => {
            const email = $('#cfgEmail').value.trim();
            const userIdField = $('#cfgUserId');
            if (!userIdField.value || userIdField.value === client.email) {
                userIdField.value = email;
            }
        });

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
            client.userId = userId || email;
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

        $('#btnToggleApiToken').addEventListener('click', () => {
            const i = $('#cfgApiToken');
            const ic = $('#btnToggleApiToken i');
            if (i.type === 'password') { i.type = 'text'; ic.className = 'fas fa-eye-slash'; }
            else { i.type = 'password'; ic.className = 'fas fa-eye'; }
        });

        $('#btnResetAll').addEventListener('click', () => {
            if (confirm('Clear ALL settings and data?')) {
                localStorage.clear();
                client.clearConfig();
                state.companies = [];
                state.importHistory = [];
                state.selectedForEnrich.clear();
                window.apiCallLog = [];
                restoreConfigFields();
                updateConnectionStatus();
                updateConfigStatusPanel();
                syncExplorerGlobals();
                renderEnrichCompanyList();
                renderVisualizeTable();
                renderRecentImports();
                renderApiCallsList();
                updateApiCallsBadge();
                showToast('All settings cleared', 'warning');
            }
        });
        $('#btnPurgeCache').addEventListener('click', () => {
            if (confirm('Purge all cached company and enrichment data?')) {
                state.companies = [];
                state.importHistory = [];
                localStorage.removeItem('bf_companies');
                localStorage.removeItem('bf_import_history');
                renderEnrichCompanyList();
                renderVisualizeTable();
                renderRecentImports();
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

        const sEp = $('#statusIconEndpoint'), tEp = $('#statusTextEndpoint');
        if (window.BF_GLOBALS.REST_API_ENDPOINT) {
            sEp.className = 'config-status-icon status-green';
            tEp.textContent = window.BF_GLOBALS.REST_API_ENDPOINT;
        } else {
            sEp.className = 'config-status-icon status-red';
            tEp.textContent = 'Not set';
        }

        const sAuth = $('#statusIconAuth'), tAuth = $('#statusTextAuth');
        if (window.BF_GLOBALS.API_TOKEN) {
            sAuth.className = 'config-status-icon status-green';
            const k = window.BF_GLOBALS.API_TOKEN;
            tAuth.textContent = `X-Api-Key: ${k.length > 12 ? k.substring(0, 6) + '••••' + k.substring(k.length - 4) : '••••••••'}`;
        } else {
            sAuth.className = 'config-status-icon status-red';
            tAuth.textContent = 'No token configured';
        }

        const sUid = $('#statusIconUserId'), tUid = $('#statusTextUserId');
        if (window.BF_GLOBALS.USER_ID) {
            sUid.className = 'config-status-icon status-green';
            tUid.textContent = window.BF_GLOBALS.USER_ID;
        } else {
            sUid.className = 'config-status-icon status-yellow';
            tUid.textContent = 'Not set (will default to email)';
        }

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
    // JSON PARSING UTILITIES
    // ============================================
    function extractJsonFromString(str) {
        if (!str || typeof str !== 'string') return null;

        // Try 1: Extract from ```json ... ``` or ``` ... ``` fences
        const fenceMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) {
            try { return JSON.parse(fenceMatch[1].trim()); } catch (e) { /* fall through */ }
        }

        // Try 2: Find the first [ ... ] or { ... } in the string
        const firstBracket = str.search(/[\[{]/);
        if (firstBracket !== -1) {
            const substr = str.substring(firstBracket);
            const open = substr[0];
            const close = open === '[' ? ']' : '}';
            let depth = 0;
            for (let i = 0; i < substr.length; i++) {
                if (substr[i] === open) depth++;
                else if (substr[i] === close) depth--;
                if (depth === 0) {
                    try { return JSON.parse(substr.substring(0, i + 1)); } catch (e) { break; }
                }
            }
        }

        // Try 3: Direct parse
        try { return JSON.parse(str); } catch (e) { return null; }
    }

    // ============================================
    // DATA PERSISTENCE
    // ============================================
    function saveCompanies() {
        localStorage.setItem('bf_companies', JSON.stringify(state.companies));
    }

    function deleteCompany(id) {
        state.companies = state.companies.filter(c => c.id !== id);
        state.selectedForEnrich.delete(id);
        saveCompanies();
        renderEnrichCompanyList();
        renderVisualizeTable();
        showToast('Company deleted', 'info');
    }

    // ============================================
    // UTILITIES
    // ============================================
    function generateId() { return 'bf-' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36); }
    function dateStamp() { return new Date().toISOString().slice(0, 10); }
    function formatFileSize(bytes) { if (!bytes) return '0 B'; const s = ['B', 'KB', 'MB', 'GB']; const i = Math.floor(Math.log(bytes) / Math.log(1024)); return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + s[i]; }
    function getTimeAgo(d) { const s = Math.floor((new Date() - new Date(d)) / 1000); if (s < 60) return 'Just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; if (s < 604800) return `${Math.floor(s / 86400)}d ago`; return new Date(d).toLocaleDateString(); }
    function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
    function escapeAttr(s) { return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

    function readFileAsText(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsText(file);
        });
    }

    function parseCSV(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length === 0) return { headers: [], rows: [] };
        const headers = parseCSVLine(lines[0]);
        const rows = lines.slice(1).map(l => parseCSVLine(l));
        return { headers, rows };
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (inQuotes) {
                if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
                else if (ch === '"') { inQuotes = false; }
                else { current += ch; }
            } else {
                if (ch === '"') { inQuotes = true; }
                else if (ch === ',') { result.push(current.trim()); current = ''; }
                else { current += ch; }
            }
        }
        result.push(current.trim());
        return result;
    }

    function downloadFile(content, mimeType, fileName) {
        const blob = new Blob([content], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }

    $('#btnRefresh')?.addEventListener('click', () => {
        switch (state.activeTab) {
            case 'visualize': renderVisualizeTable(); break;
            case 'enrich': renderEnrichCompanyList(); break;
            case 'api-calls': renderApiCallsList(); break;
            default: showToast('Refreshed', 'info');
        }
    });

})();
