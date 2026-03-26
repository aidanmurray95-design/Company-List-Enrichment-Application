/**
 * BlueFlame API Endpoints Registry
 * ─────────────────────────────────────────────────
 * Global Variables (set in Configuration, resolved at request time):
 *   {{REST_API_ENDPOINT}}  →  e.g. https://api.blueflame.ai/prod/client/v1
 *   {{API_TOKEN}}          →  The Bearer auth token
 *   {{USER_ID}}            →  User's email / unique ID
 *
 * URL pattern:  {{REST_API_ENDPOINT}}/functions/scan
 *
 * Only the 8 actual BlueFlame API commands.
 * Based on: https://documenter.getpostman.com/view/28999295/2s9YeHaWcm
 */

// ── Global variable defaults (overwritten by Configuration tab) ──
window.BF_GLOBALS = {
    REST_API_ENDPOINT: localStorage.getItem('bf_rest_api_endpoint') || 'https://api.blueflame.ai/prod/client/v1',
    API_TOKEN:         localStorage.getItem('bf_api_token') || 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI5OTM4MjZiMC0xZThkLTQwMDgtYTgzNy0wNTc1Y2NlZGRjZGEiLCJpYXQiOjE3NzQyODAzMTgsIm5iZiI6MTc3NDI4MDMxOCwianRpIjoiNTk5NDE2ODYtOWY5Ni00YWFmLThiNjAtNWM1YzlkNDg3ZjM4IiwiZXhwIjoxODA1ODE2MzE4fQ.rVEILnAGfD-MdE4vNM0PRyTYc7K_CmvyGfSVEhxH3Syz5fyDlT7ZBFYg5f1nlKP_mv2ouACLPIbOB-1-XbFWlVV6U25pvJEwJODtqI01v2Le8zJQwUypiOzbbV5787kwKXa3ZfVX9qDalArh7KzaYZWPuYXQdwM41rp-5O9wGsOzLnYiJ4a-6fIp0IJdaIGhocH90PN3dR9hI2B7UzK6FrdoYYJKUJ_OcEQx5bWctBEJbWwZDRMhMNbtG4Sl0sCgTJdNVbet2k4n-LzapWwXGJjwHQ1elwglG3lVzZxFmYUzcxaR4xeuf4VSvdRD2kCwYoCnQlD6M6LAwlo-VXgIRObJ6vfKXanWOSzdLi_dk6avgXd2FZGJogAjFpeHddL4--0TKVBGNr3hhIO-Thv0zjnnxgE8s3rtVKfSW6d_Wc6_Tqqep0zK6gnkR0SinrCaztDY6YqCJsTnmFqWJXd-krxMaFOsObLr05lcld4GRGYJ6vtdVdFGWsu9nF0Fv6kMi2LexCLLh1UjS0QzzuFosBhMwbpmz8fjIHA9LzDXJjakx75dBU2S1AshDrzXMa6Y3RkSRuHtCvoregAP2IeRDMQFrJou0meU4fX0ANHvQNc8wsY-DtjiU8h5hD09i1zcTKHGsPp5xWXr7ZvmrkQmuffp6zFX99q_6cFyae6bu1c',
    USER_ID:           localStorage.getItem('bf_user_id') || 'aidan.murray@blueflame.ai'
};

const BLUEFLAME_API = {
    llm: {
        label: 'LLM & AI',
        icon: 'fas fa-brain',
        endpoints: [
            {
                id: 'llm-request',
                name: 'Send an LLM Request',
                method: 'POST',
                path: '/functions/llm',
                description: 'Send a prompt to the default LLM model for processing.',
                body: JSON.stringify({
                    prompt: "Extract the total revenue from the following financial data...",
                    context: "",
                    user_id: "{{USER_ID}}",
                    parameters: { temperature: 0.2, max_tokens: 2048 }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            },
            {
                id: 'llm-request-model',
                name: 'Send an LLM Request - Specific Model',
                method: 'POST',
                path: '/functions/llm',
                description: 'Send a prompt to a specific LLM model by name or ID.',
                body: JSON.stringify({
                    model: "gpt-4",
                    prompt: "Analyze the balance sheet and extract key financial metrics...",
                    context: "",
                    user_id: "{{USER_ID}}",
                    parameters: { temperature: 0.1, max_tokens: 4096 }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            },
            {
                id: 'available-models',
                name: 'Available Models',
                method: 'POST',
                path: '/functions/models',
                description: 'Retrieve a list of all available LLM models.',
                body: JSON.stringify({}, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            }
        ]
    },
    extraction: {
        label: 'Extraction & QnA',
        icon: 'fas fa-search-dollar',
        endpoints: [
            {
                id: 'qna-request',
                name: 'Send QnA Request',
                method: 'POST',
                path: '/functions/qna',
                description: 'Ask a question against an uploaded document to extract specific data points.',
                body: JSON.stringify({
                    question: "What is the total revenue for Q4 2024?",
                    document_id: "{{document_id}}",
                    user_id: "{{USER_ID}}",
                    context: "",
                    options: { return_source: true, confidence_threshold: 0.7 }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            },
            {
                id: 'scan-request',
                name: 'Send Scan Request',
                method: 'POST',
                path: '/functions/scan',
                description: 'Submit a document for automated scanning and data extraction.',
                body: JSON.stringify({
                    document_id: "{{document_id}}",
                    scan_type: "financial_statement",
                    user_id: "{{USER_ID}}",
                    extract_fields: ["revenue","net_income","total_assets","total_liabilities","cash_flow","ebitda"],
                    options: { extract_tables: true, extract_key_values: true, ocr_enabled: true }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            }
        ]
    },
    bot: {
        label: 'Bot',
        icon: 'fas fa-robot',
        endpoints: [
            {
                id: 'llm-request',
                name: 'Send an LLM Request',
                method: 'POST',
                path: '/functions/llm',
                description: 'Send a conversational request to the BlueFlame LLM endpoint for interactive extraction.',
                body: JSON.stringify({
                    message: "Summarize the key financial metrics from the uploaded income statement.",
                    session_id: "",
                    document_id: "{{document_id}}",
                    user_id: "{{USER_ID}}",
                    options: { stream: false, include_sources: true }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            }
        ]
    },
    operations: {
        label: 'Status & Files',
        icon: 'fas fa-tasks',
        endpoints: [
            {
                id: 'call-status',
                name: 'Call Status and Output',
                method: 'GET',
                path: '/output/{{call_id}}',
                description: 'Check the status and retrieve the output of a previous API call.',
                body: '',
                headers: [
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: false
            },
            {
                id: 'file-upload',
                name: 'File Upload',
                method: 'POST',
                path: '/functions/upload',
                description: 'Upload a file (PDF, Excel, CSV) for processing. File sent as base64 in JSON body.',
                body: JSON.stringify({
                    file: "(base64-encoded file content)",
                    file_name: "Financial_Statement_Q4_2024.pdf",
                    content_type: "application/pdf",
                    user_id: "{{USER_ID}}",
                    metadata: { name: "Financial_Statement_Q4_2024.pdf", type: "income_statement", entity: "Acme Corp" }
                }, null, 2),
                headers: [
                    { key: 'Content-Type', value: 'application/json', enabled: true, description: 'Request content type' },
                    { key: 'Authorization', value: 'Bearer {{API_TOKEN}}', enabled: true, description: 'Bearer auth token' }
                ],
                autoStatus: true
            }
        ]
    }
};

function getAllEndpoints() {
    const all = [];
    Object.values(BLUEFLAME_API).forEach(category => {
        category.endpoints.forEach(ep => {
            all.push({ ...ep, category: category.label });
        });
    });
    return all;
}

function resolveTemplateVars(str, vars) {
    if (!str) return str;
    let result = str;
    result = result.replace(/\{\{REST_API_ENDPOINT\}\}/g, window.BF_GLOBALS.REST_API_ENDPOINT || '');
    result = result.replace(/\{\{API_TOKEN\}\}/g, window.BF_GLOBALS.API_TOKEN || '');
    result = result.replace(/\{\{USER_ID\}\}/g, window.BF_GLOBALS.USER_ID || '');
    if (vars) {
        Object.entries(vars).forEach(([key, value]) => {
            result = result.replace(new RegExp('\\{\\{' + key + '\\}\\}', 'g'), value || '');
        });
    }
    return result;
}
