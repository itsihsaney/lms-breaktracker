/**
 * =====================================================
 * BREAK TRACKER — POPUP UI (READ-ONLY RENDERER)
 *
 * Rule: popup.js NEVER calculates anything.
 * It only reads from chrome.storage.local and renders.
 * =====================================================
 */

/* ─── DOM References ─── */
const el = {
    primaryBadge: document.getElementById('primaryBadge'),
    secondaryBadge: document.getElementById('secondaryBadge'),
    timeRemaining: document.getElementById('timeRemaining'),
    workDone: document.getElementById('workDone'),
    breakUsed: document.getElementById('breakUsed'),
    overusedBreak: document.getElementById('overusedBreak'),
    additionalTime: document.getElementById('additionalTime'),
    totalTime: document.getElementById('totalTime'),
    progressCircle: document.getElementById('progressCircle'),
    noDataMessage: document.getElementById('noDataMessage')
};

/* ─── SVG Ring Config ─── */
const RING_RADIUS = 80;                        // matches r="80" in updated SVG
const RING_CIRC = 2 * Math.PI * RING_RADIUS; // ~502.65
const MAX_BREAK_MS = 90 * 60 * 1000;          // 90 minutes
const WARN_THRESHOLD = 15 * 60 * 1000;         // 15 minutes

/* ─── Init ring so CSS transition works from start ─── */
el.progressCircle.style.strokeDasharray = `${RING_CIRC} ${RING_CIRC}`;
el.progressCircle.style.strokeDashoffset = '0';

/* ─── App State ─── */
let state = {
    hasData: false,
    isLoading: true,   // true until first storage response arrives
    workingTime: 0,
    breakTime: 0,
    additionalTime: 0,
    totalTime: 0,
    overusedBreak: 0,
    breakRemaining: MAX_BREAK_MS,
    isWorking: false,
    status: null    // 'Present' | 'Late' | 'Over Break Time' — set by content.js
};

/* =====================================================
   INITIALIZATION
   ===================================================== */
document.addEventListener('DOMContentLoaded', () => {
    renderLoading();          // Show loading state immediately
    fetchAndRender();         // First fetch
    setInterval(fetchAndRender, 1000);  // Live refresh
});

/* =====================================================
   DATA SYNC  (read-only — no calculations here)
   ===================================================== */
function fetchAndRender() {
    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) return;

        // If lastUpdated is present, content.js has written real data
        const hasWrite = !!data.lastUpdated;

        state.isLoading = !hasWrite;
        state.hasData = data.hasData ?? false;
        state.workingTime = data.workingTime ?? 0;
        state.breakTime = data.breakTime ?? 0;
        state.additionalTime = data.additionalTime ?? 0;
        state.totalTime = data.totalTime ?? 0;
        state.overusedBreak = data.overusedBreak ?? 0;
        state.breakRemaining = (data.breakRemaining !== undefined) ? data.breakRemaining : MAX_BREAK_MS;
        state.isWorking = data.isWorking ?? false;
        state.status = data.status ?? null;

        render();
    });
}

/* =====================================================
   RENDER
   ===================================================== */
function render() {
    if (state.isLoading) {
        renderLoading();
        return;
    }
    renderPrimaryBadge();
    renderSecondaryBadge();
    renderRing();
    renderMetrics();
    renderNoData();
}

/* ─── Loading State ─── */
function renderLoading() {
    setBadge(el.primaryBadge, 'LOADING...', 'is-loading');
    el.secondaryBadge.style.display = 'none';
}

/* ─── Primary Badge: Tracking Active / On Break / Break Overused ─── */
function renderPrimaryBadge() {
    if (!state.hasData) {
        setBadge(el.primaryBadge, '⏸ No Data', '');
        return;
    }

    if (state.overusedBreak > 0) {
        setBadge(el.primaryBadge, '⚠ Break Overused', 'is-overused');
    } else if (state.isWorking) {
        setBadge(el.primaryBadge, '● Tracking Active', 'is-active');
    } else {
        setBadge(el.primaryBadge, 'On Break', 'is-break');
    }
}

/* ─── Secondary Badge: PRESENT / LATE / OVER BREAK TIME ─── */
function renderSecondaryBadge() {
    if (!state.hasData) {
        el.secondaryBadge.style.display = 'none';
        return;
    }

    el.secondaryBadge.style.display = 'inline-flex';

    // Use the status string written by content.js
    const s = state.status;

    if (s === 'Over Break Time') {
        setBadge(el.secondaryBadge, 'Over Break Time', 'is-overbreak');
    } else if (s === 'Late') {
        setBadge(el.secondaryBadge, 'Late', 'is-late');
    } else {
        // Present (or anything else defaults to green)
        setBadge(el.secondaryBadge, 'Present', 'is-present');
    }
}

/* ─── Circular Progress Ring ─── */
function renderRing() {
    const pct = Math.min(1, Math.max(0, state.breakRemaining / MAX_BREAK_MS));
    const offset = RING_CIRC - (pct * RING_CIRC);

    el.progressCircle.style.strokeDashoffset = `${offset}`;

    // ── Apply CSS state classes (gradient stroke + animations) ──
    const circle = el.progressCircle;
    const timeEl = el.timeRemaining;

    // Reset all state classes first
    circle.classList.remove('ring-warn', 'ring-empty', 'ring-breathing');
    timeEl.classList.remove('text-warn', 'text-empty');

    if (state.breakRemaining <= 0) {
        // Red state: break exhausted
        circle.classList.add('ring-empty');
        timeEl.classList.add('text-empty');
    } else if (state.breakRemaining <= WARN_THRESHOLD) {
        // Orange state: < 15 min remaining — pulse glow
        circle.classList.add('ring-warn');
        timeEl.classList.add('text-warn');
    } else if (!state.isWorking && state.hasData) {
        // Breathing state: user is on break (not working)
        circle.classList.add('ring-breathing');
    }
    // else: default blue gradient (no additional class needed)

    el.timeRemaining.textContent = fmtHMS(state.breakRemaining);
}

/* ─── Stat Cards ─── */
function renderMetrics() {
    el.workDone.textContent = fmtHMS(state.workingTime);
    el.breakUsed.textContent = fmtHMS(state.breakTime);
    el.additionalTime.textContent = fmtHMS(state.additionalTime);
    el.totalTime.textContent = fmtHMS(state.totalTime);

    if (state.overusedBreak > 0) {
        const mins = Math.floor(state.overusedBreak / 60000);
        el.overusedBreak.textContent = `+${mins} min overused`;
        el.overusedBreak.style.display = 'inline-block';
    } else {
        el.overusedBreak.style.display = 'none';
    }
}

/* ─── No Data Banner ─── */
function renderNoData() {
    el.noDataMessage.style.display = state.hasData ? 'none' : 'block';
}

/* =====================================================
   UTILITIES
   ===================================================== */

/**
 * Sets text + resets then applies a single variant class on a badge.
 * variant can be '' for no variant (plain loading look).
 */
function setBadge(badgeEl, text, variant) {
    badgeEl.textContent = text;
    // Remove ALL known variants first
    badgeEl.classList.remove(
        'is-active', 'is-break', 'is-overused', 'is-loading',
        'is-present', 'is-late', 'is-overbreak'
    );
    if (variant) badgeEl.classList.add(variant);
}

/**
 * Format milliseconds → HH:MM:SS  (never negative)
 */
function fmtHMS(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}
