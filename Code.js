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
  const occurrences = getNextOccurrences(rule, today);
  if (!occurrences || occurrences.length === 0) {
    Logger.log(`[SKIP] "${rule.title}": unable to compute next due date.`);
    return "skipped";
  }

  const tasklistId = getOrCreateTaskList(rule.tasklistName || "@default");
  let createdCount = 0;

  for (const dueDate of occurrences) {
    // Check if task should appear yet
    const appearDate = getAppearDate(rule, dueDate);
    if (today < appearDate) {
      Logger.log(`[SKIP] "${rule.title}": scheduled to appear on ${formatDate(appearDate)} (due ${formatDate(dueDate)})`);
      continue;
    }

    const taskId = generateTaskId(rule, dueDate);

    // Prevent duplicate tasks using unique ID tag
    if (taskAlreadyExists(tasklistId, taskId)) {
      Logger.log(`[SKIP] "${rule.title}": already exists (${taskId})`);
      continue;
    }

    Tasks.Tasks.insert(
      {
        title: rule.title,
        notes: buildTaskNotes(rule.description, taskId),
        due: dueDate.toISOString(),
      },
      tasklistId
    );

    Logger.log(`[OK] Created "${rule.title}" (due ${formatDate(dueDate)}, ID: ${taskId})`);
    createdCount++;
  }

  return createdCount > 0 ? "created" : "skipped";
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

/**
 * Calculates next occurrences (>= today) for the given rule.
 * Supports: daily, weekly, monthly, yearly-day, yearly-calandar / yearly-calendar.
 */
function getNextOccurrences(rule, today) {
  const type = String(rule.type || rule.recurrence || "").toLowerCase().trim();
  const rawParam = String(
    rule.parameter_1 !== undefined && rule.parameter_1 !== null
      ? rule.parameter_1
      : (rule.parameter1 !== undefined && rule.parameter1 !== null
          ? rule.parameter1
          : (rule.dueDay !== undefined && rule.dueDay !== null ? rule.dueDay : (rule.parameter || "")))
  ).trim();

  let targets = rawParam.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

  if (type === "daily" || type === "day" || type === "quotidien") {
    if (targets.length === 0) targets = ["1"];
    const occurrences = [];
    for (const t of targets) {
      const step = parseInt(t, 10);
      occurrences.push(getNextDailyOccurrence(step, today));
    }
    return deduplicateAndSortDates(occurrences);
  }

  if (type === "weekly" || type === "week" || type === "hebdomadaire") {
    if (targets.length === 0) {
      safeLog(`[WARN] "${rule.title}": No days specified for weekly recurrence.`);
      return [];
    }
    const occurrences = [];
    for (const t of targets) {
      const dow = parseDayOfWeek(t);
      if (dow !== null) {
        occurrences.push(getNextWeeklyOccurrence(dow, today));
      } else {
        safeLog(`[WARN] "${rule.title}": Invalid day of week "${t}".`);
      }
    }
    return deduplicateAndSortDates(occurrences);
  }

  if (type === "monthly" || type === "month" || type === "mensuel") {
    if (targets.length === 0) {
      safeLog(`[WARN] "${rule.title}": No days specified for monthly recurrence.`);
      return [];
    }
    const occurrences = [];
    for (const t of targets) {
      const nthWeekday = parseNthWeekdayOfMonth(t);
      if (nthWeekday) {
        const occ = getNextNthWeekdayMonthlyOccurrence(nthWeekday.nth, nthWeekday.dow, today);
        if (occ) occurrences.push(occ);
        else safeLog(`[WARN] "${rule.title}": Unable to compute Nth weekday for "${t}".`);
      } else {
        const dayNum = parseInt(t, 10);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
          occurrences.push(getNextMonthlyOccurrence(dayNum, today));
        } else {
          safeLog(`[WARN] "${rule.title}": Invalid day of month "${t}".`);
        }
      }
    }
    return deduplicateAndSortDates(occurrences);
  }

  if (
    type === "yearly" ||
    type === "year" ||
    type === "annuel" ||
    type === "yearly-day" ||
    type === "yearly_day" ||
    type === "year-day" ||
    type === "yearly-calandar" ||
    type === "yearly-calendar" ||
    type === "yearly_calendar" ||
    type === "yearly_calandar" ||
    type === "calendar" ||
    type === "calandar"
  ) {
    if (targets.length === 0) {
      safeLog(`[WARN] "${rule.title}": No dates or day numbers specified for yearly recurrence.`);
      return [];
    }
    const occurrences = [];
    for (const t of targets) {
      // 1. Check if format is a month-day string (e.g. "july-14", "14 juillet", "14/07")
      const md = parseMonthDay(t);
      if (md) {
        occurrences.push(getNextCalendarOccurrence(md.month, md.day, today));
        continue;
      }

      // 2. Check if format is day-of-year integer (e.g. 1 to 366)
      const dayOfYear = parseInt(t, 10);
      if (!isNaN(dayOfYear) && /^\d+$/.test(t.trim()) && dayOfYear >= 1 && dayOfYear <= 366) {
        occurrences.push(getNextYearlyDayOccurrence(dayOfYear, today));
        continue;
      }

      safeLog(`[WARN] "${rule.title}": Invalid yearly format "${t}" (must be day number 1-366 or month-day pair).`);
    }
    return deduplicateAndSortDates(occurrences);
  }

  safeLog(`[WARN] Recurrence type "${type}" not supported.`);
  return [];
}

function safeLog(msg) {
  if (typeof Logger !== "undefined") {
    Logger.log(msg);
  }
}

// Single-occurrence helper for backward compatibility
function getNextOccurrence(rule, today) {
  const occurrences = getNextOccurrences(rule, today);
  return occurrences.length > 0 ? occurrences[0] : null;
}

function getNextDailyOccurrence(step, today) {
  if (isNaN(step) || step <= 1) {
    return new Date(today);
  }
  const epochDays = Math.floor(today.getTime() / 86400000);
  const remainder = ((epochDays % step) + step) % step;
  const daysToAdd = remainder === 0 ? 0 : (step - remainder);
  const candidate = new Date(today);
  candidate.setUTCDate(candidate.getUTCDate() + daysToAdd);
  return candidate;
}

function getNextWeeklyOccurrence(targetDow, today) {
  const offset = (targetDow - today.getUTCDay() + 7) % 7;
  const candidate = new Date(today);
  candidate.setUTCDate(candidate.getUTCDate() + offset);
  return candidate;
}

function getNextMonthlyOccurrence(dayNum, today) {
  const curYear = today.getUTCFullYear();
  const curMonth = today.getUTCMonth();

  function getCandidate(y, m) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const clampedDay = Math.min(dayNum, daysInMonth);
    return new Date(Date.UTC(y, m, clampedDay));
  }

  const candCur = getCandidate(curYear, curMonth);
  if (candCur >= today) {
    return candCur;
  }

  const nextYear = curMonth === 11 ? curYear + 1 : curYear;
  const nextMonth = (curMonth + 1) % 12;
  return getCandidate(nextYear, nextMonth);
}

function parseNthWeekdayOfMonth(str) {
  if (!str) return null;
  const s = String(str).trim();
  const normalized = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const match = normalized.match(/^([0-9a-z]+)[-_ ]([a-z0-9]+)$/);
  if (!match) return null;

  function parseNth(val) {
    if (/^1(st|er)?$|^premier$/.test(val)) return 1;
    if (/^2(nd|eme)?$|^deuxieme$/.test(val)) return 2;
    if (/^3(rd|eme)?$|^troisieme$/.test(val)) return 3;
    if (/^4(th|eme)?$|^quatrieme$/.test(val)) return 4;
    if (/^5(th|eme)?$|^cinquieme$/.test(val)) return 5;
    if (/^last$|^dernier$|^derniere$/.test(val)) return -1;
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 1 && n <= 5) return n;
    return null;
  }

  let nth = parseNth(match[1]);
  let dow = parseDayOfWeek(match[2]);

  // Support inverted format: e.g. "monday-2" or "lundi-dernier"
  if (nth === null || dow === null) {
    nth = parseNth(match[2]);
    dow = parseDayOfWeek(match[1]);
  }

  if (nth === null || dow === null) return null;

  return { nth, dow };
}

function getNthWeekdayDate(year, month, nth, targetDow) {
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  if (nth === -1) {
    const lastDayDow = new Date(Date.UTC(year, month, daysInMonth)).getUTCDay();
    const diff = (lastDayDow - targetDow + 7) % 7;
    const day = daysInMonth - diff;
    return new Date(Date.UTC(year, month, day));
  }

  const firstDayDow = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstOccurrence = 1 + ((targetDow - firstDayDow + 7) % 7);
  const day = firstOccurrence + (nth - 1) * 7;

  if (day > daysInMonth) {
    return null;
  }
  return new Date(Date.UTC(year, month, day));
}

function getNextNthWeekdayMonthlyOccurrence(nth, targetDow, today) {
  const curYear = today.getUTCFullYear();
  const curMonth = today.getUTCMonth();

  const candCur = getNthWeekdayDate(curYear, curMonth, nth, targetDow);
  if (candCur && candCur >= today) {
    return candCur;
  }

  for (let i = 1; i <= 12; i++) {
    const nextMonth = (curMonth + i) % 12;
    const nextYear = curYear + Math.floor((curMonth + i) / 12);
    const candNext = getNthWeekdayDate(nextYear, nextMonth, nth, targetDow);
    if (candNext) {
      return candNext;
    }
  }
  return null;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
}

function getDateFromDayOfYear(year, dayOfYear) {
  const maxDays = isLeapYear(year) ? 366 : 365;
  const clampedDay = Math.min(dayOfYear, maxDays);
  return new Date(Date.UTC(year, 0, clampedDay));
}

function getNextYearlyDayOccurrence(dayOfYear, today) {
  const curYear = today.getUTCFullYear();
  const candCur = getDateFromDayOfYear(curYear, dayOfYear);
  if (candCur >= today) {
    return candCur;
  }
  return getDateFromDayOfYear(curYear + 1, dayOfYear);
}

function getNextCalendarOccurrence(month, day, today) {
  const curYear = today.getUTCFullYear();

  function getCandidate(year) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const clampedDay = Math.min(day, daysInMonth);
    return new Date(Date.UTC(year, month - 1, clampedDay));
  }

  const candidateCur = getCandidate(curYear);
  if (candidateCur >= today) {
    return candidateCur;
  }
  return getCandidate(curYear + 1);
}

function parseMonthDay(str) {
  if (!str) return null;
  const s = String(str).trim();
  const normalized = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const monthMap = {
    // English
    january: 1, jan: 1,
    february: 2, feb: 2,
    march: 3, mar: 3,
    april: 4, apr: 4,
    may: 5,
    june: 6, jun: 6,
    july: 7, jul: 7,
    august: 8, aug: 8,
    september: 9, sep: 9, sept: 9,
    october: 10, oct: 10,
    november: 11, nov: 11,
    december: 12, dec: 12,
    // French
    janvier: 1, janv: 1,
    fevrier: 2, fevr: 2, fev: 2,
    mars: 3,
    avril: 4, avr: 4,
    mai: 5,
    juin: 6,
    juillet: 7, juil: 7,
    aout: 8,
    septembre: 9,
    octobre: 10,
    novembre: 11,
    decembre: 12,
  };

  const monthNames = Object.keys(monthMap).sort((a, b) => b.length - a.length);

  for (const name of monthNames) {
    const regex = new RegExp(`(?:^|[^a-z0-9])${name}(?:$|[^a-z0-9])`, "i");
    if (regex.test(normalized)) {
      const month = monthMap[name];
      const remaining = normalized.replace(new RegExp(name, "gi"), " ");
      const cleanedRemaining = remaining.replace(/\b(\d+)(?:er|re|st|nd|rd|th)\b/gi, (m, p) => p);
      const numMatch = cleanedRemaining.match(/\b\d{1,2}\b/);
      if (numMatch) {
        const day = parseInt(numMatch[0], 10);
        if (day >= 1 && day <= 31) {
          return { month, day };
        }
      }
    }
  }

  const numPartsMatch = normalized.match(/^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})$/);
  if (numPartsMatch) {
    const p1 = parseInt(numPartsMatch[1], 10);
    const p2 = parseInt(numPartsMatch[2], 10);

    if (p1 > 12 && p2 <= 12) {
      return { month: p2, day: p1 };
    }
    if (p2 > 12 && p1 <= 12) {
      return { month: p1, day: p2 };
    }

    if (normalized.includes("/") || normalized.includes(".")) {
      return { month: p2, day: p1 };
    }
    return { month: p1, day: p2 };
  }

  return null;
}

function deduplicateAndSortDates(dates) {
  const map = new Map();
  for (const d of dates) {
    if (d && !isNaN(d.getTime())) {
      map.set(d.getTime(), d);
    }
  }
  const unique = Array.from(map.values());
  unique.sort((a, b) => a.getTime() - b.getTime());
  return unique;
}

// Calculate appear date based on advance rules (number_of_day, precise_day, or legacy)
function getAppearDate(rule, dueDate) {
  const advType = String(rule.advance || "").toLowerCase().trim();
  const param2 = String(
    rule.parameter_2 !== undefined && rule.parameter_2 !== null
      ? rule.parameter_2
      : (rule.parameter2 !== undefined && rule.parameter2 !== null ? rule.parameter2 : "")
  ).trim();

  // 1. number_of_day: appear X days before dueDate
  if (advType === "number_of_day" || advType === "number_of_days" || advType === "days" || advType === "day") {
    const days = parseInt(param2, 10);
    if (!isNaN(days) && days >= 0) {
      const appear = new Date(dueDate);
      appear.setUTCDate(appear.getUTCDate() - days);
      return appear;
    }
  }

  // 2. precise_day: appear on a specific day leading up to dueDate
  if (advType === "precise_day" || advType === "precise") {
    const ruleType = String(rule.type || "").toLowerCase().trim();

    // Case A: weekly (day of week: number 0-6 or name e.g. monday)
    if (ruleType === "weekly" || ruleType === "week" || ruleType === "hebdomadaire") {
      const targetDow = parseDayOfWeek(param2);
      if (targetDow !== null) {
        const offset = (dueDate.getUTCDay() - targetDow + 7) % 7;
        const appear = new Date(dueDate);
        appear.setUTCDate(appear.getUTCDate() - offset);
        return appear;
      }
    }

    // Case B: monthly (day of month number e.g. "1" or Nth weekday duo e.g. "1-tuesday")
    if (ruleType === "monthly" || ruleType === "month" || ruleType === "mensuel") {
      const nthWeekday = parseNthWeekdayOfMonth(param2);
      if (nthWeekday) {
        const curYear = dueDate.getUTCFullYear();
        const curMonth = dueDate.getUTCMonth();
        const candCur = getNthWeekdayDate(curYear, curMonth, nthWeekday.nth, nthWeekday.dow);
        if (candCur && candCur <= dueDate) {
          return candCur;
        }
        const prevYear = curMonth === 0 ? curYear - 1 : curYear;
        const prevMonth = (curMonth + 11) % 12;
        const candPrev = getNthWeekdayDate(prevYear, prevMonth, nthWeekday.nth, nthWeekday.dow);
        if (candPrev) {
          return candPrev;
        }
      } else {
        const dayNum = parseInt(param2, 10);
        if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
          const curYear = dueDate.getUTCFullYear();
          const curMonth = dueDate.getUTCMonth();
          const daysInCur = new Date(Date.UTC(curYear, curMonth + 1, 0)).getUTCDate();
          const candCur = new Date(Date.UTC(curYear, curMonth, Math.min(dayNum, daysInCur)));
          if (candCur <= dueDate) {
            return candCur;
          }
          const prevYear = curMonth === 0 ? curYear - 1 : curYear;
          const prevMonth = (curMonth + 11) % 12;
          const daysInPrev = new Date(Date.UTC(prevYear, prevMonth + 1, 0)).getUTCDate();
          return new Date(Date.UTC(prevYear, prevMonth, Math.min(dayNum, daysInPrev)));
        }
      }
    }

    // Case C: yearly (month-day duo e.g. "july-1" or day of year e.g. "100")
    if (
      ruleType === "yearly" ||
      ruleType === "year" ||
      ruleType === "annuel" ||
      ruleType === "yearly-day" ||
      ruleType === "yearly_day" ||
      ruleType === "yearly-calandar" ||
      ruleType === "yearly-calendar" ||
      ruleType === "yearly_calendar" ||
      ruleType === "yearly_calandar"
    ) {
      const md = parseMonthDay(param2);
      if (md) {
        const curYear = dueDate.getUTCFullYear();
        const daysInCur = new Date(Date.UTC(curYear, md.month, 0)).getUTCDate();
        const candCur = new Date(Date.UTC(curYear, md.month - 1, Math.min(md.day, daysInCur)));
        if (candCur <= dueDate) {
          return candCur;
        }
        const prevYear = curYear - 1;
        const daysInPrev = new Date(Date.UTC(prevYear, md.month, 0)).getUTCDate();
        return new Date(Date.UTC(prevYear, md.month - 1, Math.min(md.day, daysInPrev)));
      }

      const dayOfYear = parseInt(param2, 10);
      if (!isNaN(dayOfYear) && dayOfYear >= 1 && dayOfYear <= 366) {
        const curYear = dueDate.getUTCFullYear();
        const candCur = getDateFromDayOfYear(curYear, dayOfYear);
        if (candCur <= dueDate) {
          return candCur;
        }
        return getDateFromDayOfYear(curYear - 1, dayOfYear);
      }
    }
  }

  // Fallback for legacy advance_day_of_week
  if (rule.advanceDayOfWeek && String(rule.advanceDayOfWeek).trim() !== "") {
    const targetDow = parseDayOfWeek(rule.advanceDayOfWeek);
    if (targetDow !== null) {
      const offset = (dueDate.getUTCDay() - targetDow + 7) % 7;
      const appear = new Date(dueDate);
      appear.setUTCDate(appear.getUTCDate() - offset);
      return appear;
    }
  }

  // Fallback for legacy advance_days
  if (rule.advanceDays != null && String(rule.advanceDays).trim() !== "") {
    const days = parseInt(rule.advanceDays, 10);
    if (!isNaN(days) && days >= 0) {
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

    // description with backward compatibility with notes
    const desc = rule.description !== undefined && rule.description !== null && String(rule.description).trim() !== ""
      ? rule.description
      : rule.notes;
    rule.description = String(desc || "").trim();
    rule.notes = rule.description; // backward compatibility

    rule.tasklistName = String(rule.tasklistName || "@default").trim();

    // type with backward compatibility with recurrence
    rule.type = String(rule.type || rule.recurrence || "").toLowerCase().trim();
    rule.recurrence = rule.type; // backward compatibility

    // parameter_1 column in sheet (converted to parameter1 by toCamelCase)
    const param = rule.parameter1 !== undefined && rule.parameter1 !== null
      ? rule.parameter1
      : (rule.parameter_1 !== undefined && rule.parameter_1 !== null ? rule.parameter_1 : "");
    rule.parameter_1 = String(param).trim();
    rule.parameter1 = rule.parameter_1;

    rule.advance = String(rule.advance || "").toLowerCase().trim();

    // parameter_2 column in sheet (converted to parameter2 by toCamelCase)
    const param2 = rule.parameter2 !== undefined && rule.parameter2 !== null
      ? rule.parameter2
      : (rule.parameter_2 !== undefined && rule.parameter_2 !== null ? rule.parameter_2 : "");
    rule.parameter_2 = String(param2).trim();
    rule.parameter2 = rule.parameter_2;

    rule.advanceDays = rule.advanceDays;
    rule.advanceDayOfWeek = rule.advanceDayOfWeek;

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
  const d = String(day).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
  return str.replace(/[_\s-]+([a-z0-9])/gi, (_, l) => l.toUpperCase());
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getNextOccurrences,
    getNextOccurrence,
    getNextDailyOccurrence,
    getNextWeeklyOccurrence,
    getNextMonthlyOccurrence,
    parseNthWeekdayOfMonth,
    getNthWeekdayDate,
    getNextNthWeekdayMonthlyOccurrence,
    getNextYearlyDayOccurrence,
    getNextCalendarOccurrence,
    parseMonthDay,
    parseDayOfWeek,
    isLeapYear,
    getDateFromDayOfYear,
    deduplicateAndSortDates,
    formatDate,
    getAppearDate,
    generateTaskId,
  };
}
