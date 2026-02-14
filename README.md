# LMS Attendance Tracker

A Chrome Extension (Manifest V3) that automatically reads attendance data from Bridgeon LMS and calculates remaining work and break time.

![Extension Icon](icon128.png)

## Features

✅ **Automatic Data Parsing**
- Reads attendance table from Bridgeon LMS
- Extracts IN/OUT times using regex
- No manual input needed

✅ **Smart Calculations**
- Break time = OUT → next IN
- Work time = IN → OUT
- Remaining break = 90 min - used
- Remaining work = time until 5 PM

✅ **Live Updates**
- MutationObserver watches for new punches
- Automatically recalculates when you punch
- Real-time countdown

✅ **Visual Progress Ring**
- Animated SVG circular progress bar
- Color-coded: Blue → Orange → Red
- Shows break remaining at a glance

✅ **Clean Code**
- Beginner-friendly comments
- Modular functions
- Production-ready
- Portfolio quality

## Installation

1. Download or clone this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top-right)
4. Click **Load unpacked**
5. Select the `auto-attendance-tracker` folder
6. Extension icon will appear in toolbar

## Usage

### Step 1: Visit Attendance Page
Navigate to: `https://student.bridgeon.in/attendance`

### Step 2: Extension Automatically Parses
The content script will:
- Find today's attendance row
- Extract all IN/OUT times
- Calculate break and work time
- Update storage

### Step 3: View Data in Popup
Click the extension icon to see:
- Break Used
- Break Remaining (out of 90 min)
- Work Remaining (until 5 PM)
- Circular progress ring

### Step 4: Live Updates
When you punch in/out:
- MutationObserver detects the change
- Extension automatically recalculates
- Popup updates in real-time

## How It Works

### DOM Parsing Strategy

The extension uses **CSS-class-independent** parsing:

```javascript
// Query all table rows
const rows = document.querySelectorAll('table tbody tr');

// Extract times using regex
const TIME_REGEX = /(\d{1,2}:\d{2}\s?(AM|PM))/gi;

// Parse times from expanded rows
// "In - 08:46 AM"
// "Out - 12:30 PM"
```

### Time Calculations

**Break Time:**
```javascript
// For times: [IN1, OUT1, IN2, OUT2, IN3]
// Breaks: (OUT1 → IN2), (OUT2 → IN3)
totalBreak = (IN2 - OUT1) + (IN3 - OUT2)
```

**Work Time:**
```javascript
// Work: (IN1 → OUT1), (IN2 → OUT2), (IN3 → now if active)
totalWork = (OUT1 - IN1) + (OUT2 - IN2) + ...
```

**Remaining Break:**
```javascript
remainingBreak = 90 minutes - totalBreak
```

**Remaining Work:**
```javascript
const endOfDay = new Date()
endOfDay.setHours(17, 0, 0, 0) // 5:00 PM
remainingWork = endOfDay - now
```

### MutationObserver

Watches the attendance table for changes:

```javascript
const observer = new MutationObserver((mutations) => {
  // Re-parse table when DOM changes
  parseAttendanceTable()
})

observer.observe(tableContainer, {
  childList: true,      // New rows added
  subtree: true,        // Watch all descendants
  characterData: true   // Text changes
})
```

## File Structure

```
auto-attendance-tracker/
├── manifest.json       # Manifest V3 configuration
├── content.js          # DOM parsing & calculations
├── popup.html          # Popup UI structure
├── popup.js            # Popup logic & animations
├── styles.css          # Modern styling
├── background.js       # Service worker
├── icon16.png          # Extension icon (16x16)
├── icon48.png          # Extension icon (48x48)
├── icon128.png         # Extension icon (128x128)
└── README.md           # This file
```

## Edge Cases Handled

✅ **Odd number of IN/OUT**: If last punch is IN, calculates work until now  
✅ **Currently active session**: Includes current session in work time  
✅ **No attendance today**: Shows 0 break, 0 work  
✅ **Already punched out**: Shows final values  
✅ **Negative values**: Prevented using `Math.max(0, value)`

## Technical Details

### Content Script
- **Injection**: Only on `https://student.bridgeon.in/attendance*`
- **Run at**: `document_idle` (after DOM is ready)
- **Functions**:
  - `extractTimes()` - Parse table rows
  - `parseTime(timeStr)` - Convert "08:46 AM" to Date
  - `calculateBreak(times)` - Calculate total break
  - `calculateWork(times)` - Calculate total work
  - `updateStorage(data)` - Save to chrome.storage

### Popup
- **Width**: 320px
- **Updates**: Listens to `chrome.storage.onChanged`
- **Animation**: `requestAnimationFrame` for smooth countdown
- **Color States**:
  - Blue (#2563EB): > 15 min remaining
  - Orange (#F59E0B): < 15 min remaining
  - Red (#DC2626): 0 min remaining

### Storage Schema
```javascript
{
  breakUsed: milliseconds,
  breakRemaining: milliseconds,
  workRemaining: milliseconds,
  hasData: boolean,
  lastUpdated: timestamp,
  times: [ISO date strings]
}
```

## Troubleshooting

### Extension not working?
1. Make sure you're on `https://student.bridgeon.in/attendance`
2. Check if attendance table is visible
3. Open DevTools Console (F12) and look for logs
4. Reload the extension

### No data showing?
1. Make sure you have attendance for today
2. Try expanding the attendance row (click on it)
3. Check console for parsing errors

### Times incorrect?
1. Verify times in LMS match what extension shows
2. Check console logs for extracted times
3. Report issue with screenshot

## Browser Compatibility

- ✅ Chrome (Manifest V3)
- ✅ Edge (Chromium-based)
- ✅ Brave
- ✅ Opera

## Code Quality

✅ ES6 syntax  
✅ Modular functions  
✅ No global pollution  
✅ No external libraries  
✅ Beginner-friendly comments  
✅ Production-ready  
✅ Portfolio quality

## License

MIT License - Free to use in your portfolio!

---

**Built for Bridgeon students** 🎓
