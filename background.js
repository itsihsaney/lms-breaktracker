/* =====================================================
   LMS ATTENDANCE TRACKER - BACKGROUND SERVICE WORKER
   
   This service worker handles:
   - Message passing between content script and popup
   - Storage management
   ===================================================== */

console.log('LMS Attendance Tracker: Background service worker loaded');

// =====================================================
// MESSAGE HANDLER
// =====================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Background received message:', message);

    // Handle different message types here if needed
    if (message.type === 'UPDATE_DATA') {
        // Forward data updates to storage
        chrome.storage.local.set(message.data, () => {
            console.log('Data updated in storage');
            sendResponse({ success: true });
        });
        return true; // Keep channel open for async response
    }

    return false;
});

// =====================================================
// INSTALLATION
// =====================================================
chrome.runtime.onInstalled.addListener(() => {
    console.log('LMS Attendance Tracker installed');

    // Initialize storage with default values
    chrome.storage.local.set({
        breakUsed: 0,
        breakRemaining: 90 * 60 * 1000,
        workRemaining: 0,
        hasData: false
    });
});
