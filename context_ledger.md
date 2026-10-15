## 1. Core App Context

- **Core App Purpose:** A Windows desktop app for elementary music teachers to manage student rosters, classes, and seating charts while recording attendance, assessments, learning-sequence progress, recorder work, and music-aptitude results.
- **Tech Stack:** JavaScript (CommonJS); Electron 41 / Node.js main process; sandboxed Chromium renderer using HTML, CSS, and JavaScript; `contextBridge`/IPC preload API with context isolation and Node integration disabled; SQLite via `better-sqlite3`; `electron-updater` for packaged-app updates. React 19 is declared as a dependency.
- **Active IPC channels exposed in `preload.js` and handled/pushed by `app.js` (102 total):**
  - **Renderer → Main (`ipcRenderer.invoke` / `ipcMain.handle`, 96):**
    - App and updater: `app.getInfo`, `updater.check`, `updater.download`, `updater.install`
    - Students and duplicates: `db.getStudents`, `db.addStudent`, `db.updateStudent`, `db.deleteStudent`, `db.getDuplicateStudentGroups`, `db.getStudentMergePreview`, `db.mergeStudents`
    - Student notes: `db.addStudentNote`, `db.addFollowUpNote`, `db.getStudentNotes`, `db.updateStudentNote`, `db.deleteStudentNote`
    - Attendance and data resets: `db.getAttendanceRecords`, `db.upsertAttendanceRecord`, `db.deleteAttendanceRecord`, `db.renameAttendanceDate`, `db.resetStudentData`, `db.resetFactoryData`
    - LSA unit assets/placeholders: `db.getLsaUnitPlaceholders`, `db.upsertLsaUnitPlaceholder`, `db.getLsaUnitAssets`, `db.upsertLsaUnitAsset`, `assets.importLsaUnitImage`
    - CSV export and sync: `db.exportStudentsCsv`, `db.exportSelectedStudentsCsv`, `db.previewCsvSync`, `db.syncStudentsFromCsv`
    - Seating charts: `db.getSeatingCharts`, `db.getSeatingChart`, `db.createSeatingChart`, `db.clearStaleSeatingChartsForYear`, `db.updateSeatingChartName`, `db.saveSeatingChartLayout`, `db.deleteSeatingChart`, `db.reorderSeatingCharts`
    - Instruments and classes: `db.getInstruments`, `db.addInstrument`, `db.updateInstrument`, `db.deleteInstrument`; `db.getClasses`, `db.addClass`, `db.updateClass`, `db.deleteClass`
    - LSA lesson library: `assets.importLsaLessons`, `assets.importLsaAudio`, `db.setLsaLessonAudio`, `db.getLsaLessons`, `db.deleteLsaLesson`, `db.getLsaGradeUnitMap`, `db.upsertLsaGradeUnitMap`, `db.clearLsaGradeUnitSlot`, `db.getLsaCustomUnits`, `db.addLsaCustomUnit`
    - Assessment library, dates, and ratings: `db.getAssessmentLibrary`, `db.upsertAssessmentLibraryItem`, `db.deleteAssessmentLibraryItem`, `db.getAssessmentDates`, `db.setAssessmentDate`, `db.getAssessmentDatesForClass`, `db.setAssessmentDateForClass`, `db.getAssessmentRatings`, `db.upsertAssessmentRating`, `db.getClassAssessmentRatings`, `db.getClassAssessmentDates`, `db.exportAssessmentRubrics`, `db.importAssessmentRubrics`
    - LSA scores, notes, and label history: `db.getLsaScores`, `db.upsertLsaScore`, `db.getPenNotesForStudentsYear`, `db.savePenNoteYear`, `db.getLsaUnitLabelsHistory`, `db.snapshotLsaUnitLabels`, `db.savePenNote`, `db.getPenNotesForStudents`
    - Recorder songs and completions: `db.getRecorderSongLibrary`, `db.upsertRecorderSongLibraryItem`, `db.deleteRecorderSongLibraryItem`, `db.getRecorderSongCompletions`, `db.upsertRecorderSongCompletion`
    - Settings, aptitude, and MATS: `db.getSetting`, `db.setSetting`, `db.getAptitudeSettings`, `db.saveAptitudeSettings`, `db.getImmaScores`, `db.getImmaScoresForClass`, `db.upsertImmaScore`, `db.getMatsResultsForClass`, `db.getMatsUnmatchedResults`, `mats.hasServiceAccount`, `mats.setupServiceAccount`, `mats.fetchAndImport`, `mats.resetForRetake`
  - **Main → Renderer (`webContents.send` / `ipcRenderer.on`, 6):** `update-available`, `update-not-available`, `update-download-progress`, `update-downloaded`, `update-error`, `display-scale-changed`

## 2. Database Schema

- **Database initialization:** `db.js` initializes SQLite with `better-sqlite3`, enables WAL journaling, and runs migrations using SQLite `PRAGMA user_version`. Fresh databases create the complete current schema directly; existing databases run their missing migrations.
- **Highest migration:** Version 20 — `migration_20_repairFreshInstallSortOrder` (repairs the `seating_charts.sort_order` column on affected fresh installs).
- **Current tables and columns** (fresh-install schema):
  - `students`: `id`, `first_name`, `last_name`, `email`, `grade`, `teacher`, `notes`, `lsa_easy`, `lsa_medium`, `lsa_difficult`, `lsa_units`, `recorder_color`, `good_news_shared`, `is_active`, `student_number`, `color_dot`, `imma_t`, `imma_r`, `graduated_year`.
  - `instruments`: `id`, `name`, `type`, `quantity`, `condition`, `notes`.
  - `classes`: `id`, `name`, `grade`, `teacher`, `schedule`, `notes`.
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
  - `imma_scores`: `student_id`, `academic_year`, `tonal`, `rhythm`, `updated_at`.
  - `imma_results`: `id`, `firestore_doc_id`, `student_id`, `student_name`, `student_email`, `teacher_code`, `test_type`, `answers`, `score`, `is_complete`, `fetched_at`.
  - `lsa_pen_notes`: `student_id`, `unit_number`, `column_type`, `academic_year`, `note_data`, `updated_at`.
  - `assessment_ratings`: `student_id`, `academic_year`, `assess_num`, `rating`, `updated_at`.
  - `lsa_scores`: `student_id`, `academic_year`, `unit_number`, `easy`, `medium`, `difficult`, `updated_at`.
  - `student_notes`: `id`, `student_id`, `note_text`, `note_type`, `note_date`, `academic_year`, `parent_note_id`, `updated_at`.
  - `recorder_song_library_year`: `academic_year`, `slot_num`, `name`, `color_key`, `updated_at`.
  - `recorder_song_completions`: `student_id`, `academic_year`, `slot_num`, `completed`, `updated_at`.

- **Schema delta this session:** none. No migration added (still v20; `SCHEMA_VERSION` → `user_version` 20, `db.js` L175). New app state persists in existing `settings` table as key `class_order` (JSON array of class keys, e.g. `"Smith||3"`).
- **`settings` keys in use (non-exhaustive):** `current_academic_year`, `class_order`.

## 3. Session Logs (Latest First)

### 2026-10-14 — Class list drag-reorder + native module rebuild
- **Feature:** Classes list (right panel) reorderable like Seating Charts. Files changed: `index.html`, `renderer.js` only. `app.js`/`preload.js`/`db.js` untouched; IPC unchanged (102 channels: 96 invoke + 6 push). Reuses `db.getSetting`/`db.setSetting`.
- **index.html:** added `#class-order-gear-btn` (same SVG as seating gear, class `multi-grade-gear-btn`) and `#class-order-done-btn` (class `seating-chart-order-done-btn`) in `#class-library` header before `#multi-grade-gear-btn`. CSS selectors extended so `.class-pill.reorder-mode` gets grab cursor and `.class-pill.chart-row-dragging` / `.chart-row-drag-over` share the chart-row drag styles.
- **renderer.js:** new state `classesReorderMode`, `savedClassOrder`; consts `classOrderGearBtn`/`classOrderDoneBtn`; `loadSavedClassOrder()` (called in `initializeWorkspace` after `loadAptitudeSettings`); `getTeacherClasses()` sort = saved order first, unsaved classes after by `gradeRank` then label; `attachClassReorderDrag(button, key, classes)` (mousedown/mousemove/mouseup ghost-clone drag, persists `class_order` via `setSetting`, then `renderClassLibrary()`); `renderClassLibrary()` toggles gear/done visibility, disables click-to-select (incl. "All Classes") in reorder mode; `toggleClassesList()` exits reorder mode on collapse. Gear click expands list + enters mode; Done exits.
- **Constraints:** "All Classes" pinned top, `GRADUATED_CLASS_KEY` pinned bottom (not draggable).
- **Env fix:** `npm start` failed with `better_sqlite3.node is not a valid Win32 application` (ABI/arch mismatch, unrelated to code). Fixed with `npx electron-rebuild -f -w better-sqlite3`; app then booted (601 students). Re-run after any `npm install`.
- **Verification:** `node --check` + `eslint --fix renderer.js` clean; app launch confirmed; drag-reorder manually tested and confirmed working by user.
- **Open:** no commit made (changes uncommitted: `index.html`, `renderer.js`, `context_ledger.md`).
