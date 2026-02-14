/* =====================================================
   LMS ATTENDANCE TRACKER - CONTENT SCRIPT (SINGLE SOURCE OF TRUTH)
   ===================================================== */

(() => {
    console.log("LMS Attendance Tracker: Content Script Loaded");

    /* =====================================================
       CONSTANTS & CONFIG
    ===================================================== */
    const CONFIG = {
        WORK_START_HOUR: 9,
        WORK_END_HOUR: 17,
        MAX_BREAK_MS: 90 * 60 * 1000, // 90 minutes
        LATE_THRESHOLD_MS: 150 * 60 * 1000 // 2h 30m for "Late" vs "Over Break"
    };

    /* =====================================================
       CONTEXT SAFETY
    ===================================================== */
    function isContextValid() {
        try {
            return !!(chrome && chrome.runtime && chrome.runtime.id);
        } catch (e) {
            return false;
        }
    }

    function getTodayKey() {
        const d = new Date();
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }

    /* =====================================================
       INITIALIZATION & DAILY RESET
    ===================================================== */
    if (isContextValid()) {
        resetIfNewDay().then(() => {
            scrapeTimeline();
            setupMutationObserver();
        });
    }

    function resetIfNewDay() {
        return new Promise((resolve) => {
            if (!isContextValid()) return resolve();

            // Check daily reset on load
            chrome.runtime.sendMessage({ action: 'CHECK_DAILY_RESET' }, () => {
                if (chrome.runtime.lastError) { /* ignore */ }
                resolve();
            });
        });
    }

    /* =====================================================
       SCRAPER ENGINE (EXTRACT RAW PUNCHES)
    ===================================================== */
    function scrapeTimeline() {
        if (!isContextValid()) {
            return cleanupObserver();
        }

        const rawTimes = extractTimes();

        // --- 1. Identify First Check-In ---
        const firstPunchIn = rawTimes.length > 0 ? rawTimes[0] : null;

        // --- 2. Calculate Durations ---
        const metrics = calculateMetrics(rawTimes);

        // --- 3. Determine Status ---
        // Status logic:
        // Present: Break Remaining > 0
        // Late: Break Remaining <= 0 BUT Total Additional Break < 2.5 hours
        // Over Break Time: Total Additional Break >= 2.5 hours

        let status = "Present";
        const totalExcessBreak = metrics.additionalBreakTime + metrics.overusedBreak; // Combine both types of excess

        if (metrics.breakRemaining === 0) {
            if (totalExcessBreak >= CONFIG.LATE_THRESHOLD_MS) {
                status = "Over Break Time";
            } else {
                status = "Late";
            }
        }

        // --- 4. Sync Data ---
        const dataPayload = {
            currentDate: getTodayKey(),
            workingTime: metrics.workingTime,
            breakTime: metrics.breakTime, // Standard break used (9-5)
            additionalBreakTime: metrics.additionalBreakTime, // Break used outside 9-5
            additionalTime: metrics.additionalTime, // Work outside 9-5
            overusedBreak: metrics.overusedBreak, // Excess of standard break
            totalTime: metrics.totalTime,
            breakRemaining: metrics.breakRemaining,
            hasData: rawTimes.length > 0,
            isWorking: metrics.isWorking,
            status: status, // New Status Field
            times: rawTimes.map(t => t.toISOString()),
            lastUpdated: Date.now()
        };

        console.log("LMS Calc:", dataPayload);

        // Save to Storage (Read by Popup)
        chrome.storage.local.set(dataPayload);

        // Sync to Background (for long-running state if needed)
        chrome.runtime.sendMessage({
            action: 'SYNC_CALCULATED_DATA',
            data: dataPayload
        });
    }

    /* =====================================================
       CALCULATION LOGIC (CORE RULES)
    ===================================================== */
    function calculateMetrics(times) {
        const now = new Date();
        let workingTime = 0;       // 9AM-5PM Work
        let additionalTime = 0;    // <9AM or >5PM Work
        let breakTime = 0;         // 9AM-5PM Break
        let additionalBreakTime = 0; // <9AM or >5PM Break

        // --- A. Process Work Sessions (Pair: In -> Out) ---
        for (let i = 0; i < times.length; i += 2) {
            const inTime = times[i];
            // If no Out punch, use NOW (live tracking)
            const outTime = (times[i + 1]) ? times[i + 1] : now;

            const split = splitDurationByWindow(inTime, outTime);
            workingTime += split.standard;
            additionalTime += split.additional;
        }

        // --- B. Process Break Sessions (Pair: Out -> Next In) ---
        for (let i = 1; i < times.length; i += 2) {
            const breakStart = times[i];
            // If no Next In punch, use NOW (live tracking on break)
            const breakEnd = (times[i + 1]) ? times[i + 1] : now;

            // Only calculate break if we actually have a start time (Out punch)
            if (breakStart) {
                const split = splitDurationByWindow(breakStart, breakEnd);
                breakTime += split.standard;
                additionalBreakTime += split.additional;
            }
        }

        // --- C. Derived Metrics ---

        // 1. Break Remaining (Based ONLY on 9-5 Break Time)
        // Max 90 mins. Cannot be negative.
        const breakRemaining = Math.max(0, CONFIG.MAX_BREAK_MS - breakTime);

        // 2. Overused Break (Excess within 9-5 window)
        const overusedBreak = Math.max(0, breakTime - CONFIG.MAX_BREAK_MS);

        // 3. Total Time (First In -> Now/Last Out)
        // Rule: Start from First In. Never stop if currently working.
        // If checked out, stop at last Out.
        // BUT user requested "Total Time must run always... until last Check Out"
        // Interpretation: If currently IN, Total Time = Now - First In.
        // If currently OUT, Total Time = Last Out - First In.

        let totalTime = 0;
        if (times.length > 0) {
            const firstIn = times[0];
            const lastOut = (times.length % 2 === 0) ? times[times.length - 1] : now;
            totalTime = Math.max(0, lastOut - firstIn);
        }

        // 4. Is Working? (Odd number of punches = Checked In)
        const isWorking = times.length % 2 !== 0;

        return {
            workingTime,
            additionalTime,
            breakTime,
            additionalBreakTime,
            overusedBreak,
            breakRemaining,
            totalTime,
            isWorking
        };
    }

    // Helper: Split a duration into "Standard (9-5)" and "Additional"
    function splitDurationByWindow(start, end) {
        const s = new Date(start);
        const e = new Date(end);

        const startWindow = new Date(s);
        startWindow.setHours(CONFIG.WORK_START_HOUR, 0, 0, 0); // 9:00 AM

        const endWindow = new Date(s);
        endWindow.setHours(CONFIG.WORK_END_HOUR, 0, 0, 0); // 5:00 PM

        let standard = 0;
        let additional = 0;

        // 1. Entirely Before 9 AM
        if (e <= startWindow) {
            additional += (e - s);
        }
        // 2. Entirely After 5 PM
        else if (s >= endWindow) {
            additional += (e - s);
        }
        // 3. Overlap / Inside Window
        else {
            // Part before 9 AM
            if (s < startWindow) {
                additional += (startWindow - s);
            }
            // Part after 5 PM
            if (e > endWindow) {
                additional += (e - endWindow);
            }
            // Part inside 9 AM - 5 PM
            const effectiveStart = (s < startWindow) ? startWindow : s;
            const effectiveEnd = (e > endWindow) ? endWindow : e;

            if (effectiveEnd > effectiveStart) {
                standard += (effectiveEnd - effectiveStart);
            }
        }

        return { standard, additional };
    }

    /* =====================================================
       DATA EXTRACTION (KEEP EXISTING ROBUST LOGIC)
    ===================================================== */
    function extractTimes() {
        const times = [];
        const cells = document.querySelectorAll("td, div, span");

        cells.forEach(cell => {
            const text = cell.textContent.trim();
            if (/^(In|Out)\s?-\s?\d{1,2}:\d{2}\s?(AM|PM)/i.test(text)) {
                const match = text.match(/-\s?(\d{1,2}:\d{2}\s?(AM|PM))/i);
                if (match && match[1]) {
                    const parsed = parseTime(match[1]);
                    if (parsed) {
                        const today = new Date();
                        if (parsed.toDateString() === today.toDateString()) {
                            // Ignore future times (allow 1 min drift)
                            if (parsed <= new Date(today.getTime() + 60000)) {
                                times.push(parsed);
                            }
                        }
                    }
                }
            }
        });

        const uniqueTimes = Array.from(new Set(times.map(t => t.getTime())))
            .map(t => new Date(t));

        return uniqueTimes.sort((a, b) => a - b);
    }

    function parseTime(timeStr) {
        const match = timeStr.match(/(\d{1,2}):(\d{2})\s?(AM|PM)/i);
        if (!match) return null;
        let hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const period = match[3].toUpperCase();
        if (period === "PM" && hours !== 12) hours += 12;
        if (period === "AM" && hours === 12) hours = 0;
        const date = new Date();
        date.setHours(hours, minutes, 0, 0);
        return date;
    }

    /* =====================================================
       UTILITIES & OBSERVER
    ===================================================== */
    function setupMutationObserver() {
        const body = document.body;
        if (!body) {
            setTimeout(setupMutationObserver, 2000);
            return;
        }

        const observer = new MutationObserver(() => {
            if (!isContextValid()) return cleanupObserver();
            // Debounce Scrape
            clearTimeout(window._scrapeDebounce);
            window._scrapeDebounce = setTimeout(scrapeTimeline, 500);
        });

        observer.observe(body, { childList: true, subtree: true, characterData: true });
        window.attendanceObserver = observer;
    }

    function cleanupObserver() {
        if (window.attendanceObserver) {
            try { window.attendanceObserver.disconnect(); } catch (e) { }
            window.attendanceObserver = null;
        }
    }

    // Periodic Update (Every 1s for Live Time)
    setInterval(scrapeTimeline, 1000);

})();
