/**
 * Advanced Google Tasks Scheduler — Google Apps Script
 * Automatically creates recurring Google Tasks from rules defined in a Google Sheet.
 */

const CONFIG_SHEET_NAME = "Advanced Google Tasks Scheduler";
const CONFIG_TAB_NAME = "Tasks";
const SHEET_ID_PROPERTY = "CONFIG_SHEET_ID";

// Entry point triggered daily (or run manually)
function checkAndCreateTasks() {
  const rules = loadRulesFromSheet();
  if (!rules || rules.length === 0) {
    safeLog("[INFO] No rules found in config sheet.");
    return;
  }

  const today = getToday();
  safeLog(`[INFO] Checking tasks for ${formatDate(today)}...`);

  // Execution-scoped cache to avoid redundant API queries
  const context = {
    taskListCache: {}, // listName -> taskListId
    taskCache: {},     // taskListId -> Set of RTid tags
  };

  let created = 0;
  let skipped = 0;

  for (const rule of rules) {
    if (!rule.enabled) {
      skipped++;
      continue;
    }

    try {
      const res = processRule(rule, today, context);
      if (res === "created") created++;
      else skipped++;
    } catch (err) {
      safeLog(`[ERROR] "${rule.title}": ${err.message}`);
    }
  }

  safeLog(`[INFO] Finished: ${created} created, ${skipped} skipped.`);
}

function processRule(rule, today, context = {}) {
  const occurrences = getNextOccurrences(rule, today);
  if (!occurrences || occurrences.length === 0) {
    safeLog(`[SKIP] "${rule.title}": unable to compute next due date.`);
    return "skipped";
  }

  const taskListCache = context.taskListCache || {};
  const taskCache = context.taskCache || {};
  const tasklistId = getOrCreateTaskList(rule.tasklist_name || "@default", taskListCache);
  let createdCount = 0;

  for (const dueDate of occurrences) {
    // Check if task should appear yet
    const appearDate = getAppearDate(rule, dueDate);
    if (today < appearDate) {
      safeLog(`[SKIP] "${rule.title}": scheduled to appear on ${formatDate(appearDate)} (due ${formatDate(dueDate)})`);
      continue;
    }

    const taskId = generateTaskId(rule, dueDate);

    // Prevent duplicate tasks using cached unique ID tags
    if (taskAlreadyExists(tasklistId, taskId, taskCache)) {
      safeLog(`[SKIP] "${rule.title}": already exists (${taskId})`);
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

    // Register into in-memory tag cache
    const tagSet = getTaskTagSet(tasklistId, taskCache);
    tagSet.add(taskId);

    safeLog(`[OK] Created "${rule.title}" (due ${formatDate(dueDate)}, ID: ${taskId})`);
    createdCount++;
  }

  return createdCount > 0 ? "created" : "skipped";
}

function generateTaskId(rule, dueDate) {
  const yyyy = dueDate.getUTCFullYear();
  const mm = String(dueDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dueDate.getUTCDate()).padStart(2, "0");
  const row = String(rule.rowIndex || 0).padStart(3, "0");

  return `RTid${yyyy}${mm}${dd}${row}`;
}

function buildTaskNotes(userNotes, taskId) {
  const clean = (userNotes || "").trim();
  const tag = `[${taskId}]`;
  return clean ? `${clean}\n\n${tag}` : tag;
}

/**
 * Calculates next occurrences (>= today) for the given rule.
 * Supports the 5 official types: daily, weekly, monthly, yearly, event_triggered.
 */
function getNextOccurrences(rule, today) {
  const type = String(rule.type || "").toLowerCase().trim();
  const rawParam = String(rule.parameter_1 != null ? rule.parameter_1 : "").trim();

  if (type === "event_triggered") {
    const config = parseEventTriggerConfig(rawParam);
    if (!config) {
      safeLog(`[WARN] "${rule.title}": Invalid event_triggered parameter "${rawParam}".`);
      return [];
    }
    const occ = getNextEventTriggeredOccurrence(config, today);
    return occ ? [occ] : [];
  }

  let targets = rawParam.split(";").map((s) => s.trim()).filter((s) => s.length > 0);

  if (type === "daily") {
    if (targets.length === 0) targets = ["1"];
    const occurrences = [];
    for (const t of targets) {
      const step = parseInt(t, 10);
      occurrences.push(getNextDailyOccurrence(step, today));
    }
    return deduplicateAndSortDates(occurrences);
  }

  if (type === "weekly") {
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

  if (type === "monthly") {
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

  if (type === "yearly") {
    if (targets.length === 0) {
      safeLog(`[WARN] "${rule.title}": No dates or day numbers specified for yearly recurrence.`);
      return [];
    }
    const occurrences = [];
    for (const t of targets) {
      const md = parseMonthDay(t);
      if (md) {
        occurrences.push(getNextCalendarOccurrence(md.month, md.day, today));
        continue;
      }

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
  if (typeof Logger !== "undefined" && Logger && typeof Logger.log === "function") {
    Logger.log(msg);
  }
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
  const s = String(str).trim().toLowerCase();

  const match = s.match(/^([0-9a-z]+)[-_ ]([a-z0-9]+)$/);
  if (!match) return null;

  function parseNth(val) {
    if (/^1(st)?$|^first$/.test(val)) return 1;
    if (/^2(nd)?$|^second$/.test(val)) return 2;
    if (/^3(rd)?$|^third$/.test(val)) return 3;
    if (/^4(th)?$|^fourth$/.test(val)) return 4;
    if (/^5(th)?$|^fifth$/.test(val)) return 5;
    if (/^last$/.test(val)) return -1;
    const n = parseInt(val, 10);
    if (!isNaN(n) && n >= 1 && n <= 5) return n;
    return null;
  }

  let nth = parseNth(match[1]);
  let dow = parseDayOfWeek(match[2]);

  // Support inverted format: e.g. "monday-2"
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
  const s = String(str).trim().toLowerCase();

  const monthMap = {
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
  };

  const monthNames = Object.keys(monthMap).sort((a, b) => b.length - a.length);

  for (const name of monthNames) {
    const regex = new RegExp(`(?:^|[^a-z0-9])${name}(?:$|[^a-z0-9])`, "i");
    if (regex.test(s)) {
      const month = monthMap[name];
      const remaining = s.replace(new RegExp(name, "gi"), " ");
      const cleanedRemaining = remaining.replace(/\b(\d+)(?:st|nd|rd|th)\b/gi, (m, p) => p);
      const numMatch = cleanedRemaining.match(/\b\d{1,2}\b/);
      if (numMatch) {
        const day = parseInt(numMatch[0], 10);
        if (day >= 1 && day <= 31) {
          return { month, day };
        }
      }
    }
  }

  const numPartsMatch = s.match(/^(\d{1,2})\s*[-/.\s]\s*(\d{1,2})$/);
  if (numPartsMatch) {
    const p1 = parseInt(numPartsMatch[1], 10);
    const p2 = parseInt(numPartsMatch[2], 10);

    if (p1 > 12 && p2 <= 12) {
      return { month: p2, day: p1 };
    }
    if (p2 > 12 && p1 <= 12) {
      return { month: p1, day: p2 };
    }

    if (s.includes("/") || s.includes(".")) {
      return { month: p2, day: p1 };
    }
    return { month: p1, day: p2 };
  }

  return null;
}

function parseEventTriggerConfig(paramStr) {
  if (!paramStr) return null;
  const config = {
    title: null,
    desc: null,
    calendar: null,
    offset: 0,
    longshot: 60,
    self: true,
  };

  const regex = /(?:^|;)\s*([A-Za-z0-9_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^;]*))/g;
  let match;
  let foundAny = false;

  while ((match = regex.exec(paramStr)) !== null) {
    const key = match[1].toUpperCase().trim();
    const val = (match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] || ""))).trim();
    foundAny = true;

    if (key === "TITLE") {
      config.title = val;
    } else if (key === "DESC") {
      config.desc = val;
    } else if (key === "CALENDAR") {
      config.calendar = val;
    } else if (key === "OFFSET") {
      const n = parseInt(val, 10);
      config.offset = isNaN(n) ? 0 : n;
    } else if (key === "LONGSHOT") {
      const n = parseInt(val, 10);
      config.longshot = isNaN(n) || n <= 0 ? 60 : n;
    } else if (key === "SELF") {
      const lower = val.toLowerCase();
      config.self = !(lower === "false" || lower === "0" || lower === "no");
    }
  }

  return foundAny ? config : null;
}

function getGoogleCalendar(calendarNameOrId) {
  if (typeof CalendarApp === "undefined") {
    return null;
  }
  if (!calendarNameOrId || calendarNameOrId === "@default" || calendarNameOrId === "primary") {
    return CalendarApp.getDefaultCalendar();
  }
  const byName = CalendarApp.getCalendarsByName(calendarNameOrId);
  if (byName && byName.length > 0) {
    return byName[0];
  }
  try {
    return CalendarApp.getCalendarById(calendarNameOrId);
  } catch (e) {
    return null;
  }
}

function getCalendarEventDate(event) {
  const d = event.getStartTime();
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function eventMatchesCriteria(event, config) {
  if (!event || !config) return false;

  const title = event.getTitle() || "";
  const desc = event.getDescription() || "";

  if (config.title) {
    const normEventTitle = String(title).toLowerCase();
    const keywords = String(config.title).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!keywords.every(kw => normEventTitle.includes(kw))) {
      return false;
    }
  }

  if (config.desc) {
    const normEventDesc = String(desc).toLowerCase();
    const keywords = String(config.desc).toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (!keywords.every(kw => normEventDesc.includes(kw))) {
      return false;
    }
  }

  return true;
}

function getNextEventTriggeredOccurrence(config, today) {
  const cal = getGoogleCalendar(config.calendar);
  if (!cal) {
    safeLog(`[WARN] Calendar "${config.calendar || "@default"}" not found.`);
    return null;
  }

  const longshot = config.longshot || 60;
  const startTime = new Date(today);
  if (config.offset > 0) {
    startTime.setUTCDate(startTime.getUTCDate() - config.offset);
  }
  const endTime = new Date(today);
  endTime.setUTCDate(endTime.getUTCDate() + longshot + 1);

  let events = [];
  try {
    events = cal.getEvents(startTime, endTime) || [];
  } catch (err) {
    safeLog(`[ERROR] Failed to fetch events from calendar: ${err.message}`);
    return null;
  }

  const matchingEvents = [];
  for (const e of events) {
    if (eventMatchesCriteria(e, config)) {
      const eDate = getCalendarEventDate(e);
      const dueDate = new Date(eDate);
      dueDate.setUTCDate(dueDate.getUTCDate() + (config.offset || 0));
      if (dueDate >= today) {
        matchingEvents.push({ event: e, date: eDate, dueDate: dueDate });
      }
    }
  }

  if (matchingEvents.length === 0) {
    return null;
  }

  matchingEvents.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  return matchingEvents[0].dueDate;
}

function getEventTriggeredAppearDate(config, dueDate) {
  const cal = getGoogleCalendar(config.calendar);
  if (!cal) {
    safeLog(`[WARN] Calendar "${config.calendar || "@default"}" not found.`);
    return new Date(dueDate);
  }

  const longshot = config.longshot || 60;
  const startTime = new Date(dueDate);
  startTime.setUTCDate(startTime.getUTCDate() - longshot);
  const endTime = new Date(dueDate);
  endTime.setUTCDate(endTime.getUTCDate() + longshot + 1);

  let events = [];
  try {
    events = cal.getEvents(startTime, endTime) || [];
  } catch (err) {
    safeLog(`[ERROR] Failed to fetch events from calendar: ${err.message}`);
    return new Date(dueDate);
  }

  const matchingEvents = [];
  for (const e of events) {
    if (eventMatchesCriteria(e, config)) {
      const eDate = getCalendarEventDate(e);
      matchingEvents.push({
        event: e,
        date: eDate,
        dist: Math.abs(eDate.getTime() - dueDate.getTime()),
      });
    }
  }

  if (matchingEvents.length === 0) {
    return new Date(dueDate);
  }

  // Sort by distance to dueDate ascending. If tied, prefer date <= dueDate
  matchingEvents.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.date.getTime() - b.date.getTime();
  });

  let selected = matchingEvents[0];

  if (config.self === false) {
    const targetTitle = String(selected.event.getTitle() || "").toLowerCase().trim();
    const targetTime = typeof selected.event.getStartTime === "function"
      ? selected.event.getStartTime().getTime()
      : selected.date.getTime();

    const previousEvents = matchingEvents.filter(m => {
      const mTitle = String(m.event.getTitle() || "").toLowerCase().trim();
      const mTime = typeof m.event.getStartTime === "function"
        ? m.event.getStartTime().getTime()
        : m.date.getTime();
      return mTitle === targetTitle && mTime < targetTime;
    });

    if (previousEvents.length > 0) {
      previousEvents.sort((a, b) => {
        const timeA = typeof a.event.getStartTime === "function" ? a.event.getStartTime().getTime() : a.date.getTime();
        const timeB = typeof b.event.getStartTime === "function" ? b.event.getStartTime().getTime() : b.date.getTime();
        return timeB - timeA;
      });
      selected = previousEvents[0];
    }
  }

  const appearDate = new Date(selected.date);
  appearDate.setUTCDate(appearDate.getUTCDate() + (config.offset || 0));
  return appearDate;
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

// Calculate appear date based on advance rules (number_of_day, precise_day, event_triggered)
function getAppearDate(rule, dueDate) {
  const advType = String(rule.advance || "").toLowerCase().trim();
  const param2 = String(rule.parameter_2 != null ? rule.parameter_2 : "").trim();

  if (advType === "number_of_day") {
    const days = parseInt(param2, 10);
    if (!isNaN(days) && days >= 0) {
      const appear = new Date(dueDate);
      appear.setUTCDate(appear.getUTCDate() - days);
      return appear;
    }
  }

  if (advType === "precise_day") {
    const ruleType = String(rule.type || "").toLowerCase().trim();

    if (ruleType === "weekly") {
      const targetDow = parseDayOfWeek(param2);
      if (targetDow !== null) {
        const offset = (dueDate.getUTCDay() - targetDow + 7) % 7;
        const appear = new Date(dueDate);
        appear.setUTCDate(appear.getUTCDate() - offset);
        return appear;
      }
    }

    if (ruleType === "monthly") {
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

    if (ruleType === "yearly") {
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

  if (advType === "event_triggered") {
    const config = parseEventTriggerConfig(param2);
    if (config) {
      return getEventTriggeredAppearDate(config, dueDate);
    }
  }

  return new Date(dueDate);
}

function getOrCreateTaskList(name, cache = {}) {
  const key = name || "@default";
  if (cache[key]) {
    return cache[key];
  }

  const lists = Tasks.Tasklists.list({ maxResults: 100 }).items || [];

  if (lists.length > 0) {
    cache["@default"] = lists[0].id;
  }
  for (const l of lists) {
    if (l.title) {
      cache[l.title] = l.id;
    }
  }

  if (cache[key]) {
    return cache[key];
  }

  const created = Tasks.Tasklists.insert({ title: name });
  safeLog(`[OK] Created task list: "${name}"`);
  cache[key] = created.id;
  return created.id;
}

function getTaskTagSet(tasklistId, cache = {}) {
  if (cache[tasklistId]) {
    return cache[tasklistId];
  }

  const tagSet = new Set();
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
      if (task.notes) {
        const matches = task.notes.match(/RTid\d+/g);
        if (matches) {
          for (const m of matches) {
            tagSet.add(m);
          }
        }
      }
    }
    pageToken = res.nextPageToken;
  } while (pageToken);

  cache[tasklistId] = tagSet;
  return tagSet;
}

function taskAlreadyExists(tasklistId, taskId, cache = {}) {
  const tagSet = getTaskTagSet(tasklistId, cache);
  return tagSet.has(taskId);
}

function loadRulesFromSheet() {
  const sheet = getConfigSheet();
  if (!sheet) {
    throw new Error(`Sheet "${CONFIG_SHEET_NAME}" not found. Run setup() to create and configure it.`);
  }

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];

  const headers = data[0].map((h) => h.toString().trim().toLowerCase());
  const rules = [];

  for (let i = 1; i < data.length; i++) {
    const raw = {};
    headers.forEach((h, j) => {
      raw[h] = data[i][j];
    });

    const rule = {
      rowIndex: i + 1,
      enabled: String(raw.enabled).toLowerCase() === "true" || raw.enabled === true,
      title: String(raw.title || "").trim(),
      description: String(raw.description || "").trim(),
      tasklist_name: String(raw.tasklist_name || "@default").trim(),
      type: String(raw.type || "").toLowerCase().trim(),
      parameter_1: String(raw.parameter_1 != null ? raw.parameter_1 : "").trim(),
      advance: String(raw.advance || "").toLowerCase().trim(),
      parameter_2: String(raw.parameter_2 != null ? raw.parameter_2 : "").trim(),
    };

    if (rule.title) rules.push(rule);
  }

  safeLog(`[INFO] Loaded ${rules.length} rule(s) from sheet.`);
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

// Run once during initial setup: creates the Google Sheet if missing, and installs the daily trigger
function setup() {
  let sheet = getConfigSheet();

  if (!sheet) {
    const files = DriveApp.getFilesByName(CONFIG_SHEET_NAME);
    let spreadsheet = files.hasNext() ? SpreadsheetApp.open(files.next()) : null;

    if (!spreadsheet) {
      safeLog(`[INFO] Spreadsheet "${CONFIG_SHEET_NAME}" not found. Creating a new one on Google Drive...`);
      spreadsheet = SpreadsheetApp.create(CONFIG_SHEET_NAME);
    }

    sheet = spreadsheet.getSheetByName(CONFIG_TAB_NAME);
    if (!sheet) {
      sheet = spreadsheet.getActiveSheet();
      sheet.setName(CONFIG_TAB_NAME);
    }

    const headers = [
      "enabled",
      "title",
      "description",
      "tasklist_name",
      "type",
      "parameter_1",
      "advance",
      "parameter_2"
    ];

    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    sheet.setFrozenRows(1);

    // Provide inactive template examples to help the user get started
    const sampleRows = [
      [false, "Water household plants", "Check moisture level first", "Home", "weekly", "friday", "precise_day", "monday"],
      [false, "Monthly budget audit", "Export bank statements", "Finance", "monthly", "1", "number_of_day", "2"]
    ];
    sheet.getRange(2, 1, sampleRows.length, headers.length).setValues(sampleRows);

    PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, spreadsheet.getId());
    safeLog(`[OK] Created spreadsheet: ${spreadsheet.getUrl()}`);
  } else {
    safeLog(`[OK] Found existing spreadsheet: ${sheet.getParent().getUrl()}`);
  }

  setupDailyTrigger();
  safeLog("[OK] Daily 6:00 AM trigger successfully installed.");
  return sheet;
}

// Run once to install the daily 6:00 AM trigger
function setupDailyTrigger() {
  for (const t of ScriptApp.getProjectTriggers()) {
    if (t.getHandlerFunction() === "checkAndCreateTasks") {
      ScriptApp.deleteTrigger(t);
    }
  }
  ScriptApp.newTrigger("checkAndCreateTasks").timeBased().everyDays(1).atHour(6).create();
  safeLog("[OK] Daily trigger set for 6:00 AM.");
}

// Run once if auto-detection by name fails
function setSheetId() {
  const SHEET_ID = "PASTE_YOUR_SHEET_ID_HERE";
  PropertiesService.getUserProperties().setProperty(SHEET_ID_PROPERTY, SHEET_ID);
  safeLog(`[OK] Saved sheet ID: ${SHEET_ID}`);
}

function getToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatDate(date) {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function parseDayOfWeek(day) {
  if (!day && day !== 0) return null;
  const d = String(day).toLowerCase().trim();
  const map = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
  };
  if (map[d] !== undefined) return map[d];
  const n = parseInt(d, 10);
  if (!isNaN(n) && n >= 0 && n <= 6) return n;
  safeLog(`[WARN] Unknown day value: "${day}"`);
  return null;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    getNextOccurrences,
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
    parseEventTriggerConfig,
    eventMatchesCriteria,
    getCalendarEventDate,
    getNextEventTriggeredOccurrence,
    getEventTriggeredAppearDate,
    getGoogleCalendar,
    getOrCreateTaskList,
    getTaskTagSet,
    taskAlreadyExists,
  };
}

