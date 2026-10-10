
# Feature Specification: Dynamic Aptitude Score Categorization & UI Color-Coding

## Overview
This specification details a new feature for the Electron desktop app to categorize and visually color-code student Tonal (T) and Rhythm (R) aptitude scores (0–40 points). Categorization is based on user-defined, non-overlapping score break points per grade level (Grades 1–5).

---

## 1. System Context & Requirements
- **Tech Stack**: Windows Desktop App, Electron (`v41.0.4`), Node.js, Better-SQLite3 (`v12.8.0`), Vanilla JS / CSS.
- **Data Constraints**: Scores are integers from 0 to 40. Kindergarten is excluded. 
- **Business Logic**: Score categories must be calculated **dynamically on the fly** by cross-referencing a student's score and grade level against a global settings table. Do not hardcode or bake category strings directly into student records.

### ⚠️ Coding Style & Architecture Constraints:
1. **Architectural Consistency**: You must inspect the existing codebase first. Ensure all new IPC channel names mirror our current naming conventions exactly. All new styling must strictly reuse our established CSS class structure and naming patterns.
2. **Mandatory Documentation**: Write clean, readable code. You must continue our practice of adding meaningful, concise comments to all new blocks, functions, and layout handlers explaining **why** the block is there, its purpose, and how it interacts with the rest of the app for easy reading later.

---

## 2. Database Updates (Better-SQLite3)
Create a new configuration table to store break points. Ensure this migration runs on app startup if the table does not exist.

### Table Schema: `aptitude_settings`
```sql
CREATE TABLE IF NOT EXISTS aptitude_settings (
    grade_level INTEGER PRIMARY KEY, -- 1, 2, 3, 4, 5
    tonal_low_max INTEGER NOT NULL,
    tonal_med_max INTEGER NOT NULL,
    rhythm_low_max INTEGER NOT NULL,
    rhythm_med_max INTEGER NOT NULL
);
```

### Logical Breakpoint Mapping
For any given score, the categorization logic must evaluate sequentially:
- **Low**: `score <= low_max`
- **Medium**: `score > low_max` AND `score <= med_max`
- **High**: `score > med_max` (Up to 40)

---

## 3. UI Colors (CSS Variables)
To allow for easy shading adjustments later, add these semantic CSS variables to your global stylesheet:

```css
:root {
  --aptitude-high: #2ecc71;   /* Green */
  --aptitude-medium: #3498db; /* Blue */
  --aptitude-low: #e67e22;    /* Orange */
}
```

---

## 4. Settings Configuration Modal
Add a new management section inside the existing settings gear modal.

### Requirements:
- **Scope**: Matrix of inputs for Grades 1–5.
- **Inputs per Grade**: 
  - Tonal Low Max, Tonal Medium Max
  - Rhythm Low Max, Rhythm Medium Max
- **Validation**: 
  - Values must be integers between 0 and 40.
  - `low_max` must be strictly less than `med_max`.
- **Persistence**: Save values to `aptitude_settings` via IPC to the main process when the user clicks "Save".

---

## 5. UI Implementation Workflows

### Target 1: IMMA Scores Grid (Gradebook Focus)
- **Location**: Gradebook grid view -> IMMA Tab.
- **Behavior**: When a class is loaded, evaluate each student's Tonal and Rhythm scores against their grade level's active break points.
- **Styling**: Dynamically apply the background color style (`--aptitude-high`, `--aptitude-medium`, or `--aptitude-low`) directly to the respective score table cells.

### Target 2: LSA Record Tab (Gradebook Focus)
- **Location**: Gradebook grid view -> LSA Record Tab.
- **UI Modification**: Insert two narrow status columns immediately to the right of the student first/last name columns. Label them **T** (Tonal) and **R** (Rhythm).
- **Styling**: The cells under **T** and **R** should display no text, but their background color must match the student's dynamic aptitude categorization.

### Target 3: Learning Sequence Mode (Seating Chart Focus)
- **Location**: Seating Chart canvas area.
- **Trigger Condition**: This layout styling must **only** trigger when the seating chart view mode is explicitly set to `Learning Sequence Mode`.
- **New Toggle Control**: 
  - Inject a floating toggle button into the **upper-left corner** of the seating chart field.
  - Options/States: **"View: Tonal Aptitude"** / **"View: Rhythm Aptitude"**.
- **Behavior**: 
  - When the toggle is set to Tonal, update all student card backgrounds on the canvas to match their Tonal category color.
  - When flipped to Rhythm, immediately switch the student card backgrounds to match their Rhythm category color.
  - If the user leaves `Learning Sequence Mode`, strip all aptitude background colors and restore standard student card styling.

---

## 6. Implementation Checklist for Agent
1. [ ] Scan the app to identify existing IPC channel styles and CSS class conventions to use as a baseline.
2. [ ] Write database migration script for `aptitude_settings`.
3. [ ] Build the Main/Renderer IPC channels to fetch and save configuration values, matching existing project naming structures.
4. [ ] Build the Settings Modal UI view for Grades 1–5 with edge-case validation.
5. [ ] Implement a fully commented JS helper function `getAptitudeCategory(grade, score, type)` to run the lookup logic cleanly.
6. [ ] Update the IMMA tab renderer to style cell backgrounds dynamically.
7. [ ] Modify the LSA tab DOM structure to inject the **T** and **R** color blocks.
8. [ ] Build the upper-left toggle component on the seating chart and hook it into the `Learning Sequence Mode` card rendering loop.
9. [ ] Double-check that all new code blocks feature clear explanatory developer comments.
Updated todo list

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/Aptitude%20Score%20Categorization%20Color-Coding.md#1-1), lines 1 to 100

Explore IMMA, LSA, seating chart, IPC, and settings modal patterns

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#1-1), lines 1 to 100

Searched for regex `ipcMain\.handle|ipcMain\.on` (`**/app.js`), 84 results

Searched for regex `settings.*modal|gear.*icon|id.*settings` (`**/index.html`), 3 results

Searched for regex `IMMA|imma.*grid|renderImma` (`**/index.html`), 29 results

Searched for regex `LSA.*Record|lsa.*record|renderLsa` (`**/index.html`), 3 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#193-193), lines 193 to 300

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#4830-4830), lines 4830 to 4900

Searched for regex `imma.*tab|imma-record|data-tab.*imma` (`**/index.html`), 11 results

Searched for regex `renderImma|renderLsa|currentMode|learningSequence.*mode` (`**/renderer.js`), 12 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#290-290), lines 290 to 400

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#4950-4950), lines 4950 to 4980

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#188-188), lines 188 to 188

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#3159-3159), lines 3159 to 3200

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#3159-3159), lines 3159 to 3280

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#2664-2664), lines 2664 to 2750

Searched for regex `imma_scores|getImmaScores|getImma` (`**/db.js`), 10 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#211-211), lines 211 to 270

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#370-370), lines 370 to 420

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#420-420), lines 420 to 450

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#450-450), lines 450 to 500

Searched for regex `function getImmaScores|function getImmaScoresForClass` (`**/db.js`), 2 results

Searched for regex `currentMode|let.*mode|const.*mode|activeMode|modeToggles` (`**/renderer.js`), 49 results

Searched for regex `attendance.*color|att-status|border-color|background.*att|outline.*color` (`**/index.html`), 25 results

Searched for regex `lsa-record|lsa-grid-canvas|gradebook-lsa` (`**/index.html`), 4 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/db.js#715-715), lines 715 to 760

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#2110-2110), lines 2110 to 2210

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#4978-4978), lines 4978 to 5010

Searched for regex `att-present|att-absent|att-late|att-excused|attendance.*color|setCardAttendanceColor` (`**/renderer.js`), 1 result

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#470-470), lines 470 to 500

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#500-500), lines 500 to 550

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Searched for regex `assessment.*rating|rating.*1|rating.*2|rating.*3|rating.*4` (`**/index.html`), 5 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#2560-2560), lines 2560 to 2590

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/app.js#550-550), lines 550 to 600

Searched for regex `ipcMain\.handle.*assessment|ipcMain\.handle.*imma|ipcMain\.handle.*attendance` (`**/app.js`), 19 results

Searched for regex `attended|not-attended|absent|present|late|excused|attendanceStatus` (`**/renderer.js`), 53 results

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#1200-1200), lines 1200 to 2228

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#2228-2228), lines 2228 to 2350

Searched for regex `outlineColor|outline.*style|card\.style|setOutline` (`**/renderer.js`), 24 results

Searched for regex `createStudentCard|buildCard|card\.innerHTML|card-header` (`**/renderer.js`), 13 results

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#3500-3500), lines 3500 to 4278

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#290-290), lines 290 to 2220

Read [](file:///c%3A/Users/jpcon/AppData/Roaming/Code/User/workspaceStorage/e41095a123728282b611ad16a04f8b07/GitHub.copilot-chat/chat-session-resources/5542c00e-a0a3-475e-b9e5-47028f681daa/toolu_bdrk_013PPSeg4XVPJ41D9eFg2Me4__vscode-1782741294548/content.txt#1-1), lines 1 to 300

Good. I have enough codebase context to ask smart questions before finalizing the plan. 

Analyzing your answers...

Good, all answers collected. Now building the full plan.  

Searched for text `immaScores|immaScoreMap|scoreMap|getImmaScores` (`**/renderer.js`), 5 results

Searched for text `lsaMode|chart-field|aptitude|toggleLsa|setMode` (`**/renderer.js`), 36 results

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/renderer.js#4974-4974), lines 4974 to 5020

Searched for regex `id="chart-field|id="seating-chart|chart-panel` (`**/index.html`), 3 results

No matches found. Your search pattern might be excluded completely by either the search.exclude settings or .*ignore files.
If you believe that it should have results, you can check into the .*ignore files and the exclude setting (here are some excluded patterns for reference:[**/node_modules,**/bower_components,**/*.code-search]).
Then if you want to include those files you can call the tool again by setting "includeIgnoredFiles" to true.

Searched for regex `getElementById\(['"](chart|canvas|seating-area|lsa-prompt)` (`**/renderer.js`), 6 results

Searched for regex `id="chart-canvas|chart-wrapper|chart-outer|chart-scroll` (`**/index.html`), 1 result

Read [](file:///c%3A/Users/jpcon/Documents/Coding%20Projects/Elementary%20Music%20Management%20app/index.html#4910-4910), lines 4910 to 4940

Now I have everything I need. Building the plan: 

Created memory file [](file:///c%3A/Users/jpcon/AppData/Roaming/Code/User/workspaceStorage/e41095a123728282b611ad16a04f8b07/GitHub.copilot-chat/memory-tool/memories/NTU0MmMwMGUtYTBhMy00NzVlLWI5ZTUtNDcwMjhmNjgxZGFh/plan.md)

Here's the full plan:

---

## Plan: Aptitude Score Categorization & Color-Coding

**TL;DR:** Add a dynamic aptitude color-coding system driven by per-grade breakpoints the teacher configures. Colors surface in three places: IMMA tab cell backgrounds, two new T/R columns in the LSA Record tab, and a top-stripe on seating chart cards in Learning Sequence Mode.

**Decisions locked in:**
- Settings → dedicated modal opened from the settings dropdown
- Breakpoints start empty; no colors appear until configured
- No score OR no settings → blank/unstyled
- Seating chart → colored top-border stripe on cards
- Tonal/Rhythm toggle persists for the session
- Kindergarten T/R cells → blank

---

### Phase 1: Database & IPC Foundation
*(db.js, app.js, preload.js — all parallel)*

1. **db.js** — Increment `SCHEMA_VERSION` to `12`. Add `migration_12_aptitudeSettings()` creating the `aptitude_settings` table (all max columns nullable so unconfigured = no color). Call it in `runMigrations()` and add the table to `createBaseTables()`.
2. **db.js** — Add `getAptitudeSettings()` (returns all rows) and `saveAptitudeSettings(rows)` (upserts via `INSERT OR REPLACE`).
3. **app.js** — Add two handlers: `'db.getAptitudeSettings'` and `'db.saveAptitudeSettings'`, following the `db.` camelCase prefix convention.
4. **preload.js** — Expose both on `window.api` via `contextBridge`, matching existing patterns.

### Phase 2: CSS
*(index.html `<style>` block — parallel with Phase 1)*

5. Add `:root` variables: `--aptitude-high: #2ecc71`, `--aptitude-medium: #3498db`, `--aptitude-low: #e67e22`.
6. Add `.aptitude-band-high/medium/low` — `border-top: 5px solid var(--aptitude-*)` applied to `.chart-student` elements.
7. Add `.aptitude-cell-high/medium/low` — `background: var(--aptitude-*)` for table cells in IMMA and LSA grids.
8. Add styles for the aptitude settings modal (pale tan, white inputs, consistent with other modals) and the floating toggle (`absolute`, top-left of `.chart-shell`, hidden by default).

### Phase 3: Helper Functions & Caches
*(renderer.js — depends on Phase 1)*

9. Add module-level `aptitudeSettings = {}` (keyed by grade_level). Add `loadAptitudeSettings()` — fetches via IPC, called on app startup.
10. Add module-level `immaScoreCache = {}` (keyed by student_id → `{tonal, rhythm}`). Add `refreshImmaScoreCache()` — fetches scores for the active class, called on class selection. Update `renderImmaGrid()` to also populate this cache, and refresh it after a score is edited.
11. Add `getAptitudeCategory(grade, score, type)` — returns `'high' | 'medium' | 'low' | null`. Returns `null` for Kindergarten, null score, or unconfigured settings. Reads from `aptitudeSettings[grade]`.
12. Add `getAptitudeCSSClass(grade, score, type, prefix)` — thin wrapper that returns `aptitude-band-*` or `aptitude-cell-*` class string, or `''`.

### Phase 4: Aptitude Settings Modal
*(depends on Phases 1–3)*

13. **index.html** — Add `<button id="open-aptitude-settings-btn">` to `#settings-dropdown` with a divider.
14. **index.html** — Add `#aptitude-settings-modal`: title, non-bold guide text, 5-row × 4-column input table (Tonal Low Max / Tonal Med Max / Rhythm Low Max / Rhythm Med Max per grade), Save + Cancel buttons. All inputs: `type="number" min="0" max="40"`, white background.
15. **renderer.js** — `openAptitudeSettingsModal()` populates inputs from cache. On Save: validate (0–40 integers, low_max < med_max per type per grade — show inline error if invalid), call IPC, call `loadAptitudeSettings()`, re-render all active views.

### Phase 5: IMMA Tab Cell Colors
*(depends on Phases 2–3)*

16. **renderer.js `renderImmaGrid()`** — On each student row, add `getAptitudeCSSClass(student.grade, score.tonal, 'tonal', 'cell')` to the Tonal `<td>` class. Same for Rhythm `<td>`. MATS columns are left uncolored.

### Phase 6: LSA Record T/R Columns
*(depends on Phases 2–3)*

17. **renderer.js `renderLsaGrid()`** — Insert two `<th>` cells (`T` and `R`) after the Last Name header. Insert two narrow `<td>` cells per student row after Last Name — no text content, just `getAptitudeCSSClass(...)` applied as class. Add two narrow `<col>` elements (~28px) in the `<colgroup>`.

### Phase 7: Seating Chart Aptitude View
*(depends on Phases 2–3)*

18. **renderer.js** — Add `let lsaAptitudeView = 'tonal'` (session-persistent). 
19. **index.html** — Add `<div id="aptitude-view-toggle" class="aptitude-view-toggle hidden">` with a single cycling `<button id="aptitude-toggle-btn">` inside `.chart-shell`.
20. **renderer.js `toggleLsaMode()`** — On LSA entry: remove `hidden` from toggle div. On LSA exit: add `hidden` back. `renderWorkspace()` syncs toggle visibility to `lsaMode`.
21. **renderer.js** — Wire toggle button click: flip `lsaAptitudeView`, update button label text, call `renderWorkspace()`.
22. **renderer.js** — In student card HTML generation (`.chart-student`): when `lsaMode`, add `getAptitudeCSSClass(student.grade, immaScoreCache[student.id]?.[lsaAptitudeView], lsaAptitudeView, 'band')` to the card's classes. When not in `lsaMode`, no band class is added — natural cleanup.

---

**Relevant files:**
- db.js — migration_12, new db functions, SCHEMA_VERSION, createBaseTables
- app.js — 2 new IPC handlers
- preload.js — 2 new API exposures
- index.html — CSS, settings button, modal HTML, toggle HTML
- renderer.js — caches, helpers, modal logic, renderImmaGrid, renderLsaGrid, toggleLsaMode, renderWorkspace card section

---

**Verification:**
1. Fresh install → table created, no colors visible
2. Existing user → migration runs silently, existing data unaffected
3. Invalid settings (low_max ≥ med_max) → save blocked with inline error
4. Valid save → IMMA and LSA grids re-render with correct colors
5. LSA tab: Kinder = blank; grade 1–5 + score = colored; no score = blank
6. Seating chart LSA mode: toggle appears top-left, cards show colored top stripe; leaving LSA mode removes all stripes; toggle state remembered on re-entry
7. Class switch → score cache refreshes, colors update

---

