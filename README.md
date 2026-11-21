# 🔁 Advanced Google Tasks Scheduler

![JavaScript](https://img.shields.io/badge/JavaScript-ES6+-F7DF1E?logo=javascript&logoColor=black)
![Google Apps Script](https://img.shields.io/badge/Google_Apps_Script-4285F4?logo=google&logoColor=white)
![Google Workspace](https://img.shields.io/badge/Google_Workspace-Sheets_%7C_Tasks_%7C_Calendar-34A853?logo=google)
![CLI](https://img.shields.io/badge/CLI-clasp-blue?logo=google)
![License](https://img.shields.io/badge/License-MIT-green.svg)

> Automatically create recurring tasks in **Google Tasks** with advanced scheduling rules (advance appearance days, multi-list routing, calendar event triggers, and bulletproof deduplication) managed directly from a simple **Google Sheet**.

---

## 📌 Overview

**Advanced Google Tasks Scheduler** is a Google Apps Script automation that brings advanced task scheduling to Google Tasks, configured and maintained entirely through a simple **Google Sheet on Google Drive**.

The system is built around two core capabilities:
* **Advanced Task Recurrence**: Define recurring deadlines with precision well beyond native capabilities (`daily` step intervals, multi-day `weekly` schedules, `monthly` dates & Nth weekdays like `2-monday`, `yearly` milestones & calendar dates, or dynamic Google Calendar `event_triggered` deadlines).
* **Fine-Grained Appearance Scheduling**: Control exactly when each task appears in your task lists before its deadline—whether via a relative day offset (`number_of_day`), anchored to a specific weekday or calendar date (`precise_day`), or linked to a Google Calendar event (`event_triggered`).

Every rule is easily managed in your spreadsheet, and the script runs autonomously every morning via a Google Cloud trigger.

---

## ✨ Features

* 🔄 **5 Powerful Recurrence Engines**: Full support for daily intervals, multi-day weekly routines, monthly dates & Nth weekdays, annual milestones, and calendar event triggers.
* 📅 **Flexible Advance Scheduling**: Make tasks appear in advance using relative day counts (`D-X`), specific calendar anchors, or relative to Google Calendar events.
* 🛡️ **Bulletproof Deduplication (`RTid`)**: Every recurring occurrence receives a unique identifier tag (`[RTidYYYYMMDDXXX]`) appended to its description. Even if you complete or hide the task earlier, it will never be duplicated on subsequent daily runs.
* 📁 **Multi-List Support & Auto-Provisioning**: Route tasks to specific task lists (e.g., *Work*, *Home*, *Finance*). If a list does not exist yet, the script creates it automatically!
* ⏰ **100% Autonomous**: Runs on a daily 6:00 AM Google Cloud time-based trigger—no external servers, local daemons, or machine wakeups required.

---

## 📊 Google Sheet Configuration

The script connects to a Google Spreadsheet initially named **`Advanced Google Tasks Scheduler`** containing a tab/sheet named **`Tasks`**.

> 💡 **Persistent Linking**: Once the script runs and detects your spreadsheet for the first time, its unique Google Drive ID is permanently saved in the script's properties. From that point on, you can freely **rename the spreadsheet file** or **move it into any folder on your Google Drive**. However, the internal tab containing your rules **must always remain named `Tasks`**.

### Column Schema (Row 1)

Row 1 of the **`Tasks`** sheet must contain the following 8 header columns:

| Column | Type | Required | Description | Example |
| :--- | :--- | :---: | :--- | :--- |
| `enabled` | Boolean | Yes | Enables (`TRUE`) or disables (`FALSE`) the recurrence rule. | `TRUE` |
| `title` | String | Yes | Title of the task created in Google Tasks. | `Water household plants` |
| `description` | String | No | Task notes or body description. Deduplication ID tag will be appended at the end. | `Check moisture level first` |
| `tasklist_name` | String | No | Target task list name. If blank or `@default`, your primary default list is used. | `Home` |
| `type` | String | Yes | Recurrence type: `daily`, `weekly`, `monthly`, `yearly`, or `event_triggered`. | `weekly` |
| `parameter_1` | String | Yes | Recurrence parameter matching the chosen `type` (e.g. `friday`, `2-monday`, `15`). | `friday` |
| `advance` | String | No | Advance mode: `number_of_day`, `precise_day`, or `event_triggered`. If empty, appears on due date. | `precise_day` |
| `parameter_2` | String | No | Configuration for `advance` (days count, precise day, or event filter string). | `monday` |

---

## 📝 Task Definition Parameters (`enabled`, `title`, `description`, `tasklist_name`)

These 4 columns define the task's identity, content, status, and destination list in Google Tasks:

### 1. `enabled`
* **Description**: Master switch to turn the recurrence rule on or off.
* **Values**: `TRUE` (active) or `FALSE` (paused/disabled).
* **Usage**: Allows temporarily pausing recurring generation without deleting the row configuration.

---

### 2. `title`
* **Description**: The headline or title of the task created in Google Tasks.
* **Format**: Plain text (e.g. `Water household plants`, `Quarterly tax filing`).
* **Requirement**: **Mandatory**. Rows with an empty title are automatically skipped.

---

### 3. `description`
* **Description**: Task notes, detailed instructions, or checklists.
* **Format**: Plain text or multiline text.
* **Deduplication Tag**: The script automatically appends the unique tracking tag (e.g. `[RTid20261121002]`) at the end of the description to guarantee that an occurrence is never duplicated.

---

### 4. `tasklist_name`
* **Description**: The target Google Tasks list where the task will be added.
* **Values**:
  * Any list name (e.g. `Home`, `Work`, `Finance`, `Groceries`).
  * If left empty or set to `@default`, the task is created in your primary default Google Tasks list.
* **Auto-Provisioning**: If the specified list does not exist in your Google Tasks account, the script automatically creates it for you!

---

## 🔄 Recurrence Types & Parameters Guide (`type` & `parameter_1`)

**Advanced Google Tasks Scheduler** supports **5 distinct recurrence types**. Multiple values within `parameter_1` can be separated with a semicolon (`;`).

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
* **Parameter format**: A single weekday or a list of weekdays separated by `;`. Supports full names, short abbreviations (e.g. `mon`, `wed`, `fri`), or numbers `0` to `6` (where 0 = Sunday).
* **Examples**:
  * `friday` &rarr; Every Friday.
  * `monday; thursday` &rarr; Every Monday and every Thursday.
  * `sat; sun` &rarr; Every weekend day.

---

### 3. `monthly`
* **Description**: Triggers tasks on specific days of each month (either by day number or by Nth weekday pair).
* **Parameter format**: One or more day numbers (1 to 31) or Nth weekday expressions (e.g. `2-monday`, `last-friday`), separated by `;`.
* **Examples**:
  * `1` &rarr; 1st day of every month (e.g., rent, monthly budget review).
  * `2; 5` &rarr; On both the 2nd and 5th of each month.
  * `2-monday` &rarr; The **second Monday** of each month (e.g., monthly board meeting).
  * `1-tuesday` &rarr; The first Tuesday of each month.
  * `last-friday` &rarr; The last Friday of each month.
  * `2-monday; 4-thursday` &rarr; The 2nd Monday and 4th Thursday of each month.
  * `1; 2-monday` &rarr; Both day number and Nth weekday pair combined.

---

### 4. `yearly`
* **Description**: Unified annual recurrence. Automatically distinguishes between day-of-year numbers and month-day calendar text.
* **Parameter format**: One or more day numbers (1 to 366) or month-day pairs separated by `;`.
* **Examples**:
  * `100` &rarr; Day 100 of the year (mid-April).
  * `256` &rarr; Programmers' Day (Day 256 of the year).
  * `july-14; august-1` &rarr; July 14th and August 1st.
  * `december-25` &rarr; Christmas Day (December 25th).
  * `100; july-14` &rarr; Combines both number and date formats.

---

### 5. `event_triggered`
* **Description**: Dynamically anchors the task due date to a specific Google Calendar event.
* **Parameter format**: Semicolon-separated key-value search criteria:
  * `TITLE="..."`: Case-insensitive keywords in event title (all space-separated keywords must be present, in any order).
  * `DESC="..."`: Case-insensitive keywords in event description (all space-separated keywords must be present, in any order).
  * `CALENDAR="..."`: Specific calendar name, ID, or `"primary"` (defaults to searching across **all calendars**).
  * `OFFSET=...`: Integer day shift (e.g. `0` = event day, `1` = day after, `-1` = day before). Default `0`.
  * `LONGSHOT=...`: Search window in days ahead from today. Default `60` days.
* **Single Occurrence Guarantee**: Scans forward starting from today and stops at the **first matching event**. A single row will never spawn multiple concurrent tasks in Google Tasks.
* **Examples**:
  * `TITLE="Chinese class";OFFSET=1` &rarr; Due the day after your next Chinese class.
  * `TITLE="Exam";OFFSET=-1;LONGSHOT=90` &rarr; Due the day before your next exam within 90 days.
  * `TITLE="Board meeting";CALENDAR="Personal"` &rarr; Due on the day of the meeting found in the "Personal" calendar.

---

## ⏳ Advance Appearance Rules (`advance` & `parameter_2`)

You can control exactly when a recurring task appears in Google Tasks before its due date:

### 1. `advance = "number_of_day"`
* **`parameter_2`**: An integer indicating how many days before the due date the task should appear (`D-X`).
* **Individual Occurrence Handling**: When multiple days are specified in `parameter_1` (e.g. `monday; thursday`), each occurrence calculates its appear date individually (e.g. with `parameter_2 = 2`, Monday's task appears Saturday and Thursday's appears Tuesday).

### 2. `advance = "precise_day"`
Controls the exact calendar anchor for the task to appear:
* **For `weekly`**: `parameter_2` is the weekday (number `0`–`6` or name, e.g. `1` or `monday`) when the task should appear leading up to the due date.
* **For `monthly`**: `parameter_2` can be:
  * A day number of the month (e.g. `1` &rarr; appears on the 1st of the month).
  * An Nth weekday pair (e.g. `1-tuesday` &rarr; appears on the first Tuesday of the month).
* **For `yearly`**: `parameter_2` can be:
  * A day of the year (e.g. `90` &rarr; appears on day 90).
  * A month-day pair (e.g. `december-1` &rarr; appears on December 1st).

### 3. `advance = "event_triggered"`
* **Description**: Makes a task appear relative to a Google Calendar event.
* **`parameter_2`**: Event filter string (same syntax as above: `TITLE="..."`, `DESC="..."`, `CALENDAR="..."`, `OFFSET=...`, `LONGSHOT=...`, `SELF=...`):
  * `SELF=True/False`: (Default `True`). When set to `False`, instead of anchoring to the target event itself, it anchors to the **previous event with the exact same name** occurring before the target event.
* **Closest Event Matching**: Looks for the matching event **closest** to the task's due date (or preceding it when `SELF=False`) and applies `OFFSET`.
* **Examples**:
  * `TITLE="Chinese class";OFFSET=1` &rarr; The task appears the day following your Chinese class (e.g. to review lesson material after class).
  * `TITLE="Chinese class";SELF=False;OFFSET=1` &rarr; The preparation task appears the day after your **previous** Chinese class to prepare ahead for the upcoming session.

---

## 💡 Spreadsheet Examples

Here is an example setup demonstrating how different recurrence types and advance appearances interact:

| enabled | title | description | tasklist_name | type | parameter_1 | advance | parameter_2 |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `TRUE` | Morning stretch routine | 10 minutes of yoga | Health | `daily` | `1` | | |
| `TRUE` | Put out recycling bins | Yellow and green bins | Home | `weekly` | `tuesday` | `number_of_day` | `1` |
| `TRUE` | Team sprint planning | Prepare slide deck & agenda | Work | `weekly` | `friday` | `precise_day` | `monday` |
| `TRUE` | Review Chinese vocabulary | Practice flashcards after class | Study | `weekly` | `friday` | `event_triggered` | `TITLE="Chinese class";OFFSET=1` |
| `TRUE` | Chinese class homework | Complete workbook exercises | Study | `event_triggered` | `TITLE="Chinese class"` | `event_triggered` | `TITLE="Chinese class";SELF=False;OFFSET=1` |
| `TRUE` | Pay apartment rent | Transfer to landlord via SEPA | Finance | `monthly` | `1` | `number_of_day` | `5` |
| `TRUE` | Monthly board sync | Review department KPIs | Work | `monthly` | `2-monday` | `precise_day` | `1-tuesday` |
| `TRUE` | Mid-month budget audit | Export bank statements | Finance | `monthly` | `15` | `precise_day` | `1` |
| `TRUE` | Prepare final exam pack | Print summary sheets | Study | `event_triggered` | `TITLE="Exam";OFFSET=-1` | `number_of_day` | `7` |
| `TRUE` | File tax return | Gather receipts and forms | Admin | `yearly` | `may-15` | `number_of_day` | `14` |
| `TRUE` | Wish happy birthday | Send card and gift | Friends | `yearly` | `july-14; august-1`| `number_of_day` | `3` |

---

## 🚀 Getting Started

1. Go to [Google Apps Script](https://script.new) to create a new script project and rename it to **`Advanced Google Tasks Scheduler`** (or open **Extensions > Apps Script** from an existing Google Sheet).
2. Replace the editor contents with the code from [Code.js](Code.js).
3. **Enable the Google Tasks API**:
   * In the left sidebar, click the **`+`** icon next to **Services**.
   * Select **Google Tasks API**, verify version `v1`, and confirm identifier is `Tasks`.
4. Click the 💾 **Save** button.

<details>
<summary>⚡ <b>Alternative: Deploy via clasp (Google Apps Script CLI)</b></summary>

For developers preferring the terminal workflow via [`@google/clasp`](https://github.com/google/clasp):
```bash
git clone https://github.com/Thomas-dvd/Advanced-Google-Tasks-Scheduler.git
cd Advanced-Google-Tasks-Scheduler
clasp login
clasp create --title "Advanced Google Tasks Scheduler" --type standalone
clasp push
```
*(This pushes `appsscript.json` with the Google Tasks API enabled and `Europe/Paris` timezone configured out-of-the-box).*
</details>

---

## ⚙️ Initial Run & Automatic Setup

In the Google Apps Script editor:

1. Select **`setup`** from the function dropdown at the top and click **Run**.
2. **Grant Permissions**: A dialog will prompt you for authorization. The script requests access to:
   * **Google Drive & Google Sheets**: To automatically create or read your `Advanced Google Tasks Scheduler` spreadsheet.
   * **Google Tasks**: To check existing tasks and insert new occurrences.
   * **Google Calendar**: To inspect event dates when using `event_triggered` rules.

> ⚠️ **Google "Unverified App" Screen**:  
> Because you are running your own custom Apps Script code for the first time, Google displays a standard safety screen saying *"Google hasn't verified this app"*.  
> 1. Click **Advanced** (at the bottom-left of the warning popup).  
> 2. Click **Go to Advanced Google Tasks Scheduler (unsafe)**.  
> 3. Click **Allow**.  
> This is completely normal for personal Apps Script projects running in your own Google account.

3. **Check the Execution Log**:
   * If no spreadsheet named `Advanced Google Tasks Scheduler` exists on your Google Drive, `setup()` **automatically creates it for you**, sets up the `Tasks` tab with all 8 headers, inserts disabled starter examples, and logs the direct link to the new sheet!
   * The daily 6:00 AM trigger is also automatically installed.

> 💡 **Immediate Testing**: To generate your tasks right away without waiting until tomorrow morning, select **`checkAndCreateTasks`** and click **Run**. Check the **Execution log** to see task creation and skip decisions.

> 🕒 **Timezone Note**: The 6:00 AM trigger executes according to your Apps Script project's configured timezone (defaults to your Google account's timezone, or `Europe/Paris` if deployed via clasp using `appsscript.json`). To adjust this to your local timezone, open **Project Settings** (⚙️ in the left sidebar) and select your desired **Time zone**.

---

## 🛠️ Callable Functions Reference

| Function | Purpose |
| :--- | :--- |
| `setup()` | **One-click initial installation**. Automatically creates and formats the Google Sheet on Drive if missing, links its ID, and installs the daily 6:00 AM trigger. |
| `setupDailyTrigger()` | **Trigger-only setup**. Reinstalls or resets the daily 6:00 AM background trigger in Google Cloud without altering sheet properties. |
| `checkAndCreateTasks()` | **Main synchronization engine**. Runs automatically every morning at 6:00 AM, or manually on demand. |
| `setSheetId()` | **Fallback utility**. Allows manually pinning a specific Google Sheet ID (`SHEET_ID`) if auto-discovery by file name fails. |

---

## 📄 License

This project is licensed under the [MIT License](LICENSE) — feel free to use and modify it for your own needs.
