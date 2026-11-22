// ============================================================
//  Recursive Tasks — Google Apps Script
//  Config source : Google Sheet
//  Target        : Google Tasks API
// ============================================================

// ─── GLOBAL CONFIG ───────────────────────────────────────────
// Name of the Google Sheet used as the source of truth.
// The sheet must be shared with the same Google account.
const CONFIG_SHEET_NAME = "Recursive Tasks";

// Name of the tab inside the sheet that contains the rules.
const CONFIG_TAB_NAME = "Tasks";

// Key used to cache the Sheet ID in PropertiesService.
const SHEET_ID_PROPERTY = "CONFIG_SHEET_ID";

// ─── MAIN ENTRY POINT ────────────────────────────────────────
/**
 * Main function: checks recurrence rules and creates tasks
 * whose appear date is today or in the past.
 * Can be called manually or via a daily time-based trigger.
 */
function checkAndCreateTasks() {
    const rules = loadRulesFromSheet();
    if (!rules || rules.length === 0) {
        Logger.log("No rules found in the Google Sheet.");
        return;
    }

    const today = getToday();
    Logger.log(`Checking tasks for: ${formatDate(today)}`);

    let created = 0;
    let skipped = 0;

    for (const rule of rules) {
        if (!rule.enabled) {
            skipped++;
            continue;
        }

        try {
            const result = processRule(rule, today);
            if (result === "created") created++;
            else skipped++;
        } catch (e) {
            Logger.log(`[ERROR] Rule "${rule.title}": ${e.message}`);
        }
    }

    Logger.log(`Done — ${created} task(s) created, ${skipped} skipped.`);
}

/**
 * Processes a single recurrence rule and creates the task if needed.
 * @param {Object} rule  - The rule loaded from the Sheet.
 * @param {Date}   today - Today's date (midnight UTC).
 * @returns {string} "created" | "skipped"
 */
function processRule(rule, today) {
    // 1. Calculate the next due date
    const dueDate = getNextOccurrence(rule, today);
    if (!dueDate) {
        Logger.log(`[SKIP] "${rule.title}": could not calculate next occurrence.`);
        return "skipped";
    }

    // 2. Calculate the appear date
    const appearDate = getAppearDate(rule, dueDate);

    // 3. Check if we are within the appear window
    if (today < appearDate) {
        Logger.log(`[SKIP] "${rule.title}": appears on ${formatDate(appearDate)}, due on ${formatDate(dueDate)}.`);
        return "skipped";
    }

    // 4. Find or create the target Google Tasks list
    const tasklistId = getOrCreateTaskList(rule.tasklistName || "@default");

    // 5. Check if the task already exists (deduplication)
    if (taskAlreadyExists(tasklistId, rule.title, dueDate)) {
        Logger.log(`[SKIP] "${rule.title}" already exists for ${formatDate(dueDate)}.`);
        return "skipped";
    }

    // 6. Create the task
    Tasks.Tasks.insert(
        {
            title: rule.title,
            notes: rule.notes || "",
            due: dueDate.toISOString(),
        },
        tasklistId
    );

    Logger.log(`[OK] Task created: "${rule.title}" — due on ${formatDate(dueDate)}.`);
    return "created";
}

// ─── RECURRENCE LOGIC ────────────────────────────────────────

/**
 * Calculates the next due date for a weekly recurrence rule.
 * Finds the next occurrence of "due_day" (0=Sun, 1=Mon ... 6=Sat) starting from today.
 *
 * @param {Object} rule  - The recurrence rule.
 * @param {Date}   today - Today's date (midnight UTC).
 * @returns {Date|null}
 */
function getNextOccurrence(rule, today) {
    if (rule.recurrence !== "weekly") {
        Logger.log(`[WARN] Recurrence type "${rule.recurrence}" is not supported for "${rule.title}".`);
        return null;
    }

    const dueDayOfWeek = parseDayOfWeek(rule.dueDay); // 0 (Sun) to 6 (Sat)
    if (dueDayOfWeek === null) return null;

    const candidate = new Date(today);
    const todayDow = candidate.getUTCDay(); // 0=Sun
    const daysUntilDue = (dueDayOfWeek - todayDow + 7) % 7;

    candidate.setUTCDate(candidate.getUTCDate() + daysUntilDue);
    return candidate;
}

/**
 * Calculates the date from which the task should become visible.
 * Two modes (advance_day_of_week takes priority):
 *   - "advance_day_of_week": A fixed weekday before the due date
 *                            (e.g. "saturday" -> a Tuesday task appears the previous Saturday)
 *   - "advance_days":        N days before the due date (e.g. 3 -> appears 3 days early)
 *
 * @param {Object} rule    - The recurrence rule.
 * @param {Date}   dueDate - The calculated due date.
 * @returns {Date}
 */
function getAppearDate(rule, dueDate) {
    // Mode 1: advance_day_of_week (fixed weekday before the due date)
    if (rule.advanceDayOfWeek && String(rule.advanceDayOfWeek).trim() !== "") {
        const targetDow = parseDayOfWeek(rule.advanceDayOfWeek);
        if (targetDow !== null) {
            const appear = new Date(dueDate);
            const offset = (dueDate.getUTCDay() - targetDow + 7) % 7;
            appear.setUTCDate(appear.getUTCDate() - offset);
            return appear;
        }
    }

    // Mode 2: advance_days (N days before the due date)
    if (rule.advanceDays !== null && rule.advanceDays !== undefined && String(rule.advanceDays).trim() !== "") {
        const days = parseInt(rule.advanceDays, 10);
        if (!isNaN(days)) {
            const appear = new Date(dueDate);
            appear.setUTCDate(appear.getUTCDate() - days);
            return appear;
        }
    }

    // Default: appears on the due date itself
    return new Date(dueDate);
}

// ─── GOOGLE TASKS HELPERS ────────────────────────────────────

/**
 * Returns the ID of an existing Google Tasks list by its title,
 * or creates a new one if it does not exist.
 * "@default" returns the user's default list.
 *
 * @param {string} name - List name ("@default" for the default list).
 * @returns {string} The tasklist ID.
 */
function getOrCreateTaskList(name) {
    const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];

    if (!name || name === "@default") {
        return lists.length > 0 ? lists[0].id : "@default";
    }

    for (const list of lists) {
        if (list.title === name) return list.id;
    }

    // Create the list if it does not exist
    const newList = Tasks.Tasklists.insert({ title: name });
    Logger.log(`[INFO] Google Tasks list created: "${name}".`);
    return newList.id;
}

/**
 * Checks whether a task with the same title and due date already exists
 * in the given tasklist (deduplication guard).
 *
 * @param {string} tasklistId - The tasklist ID.
 * @param {string} title      - The task title to check.
 * @param {Date}   dueDate    - The due date.
 * @returns {boolean}
 */
function taskAlreadyExists(tasklistId, title, dueDate) {
    const dueDateStr = dueDate.toISOString().split("T")[0]; // "YYYY-MM-DD"
    let pageToken = null;

    do {
        const params = { maxResults: 100, showCompleted: false, showHidden: false };
        if (pageToken) params.pageToken = pageToken;

        const response = Tasks.Tasks.list(tasklistId, params);
        const tasks = response.items || [];

        for (const task of tasks) {
            const taskDueStr = task.due ? task.due.split("T")[0] : "";
            if (task.title === title && taskDueStr === dueDateStr) {
                return true;
            }
        }

        pageToken = response.nextPageToken;
    } while (pageToken);

    return false;
}

// ─── GOOGLE SHEET — LOADING RULES ────────────────────────────

/**
 * Loads recurrence rules from the configured Google Sheet.
 * Looks up the sheet ID in PropertiesService first,
 * then falls back to searching by name in the user's Drive.
 *
 * Expected column headers in CONFIG_TAB_NAME (row 1):
 *   title | tasklist_name | recurrence | due_day | advance_days | advance_day_of_week | notes | enabled
 *
 * @returns {Object[]} Array of rule objects.
 */
function loadRulesFromSheet() {
    const sheet = getConfigSheet();
    if (!sheet) {
        throw new Error(
            `Google Sheet "${CONFIG_SHEET_NAME}" not found. Create it or set its ID via setSheetId().`
        );
    }

    const data = sheet.getDataRange().getValues();
    if (data.length < 2) return []; // Headers only or empty

    const headers = data[0].map((h) => toCamelCase(h.toString().trim().toLowerCase()));
    const rules = [];

    for (let i = 1; i < data.length; i++) {
        const row = data[i];
        const rule = {};
        headers.forEach((header, j) => {
            rule[header] = row[j];
        });

        // Normalize values
        rule.enabled = String(rule.enabled).toLowerCase() === "true" || rule.enabled === true;
        rule.title = String(rule.title || "").trim();
        rule.tasklistName = String(rule.tasklistName || "@default").trim();
        rule.recurrence = String(rule.recurrence || "").toLowerCase().trim();
        rule.dueDay = String(rule.dueDay || "").toLowerCase().trim();
        rule.notes = String(rule.notes || "").trim();

        if (!rule.title) continue; // Skip rows with no title
        rules.push(rule);
    }

    Logger.log(`${rules.length} rule(s) loaded from the Sheet.`);
    return rules;
}

/**
 * Retrieves the configuration tab from the Google Sheet.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet|null}
 */
function getConfigSheet() {
    let sheetId = PropertiesService.getUserProperties().getProperty(SHEET_ID_PROPERTY);
    let spreadsheet = null;

    if (sheetId) {
        try {
            spreadsheet = SpreadsheetApp.openById(sheetId);
        } catch (e) {
            Logger.log("[WARN] Cached Sheet ID is invalid, searching by name...");
            sheetId = null;
        }
    }

    if (!spreadsheet) {
        // Search by name in Drive
        const files = DriveApp.getFilesByName(CONFIG_SHEET_NAME);
        if (!files.hasNext()) return null;
        spreadsheet = SpreadsheetApp.open(files.next());
        // Cache the ID for future calls
        PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, spreadsheet.getId());
    }

    return spreadsheet.getSheetByName(CONFIG_TAB_NAME);
}

// ─── TRIGGER & SETUP ─────────────────────────────────────────

/**
 * Installs a daily time-based trigger that calls checkAndCreateTasks() every morning at 6 AM.
 * If a trigger already exists for that function, it is removed and recreated.
 * Run this function ONCE manually from the Apps Script editor.
 */
function setupDailyTrigger() {
    // Remove any existing triggers for this function
    const triggers = ScriptApp.getProjectTriggers();
    for (const trigger of triggers) {
        if (trigger.getHandlerFunction() === "checkAndCreateTasks") {
            ScriptApp.deleteTrigger(trigger);
        }
    }

    // Create a new daily trigger at 6:00 AM (project timezone: Europe/Paris)
    ScriptApp.newTrigger("checkAndCreateTasks")
        .timeBased()
        .everyDays(1)
        .atHour(6)
        .create();

    Logger.log("Daily trigger installed: checkAndCreateTasks() will run every day at 6:00 AM.");
}

/**
 * Manually sets the Google Sheet ID if the automatic search by name fails.
 * Usage: paste the Sheet ID below and run this function from the editor.
 */
function setSheetId() {
    const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE"; // <- Replace with the actual Sheet ID
    PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, SHEET_ID);
    Logger.log(`Sheet ID saved: ${SHEET_ID}`);
}

// ─── UTILITIES ───────────────────────────────────────────────

/**
 * Returns today's date at midnight UTC.
 * @returns {Date}
 */
function getToday() {
    const now = new Date();
    return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

/**
 * Formats a date as "DD/MM/YYYY" for log output.
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
    return `${String(date.getUTCDate()).padStart(2, "0")}/${String(date.getUTCMonth() + 1).padStart(2, "0")}/${date.getUTCFullYear()}`;
}

/**
 * Converts a day name to a day-of-week number (0=Sunday to 6=Saturday).
 * Accepts full names in French or English, abbreviations, or a direct number.
 *
 * @param {string|number} day
 * @returns {number|null}
 */
function parseDayOfWeek(day) {
    if (day === null || day === undefined || day === "") return null;
    const d = String(day).toLowerCase().trim();
    const map = {
        // French
        dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
        // English
        sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
        // French abbreviations
        dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6,
        // English abbreviations
        sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    };
    if (map[d] !== undefined) return map[d];
    const n = parseInt(d, 10);
    if (!isNaN(n) && n >= 0 && n <= 6) return n;
    Logger.log(`[WARN] Unrecognized day name: "${day}"`);
    return null;
}

/**
 * Converts a snake_case column header to camelCase.
 * e.g. "tasklist_name" -> "tasklistName"
 *
 * @param {string} str
 * @returns {string}
 */
function toCamelCase(str) {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}