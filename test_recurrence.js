/**
 * Comprehensive Test Suite for Recursive Tasks Recurrence Algorithms
 *
 * Tests the 5 recurrence algorithms:
 * 1. daily: interval 1 (today), interval 2 (every 2 days), interval 3 (every 3 days)
 * 2. weekly: single day, multiple days (';'), bilingual (EN/FR)
 * 3. monthly: single day (1), multiple days (2; 5; 31), clamping (Feb 28/29, Apr 30)
 * 4. yearly-day: day 1 (Jan 1), day 100, day 365/366 (leap and non-leap)
 * 5. yearly-calendar / yearly-calandar: 'july-14; august-1', French names ('14 juillet; 1 aout'), parsing
 */

if (typeof global.Logger === "undefined") {
  global.Logger = { log: () => {} };
}

let mockCalendarEvents = [];
global.CalendarApp = {
  getDefaultCalendar: () => ({
    getEvents: (startTime, endTime) => {
      return mockCalendarEvents.filter((e) => {
        const d = e.getStartTime();
        return d >= startTime && d <= endTime;
      });
    },
  }),
  getCalendarsByName: (name) => {
    return [
      {
        getName: () => name,
        getEvents: (startTime, endTime) => {
          return mockCalendarEvents.filter((e) => {
            const d = e.getStartTime();
            return e.calendarName === name && d >= startTime && d <= endTime;
          });
        },
      },
    ];
  },
  getCalendarById: (id) => null,
};

function createMockEvent(title, startTime, desc = "", calendarName = "@default") {
  return {
    getTitle: () => title,
    getDescription: () => desc,
    getStartTime: () => startTime,
    calendarName,
  };
}

const {
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
  parseDayOfWeek,
  parseMonthDay,
  isLeapYear,
  formatDate,
  getAppearDate,
  parseEventTriggerConfig,
  eventMatchesCriteria,
  getNextEventTriggeredOccurrence,
  getEventTriggeredAppearDate,
} = require("./Code.js");

// --- Minimalist Test Framework ---
let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function describe(suiteName, fn) {
  console.log(`\n==================================================`);
  console.log(`SUITE: ${suiteName}`);
  console.log(`==================================================`);
  fn();
}

function test(testName, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  [PASS] ${testName}`);
  } catch (err) {
    failedTests++;
    console.error(`  [FAIL] ${testName}`);
    console.error(`         ${err.message}`);
    failures.push({ suite: testName, error: err.message });
  }
}

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message || "Expected condition to be true, got false.");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message || "Equality assertion failed"}: expected [${expected}], got [${actual}]`
    );
  }
}

function assertEqualDates(actual, expected, message) {
  if (!actual && !expected) return;
  if (!actual || !expected) {
    throw new Error(
      `${message || "Date assertion failed"}: expected [${expected ? expected.toISOString() : null}], got [${actual ? actual.toISOString() : null}]`
    );
  }
  const actualStr = actual.toISOString().slice(0, 10);
  const expectedStr = expected.toISOString().slice(0, 10);
  if (actualStr !== expectedStr) {
    throw new Error(
      `${message || "Date mismatch"}: expected [${expectedStr} (${formatDate(expected)})], got [${actualStr} (${formatDate(actual)})]`
    );
  }
}

function utcDate(year, month, day) {
  // month is 1-based (1 = Jan, 12 = Dec) for easy readability in test fixtures
  return new Date(Date.UTC(year, month - 1, day));
}

// ==============================================================================
// 1. DAILY RECURRENCE TESTS
// ==============================================================================
describe("1. Daily Recurrence Algorithm", () => {
  test("1 = every day: next occurrence is always 'today'", () => {
    const datesToTest = [
      utcDate(2026, 1, 1),
      utcDate(2026, 2, 28),
      utcDate(2026, 7, 14),
      utcDate(2026, 12, 31),
      utcDate(2024, 2, 29), // leap year
    ];

    for (const today of datesToTest) {
      const ruleNumeric = { recurrence: "daily", dueDay: 1 };
      const resNumeric = getNextOccurrence(ruleNumeric, today);
      assertEqualDates(resNumeric, today, `daily (1 numeric) on ${today.toISOString()}`);

      const ruleString = { recurrence: "daily", dueDay: "1" };
      const resString = getNextOccurrence(ruleString, today);
      assertEqualDates(resString, today, `daily ("1" string) on ${today.toISOString()}`);

      const ruleDefault = { recurrence: "daily", dueDay: "" };
      const resDefault = getNextOccurrence(ruleDefault, today);
      assertEqualDates(resDefault, today, `daily (empty dueDay) on ${today.toISOString()}`);

      const ruleEveryDay = { recurrence: "daily", dueDay: "every day" };
      const resEveryDay = getNextOccurrence(ruleEveryDay, today);
      assertEqualDates(resEveryDay, today, `daily ("every day") on ${today.toISOString()}`);
    }
  });

  test("2 = every 2 days: alternating occurrence and next day", () => {
    const rule = { recurrence: "daily", dueDay: 2 };
    // Check over a sequence of 6 consecutive days
    const base = utcDate(2026, 5, 1);
    const results = [];

    for (let i = 0; i < 6; i++) {
      const today = new Date(base);
      today.setUTCDate(today.getUTCDate() + i);
      const next = getNextOccurrence(rule, today);
      assertTrue(next >= today, `next occurrence must be >= today`);
      const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
      assertTrue(diffDays === 0 || diffDays === 1, `offset for 2-day recurrence must be 0 or 1`);
      results.push({ today: today.toISOString().slice(0, 10), next: next.toISOString().slice(0, 10), diffDays });
    }

    // Verify alternation: offsets must alternate between 0 and 1
    for (let i = 0; i < results.length - 1; i++) {
      assertTrue(
        results[i].diffDays !== results[i + 1].diffDays,
        `Consecutive days should alternate 0 and 1: day ${i} had ${results[i].diffDays}, day ${i+1} had ${results[i+1].diffDays}`
      );
    }
  });

  test("3 = every 3 days: cycle of 0, 2, 1 days offset", () => {
    const rule = { recurrence: "daily", dueDay: 3 };
    const base = utcDate(2026, 6, 1);
    const offsets = [];

    for (let i = 0; i < 9; i++) {
      const today = new Date(base);
      today.setUTCDate(today.getUTCDate() + i);
      const next = getNextOccurrence(rule, today);
      assertTrue(next >= today, `next occurrence must be >= today`);
      const diffDays = Math.round((next.getTime() - today.getTime()) / 86400000);
      assertTrue(diffDays >= 0 && diffDays <= 2, `offset must be 0, 1, or 2`);
      offsets.push(diffDays);
    }

    // Verify 3-day repeating cycle structure: diffDays + (next day's diffDays) relationship
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] === 0) {
        // Today is on schedule; tomorrow will have offset 2, the day after offset 1
        if (i + 1 < offsets.length) assertEqual(offsets[i + 1], 2, `Day after offset 0 must be 2`);
        if (i + 2 < offsets.length) assertEqual(offsets[i + 2], 1, `Two days after offset 0 must be 1`);
      }
    }
  });

  test("aliases: 'day' and 'quotidien' match daily recurrence", () => {
    const today = utcDate(2026, 4, 15);
    const rule1 = { recurrence: "day", dueDay: "1" };
    assertEqualDates(getNextOccurrence(rule1, today), today);

    const rule2 = { recurrence: "quotidien", dueDay: "1" };
    assertEqualDates(getNextOccurrence(rule2, today), today);
  });
});

// ==============================================================================
// 2. WEEKLY RECURRENCE TESTS
// ==============================================================================
describe("2. Weekly Recurrence Algorithm", () => {
  test("single day: english and french weekdays", () => {
    // 2026-11-16 is Monday (UTC day 1)
    const monday = utcDate(2026, 11, 16);
    assertEqual(monday.getUTCDay(), 1, "Fixture must be Monday");

    // Evaluated on Monday
    const ruleMon = { recurrence: "weekly", dueDay: "monday" };
    assertEqualDates(getNextOccurrence(ruleMon, monday), monday, "Monday on Monday is today");

    const ruleLundi = { recurrence: "weekly", dueDay: "lundi" };
    assertEqualDates(getNextOccurrence(ruleLundi, monday), monday, "Lundi on Monday is today");

    const ruleTue = { recurrence: "weekly", dueDay: "tuesday" };
    assertEqualDates(
      getNextOccurrence(ruleTue, monday),
      utcDate(2026, 11, 17),
      "Tuesday from Monday is tomorrow"
    );

    const ruleFri = { recurrence: "weekly", dueDay: "vendredi" };
    assertEqualDates(
      getNextOccurrence(ruleFri, monday),
      utcDate(2026, 11, 20),
      "Vendredi from Monday is in 4 days"
    );

    const ruleSunday = { recurrence: "weekly", dueDay: "dimanche" };
    assertEqualDates(
      getNextOccurrence(ruleSunday, monday),
      utcDate(2026, 11, 22),
      "Dimanche from Monday is Sunday"
    );
  });

  test("single day: wrapping to next week", () => {
    // 2026-11-20 is Friday (UTC day 5)
    const friday = utcDate(2026, 11, 20);
    const ruleMonday = { recurrence: "weekly", dueDay: "monday" };
    assertEqualDates(
      getNextOccurrence(ruleMonday, friday),
      utcDate(2026, 11, 23),
      "Monday evaluated on Friday wraps to next Monday"
    );

    // 2026-11-21 is Saturday (UTC day 6)
    const saturday = utcDate(2026, 11, 21);
    assertEqualDates(
      getNextOccurrence(ruleMonday, saturday),
      utcDate(2026, 11, 23),
      "Monday evaluated on Saturday wraps to Monday (+2 days)"
    );
  });

  test("multiple days separated by ';': english (monday; thursday)", () => {
    const rule = { recurrence: "weekly", dueDay: "monday; thursday" };

    // Tuesday 2026-11-17 -> next is Thursday 2026-11-19
    const tuesday = utcDate(2026, 11, 17);
    assertEqualDates(getNextOccurrence(rule, tuesday), utcDate(2026, 11, 19));

    // Thursday 2026-11-19 -> next is today (Thursday 2026-11-19)
    const thursday = utcDate(2026, 11, 19);
    assertEqualDates(getNextOccurrence(rule, thursday), thursday);

    // Friday 2026-11-20 -> next is Monday 2026-11-23
    const friday = utcDate(2026, 11, 20);
    assertEqualDates(getNextOccurrence(rule, friday), utcDate(2026, 11, 23));

    // Monday 2026-11-23 -> next is today (Monday 2026-11-23)
    const monday = utcDate(2026, 11, 23);
    assertEqualDates(getNextOccurrence(rule, monday), monday);
  });

  test("multiple days separated by ';': french (lundi; vendredi)", () => {
    const rule = { recurrence: "weekly", dueDay: "lundi; vendredi" };

    // Wednesday 2026-11-18 -> next is Friday 2026-11-20
    const wednesday = utcDate(2026, 11, 18);
    assertEqualDates(getNextOccurrence(rule, wednesday), utcDate(2026, 11, 20));

    // Friday 2026-11-20 -> next is today (Friday 2026-11-20)
    const friday = utcDate(2026, 11, 20);
    assertEqualDates(getNextOccurrence(rule, friday), friday);

    // Saturday 2026-11-21 -> next is Monday 2026-11-23
    const saturday = utcDate(2026, 11, 21);
    assertEqualDates(getNextOccurrence(rule, saturday), utcDate(2026, 11, 23));

    // Sunday 2026-11-22 -> next is Monday 2026-11-23
    const sunday = utcDate(2026, 11, 22);
    assertEqualDates(getNextOccurrence(rule, sunday), utcDate(2026, 11, 23));
  });

  test("weekday parser handles abbreviations and numbers", () => {
    assertEqual(parseDayOfWeek("mon"), 1);
    assertEqual(parseDayOfWeek("lun"), 1);
    assertEqual(parseDayOfWeek("mer"), 3);
    assertEqual(parseDayOfWeek("thu"), 4);
    assertEqual(parseDayOfWeek("dim"), 0);
    assertEqual(parseDayOfWeek("0"), 0);
    assertEqual(parseDayOfWeek("6"), 6);
  });
});

// ==============================================================================
// 3. MONTHLY RECURRENCE TESTS
// ==============================================================================
describe("3. Monthly Recurrence Algorithm", () => {
  test("single day: day 1", () => {
    const rule = { recurrence: "monthly", dueDay: "1" };

    // Today is May 1st -> next is today (May 1st)
    const may1 = utcDate(2026, 5, 1);
    assertEqualDates(getNextOccurrence(rule, may1), may1);

    // Today is May 2nd -> next is June 1st
    const may2 = utcDate(2026, 5, 2);
    assertEqualDates(getNextOccurrence(rule, may2), utcDate(2026, 6, 1));

    // Today is Dec 15th -> next is Jan 1st of next year
    const dec15 = utcDate(2026, 12, 15);
    assertEqualDates(getNextOccurrence(rule, dec15), utcDate(2027, 1, 1));
  });

  test("multiple days: '2; 5; 31'", () => {
    const rule = { recurrence: "monthly", dueDay: "2; 5; 31" };

    // March 1, 2026 -> next is March 2
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 1)), utcDate(2026, 3, 2));

    // March 2, 2026 -> next is March 2 (today)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 2)), utcDate(2026, 3, 2));

    // March 3, 2026 -> next is March 5
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 3)), utcDate(2026, 3, 5));

    // March 5, 2026 -> next is March 5 (today)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 5)), utcDate(2026, 3, 5));

    // March 6, 2026 -> next is March 31
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 6)), utcDate(2026, 3, 31));

    // March 31, 2026 -> next is March 31 (today)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 31)), utcDate(2026, 3, 31));
  });

  test("clamping for shorter months: 31 in Feb (non-leap year 2026, 28 days)", () => {
    const rule31 = { recurrence: "monthly", dueDay: "31" };

    // Feb 1, 2026 -> clamps to Feb 28, 2026
    assertEqualDates(getNextOccurrence(rule31, utcDate(2026, 2, 1)), utcDate(2026, 2, 28));

    // Feb 28, 2026 -> is Feb 28, 2026 (today)
    assertEqualDates(getNextOccurrence(rule31, utcDate(2026, 2, 28)), utcDate(2026, 2, 28));

    // Multi-day with 31 in Feb: '2; 5; 31' on Feb 10 -> returns Feb 28, 2026
    const ruleMulti = { recurrence: "monthly", dueDay: "2; 5; 31" };
    assertEqualDates(getNextOccurrence(ruleMulti, utcDate(2026, 2, 10)), utcDate(2026, 2, 28));
  });

  test("clamping for shorter months: 31 in Feb (leap year 2024, 29 days)", () => {
    const rule31 = { recurrence: "monthly", dueDay: "31" };

    // Feb 1, 2024 -> clamps to Feb 29, 2024
    assertEqualDates(getNextOccurrence(rule31, utcDate(2024, 2, 1)), utcDate(2024, 2, 29));

    // Feb 29, 2024 -> is Feb 29, 2024 (today)
    assertEqualDates(getNextOccurrence(rule31, utcDate(2024, 2, 29)), utcDate(2024, 2, 29));
  });

  test("clamping for 30-day months: April 31 clamps to April 30", () => {
    const rule31 = { recurrence: "monthly", dueDay: "31" };
    assertEqualDates(getNextOccurrence(rule31, utcDate(2026, 4, 15)), utcDate(2026, 4, 30));
    assertEqualDates(getNextOccurrence(rule31, utcDate(2026, 4, 30)), utcDate(2026, 4, 30));
  });

  test("roll over when all days in current month have passed", () => {
    const rule = { recurrence: "monthly", dueDay: "10" };
    // May 11 -> next is June 10
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 5, 11)), utcDate(2026, 6, 10));

    // Clamping on roll-over: Jan 31 with dueDay '30' -> Jan 30 passed -> Feb 2026 clamps 30 to Feb 28
    const rule30 = { recurrence: "monthly", dueDay: "30" };
    assertEqualDates(getNextOccurrence(rule30, utcDate(2026, 1, 31)), utcDate(2026, 2, 28));
  });

  test("Nth weekday parser: '2-monday', '1-tuesday', 'last-friday', '2-lundi'", () => {
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("2-monday")), JSON.stringify({ nth: 2, dow: 1 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("1-tuesday")), JSON.stringify({ nth: 1, dow: 2 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("3-friday")), JSON.stringify({ nth: 3, dow: 5 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("last-friday")), JSON.stringify({ nth: -1, dow: 5 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("2-lundi")), JSON.stringify({ nth: 2, dow: 1 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("dernier-lundi")), JSON.stringify({ nth: -1, dow: 1 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("monday-2")), JSON.stringify({ nth: 2, dow: 1 }));
    assertEqual(JSON.stringify(parseNthWeekdayOfMonth("2nd monday")), JSON.stringify({ nth: 2, dow: 1 }));
  });

  test("monthly Nth weekday: '2-monday' returns second Monday of the month", () => {
    const rule = { type: "monthly", parameter_1: "2-monday" };

    // In Nov 2026: Nov 1 is Sun -> 1st Mon is Nov 2, 2nd Mon is Nov 9.
    // Nov 5, 2026 -> returns Nov 9, 2026
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 11, 5)), utcDate(2026, 11, 9));

    // Nov 9, 2026 (today) -> returns Nov 9, 2026
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 11, 9)), utcDate(2026, 11, 9));

    // Nov 10, 2026 (passed) -> returns 2nd Mon of Dec 2026 (Dec 1 is Tue -> 1st Mon Dec 7, 2nd Mon Dec 14)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 11, 10)), utcDate(2026, 12, 14));
  });

  test("monthly pure number and duo: both work individually or combined", () => {
    // Pure number
    const ruleNum = { type: "monthly", parameter_1: "15" };
    assertEqualDates(getNextOccurrence(ruleNum, utcDate(2026, 11, 1)), utcDate(2026, 11, 15));

    // Duo (Nth weekday)
    const ruleDuo = { type: "monthly", parameter_1: "2-monday" };
    assertEqualDates(getNextOccurrence(ruleDuo, utcDate(2026, 11, 1)), utcDate(2026, 11, 9));

    // Combined: pure number + duo
    const ruleCombined = { type: "monthly", parameter_1: "1; 2-monday" };
    const occs = getNextOccurrences(ruleCombined, utcDate(2026, 11, 1));
    assertEqual(occs.length, 2);
    assertEqualDates(occs[0], utcDate(2026, 11, 1)); // day 1 (today)
    assertEqualDates(occs[1], utcDate(2026, 11, 9)); // 2nd Monday
  });

  test("monthly Nth weekday: French '2-lundi' and 'dernier-vendredi'", () => {
    const ruleLundi = { type: "monthly", parameter_1: "2-lundi" };
    assertEqualDates(getNextOccurrence(ruleLundi, utcDate(2026, 11, 5)), utcDate(2026, 11, 9));

    const ruleLastFri = { type: "monthly", parameter_1: "dernier-vendredi" };
    // Nov 2026 has 30 days. Nov 30 is Mon. Last Friday is Nov 27.
    assertEqualDates(getNextOccurrence(ruleLastFri, utcDate(2026, 11, 1)), utcDate(2026, 11, 27));
    assertEqualDates(getNextOccurrence(ruleLastFri, utcDate(2026, 11, 27)), utcDate(2026, 11, 27));
    // Nov 28 -> Dec 2026 has 31 days. Dec 31 is Thu -> last Fri is Dec 25.
    assertEqualDates(getNextOccurrence(ruleLastFri, utcDate(2026, 11, 28)), utcDate(2026, 12, 25));
  });

  test("monthly Nth weekday: multiple expressions ('2-monday; 4-thursday')", () => {
    const rule = { type: "monthly", parameter_1: "2-monday; 4-thursday" };
    // In Nov 2026:
    // 2nd Monday is Nov 9
    // 4th Thursday: Nov 1 is Sun -> 1st Thu Nov 5, 2nd Thu Nov 12, 3rd Thu Nov 19, 4th Thu Nov 26
    const occs = getNextOccurrences(rule, utcDate(2026, 11, 1));
    assertEqual(occs.length, 2);
    assertEqualDates(occs[0], utcDate(2026, 11, 9));
    assertEqualDates(occs[1], utcDate(2026, 11, 26));
  });
});

// ==============================================================================
// 4. YEARLY-DAY RECURRENCE TESTS
// ==============================================================================
describe("4. Yearly-Day Recurrence Algorithm", () => {
  test("day 1 = January 1st", () => {
    const rule = { recurrence: "yearly-day", dueDay: "1" };

    // On Jan 1, 2026 -> returns Jan 1, 2026 (today)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 1, 1)), utcDate(2026, 1, 1));

    // On Jan 2, 2026 -> returns Jan 1, 2027
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 1, 2)), utcDate(2027, 1, 1));
  });

  test("day 100 in non-leap year (2026) is April 10", () => {
    // In 2026: Jan = 31, Feb = 28, Mar = 31 (sum = 90). Day 91 is Apr 1 -> Day 100 is Apr 10.
    const rule = { recurrence: "yearly-day", dueDay: "100" };

    // March 15, 2026 -> April 10, 2026
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 15)), utcDate(2026, 4, 10));

    // April 10, 2026 -> April 10, 2026 (today)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 4, 10)), utcDate(2026, 4, 10));

    // April 11, 2026 -> April 10, 2027 (next year)
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 4, 11)), utcDate(2027, 4, 10));
  });

  test("day 100 in leap year (2024) is April 9", () => {
    // In 2024: Jan = 31, Feb = 29, Mar = 31 (sum = 91). Day 92 is Apr 1 -> Day 100 is Apr 9.
    const rule = { recurrence: "yearly-day", dueDay: "100" };
    assertEqualDates(getNextOccurrence(rule, utcDate(2024, 2, 1)), utcDate(2024, 4, 9));
    assertEqualDates(getNextOccurrence(rule, utcDate(2024, 4, 9)), utcDate(2024, 4, 9));
  });

  test("day 365 and 366: non-leap vs leap year handling", () => {
    const rule365 = { recurrence: "yearly-day", dueDay: "365" };
    const rule366 = { recurrence: "yearly-day", dueDay: "366" };

    // Non-leap year 2026 (365 days):
    // Day 365 is Dec 31
    assertEqualDates(getNextOccurrence(rule365, utcDate(2026, 12, 1)), utcDate(2026, 12, 31));
    // Day 366 clamps to Dec 31
    assertEqualDates(getNextOccurrence(rule366, utcDate(2026, 12, 1)), utcDate(2026, 12, 31));

    // Leap year 2024 (366 days):
    // Day 365 is Dec 30
    assertEqualDates(getNextOccurrence(rule365, utcDate(2024, 12, 1)), utcDate(2024, 12, 30));
    // Day 366 is Dec 31
    assertEqualDates(getNextOccurrence(rule366, utcDate(2024, 12, 1)), utcDate(2024, 12, 31));
  });

  test("multiple yearly days: '1; 100; 365'", () => {
    const rule = { recurrence: "yearly-day", dueDay: "1; 100; 365" };

    // Before day 100: March 1, 2026 -> returns April 10, 2026
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 3, 1)), utcDate(2026, 4, 10));

    // Between 100 and 365: May 1, 2026 -> returns Dec 31, 2026
    assertEqualDates(getNextOccurrence(rule, utcDate(2026, 5, 1)), utcDate(2026, 12, 31));
  });
});

// ==============================================================================
// 5. YEARLY-CALENDAR / YEARLY-CALANDAR RECURRENCE TESTS
// ==============================================================================
describe("5. Yearly-Calendar / Yearly-Calandar Recurrence Algorithm", () => {
  test("spelling compatibility: accepts both 'yearly-calendar' and 'yearly-calandar'", () => {
    const today = utcDate(2026, 5, 1);
    const ruleCalendar = { recurrence: "yearly-calendar", dueDay: "july-14" };
    const ruleCalandar = { recurrence: "yearly-calandar", dueDay: "july-14" };

    assertEqualDates(getNextOccurrence(ruleCalendar, today), utcDate(2026, 7, 14));
    assertEqualDates(getNextOccurrence(ruleCalandar, today), utcDate(2026, 7, 14));
  });

  test("'july-14; august-1': transitions and today occurrences", () => {
    const rule = { recurrence: "yearly-calendar", dueDay: "july-14; august-1" };

    // 1. Before July 14 -> July 14, 2026
    const july10 = utcDate(2026, 7, 10);
    assertEqualDates(getNextOccurrence(rule, july10), utcDate(2026, 7, 14));

    // 2. On July 14 -> July 14, 2026 (today)
    const july14 = utcDate(2026, 7, 14);
    assertEqualDates(getNextOccurrence(rule, july14), july14);

    // 3. After July 14 but before Aug 1 -> August 1, 2026
    const july15 = utcDate(2026, 7, 15);
    assertEqualDates(getNextOccurrence(rule, july15), utcDate(2026, 8, 1));

    // 4. On August 1 -> August 1, 2026 (today)
    const august1 = utcDate(2026, 8, 1);
    assertEqualDates(getNextOccurrence(rule, august1), august1);

    // 5. After August 1 -> rolls over to July 14, 2027
    const august2 = utcDate(2026, 8, 2);
    assertEqualDates(getNextOccurrence(rule, august2), utcDate(2027, 7, 14));
  });

  test("French month-day expressions: '14 juillet; 1 aout'", () => {
    const rule = { recurrence: "yearly-calendar", dueDay: "14 juillet; 1 aout" };

    const june1 = utcDate(2026, 6, 1);
    assertEqualDates(getNextOccurrence(rule, june1), utcDate(2026, 7, 14));

    const july20 = utcDate(2026, 7, 20);
    assertEqualDates(getNextOccurrence(rule, july20), utcDate(2026, 8, 1));
  });

  test("French accents, casing, and ordinals ('1er mai', '15 août')", () => {
    const ruleAccents = { recurrence: "yearly-calandar", dueDay: "15 août" };
    assertEqualDates(getNextOccurrence(ruleAccents, utcDate(2026, 1, 1)), utcDate(2026, 8, 15));

    const ruleOrdinal = { recurrence: "yearly-calendar", dueDay: "1er mai" };
    assertEqualDates(getNextOccurrence(ruleOrdinal, utcDate(2026, 1, 1)), utcDate(2026, 5, 1));

    const ruleFevrier = { recurrence: "yearly-calendar", dueDay: "10 Février" };
    assertEqualDates(getNextOccurrence(ruleFevrier, utcDate(2026, 1, 1)), utcDate(2026, 2, 10));
  });

  test("parseMonthDay parser unit tests", () => {
    // English formats (month is 1-based: 1 = Jan, 12 = Dec)
    assertEqual(JSON.stringify(parseMonthDay("july-14")), JSON.stringify({ month: 7, day: 14 }));
    assertEqual(JSON.stringify(parseMonthDay("august-1")), JSON.stringify({ month: 8, day: 1 }));
    assertEqual(JSON.stringify(parseMonthDay("december 25")), JSON.stringify({ month: 12, day: 25 }));
    assertEqual(JSON.stringify(parseMonthDay("25-dec")), JSON.stringify({ month: 12, day: 25 }));

    // French formats
    assertEqual(JSON.stringify(parseMonthDay("14 juillet")), JSON.stringify({ month: 7, day: 14 }));
    assertEqual(JSON.stringify(parseMonthDay("1 aout")), JSON.stringify({ month: 8, day: 1 }));
    assertEqual(JSON.stringify(parseMonthDay("1 août")), JSON.stringify({ month: 8, day: 1 }));
    assertEqual(JSON.stringify(parseMonthDay("1er mai")), JSON.stringify({ month: 5, day: 1 }));
    assertEqual(JSON.stringify(parseMonthDay("31 decembre")), JSON.stringify({ month: 12, day: 31 }));

    // Numeric formats (e.g. 14/07)
    assertEqual(JSON.stringify(parseMonthDay("14/07")), JSON.stringify({ month: 7, day: 14 }));

    // Invalid formats
    assertEqual(parseMonthDay("not-a-date"), null);
    assertEqual(parseMonthDay(""), null);
  });

  test("leap year date (february 29 / 29 fevrier)", () => {
    const ruleLeap = { recurrence: "yearly-calendar", dueDay: "29 fevrier" };

    // In leap year 2024 -> Feb 29, 2024
    assertEqualDates(getNextOccurrence(ruleLeap, utcDate(2024, 1, 1)), utcDate(2024, 2, 29));

    // In non-leap year 2026 -> clamps to Feb 28, 2026
    assertEqualDates(getNextOccurrence(ruleLeap, utcDate(2026, 1, 1)), utcDate(2026, 2, 28));
  });
});

// ==============================================================================
// 6. MULTI-OCCURRENCE & BACKWARD COMPATIBILITY TESTS
// ==============================================================================
describe("6. getNextOccurrences & Schema Compatibility", () => {
  test("getNextOccurrences returns all upcoming occurrences for multi-day weekly", () => {
    const today = utcDate(2026, 11, 17); // Tuesday
    const rule = { recurrence: "weekly", dueDay: "monday; thursday" };
    const occurrences = getNextOccurrences(rule, today);

    assertEqual(occurrences.length, 2, "Should return 2 occurrences");
    assertEqualDates(occurrences[0], utcDate(2026, 11, 19), "First is Thursday 2026-11-19");
    assertEqualDates(occurrences[1], utcDate(2026, 11, 23), "Second is Monday 2026-11-23");
  });

  test("getNextOccurrences returns all upcoming occurrences for multi-day monthly", () => {
    const today = utcDate(2026, 2, 1); // Feb 1, 2026
    const rule = { recurrence: "monthly", dueDay: "2; 5; 31" };
    const occurrences = getNextOccurrences(rule, today);

    assertEqual(occurrences.length, 3, "Should return 3 occurrences in Feb");
    assertEqualDates(occurrences[0], utcDate(2026, 2, 2));
    assertEqualDates(occurrences[1], utcDate(2026, 2, 5));
    assertEqualDates(occurrences[2], utcDate(2026, 2, 28)); // clamped 31 in Feb
  });

  test("getNextOccurrences returns all upcoming occurrences for multi-date yearly-calendar", () => {
    const today = utcDate(2026, 5, 1);
    const rule = { recurrence: "yearly-calendar", dueDay: "july-14; august-1" };
    const occurrences = getNextOccurrences(rule, today);

    assertEqual(occurrences.length, 2, "Should return 2 occurrences");
    assertEqualDates(occurrences[0], utcDate(2026, 7, 14));
    assertEqualDates(occurrences[1], utcDate(2026, 8, 1));
  });

  test("compatibility with rule.type and rule.parameter_1 headers", () => {
    const today = utcDate(2026, 3, 15);
    const rule = { type: "weekly", parameter_1: "monday" };
    const res = getNextOccurrence(rule, today);
    assertEqualDates(res, utcDate(2026, 3, 16));
  });
});

// ==============================================================================
// 7. ADVANCE RULES & UNIFIED YEARLY RECURRENCE
// ==============================================================================
describe("7. Advance Rules & Unified Yearly Recurrence", () => {
  test("unified 'yearly' handles both day of year numbers and month-day text", () => {
    const today = utcDate(2026, 1, 1);

    // Number (day of year 100 -> April 10, 2026)
    const ruleNum = { type: "yearly", parameter_1: "100" };
    assertEqualDates(getNextOccurrence(ruleNum, today), utcDate(2026, 4, 10));

    // Text (month-day "july-14" -> July 14, 2026)
    const ruleText = { type: "yearly", parameter_1: "july-14" };
    assertEqualDates(getNextOccurrence(ruleText, today), utcDate(2026, 7, 14));

    // Mixed list: "100; august-15"
    const ruleMixed = { type: "yearly", parameter_1: "100; august-15" };
    const occs = getNextOccurrences(ruleMixed, today);
    assertEqual(occs.length, 2);
    assertEqualDates(occs[0], utcDate(2026, 4, 10));
    assertEqualDates(occs[1], utcDate(2026, 8, 15));
  });

  test("advance = 'number_of_day' computes individual appear dates for multiple targets", () => {
    const rule = {
      type: "weekly",
      parameter_1: "monday; thursday",
      advance: "number_of_day",
      parameter_2: "2",
    };

    // Given dueDate is Monday Nov 23, 2026 -> appear is Saturday Nov 21 (J-2)
    const dueDateMon = utcDate(2026, 11, 23);
    assertEqualDates(getAppearDate(rule, dueDateMon), utcDate(2026, 11, 21));

    // Given dueDate is Thursday Nov 26, 2026 -> appear is Tuesday Nov 24 (J-2)
    const dueDateThu = utcDate(2026, 11, 26);
    assertEqualDates(getAppearDate(rule, dueDateThu), utcDate(2026, 11, 24));
  });

  test("advance = 'precise_day' for weekly (weekday number or name)", () => {
    // Due Friday, appear Monday (1 or "monday")
    const ruleWeekly = {
      type: "weekly",
      parameter_1: "friday",
      advance: "precise_day",
      parameter_2: "1", // Monday
    };
    const dueFri = utcDate(2026, 11, 20); // Friday
    assertEqualDates(getAppearDate(ruleWeekly, dueFri), utcDate(2026, 11, 16)); // Monday

    const ruleWeeklyName = {
      type: "weekly",
      parameter_1: "friday",
      advance: "precise_day",
      parameter_2: "lundi",
    };
    assertEqualDates(getAppearDate(ruleWeeklyName, dueFri), utcDate(2026, 11, 16));
  });

  test("advance = 'precise_day' for monthly (day number and Nth weekday)", () => {
    // 1. Day number in same month: due on Nov 20, appear on the 1st
    const ruleMonthlyNum = {
      type: "monthly",
      parameter_1: "20",
      advance: "precise_day",
      parameter_2: "1",
    };
    const dueNov20 = utcDate(2026, 11, 20);
    assertEqualDates(getAppearDate(ruleMonthlyNum, dueNov20), utcDate(2026, 11, 1));

    // 2. Day number in previous month: due on Nov 5, appear on the 25th of Oct
    const ruleMonthlyPrev = {
      type: "monthly",
      parameter_1: "5",
      advance: "precise_day",
      parameter_2: "25",
    };
    const dueNov5 = utcDate(2026, 11, 5);
    assertEqualDates(getAppearDate(ruleMonthlyPrev, dueNov5), utcDate(2026, 10, 25));

    // 3. Nth weekday duo: due on 2nd Monday (Nov 9), appear on 1st Tuesday (Nov 3)
    const ruleMonthlyDuo = {
      type: "monthly",
      parameter_1: "2-monday",
      advance: "precise_day",
      parameter_2: "1-tuesday",
    };
    const dueNov9 = utcDate(2026, 11, 9);
    assertEqualDates(getAppearDate(ruleMonthlyDuo, dueNov9), utcDate(2026, 11, 3));
  });

  test("advance = 'precise_day' for yearly (day of year and month-day duo)", () => {
    // 1. Month-day text: due Dec 25, appear Dec 1
    const ruleYearlyText = {
      type: "yearly",
      parameter_1: "december-25",
      advance: "precise_day",
      parameter_2: "december-1",
    };
    const dueDec25 = utcDate(2026, 12, 25);
    assertEqualDates(getAppearDate(ruleYearlyText, dueDec25), utcDate(2026, 12, 1));

    // 2. Day of year number: due day 100 (Apr 10), appear day 90 (Mar 31)
    const ruleYearlyNum = {
      type: "yearly",
      parameter_1: "100",
      advance: "precise_day",
      parameter_2: "90",
    };
    const dueDay100 = utcDate(2026, 4, 10);
    assertEqualDates(getAppearDate(ruleYearlyNum, dueDay100), utcDate(2026, 3, 31));
  });
});

// ==============================================================================
// 8. EVENT_TRIGGERED RECURRENCE & ADVANCE TESTS
// ==============================================================================
describe("8. Event-Triggered Recurrence & Advance Algorithm", () => {
  test("parseEventTriggerConfig parses key-value pairs with quotes and defaults", () => {
    const cfg1 = parseEventTriggerConfig('TITLE="cours de chinois";OFFSET=1');
    assertEqual(cfg1.title, "cours de chinois");
    assertEqual(cfg1.offset, 1);
    assertEqual(cfg1.longshot, 60);
    assertEqual(cfg1.desc, null);
    assertEqual(cfg1.calendar, null);

    const cfg2 = parseEventTriggerConfig('TITLE=cours de chinois;DESC="salle 102";CALENDAR="Perso";OFFSET=-1;LONGSHOT=30');
    assertEqual(cfg2.title, "cours de chinois");
    assertEqual(cfg2.desc, "salle 102");
    assertEqual(cfg2.calendar, "Perso");
    assertEqual(cfg2.offset, -1);
    assertEqual(cfg2.longshot, 30);

    const cfgEmpty = parseEventTriggerConfig("");
    assertEqual(cfgEmpty, null);
  });

  test("type = 'event_triggered' finds first upcoming matching event starting from today", () => {
    const today = utcDate(2026, 11, 21);
    mockCalendarEvents = [
      createMockEvent("Dentiste", utcDate(2026, 11, 23)),
      createMockEvent("Cours de chinois", utcDate(2026, 11, 25)),
      createMockEvent("Cours de chinois", utcDate(2026, 11, 28)),
    ];

    // Case 1: OFFSET = 0 -> due date is Nov 25
    const rule1 = {
      type: "event_triggered",
      parameter_1: 'TITLE="cours de chinois"',
    };
    const occs1 = getNextOccurrences(rule1, today);
    assertEqual(occs1.length, 1);
    assertEqualDates(occs1[0], utcDate(2026, 11, 25));

    // Case 2: OFFSET = 1 -> due date is Nov 26 (day after event)
    const rule2 = {
      type: "event_triggered",
      parameter_1: 'TITLE="cours de chinois";OFFSET=1',
    };
    const occs2 = getNextOccurrences(rule2, today);
    assertEqual(occs2.length, 1);
    assertEqualDates(occs2[0], utcDate(2026, 11, 26));

    // Case 3: OFFSET = -1 -> due date is Nov 24 (day before event)
    const rule3 = {
      type: "event_triggered",
      parameter_1: 'TITLE="cours de chinois";OFFSET=-1',
    };
    const occs3 = getNextOccurrences(rule3, today);
    assertEqual(occs3.length, 1);
    assertEqualDates(occs3[0], utcDate(2026, 11, 24));
  });

  test("type = 'event_triggered' respects LONGSHOT window limit", () => {
    const today = utcDate(2026, 1, 1);
    // Event is 75 days later (March 17)
    mockCalendarEvents = [
      createMockEvent("Grand Marathon", utcDate(2026, 3, 17)),
    ];

    // Default longshot is 60 days -> event at day 75 is NOT found
    const ruleDefault = {
      type: "event_triggered",
      parameter_1: 'TITLE="Marathon"',
    };
    const occsDefault = getNextOccurrences(ruleDefault, today);
    assertEqual(occsDefault.length, 0);

    // Explicit LONGSHOT=90 -> event IS found
    const ruleExtended = {
      type: "event_triggered",
      parameter_1: 'TITLE="Marathon";LONGSHOT=90',
    };
    const occsExtended = getNextOccurrences(ruleExtended, today);
    assertEqual(occsExtended.length, 1);
    assertEqualDates(occsExtended[0], utcDate(2026, 3, 17));
  });

  test("type = 'event_triggered' filters by CALENDAR and DESC", () => {
    const today = utcDate(2026, 11, 1);
    mockCalendarEvents = [
      createMockEvent("Réunion", utcDate(2026, 11, 5), "Session interne", "Travail"),
      createMockEvent("Réunion", utcDate(2026, 11, 10), "Conseil syndical", "Perso"),
    ];

    const rulePerso = {
      type: "event_triggered",
      parameter_1: 'TITLE="Réunion";CALENDAR="Perso"',
    };
    const occs = getNextOccurrences(rulePerso, today);
    assertEqual(occs.length, 1);
    assertEqualDates(occs[0], utcDate(2026, 11, 10));
  });

  test("advance = 'event_triggered' finds closest matching event to dueDate and applies offset", () => {
    // Task due on Friday Nov 27
    const dueFriday = utcDate(2026, 11, 27);
    mockCalendarEvents = [
      createMockEvent("Cours de chinois", utcDate(2026, 11, 10)),
      createMockEvent("Cours de chinois", utcDate(2026, 11, 24)), // Tuesday (closest to Friday Nov 27, dist = 3 days)
      createMockEvent("Cours de chinois", utcDate(2026, 12, 8)),
    ];

    // "TITLE='cours de chinois';OFFSET=1" -> task appears day after closest event (Nov 24 + 1 = Nov 25)
    const rule = {
      type: "weekly",
      parameter_1: "friday",
      advance: "event_triggered",
      parameter_2: 'TITLE="cours de chinois";OFFSET=1',
    };

    const appearDate = getAppearDate(rule, dueFriday);
    assertEqualDates(appearDate, utcDate(2026, 11, 25));
  });

  test("advance = 'event_triggered' falls back to dueDate if no matching event", () => {
    const dueDate = utcDate(2026, 11, 27);
    mockCalendarEvents = []; // No events

    const rule = {
      type: "weekly",
      parameter_1: "friday",
      advance: "event_triggered",
      parameter_2: 'TITLE="Événement introuvable"',
    };

    const appearDate = getAppearDate(rule, dueDate);
    assertEqualDates(appearDate, dueDate);
  });
});

// ==============================================================================
// SUMMARY & EXIT CODE
// ==============================================================================
console.log("\n==================================================");
console.log(`TEST SUMMARY`);
console.log(`==================================================`);
console.log(`Total tests:  ${totalTests}`);
console.log(`Passed tests: ${passedTests}`);
console.log(`Failed tests: ${failedTests}`);

if (failedTests > 0) {
  console.error(`\nFAILED TESTS (${failedTests}):`);
  failures.forEach((f, idx) => {
    console.error(`  ${idx + 1}. ${f.suite}: ${f.error}`);
  });
  process.exit(1);
} else {
  console.log(`\n🎉 ALL TESTS PASSED SUCCESSFULLY (100%)!`);
  process.exit(0);
}
