/**
 * Session Viewer - Browse and replay past Gemini CLI sessions
 */

class SessionViewer {
    constructor() {
        this.mode = 'live'; // 'live' or 'replay'
        this.sessions = [];
        this.currentSessionId = null;
        this.replayEvents = [];
        this.replayIndex = 0;
        this.replayInterval = null;
    }

    async loadSessionList() {
        try {
            const response = await fetch('/api/sessions');
            const data = await response.json();
            this.sessions = data.sessions || [];
            this.renderSessionList();
        } catch (err) {
            console.error('[Sessions] Failed to load sessions:', err);
        }
    }

    renderSessionList() {
        const container = document.getElementById('session-list');
        if (!container) return;

        if (this.sessions.length === 0) {
            container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;">No past sessions</div>';
            return;
        }

        container.innerHTML = this.sessions.map(session => `
            <div class="session-item" data-session-id="${session.id}" style="padding:10px;margin:5px 0;background:#f9fafb;border-radius:5px;cursor:pointer;border-left:3px solid #667eea;">
                <div style="font-weight:600;color:#374151;">${new Date(session.startTime).toLocaleString()}</div>
                <div style="font-size:0.9em;color:#6b7280;margin-top:4px;">${session.firstUserMessage}</div>
                <div style="font-size:0.85em;color:#9ca3af;margin-top:4px;">
                    ${session.messageCount} messages | ${session.model || 'Unknown model'}
                </div>
            </div>
        `).join('');

        // Add click handlers
        container.querySelectorAll('.session-item').forEach(item => {
            item.addEventListener('click', () => {
                const sessionId = item.getAttribute('data-session-id');
                this.loadAndReplaySession(sessionId);
            });
        });
    }

    async loadAndReplaySession(sessionId) {
        try {
            console.log('[Sessions] Loading session:', sessionId);

            const response = await fetch(`/api/sessions/${sessionId}`);
            const data = await response.json();

            if (!data.session || !data.events) {
                console.error('[Sessions] Invalid session data');
                return;
            }

            this.currentSessionId = sessionId;
            this.replayEvents = data.events;
            this.replayIndex = 0;
            this.mode = 'replay';

            // Update mode indicator
            const modeEl = document.getElementById('mode-indicator');
            if (modeEl) {
                modeEl.textContent = 'REPLAY MODE';
                modeEl.style.background = '#f59e0b';
            }

            console.log('[Sessions] Loaded', this.replayEvents.length, 'events');

            // Start replay
            this.startReplay();
        } catch (err) {
            console.error('[Sessions] Failed to load session:', err);
        }
    }

    startReplay() {
        this.stopReplay();

        console.log('[Sessions] Starting replay...');

        // Replay events at 10x speed
        this.replayInterval = setInterval(() => {
            if (this.replayIndex >= this.replayEvents.length) {
                this.stopReplay();
                console.log('[Sessions] Replay complete');
                return;
            }

            const event = this.replayEvents[this.replayIndex];

            // Simulate event arrival
            if (typeof handleEvent === 'function') {
                handleEvent(event);
            }

            this.replayIndex++;

            // Update progress
            const progress = (this.replayIndex / this.replayEvents.length) * 100;
            const progressEl = document.getElementById('replay-progress');
            if (progressEl) {
                progressEl.style.width = progress + '%';
                progressEl.textContent = Math.round(progress) + '%';
            }
        }, 100); // 100ms between events (10x speed)
    }

    stopReplay() {
        if (this.replayInterval) {
            clearInterval(this.replayInterval);
            this.replayInterval = null;
        }
    }

    switchToLive() {
        this.stopReplay();
        this.mode = 'live';
        this.currentSessionId = null;

        const modeEl = document.getElementById('mode-indicator');
        if (modeEl) {
            modeEl.textContent = 'LIVE MODE';
            modeEl.style.background = '#10b981';
        }

        console.log('[Sessions] Switched to live mode');
    }
}

// Global instance
let sessionViewer = null;

function initSessionViewer() {
    sessionViewer = new SessionViewer();

    // Load session list on init
    if (sessionViewer) {
        sessionViewer.loadSessionList();
    }

    // Wire up buttons
    const liveBtn = document.getElementById('btn-live');
    if (liveBtn) {
        liveBtn.addEventListener('click', () => {
            if (sessionViewer) sessionViewer.switchToLive();
        });
    }

    const refreshBtn = document.getElementById('btn-refresh-sessions');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (sessionViewer) sessionViewer.loadSessionList();
        });
    }
}
