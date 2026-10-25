/**
 * Recursive Tasks — Google Apps Script
 * Automatically creates recurring Google Tasks from rules defined in a Google Sheet.
 */

const CONFIG_SHEET_NAME = "Recursive Tasks";
const CONFIG_TAB_NAME = "Tasks";
const SHEET_ID_PROPERTY = "CONFIG_SHEET_ID";

// Entry point triggered daily (or run manually)
function checkAndCreateTasks() {
  const rules = loadRulesFromSheet();
  if (!rules || rules.length === 0) {
    Logger.log("No rules found in config sheet.");
    return;
  }

  const today = getToday();
  Logger.log(`Checking tasks for ${formatDate(today)}...`);

  let created = 0;
  let skipped = 0;

  for (const rule of rules) {
    if (!rule.enabled) {
      skipped++;
      continue;
    }

    try {
      const res = processRule(rule, today);
      if (res === "created") created++;
      else skipped++;
    } catch (err) {
      Logger.log(`[ERROR] "${rule.title}": ${err.message}`);
    }
  }

  Logger.log(`Finished: ${created} created, ${skipped} skipped.`);
}

function processRule(rule, today) {
  const dueDate = getNextOccurrence(rule, today);
  if (!dueDate) {
    Logger.log(`[SKIP] "${rule.title}": unable to compute next due date.`);
    return "skipped";
  }

  // Check if task should appear yet
  const appearDate = getAppearDate(rule, dueDate);
  if (today < appearDate) {
    Logger.log(`[SKIP] "${rule.title}": scheduled to appear on ${formatDate(appearDate)} (due ${formatDate(dueDate)})`);
    return "skipped";
  }

  const tasklistId = getOrCreateTaskList(rule.tasklistName || "@default");
  const taskId = generateTaskId(rule, dueDate);

  // Prevent duplicate tasks using unique ID tag
  if (taskAlreadyExists(tasklistId, taskId)) {
    Logger.log(`[SKIP] "${rule.title}": already exists (${taskId})`);
    return "skipped";
  }

  Tasks.Tasks.insert(
    {
      title: rule.title,
      notes: buildTaskNotes(rule.notes, taskId),
      due: dueDate.toISOString(),
    },
    tasklistId
  );

  Logger.log(`[OK] Created "${rule.title}" (due ${formatDate(dueDate)}, ID: ${taskId})`);
  return "created";
}

function generateTaskId(rule, dueDate) {
  const yyyy = dueDate.getUTCFullYear();
  const mm = String(dueDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dueDate.getUTCDate()).padStart(2, "0");
  const hh = String(dueDate.getUTCHours()).padStart(2, "0");
  const min = String(dueDate.getUTCMinutes()).padStart(2, "0");
  const row = String(rule.rowIndex || 0).padStart(3, "0");

  return `RTid${yyyy}${mm}${dd}${hh}${min}${row}`;
}

function buildTaskNotes(userNotes, taskId) {
  const clean = (userNotes || "").trim();
  const tag = `[${taskId}]`;
  return clean ? `${clean}\n\n${tag}` : tag;
}

function getNextOccurrence(rule, today) {
  if (rule.recurrence !== "weekly") {
    Logger.log(`[WARN] Recurrence type "${rule.recurrence}" not supported yet.`);
    return null;
  }

  const dueDow = parseDayOfWeek(rule.dueDay);
  if (dueDow === null) return null;

  const candidate = new Date(today);
  const offset = (dueDow - candidate.getUTCDay() + 7) % 7;
  candidate.setUTCDate(candidate.getUTCDate() + offset);
  return candidate;
}

// Calculate appear date based on advance days or advance day of week
function getAppearDate(rule, dueDate) {
  if (rule.advanceDayOfWeek && String(rule.advanceDayOfWeek).trim() !== "") {
    const targetDow = parseDayOfWeek(rule.advanceDayOfWeek);
    if (targetDow !== null) {
      const appear = new Date(dueDate);
      appear.setUTCDate(appear.getUTCDate() - ((dueDate.getUTCDay() - targetDow + 7) % 7));
      return appear;
    }
  }

  if (rule.advanceDays != null && String(rule.advanceDays).trim() !== "") {
    const days = parseInt(rule.advanceDays, 10);
    if (!isNaN(days)) {
      const appear = new Date(dueDate);
      appear.setUTCDate(appear.getUTCDate() - days);
      return appear;
    }
  }

  return new Date(dueDate);
}

function getOrCreateTaskList(name) {
  const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];

  if (!name || name === "@default") {
    return lists.length > 0 ? lists[0].id : "@default";
  }

  const existing = lists.find((l) => l.title === name);
  if (existing) return existing.id;

  const created = Tasks.Tasklists.insert({ title: name });
  Logger.log(`Created new task list: "${name}"`);
  return created.id;
}

function taskAlreadyExists(tasklistId, taskId) {
  let pageToken = null;

  do {
    const params = {
      maxResults: 100,
      showCompleted: true,
      showHidden: true,
    };
    if (pageToken) params.pageToken = pageToken;

    const res = Tasks.Tasks.list(tasklistId, params);
    for (const task of res.items || []) {
      if ((task.notes || "").includes(taskId)) {
        return true;
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  return false;
}

function loadRulesFromSheet() {
  const sheet = getConfigSheet();
  if (!sheet) {
    throw new Error(`Sheet "${CONFIG_SHEET_NAME}" not found. Run setSheetId() to configure.`);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map((h) => toCamelCase(h.toString().trim().toLowerCase()));
  const rules = [];

  for (let i = 1; i < data.length; i++) {
    const rule = {};
    headers.forEach((h, j) => {
      rule[h] = data[i][j];
    });

    rule.rowIndex = i + 1; // Row number in Google Sheet (1-based)
    rule.enabled = String(rule.enabled).toLowerCase() === "true" || rule.enabled === true;
    rule.title = String(rule.title || "").trim();
    rule.tasklistName = String(rule.tasklistName || "@default").trim();
    rule.recurrence = String(rule.recurrence || "").toLowerCase().trim();
    rule.dueDay = String(rule.dueDay || "").toLowerCase().trim();
    rule.notes = String(rule.notes || "").trim();

    if (rule.title) rules.push(rule);
  }

  Logger.log(`Loaded ${rules.length} rule(s) from sheet.`);
  return rules;
}

function getConfigSheet() {
  let sheetId = PropertiesService.getUserProperties().getProperty(SHEET_ID_PROPERTY);
  let spreadsheet = null;

  if (sheetId) {
    try {
      spreadsheet = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      sheetId = null;
    }
  }

  if (!spreadsheet) {
    const files = DriveApp.getFilesByName(CONFIG_SHEET_NAME);
    if (!files.hasNext()) return null;
    spreadsheet = SpreadsheetApp.open(files.next());
    PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, spreadsheet.getId());
  }

  return spreadsheet.getSheetByName(CONFIG_TAB_NAME);
}

// Run once to install the daily 6:00 AM trigger
function setupDailyTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "checkAndCreateTasks") {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger("checkAndCreateTasks").timeBased().everyDays(1).atHour(6).create();
  Logger.log("Daily trigger set for 6:00 AM.");
}

// Run once if auto-detection by name fails
function setSheetId() {
  const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
  PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, SHEET_ID);
  Logger.log(`Saved sheet ID: ${SHEET_ID}`);
}

function getToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDate(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function parseDayOfWeek(day) {
  if (!day && day !== 0) return null;
  const d = String(day).toLowerCase().trim();
  const map = {
    dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  if (map[d] !== undefined) return map[d];
  const n = parseInt(d, 10);
  if (!isNaN(n) && n >= 0 && n <= 6) return n;
  Logger.log(`[WARN] Unknown day value: "${day}"`);
  return null;
}

function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (_, l) => l.toUpperCase());
}