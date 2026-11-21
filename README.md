# 🔁 Recursive Tasks (Google Apps Script)

> Automatically create recurring tasks in **Google Tasks** with advanced scheduling rules (advance appearance days, multi-list routing, custom recurrence patterns, and bulletproof deduplication) managed directly from a simple **Google Sheet**.

---

## 🌟 Why this project?

While Google Tasks supports basic recurring tasks, it has several critical limitations:
* You cannot make a task **appear $X$ days in advance** of its due date (to prepare or plan ahead).
* You cannot configure a task to appear on a **specific day of the week** (e.g., appear every *Monday* for a task due on *Saturday*).
* You cannot define **multiple recurrence targets** in a single rule (e.g., every Monday and Thursday, or the 1st and 15th of the month).
* Managing complex routines across multiple task lists is tedious and hard to audit in the standard UI.

**Recursive Tasks** solves these challenges by letting you define all your recurring routines in a single Google Sheet, automatically synced to Google Tasks every morning.

---

## ✨ Features

* 📋 **Centralized Spreadsheet Management**: Easily add, tweak, or disable task rules in a clean tabular view.
* 🔄 **5 Powerful Recurrence Engines**: Support for daily intervals, multi-day weekly routines, monthly dates, day-of-year milestones, and calendar dates.
* 📅 **Flexible Advance Scheduling**:
  * **Relative offset (`advance_days`)**: Make tasks appear $X$ days before their due date ($D-1$, $D-3$, etc.).
  * **Day-of-week anchor (`advance_day_of_week`)**: Make tasks appear on a specific weekday leading up to their due date (e.g., plan your week on Monday for tasks due later in the week).
* 🛡️ **Bulletproof Deduplication (`RTid`)**: Every recurring occurrence receives a unique identifier tag (`[RTidYYYYMMDDHHmmXXX]`) appended to its description. Even if you complete or hide the task earlier, it will never be duplicated on subsequent daily runs.
* 📁 **Multi-List Support & Auto-Provisioning**: Route tasks to specific task lists (e.g., *Work*, *Home*, *Finance*). If a list does not exist yet, the script creates it automatically!
* 🌍 **Bilingual Support**: Recurrence parameters and appearance days support English and French, full names, abbreviations, and standard formats.
* ⏰ **100% Autonomous**: Runs on a daily 6:00 AM Google Cloud time-based trigger—no external servers, local daemons, or machine wakeups required.

---

## 📊 Google Sheet Configuration

The script connects to a Google Spreadsheet named **`Recursive Tasks`** containing a tab/sheet named **`Tasks`**.

### Column Schema (Row 1)

Row 1 of the **`Tasks`** sheet must contain the following 8 header columns:

| Column | Type | Required | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `enabled` | Boolean | Yes | Enables (`TRUE`) or disables (`FALSE`) the recurrence rule. | `TRUE` |
| `title` | String | Yes | Title of the task created in Google Tasks. | `Water household plants` |
| `description` | String | No | Task notes or body description. Deduplication ID tag will be appended at the end. | `Check moisture level first` |
| `tasklist_name` | String | No | Target task list name. If blank or `@default`, your primary default list is used. | `Home` |
| `type` | String | Yes | Recurrence type: `daily`, `weekly`, `monthly`, or `yearly`. | `weekly` |
| `parameter_1` | String | Yes | Recurrence parameter matching the chosen `type` (e.g. `2-monday`, `15`, `monday; thursday`). | `monday; thursday` |
| `advance` | String | No | Advance mode: `number_of_day` or `precise_day`. If empty, appears on due date. | `precise_day` |
| `parameter_2` | String | No | Configuration for `advance` (number of days or precise day target). | `1` |

---

## 🔄 Recurrence Types & Parameters Guide

Recursive Tasks supports **4 core recurrence types**. Multiple values within `parameter_1` can be separated with a semicolon (`;`).

### 1. `daily`
* **Description**: Triggers tasks at regular day intervals.
* **Parameter format**: An integer representing the day step interval.
* **Examples**:
  * `1` &rarr; Every single day.
  * `2` &rarr; Every other day (every 2 days).
  * `7` &rarr; Every 7 days.

---

### 2. `weekly`
* **Description**: Triggers tasks on specified days of the week.
* **Parameter format**: A single weekday or a list of weekdays separated by `;`. Supports English and French (full names, short abbreviations, or numbers `0` to `6` where 0 = Sunday).
* **Examples**:
  * `friday` &rarr; Every Friday.
  * `monday; thursday` &rarr; Every Monday and every Thursday.
  * `lundi; mercredi; vendredi` &rarr; Every Monday, Wednesday, and Friday.
  * `sat; sun` &rarr; Every weekend day.

---

### 3. `monthly`
* **Description**: Triggers tasks on specific days of each month (either by pure day number or by Nth weekday duo).
* **Parameter format**: One or more day numbers (1 to 31) or Nth weekday expressions (e.g. `2-monday`, `last-friday`), separated by `;`.
* **Examples**:
  * `1` &rarr; 1st day of every month (e.g., rent, monthly budget review).
  * `2; 5` &rarr; On both the 2nd and 5th of each month.
  * `2-monday` &rarr; The **second Monday** of each month (e.g., monthly board meeting).
  * `1-tuesday` &rarr; The first Tuesday of each month.
  * `last-friday` (or `dernier-vendredi`) &rarr; The last Friday of each month.
  * `2-monday; 4-thursday` &rarr; The 2nd Monday and 4th Thursday of each month.
  * `1; 2-monday` &rarr; Both pure number and duo combined.

---

### 4. `yearly`
* **Description**: Unified annual recurrence. Automatically distinguishes between day-of-year numbers and month-day calendar text.
* **Parameter format**: One or more day numbers (1 to 366) or month-day pairs separated by `;`.
* **Examples**:
  * `100` &rarr; Day 100 of the year (mid-April).
  * `256` &rarr; Programmers' Day (Day 256 of the year).
  * `july-14; august-1` &rarr; Bastille Day (July 14) and Swiss National Day (August 1).
  * `14 juillet; 1 aout` &rarr; Same dates expressed in French format.
  * `december-25` &rarr; Christmas Day (December 25th).
  * `100; july-14` &rarr; Combines both number and date formats.

---

## ⏳ Advance Appearance Rules (`advance` & `parameter_2`)

You can control exactly when a recurring task appears in Google Tasks before its due date:

### 1. `advance = "number_of_day"`
* **`parameter_2`**: An integer indicating how many days before the due date the task should appear ($J - X$).
* **Individual Occurrence Handling**: When multiple days are specified in `parameter_1` (e.g. `monday; thursday`), each occurrence calculates its appear date individually (e.g. Monday's task appears Saturday, Thursday's appears Tuesday).

### 2. `advance = "precise_day"`
Controls the exact calendar anchor for the task to appear:
* **For `weekly`**: `parameter_2` is the weekday (number `0`–`6` or name, e.g. `1` or `monday`) when the task should appear leading up to the due date.
* **For `monthly`**: `parameter_2` can be:
  * A day number of the month (e.g. `1` &rarr; appears on the 1st of the month).
  * A duo expression (e.g. `1-tuesday` &rarr; appears on the first Tuesday of the month).
* **For `yearly`**: `parameter_2` can be:
  * A day of the year (e.g. `90` &rarr; appears on day 90).
  * A month-day pair (e.g. `december-1` &rarr; appears on December 1st).

---

## 💡 Spreadsheet Examples

Here is an example setup demonstrating how different recurrence types and advance appearances interact:

| enabled | title | description | tasklist_name | type | parameter_1 | advance | parameter_2 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TRUE` | Morning stretch routine | 10 minutes of yoga | Health | `daily` | `1` | | |
| `TRUE` | Put out recycling bins | Yellow and green bins | Home | `weekly` | `tuesday` | `number_of_day` | `1` |
| `TRUE` | Team sprint planning | Prepare slide deck & agenda | Work | `weekly` | `friday` | `precise_day` | `monday` |
| `TRUE` | Pay apartment rent | Transfer to landlord via SEPA | Finance | `monthly` | `1` | `number_of_day` | `5` |
| `TRUE` | Monthly board sync | Review department KPIs | Work | `monthly` | `2-monday` | `precise_day` | `1-tuesday` |
| `TRUE` | Mid-month budget audit | Export bank statements | Finance | `monthly` | `15` | `precise_day` | `1` |
| `TRUE` | Mid-year goal review | Revisit annual OKRs | Personal | `yearly` | `182` | `precise_day` | `175` |
| `TRUE` | File tax return | Gather receipts and forms | Admin | `yearly` | `may-15` | `number_of_day` | `14` |
| `TRUE` | Wish happy birthday | Send card and gift | Friends | `yearly` | `july-14; august-1`| `number_of_day` | `3` |

---

## 🚀 Getting Started

### Option A: Quick Setup via Google Apps Script Web Editor

1. Create a new Google Spreadsheet on [Google Sheets](https://sheets.new) named **`Recursive Tasks`**.
2. Rename the active sheet/tab to **`Tasks`** and populate row 1 with the headers:
   ```text
   enabled | title | description | tasklist_name | type | parameter_1 | advance | parameter_2
   ```
3. In the spreadsheet menu, navigate to **Extensions > Apps Script**.
4. Replace the editor contents with the code from [Code.js](Code.js).
5. **Enable the Google Tasks API**:
   * In the left sidebar, click the **`+`** icon next to **Services**.
   * Select **Google Tasks API**, verify version `v1`, and confirm identifier is `Tasks`.
6. Click the 💾 **Save** button.

### Option B: Local Development with `clasp`

If you use Google's official [clasp](https://github.com/google/clasp) CLI:

```bash
# 1. Clone this repository
git clone <YOUR_REPO_URL>
cd "Recursive Tasks"

# 2. Log in to your Google Account
clasp login

# 3. Create or link an existing Apps Script project
clasp create --title "Recursive Tasks" --type sheets
# or configure your existing scriptId in .clasp.json

# 4. Push code to Apps Script
clasp push
```

---

## ⚙️ Initial Run & Scheduling

In the Google Apps Script editor:

1. Select **`setupDailyTrigger`** from the function dropdown and click **Run**.
2. Review and grant the requested Google permissions (Drive read access and Google Tasks management).
3. Your daily 6:00 AM trigger is now active!

> 💡 **Immediate Testing**: To generate your tasks right away without waiting until tomorrow morning, select **`checkAndCreateTasks`** and click **Run**. Check the **Execution log** to see task creation and skip decisions.

---

## 🛠️ Callable Functions Reference

| Function | Purpose |
| :--- | :--- |
| `setupDailyTrigger()` | **Run once during installation**. Automatically configures the daily 6:00 AM background trigger in Google Cloud. |
| `checkAndCreateTasks()` | **Main synchronization engine**. Runs automatically every morning at 6:00 AM, or manually on demand. |
| `setSheetId()` | **Fallback utility**. Allows manually pinning a specific Google Sheet ID (`SHEET_ID`) if auto-discovery by file name fails. |

---

## 📁 Repository Structure

```text
.
├── .clasp.json       # Apps Script deployment settings (ignored by Git)
├── .gitignore        # Git ignore rules (.clasp.json, auth tokens, logs, etc.)
├── appsscript.json   # Apps Script manifest (timezone, Tasks v1 advanced service)
├── Code.js           # Core Google Apps Script implementation
└── README.md         # Project documentation
```

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — feel free to use and modify it for your own needs.
