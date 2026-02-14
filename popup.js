/**
 * =====================================================
 * TIME TRACKER - POPUP UI (READ-ONLY)
 * =====================================================
 */

// DOM Elements
const elements = {
    timeRemaining: document.getElementById('timeRemaining'),
    workingTime: document.getElementById('workDone'),
    breakUsed: document.getElementById('breakUsed'),
    overusedBreak: document.getElementById('overusedBreak'),
    additionalTime: document.getElementById('additionalTime'),
    totalTime: document.getElementById('totalTime'),
    progressCircle: document.getElementById('progressCircle'),
    noDataMessage: document.getElementById('noDataMessage'),
    statusBadge: document.getElementById('statusBadge')
};

const CONFIG = {
    MAX_BREAK_MS: 90 * 60 * 1000,
    WARNING_THRESHOLD_MS: 15 * 60 * 1000
};

const circumference = 2 * Math.PI * 75; // r=75

// State (Mirror of storage)
let state = {
    hasData: false,
    workingTime: 0,
    breakTime: 0,
    additionalTime: 0,
    totalTime: 0,
    overusedBreak: 0,
    breakRemaining: CONFIG.MAX_BREAK_MS,
    isWorking: false,
    status: null // New field
};

// =====================================================
// INITIALIZATION
// =====================================================
document.addEventListener('DOMContentLoaded', () => {
    setupCircle();
    updateUIFromStorage(); // Immediate update

    // Performance: Use setInterval (1s) instead of requestAnimationFrame
    // This reduces CPU usage while popup is open
    setInterval(updateUIFromStorage, 1000);
});

function setupCircle() {
    elements.progressCircle.style.strokeDasharray = `${circumference} ${circumference}`;
    elements.progressCircle.style.strokeDashoffset = '0';
}

// =====================================================
// DATA SYNC
// =====================================================
function updateUIFromStorage() {
    chrome.storage.local.get(null, (data) => {
        if (chrome.runtime.lastError) return;

        console.log("Popup Debug - Read from Storage:", data);

        // Map storage data to state
        state.hasData = data.hasData || false;
        state.workingTime = data.workingTime || 0;
        state.breakTime = data.breakTime || 0;
        state.additionalTime = data.additionalTime || 0;
        state.totalTime = data.totalTime || 0;
        state.overusedBreak = data.overusedBreak || 0;
        state.breakRemaining = (data.breakRemaining !== undefined) ? data.breakRemaining : CONFIG.MAX_BREAK_MS;
        state.isWorking = data.isWorking || false;
        state.status = data.status || null;

        render();
    });
}

// =====================================================
// RENDERING
// =====================================================
function render() {
    // 1. Status Badge
    updateStatusBadge();

    // 2. Circular Progress (Break Remaining)
    const percentage = state.breakRemaining / CONFIG.MAX_BREAK_MS;
    const offset = circumference - (percentage * circumference);
    elements.progressCircle.style.strokeDashoffset = offset;

    // Color logic
    if (state.breakRemaining === 0) {
        elements.progressCircle.style.stroke = '#EF4444'; // Red
    } else if (state.breakRemaining < CONFIG.WARNING_THRESHOLD_MS) {
        elements.progressCircle.style.stroke = '#F59E0B'; // Orange
    } else {
        elements.progressCircle.style.stroke = '#2563EB'; // Blue
    }

    elements.timeRemaining.textContent = formatHHMMSS(state.breakRemaining);

    // 3. Stats Cards
    elements.workingTime.textContent = formatHHMMSS(state.workingTime);
    elements.breakUsed.textContent = formatHHMMSS(state.breakTime);
    elements.additionalTime.textContent = formatHHMMSS(state.additionalTime);
    elements.totalTime.textContent = formatHHMMSS(state.totalTime);

    // 4. Overused Break Indicator (Show/Hide)
    if (state.overusedBreak > 0) {
        const mins = Math.floor(state.overusedBreak / 60000);
        elements.overusedBreak.textContent = `Overused Break: +${mins} min`;
        elements.overusedBreak.style.display = 'block';
    } else {
        elements.overusedBreak.style.display = 'none';
    }

    // 5. No Data State
    elements.noDataMessage.style.display = state.hasData ? 'none' : 'block';
}

function updateStatusBadge() {
    elements.statusBadge.classList.remove('active', 'warning', 'inactive', 'danger');

    // 1. No Data
    if (!state.hasData) {
        elements.statusBadge.textContent = 'No Data';
        elements.statusBadge.classList.add('inactive');
        return;
    }

    // 2. Status from Content Script (Present, Late, Over Break Time)
    // If we have a specific status string from storage, use it.
    // Otherwise fallback to basic logic.
    if (state.status) {
        elements.statusBadge.textContent = state.status;

        if (state.status === 'Present') {
            elements.statusBadge.classList.add('active'); // Green
        } else if (state.status === 'Late') {
            elements.statusBadge.classList.add('warning'); // Orange
        } else if (state.status === 'Over Break Time') {
            elements.statusBadge.classList.add('danger'); // Red
        } else {
            elements.statusBadge.classList.add('active');
        }
    } else {
        // Fallback for backward compatibility
        if (state.overusedBreak > 0) {
            elements.statusBadge.textContent = 'Break Limit Exceeded';
            elements.statusBadge.classList.add('warning');
        } else if (state.isWorking) {
            elements.statusBadge.textContent = 'Tracking Active';
            elements.statusBadge.classList.add('active');
        } else {
            elements.statusBadge.textContent = 'On Break';
            elements.statusBadge.classList.add('warning');
        }
    }
}

// =====================================================
// UTILITIES
// =====================================================
function formatHHMMSS(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}
