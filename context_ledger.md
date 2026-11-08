## 1. Core App Context

- **Core App Purpose:** A Windows desktop app for elementary music teachers to manage student rosters, classes, and seating charts while recording attendance, assessments, learning-sequence progress, recorder work, and music-aptitude results.
- **Tech Stack:** JavaScript (CommonJS); Electron 41 / Node.js main process; sandboxed Chromium renderer using HTML, CSS, and JavaScript; `contextBridge`/IPC preload API with context isolation and Node integration disabled; SQLite via `better-sqlite3`; `electron-updater` for packaged-app updates. React 19 is declared as a dependency.
- **Active IPC channels exposed in `preload.js` and handled/pushed by `app.js` (109 total):**
  - **Renderer → Main (`ipcRenderer.invoke` / `ipcMain.handle`, 103):**
    - App and updater: `app.getInfo`, `updater.check`, `updater.download`, `updater.install`
    - Students and duplicates: `db.getStudents`, `db.addStudent`, `db.updateStudent`, `db.deleteStudent`, `db.getDuplicateStudentGroups`, `db.getStudentMergePreview`, `db.mergeStudents`
    - Student notes: `db.addStudentNote`, `db.addFollowUpNote`, `db.getStudentNotes`, `db.updateStudentNote`, `db.deleteStudentNote`
    - Attendance and data resets: `db.getAttendanceRecords`, `db.upsertAttendanceRecord`, `db.deleteAttendanceRecord`, `db.renameAttendanceDate`, `db.resetStudentData`, `db.resetFactoryData`
    - LSA unit assets/placeholders: `db.getLsaUnitPlaceholders`, `db.upsertLsaUnitPlaceholder`, `db.getLsaUnitAssets`, `db.upsertLsaUnitAsset`, `assets.importLsaUnitImage`
    - CSV export and sync: `db.exportStudentsCsv`, `db.exportSelectedStudentsCsv`, `db.previewCsvSync`, `db.syncStudentsFromCsv`
    - Seating charts: `db.getSeatingCharts`, `db.getSeatingChart`, `db.createSeatingChart`, `db.clearStaleSeatingChartsForYear`, `db.updateSeatingChartName`, `db.saveSeatingChartLayout`, `db.deleteSeatingChart`, `db.reorderSeatingCharts`
    - Instruments and classes: `db.getInstruments`, `db.addInstrument`, `db.updateInstrument`, `db.deleteInstrument`; `db.getClasses`, `db.addClass`, `db.updateClass`, `db.deleteClass`
    - Schools: `db.getSchools`, `db.addSchool`, `db.renameSchool`, `db.updateSchoolStatus`, `db.deleteSchool`, `db.archiveTeacher`
    - LSA lesson library: `assets.importLsaLessons`, `assets.importLsaAudio`, `db.setLsaLessonAudio`, `db.getLsaLessons`, `db.deleteLsaLesson`, `db.getLsaGradeUnitMap`, `db.upsertLsaGradeUnitMap`, `db.clearLsaGradeUnitSlot`, `db.getLsaCustomUnits`, `db.addLsaCustomUnit`
    - Assessment library, dates, and ratings: `db.getAssessmentLibrary`, `db.upsertAssessmentLibraryItem`, `db.deleteAssessmentLibraryItem`, `db.getAssessmentDates`, `db.setAssessmentDate`, `db.getAssessmentDatesForClass`, `db.setAssessmentDateForClass`, `db.getAssessmentRatings`, `db.upsertAssessmentRating`, `db.getClassAssessmentRatings`, `db.getClassAssessmentDates`, `db.exportAssessmentRubrics`, `db.importAssessmentRubrics`
    - LSA scores, notes, and label history: `db.getLsaScores`, `db.upsertLsaScore`, `db.getPenNotesForStudentsYear`, `db.savePenNoteYear`, `db.getLsaUnitLabelsHistory`, `db.snapshotLsaUnitLabels`, `db.savePenNote`, `db.getPenNotesForStudents`
    - Recorder songs and completions: `db.getRecorderSongLibrary`, `db.upsertRecorderSongLibraryItem`, `db.deleteRecorderSongLibraryItem`, `db.getRecorderSongCompletions`, `db.upsertRecorderSongCompletion`
    - Settings, aptitude, and MATS: `db.getSetting`, `db.setSetting`, `db.getAptitudeSettings`, `db.saveAptitudeSettings`, `db.getImmaScores`, `db.getImmaScoresForClass`, `db.upsertImmaScore`, `db.importMatsScores`, `db.getMatsResultsForClass`, `db.getMatsUnmatchedResults`, `mats.hasServiceAccount`, `mats.setupServiceAccount`, `mats.fetchAndImport`, `mats.resetForRetake`
  - **Main → Renderer (`webContents.send` / `ipcRenderer.on`, 6):** `update-available`, `update-not-available`, `update-download-progress`, `update-downloaded`, `update-error`, `display-scale-changed`

## 2. Database Schema

- **Database initialization:** `db.js` initializes SQLite with `better-sqlite3`, enables WAL journaling, and runs migrations using SQLite `PRAGMA user_version`. Fresh databases create the complete current schema directly; existing databases run their missing migrations.
- **Highest migration:** Version 22 — `migration_22_schools` adds schools, assigns legacy students/classes to the default school, and school-scopes existing class-keyed data.
- **Current tables and columns** (fresh-install schema):
  - `schools`: `id`, `name`, `is_active`, `created_at`.
  - `students`: `id`, `first_name`, `last_name`, `email`, `grade`, `teacher`, `notes`, `lsa_easy`, `lsa_medium`, `lsa_difficult`, `lsa_units`, `recorder_color`, `good_news_shared`, `is_active`, `student_number`, `color_dot`, `imma_t`, `imma_r`, `graduated_year`, `school_id`.
  - `instruments`: `id`, `name`, `type`, `quantity`, `condition`, `notes`.
  - `classes`: `id`, `name`, `grade`, `teacher`, `schedule`, `notes`, `school_id`.
  - `seating_charts`: `id`, `name`, `class_key`, `arrangement`, `academic_year`, `sort_order`, `created_at`, `updated_at`.
  - `seating_chart_items`: `chart_id`, `student_id`, `placed`, `x`, `y`, `state`, `attendance`, `assessment_rating`, `color_dot`.
  - `attendance_records`: `student_id`, `attendance_date`, `status`, `updated_at`.
  - `lsa_unit_placeholders`: `class_key`, `unit_number`, `x`, `y`, `updated_at`.
  - `lsa_unit_assets`: `class_key`, `unit_number`, `image_url`, `helper_label`, `audio_url`, `updated_at`.
  - `lsa_lessons`: `id`, `file_name`, `image_url`, `audio_url`, `created_at`.
  - `lsa_unit_labels_history`: `class_key`, `academic_year`, `unit_number`, `file_name`, `updated_at`.
  - `lsa_grade_unit_map`: `grade_level`, `unit_number`, `lesson_id`, `updated_at`.
  - `lsa_custom_units`: `unit_number`.
  - `assessment_library`: `grade_level`, `assess_num`, `name`, `scale1`, `scale2`, `scale3`, `scale4`, `updated_at`.
  - `assessment_library_year`: `grade_level`, `academic_year`, `assess_num`, `name`, `scale1`, `scale2`, `scale3`, `scale4`, `updated_at`.
  - `assessment_dates`: `chart_id`, `assess_num`, `assessed_date`.
  - `assessment_dates_year`: `class_key`, `academic_year`, `assess_num`, `assessed_date`.
  - `settings`: `key`, `value`.
  - `aptitude_settings`: `grade_level`, `tonal_low_max`, `tonal_med_max`, `rhythm_low_max`, `rhythm_med_max`.
  - `imma_scores`: `student_id`, `academic_year`, `tonal`, `rhythm`, `tonal_complete`, `rhythm_complete`, `updated_at`.
  - `imma_results`: `id`, `firestore_doc_id`, `student_id`, `student_name`, `student_email`, `teacher_code`, `test_type`, `answers`, `score`, `is_complete`, `fetched_at`.
  - `lsa_pen_notes`: `student_id`, `unit_number`, `column_type`, `academic_year`, `note_data`, `updated_at`.
  - `assessment_ratings`: `student_id`, `academic_year`, `assess_num`, `rating`, `updated_at`.
  - `lsa_scores`: `student_id`, `academic_year`, `unit_number`, `easy`, `medium`, `difficult`, `updated_at`.
  - `student_notes`: `id`, `student_id`, `note_text`, `note_type`, `note_date`, `academic_year`, `parent_note_id`, `updated_at`.
  - `recorder_song_library_year`: `academic_year`, `slot_num`, `name`, `color_key`, `updated_at`.
  - `recorder_song_completions`: `student_id`, `academic_year`, `slot_num`, `completed`, `updated_at`.

- **Schema delta this session:** Version 22 adds `schools` and nullable `school_id` links. Legacy data belongs to Default School. Class-keyed records use `school:<id>::<teacher>||<grade>`; the legacy no-class LSA scope becomes `school:1::__ALL__`. The global unassigned pool uses null school IDs.
- **`settings` keys in use (non-exhaustive):** `current_academic_year`, `class_order`.

## 3. Session Logs (Latest First)

### 2026-11-07 — Release recovery
- The v1.7.0 release attempt returned HTTP 422 after publishing the installer; the public release was missing `latest.yml` and the blockmap. Its tag points to the feature commit whose committed version is still 1.6.6. The local `dist\latest.yml` from that attempt was stale and must not be uploaded.
- Prepare v1.7.1 from a committed version bump and pre-create its tag and draft release before running `npm run build:release`, so parallel artifact uploads find an existing release rather than racing to create one. Verify the installer, matching blockmap, and `latest.yml` on the draft before publishing it on GitHub.

### 2026-11-07 — School management modal refinements
- The modal lists schools before the Add School input, and school names are read-only until Edit is selected; Save persists the name and refreshes the sidebar picker.
- Selecting a read-only school name independently changes the teacher list inside the modal without switching the sidebar school. The selected school is highlighted, identified in the teacher heading, and used as the target when inactivating a teacher. Opening the modal starts with the sidebar school selected.
- Teacher inactivation uses a compact file-cabinet icon and text action. A divider separates school and teacher management.
- The top Student Search searches names globally and navigates to the matching active school and class; the lower search filters the unplaced roster within the current scope. An inactive global-search result can be selected without its card being visible while inactive students are hidden.
- Verification: mocked renderer interactions covered school selection, keyboard selection, targeted teacher inactivation, rename validation and sidebar refresh; school database tests cover rename persistence. The reported search focus issue was not reproduced and worked after the user restarted.

### 2026-11-07 — Multi-school management
- School picker in the right panel scopes class lists, class charts and gradebook; the global unassigned pool includes inactive students. Graduated students remain in their separate global bucket.
- The school management gear adds/renames schools and archives schools or individual teachers after confirmation; archived students retain their score history and can be matched on CSV reimport. Reactivating a school does not automatically restore its former roster.
- CSV import requires a target school, limits deactivation to it, and requests review for cross-school or ambiguous matches. MATS name/email matching refuses ambiguous candidates rather than choosing an arbitrary student.
- Prior-year chart cleanup is restricted to the imported school. Chart rendering and saves use the selected roster while retaining stored placements belonging to other rosters.
- Class order and multi-grade settings are per-school (the default school keeps legacy settings); school switches use the existing class-context reload path.
- Verification: `scripts\test-multi-school-routing.js` covers migration, class-key isolation, archived rosters, reimport, matching, and persistence. The Electron-renderer school, pool and class-reorder paths were also exercised with mock data.

### 2026-11-07 — Unfinished MATS score indicators
- MATS import saves each score and its completion status together for the current academic year; a red dot and tooltip identify unfinished scores in active and previous-year IMMA cells.
- Migration v21 preserves existing scores with unknown completion status. Manual edits clear status only for changed scores; duplicate-student merge carries score and status together.
- Resetting a test for retake does not change the stored score snapshot; a subsequent fetch replaces that score and status.
- Verification: `scripts\test-mats-completion.js` runs with Electron's Node runtime and covers migration, import, editing, years, duplicate merge, persistence, and rendered indicator markup.

### 2026-10-14 (late) — Class-list drag auto-scroll + v1.6.6 release attempt
- **Code:** `renderer.js` only (`attachClassReorderDrag`). While dragging a class pill, a `requestAnimationFrame` loop scrolls `#class-list` (max-height 320px, overflow-y auto) when cursor is within 40px of its top/bottom edge or beyond (speed ramps to 14px/frame); `updateDropTarget()` re-hit-tests on every scroll tick using `lastClientY`; rAF cancelled in `onUp`; `scrollTop` preserved across post-drop `renderClassLibrary()`. Purpose: touchpad users without wheel. Seating-chart reorder untouched.
- **Schema/IPC:** no change (migration v20, 102 IPC channels; `app.js`/`preload.js`/`db.js` untouched).
- **Git:** `a3290e7` class reorder, `56603cd` auto-scroll, `6d081e6` bump to 1.6.6; pushed to `origin/master` (in sync).
- **Release (`npm run build:release`, electron-builder 26.17, publish always):** x64+arm64 NSIS universal installer built OK (`dist\Elementary Music Teacher App Setup 1.6.6.exe`). Publish failed with `422 Published releases must have a valid tag`: two parallel publishers both tried to create release `v1.6.6`. Release exists on GitHub with only the `.exe` asset (`latest.yml`/`.blockmap` not confirmed); tag `v1.6.6` (also v1.6.4/v1.6.5) points to old commit `71c4ab9`, not the new code. Earlier build attempt failed on arm64 `EPERM unlink better_sqlite3.node` because dev `electron.exe` processes (from `npm start`) held the file lock; closing them fixed it.
- **Open:** user re-running `build:release` to complete publish; verify `latest.yml` present on release (needed by `electron-updater`); decide whether to retag `v1.6.6` to `6d081e6` (delete tag + release, rebuild). Close `npm start` instances before building.

### 2026-10-14 — Class list drag-reorder + native module rebuild
- **Feature:** Classes list (right panel) reorderable like Seating Charts. Files changed: `index.html`, `renderer.js` only. `app.js`/`preload.js`/`db.js` untouched; IPC unchanged (102 channels: 96 invoke + 6 push). Reuses `db.getSetting`/`db.setSetting`.
- **index.html:** added `#class-order-gear-btn` (same SVG as seating gear, class `multi-grade-gear-btn`) and `#class-order-done-btn` (class `seating-chart-order-done-btn`) in `#class-library` header before `#multi-grade-gear-btn`. CSS selectors extended so `.class-pill.reorder-mode` gets grab cursor and `.class-pill.chart-row-dragging` / `.chart-row-drag-over` share the chart-row drag styles.
- **renderer.js:** new state `classesReorderMode`, `savedClassOrder`; consts `classOrderGearBtn`/`classOrderDoneBtn`; `loadSavedClassOrder()` (called in `initializeWorkspace` after `loadAptitudeSettings`); `getTeacherClasses()` sort = saved order first, unsaved classes after by `gradeRank` then label; `attachClassReorderDrag(button, key, classes)` (mousedown/mousemove/mouseup ghost-clone drag, persists `class_order` via `setSetting`, then `renderClassLibrary()`); `renderClassLibrary()` toggles gear/done visibility, disables click-to-select (incl. "All Classes") in reorder mode; `toggleClassesList()` exits reorder mode on collapse. Gear click expands list + enters mode; Done exits.
- **Constraints:** "All Classes" pinned top, `GRADUATED_CLASS_KEY` pinned bottom (not draggable).
- **Env fix:** `npm start` failed with `better_sqlite3.node is not a valid Win32 application` (ABI/arch mismatch, unrelated to code). Fixed with `npx electron-rebuild -f -w better-sqlite3`; app then booted (601 students). Re-run after any `npm install`.
- **Verification:** `node --check` + `eslint --fix renderer.js` clean; app launch confirmed; drag-reorder manually tested and confirmed working by user.
- **Open:** no commit made (changes uncommitted: `index.html`, `renderer.js`, `context_ledger.md`).
