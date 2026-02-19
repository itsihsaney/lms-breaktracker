/* =====================================================
   LMS ATTENDANCE TRACKER - CONTENT SCRIPT (SINGLE SOURCE OF TRUTH)
   ===================================================== */

(() => {
    // Prevent multiple injections
    if (window._lmsTrackerActive) return;
    window._lmsTrackerActive = true;

    console.log("LMS Attendance Tracker: Data Engine V2.1 Logic Fixed");

    /* =====================================================
       1. CONSTANTS & CONFIGURATION
       ===================================================== */
    const CONFIG = {
        WORK_START_HOUR: 9,
        WORK_END_HOUR: 17,
        MAX_BREAK_MS: 90 * 60 * 1000,      // 90 minutes
        LATE_THRESHOLD_MS: 150 * 60 * 1000, // 2.5 hours threshold for status
        DEBOUNCE_MS: 800,                 // Debounce for DOM changes
        SYNC_INTERVAL_MS: 1000            // Interval for live calculations
    };

    let lastPayloadHash = "";

    /* =====================================================
       2. INITIALIZATION
       ===================================================== */
    function init() {
        setupObserver();

        // Initial delay to allow page content to settle
        setTimeout(processPage, 1500);

        // Periodic update for live timers (Working Time / Total Time)
        setInterval(processPage, CONFIG.SYNC_INTERVAL_MS);
    }

    /* =====================================================
       3. DATA EXTRACTION ENGINE (ROBUST & TARGETED)
       ===================================================== */
    function extractPunches() {
        const found = [];
        const today = new Date();
        const now = today.getTime();

        // Preparation for today's data filtering
        const d = today.getDate();
        const mShort = today.toLocaleString('default', { month: 'short' });
        const mFull = today.toLocaleString('default', { month: 'long' });

        // Search for relevant elements
        const candidates = document.querySelectorAll("td, div, span, p, tr");

        candidates.forEach(el => {
            if (el.children.length > 5) return;

            const text = el.textContent.trim();
            const match = text.match(/^(In|Out)\s?[-:]?\s?(\d{1,2}:\d{2}\s?(AM|PM))/i);

            if (match) {
                const type = match[1].toLowerCase();
                const timeStr = match[2];

                if (isTodayContext(el, d, mShort, mFull)) {
                    const parsedDate = parseTime(timeStr);
                    if (parsedDate) {
                        const punchMs = parsedDate.getTime();

                        // --- 3️⃣ IGNORE LMS AUTO CHECKOUT BEFORE 5PM ---
                        // Rule: If "Out" is exactly 5:00 PM but current time is before 5:00 PM, ignore it.
                        const isExactly5PM = (parsedDate.getHours() === 17 && parsedDate.getMinutes() === 0);
                        if (type === 'out' && isExactly5PM && now < punchMs) {
                            return;
                        }

                        found.push({ type, time: punchMs });
                    }
                }
            }
        });

        // De-duplication
        const unique = [];
        const seen = new Set();
        found.forEach(p => {
            const key = `${p.type}-${p.time}`;
            if (!seen.has(key)) {
                seen.add(key);
                unique.push(p);
            }
        });

        // Chronological sorting
        unique.sort((a, b) => a.time - b.time);

        return unique;
    }

    function isTodayContext(el, d, mShort, mFull) {
        let depth = 0;
        let curr = el;
        const patterns = ["Today", `${d} ${mShort}`, `${mShort} ${d}`, `${d} ${mFull}`, `${mFull} ${d}`];

        while (curr && depth < 5) {
            const content = curr.textContent;
            if (patterns.some(p => content.includes(p))) return true;
            curr = curr.parentElement;
            depth++;
        }
        return false;
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
       4. CALCULATION ENGINE (SINGLE SOURCE OF TRUTH)
       ===================================================== */
    function calculateMetrics(punches) {
        const now = Date.now();
        const today = new Date();
        const winStart9AM = new Date(today).setHours(CONFIG.WORK_START_HOUR, 0, 0, 0);

        let workingTime = 0;
        let breakTime = 0;
        let additionalTime = 0;
        let additionalBreakTime = 0;

        let activeInAt = null;
        let activeBreakAt = null;
        let firstIn = null;

        // Simulate state sequence (In -> Out -> In)
        punches.forEach(p => {
            if (p.type === 'in') {
                if (!firstIn) firstIn = p.time;

                if (activeBreakAt) {
                    const split = splitDuration(activeBreakAt, p.time);
                    breakTime += split.standard;
                    additionalBreakTime += split.additional;
                    activeBreakAt = null;
                }
                if (!activeInAt) activeInAt = p.time;
            } else if (p.type === 'out') {
                if (activeInAt) {
                    const split = splitDuration(activeInAt, p.time);
                    workingTime += split.standard;
                    additionalTime += split.additional;
                    activeInAt = null;
                }
                if (!activeBreakAt) activeBreakAt = p.time;
            }
        });

        // --- HANDLE LIVE STATE (CURRENTLY IN OR OUT) ---
        if (activeInAt) {
            const split = splitDuration(activeInAt, now);
            workingTime += split.standard;
            additionalTime += split.additional;
        } else if (activeBreakAt) {
            const split = splitDuration(activeBreakAt, now);
            breakTime += split.standard;
            additionalBreakTime += split.additional;
        }

        // --- 2️⃣ LATE CHECK-IN DEDUCTION ---
        // Rule: If check-in > 9:00 AM, deduct diff from breakRemaining (max 1 hour).
        let lateDeduction = 0;
        if (firstIn && firstIn > winStart9AM) {
            const lateDiff = firstIn - winStart9AM;
            lateDeduction = Math.min(lateDiff, 60 * 60 * 1000); // 1 hour cap
        }

        // --- 1️⃣ TOTAL TIME RULE ---
        // Rule: Total Time = Working Time + Additional Time (Breaks EXCLUDED)
        const totalTime = workingTime + additionalTime;

        // --- 4️⃣ BREAK WINDOW RULE & REMAINING ---
        // breakTime only includes "standard" (9-5) break durations per splitDuration().
        // breakRemaining is reduced by breakTime AND lateDeduction.
        const breakRemaining = Math.max(0, CONFIG.MAX_BREAK_MS - breakTime - lateDeduction);
        const overusedBreak = Math.max(0, (breakTime + lateDeduction) - CONFIG.MAX_BREAK_MS);

        const isWorking = !!activeInAt;

        return {
            workingTime,
            breakTime,
            additionalTime,
            additionalBreakTime,
            overusedBreak,
            breakRemaining,
            totalTime,
            isWorking,
            hasData: punches.length > 0
        };
    }

    function splitDuration(start, end) {
        const s = new Date(start);
        const winStart = new Date(s).setHours(CONFIG.WORK_START_HOUR, 0, 0, 0);
        const winEnd = new Date(s).setHours(CONFIG.WORK_END_HOUR, 0, 0, 0);

        let standard = 0;
        let additional = 0;

        if (end <= winStart || start >= winEnd) {
            additional = Math.max(0, end - start);
        } else {
            // Part before 9:00 AM
            if (start < winStart) additional += (winStart - start);
            // Part after 5:00 PM
            if (end > winEnd) additional += (end - winEnd);

            // Part inside 9:00 AM - 5:00 PM
            const effectiveStart = Math.max(start, winStart);
            const effectiveEnd = Math.min(end, winEnd);
            standard = Math.max(0, effectiveEnd - effectiveStart);
        }

        return { standard, additional };
    }

    /* =====================================================
       5. STATE SYNC & STORAGE
       ===================================================== */
    function processPage() {
        if (!chrome?.runtime?.id) return;

        try {
            const punches = extractPunches();
            const results = calculateMetrics(punches);

            // Determine Status String
            let status = "Present";
            if (results.breakRemaining === 0) {
                const penalty = (results.breakTime + results.overusedBreak); // Simple legacy status trigger
                status = (penalty >= CONFIG.LATE_THRESHOLD_MS) ? "Over Break Time" : "Late";
            }

            // Construct Full Payload
            const payload = {
                workingTime: results.workingTime,
                breakTime: results.breakTime,
                additionalTime: results.additionalTime,
                overusedBreak: results.overusedBreak,
                totalTime: results.totalTime,
                breakRemaining: results.breakRemaining,
                hasData: results.hasData,
                isWorking: results.isWorking,
                status: status,
                lastUpdated: Date.now()
            };

            // Debounce Storage Writes
            const hash = JSON.stringify(payload);
            if (hash === lastPayloadHash) return;
            lastPayloadHash = hash;

            chrome.storage.local.set(payload);

        } catch (error) {
            console.error("LMS Processor Error:", error);
        }
    }

    /* =====================================================
       6. OBSERVER & EVENTS
       ===================================================== */
    function setupObserver() {
        let debounceTimer;
        const observer = new MutationObserver(() => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(processPage, CONFIG.DEBOUNCE_MS);
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        window.addEventListener('beforeunload', () => observer.disconnect());
    }

    init();

})();
