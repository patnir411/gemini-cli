// Simple working dashboard
const WS_URL = 'ws://localhost:9333';
let ws = null;
let eventCount = 0;
let startTime = Date.now();
let eventsTimestamps = [];

const state = {
    session: { turnCount: 0, currentModel: null },
    reactLoop: { iterationCount: 0, pendingToolCalls: [], finishReason: null },
    toolExecution: { activeTools: new Map(), history: [] },
    tokens: { total: 0, prompt: 0, output: 0, cached: 0, thoughts: 0, tools: 0, limit: 1000000, utilization: 0 },
    performance: { memoryUsageMb: 0 },
};

const messageHistory = [];

function update(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function connect() {
    ws = new WebSocket(WS_URL);
    ws.onopen = () => { console.log('[WS] Connected'); update('status', 'Connected'); };
    ws.onclose = () => { update('status', 'Reconnecting...'); setTimeout(connect, 3000); };
    ws.onerror = (err) => console.error('[WS] Error:', err);
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'batch' && data.events) data.events.forEach(e => handleEvent(e));
            if (data.type === 'state' && data.state) {
                if (data.state.session) Object.assign(state.session, data.state.session);
                if (data.state.tokens) Object.assign(state.tokens, data.state.tokens);

                // Update DAG if available
                if (data.state.dagGraph) {
                    console.log('[Dashboard] dagGraph received:', data.state.dagGraph);
                    if (typeof updateDAG === 'function') {
                        updateDAG(data.state.dagGraph);
                    } else {
                        console.warn('[Dashboard] updateDAG function not found');
                    }
                } else {
                    console.log('[Dashboard] No dagGraph in state');
                }
            }
            updateUI();
        } catch (err) { console.error('[WS] Error:', err); }
    };
}

function handleEvent(event) {
    eventCount++;
    eventsTimestamps.push(Date.now());
    eventsTimestamps = eventsTimestamps.filter(t => t > Date.now() - 60000);

    const payload = event.payload || event.value || event;

    // Extract model from context OR from event itself
    if (event.context && event.context.currentModel) {
        state.session.currentModel = event.context.currentModel;
    } else if (event.meta && event.meta.model) {
        state.session.currentModel = event.meta.model;
    } else if (typeof payload === 'string' && payload.includes('gemini')) {
        // Extract from payload if it contains model name
        const modelMatch = payload.match(/(gemini-[\w\-]+)/);
        if (modelMatch) state.session.currentModel = modelMatch[1];
    }

    switch(event.type) {
        case 'turn_started':
            state.session.turnCount++;
            // Extract model from turn event if present
            if (payload.model) state.session.currentModel = payload.model;
            break;
        case 'model_info':
            if (payload.model || payload) {
                state.session.currentModel = typeof payload === 'string' ? payload : payload.model;
                console.log('[MODEL] Set to:', state.session.currentModel);
            }
            break;
        case 'stream_content':
        case 'content':
            state.reactLoop.iterationCount++;
            const content = payload.value || payload;
            if (typeof content === 'string') {
                messageHistory.push({ type: 'assistant', content, timestamp: event.timestamp });
                if (messageHistory.length > 50) messageHistory.shift();
            }
            break;
        case 'turn_started':
            state.session.turnCount++;
            // Extract user query if available
            if (payload.userQuery || payload.query) {
                messageHistory.push({
                    type: 'user',
                    content: payload.userQuery || payload.query,
                    timestamp: event.timestamp
                });
            }
            break;
        case 'stream_finished':
        case 'finished':
            // Extract from nested structure
            let usage = null;
            if (payload.value && payload.value.usageMetadata) usage = payload.value.usageMetadata;
            else if (payload.usageMetadata) usage = payload.usageMetadata;

            if (usage) {
                state.tokens.prompt = usage.promptTokenCount || 0;
                state.tokens.output = usage.candidatesTokenCount || 0;
                state.tokens.cached = usage.cachedContentTokenCount || 0;
                state.tokens.thoughts = usage.thoughtsTokenCount || 0;
                state.tokens.total = usage.totalTokenCount || 0;
                state.tokens.utilization = (state.tokens.total / state.tokens.limit) * 100;
                console.log('[TOKENS] Updated:', state.tokens);
            }

            // Extract finish reason
            const reason = payload.value ? payload.value.reason : payload.reason;
            if (reason) {
                state.reactLoop.finishReason = reason;
                console.log('[FINISH] Reason:', reason);
            }
            break;
        case 'stream_tool_call_request':
        case 'tool_call_request':
            if (payload && payload.value) {
                const tool = payload.value;
                state.toolExecution.activeTools.set(tool.callId, {
                    name: tool.name, timestamp: event.timestamp
                });
            }
            break;
        case 'stream_tool_call_response':
        case 'tool_call_response':
            if (payload && payload.value && payload.value.callId) {
                const tool = state.toolExecution.activeTools.get(payload.value.callId);
                if (tool) {
                    state.toolExecution.history.push({
                        name: tool.name,
                        duration: event.timestamp - tool.timestamp
                    });
                    state.toolExecution.activeTools.delete(payload.value.callId);
                }
            }
            break;
    }

    addEventToLog(event);
}

function updateUI() {
    update('events', eventCount);
    update('turn', state.session.turnCount);
    update('model', state.session.currentModel || '-');
    update('tokens-header', state.tokens.total.toLocaleString());

    // Count total tools (active + history)
    const totalTools = state.toolExecution.activeTools.size + state.toolExecution.history.length;
    update('tools-header', totalTools);

    // Update workflow SVG
    update('turn-count-svg', state.session.turnCount + '/100');
    update('tool-count-svg', state.toolExecution.history.length);
    highlightStage('stage-turn', state.reactLoop.iterationCount > 0);
    highlightStage('stage-tool', state.toolExecution.activeTools.size > 0);
    update('tokens-big', state.tokens.total.toLocaleString());
    update('tok-prompt', state.tokens.prompt.toLocaleString());
    update('tok-output', state.tokens.output.toLocaleString());
    update('tok-cached', state.tokens.cached.toLocaleString());
    update('tok-thoughts', state.tokens.thoughts.toLocaleString());
    update('tok-tools', state.tokens.tools.toLocaleString());
    update('tok-total', state.tokens.total.toLocaleString());
    update('percent', state.tokens.utilization.toFixed(2) + '%');
    update('turn-big', state.session.turnCount);
    update('iterations', state.reactLoop.iterationCount);
    update('pending-tools', state.reactLoop.pendingToolCalls.length);
    update('finish-reason', state.reactLoop.finishReason || '-');
    const eventsPerSec = eventsTimestamps.length / 60;
    update('events-sec', eventsPerSec.toFixed(1));
    update('memory', state.performance.memoryUsageMb.toFixed(1) + 'MB');

    const toolsEl = document.getElementById('tools');
    if (toolsEl) {
        const all = [...Array.from(state.toolExecution.activeTools.values()), ...state.toolExecution.history.slice(-10)];
        toolsEl.innerHTML = all.length === 0 ? '<div style="text-align:center;padding:20px;color:#999;">No tools yet</div>' :
            all.map(t => '<div style="padding:10px;margin:5px 0;background:#f9fafb;border-left:4px solid #10b981;border-radius:5px;"><strong>' + t.name + '</strong>' + (t.duration ? '<span style="float:right;color:#666;">' + t.duration + 'ms</span>' : '') + '</div>').join('');
    }

    const msgsEl = document.getElementById('messages');
    if (msgsEl && messageHistory.length > 0) {
        msgsEl.innerHTML = messageHistory.slice(-20).reverse().map(m => {
            const isUser = m.type === 'user';
            const bgColor = isUser ? '#dbeafe' : '#f3f4f6';
            const align = isUser ? 'margin-left:auto;text-align:right;' : '';
            const label = isUser ? '👤 You' : '🤖 Gemini';

            // Basic markdown rendering (code blocks, bold, italic)
            let content = m.content;

            // Code blocks
            content = content.replace(/```(\w+)?\n([\s\S]*?)```/g, '<pre style="background:#1f2937;color:#10b981;padding:10px;border-radius:6px;overflow-x:auto;margin:8px 0;"><code>$2</code></pre>');

            // Inline code
            content = content.replace(/`([^`]+)`/g, '<code style="background:#f3f4f6;padding:2px 6px;border-radius:3px;font-family:monospace;font-size:0.9em;color:#667eea;">$1</code>');

            // Bold
            content = content.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

            // Bullet points
            content = content.replace(/^\* (.+)$/gm, '• $1');

            return '<div style="max-width:80%;' + align + 'padding:12px 16px;margin:10px 0;background:' + bgColor + ';border-radius:12px;' + (isUser ? 'border-bottom-right-radius:4px;' : 'border-bottom-left-radius:4px;') + 'box-shadow:0 1px 3px rgba(0,0,0,0.1);">' +
                   '<div style="font-size:0.8em;color:#6b7280;margin-bottom:4px;font-weight:600;">' + label + '</div>' +
                   '<div style="line-height:1.6;">' + content + '</div>' +
                   '</div>';
        }).join('');
    }
}

function addEventToLog(event) {
    const log = document.getElementById('log');
    if (!log) return;

    if (log.children.length === 0) log.innerHTML = '';

    const time = new Date(event.timestamp).toLocaleTimeString();
    const fullPayload = JSON.stringify(event.payload || event.value || event, null, 2);
    const preview = fullPayload.substring(0, 150);

    const div = document.createElement('div');
    div.className = 'event';
    div.style.cursor = 'pointer';
    div.innerHTML = '<div class="event-time">' + time + '</div>' +
                    '<div class="event-type" style="font-weight:700;color:#667eea;">' + event.type + '</div>' +
                    '<pre class="preview" style="font-size:0.75em;margin:4px 0;max-height:60px;overflow:hidden;">' + preview + '...</pre>' +
                    '<pre class="full" style="font-size:0.75em;margin:4px 0;display:none;max-height:400px;overflow-y:auto;background:#fff;padding:10px;border:1px solid #e5e7eb;border-radius:4px;">' + fullPayload + '</pre>';

    div.addEventListener('click', function() {
        const prev = this.querySelector('.preview');
        const full = this.querySelector('.full');
        if (full.style.display === 'none') {
            prev.style.display = 'none';
            full.style.display = 'block';
            this.style.background = '#dbeafe';
        } else {
            prev.style.display = 'block';
            full.style.display = 'none';
            this.style.background = '#f9fafb';
        }
    });

    log.prepend(div);
    if (log.children.length > 100) log.removeChild(log.lastChild);
}

function init() {
    console.log('[DASHBOARD] Starting...');

    // Initialize DAG viewer
    if (typeof initDAGViewer === 'function') {
        initDAGViewer();
        console.log('[DASHBOARD] DAG viewer initialized');
    }

    // Initialize Session viewer
    if (typeof initSessionViewer === 'function') {
        initSessionViewer();
        console.log('[DASHBOARD] Session viewer initialized');
    }

    // Export button
    const exportBtn = document.getElementById('btn-export');
    if (exportBtn) {
        exportBtn.addEventListener('click', exportCurrentSession);
    }

    connect();
    console.log('[DASHBOARD] Ready');
}

function exportCurrentSession() {
    const exportData = {
        sessionId: 'current-' + Date.now(),
        timestamp: new Date().toISOString(),
        turns: state.session.turnCount,
        tokens: state.tokens,
        tools: state.toolExecution.history,
        messages: messageHistory,
        events: Array.from(document.getElementById('log').children).map(el => el.textContent)
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gemini-session-' + Date.now() + '.json';
    a.click();
    URL.revokeObjectURL(url);

    console.log('[Export] Session exported');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}

console.log('[DASHBOARD] Script loaded');

function highlightStage(id, active) {
    const stage = document.getElementById(id);
    if (!stage) return;
    const rect = stage.querySelector('rect');
    if (rect) {
        rect.setAttribute('fill', active ? '#10b981' : '#e5e7eb');
        rect.setAttribute('stroke', active ? '#10b981' : '#667eea');
    }
}
