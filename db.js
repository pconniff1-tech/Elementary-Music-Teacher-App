/**
 * @file db.js
 * @process Main — Node.js / Electron Main Process only
 *
 * Pure data-access layer wrapping better-sqlite3. This module is require()-d
 * exclusively by app.js (Main process) and is never loaded in the renderer.
 * All functions are synchronous (better-sqlite3 is synchronous by design);
 * async wrappers are added by the ipcMain.handle() calls in app.js.
 */

// --- Student Notes (Note Mode) ---
function addStudentNote(studentId, noteText, noteType, noteDate, academicYear) {
  const result = db
    .prepare(
      `
    INSERT INTO student_notes (student_id, note_text, note_type, note_date, academic_year, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `
    )
    .run(Number(studentId), noteText, noteType || null, noteDate || null, academicYear || null);
  return {
    id: result.lastInsertRowid,
    student_id: studentId,
    note_text: noteText,
    note_type: noteType,
    note_date: noteDate,
    academic_year: academicYear,
  };
}

function addFollowUpNote(parentNoteId, studentId, noteText, noteType, noteDate, academicYear) {
  // Follow-up notes are always linked to their parent; they sort under it.
  const result = db
    .prepare(
      `
    INSERT INTO student_notes (student_id, note_text, note_type, note_date, academic_year, parent_note_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `
    )
    .run(
      Number(studentId),
      noteText,
      noteType || null,
      noteDate || null,
      academicYear || null,
      Number(parentNoteId)
    );
  return {
    id: result.lastInsertRowid,
    student_id: studentId,
    note_text: noteText,
    note_type: noteType,
    note_date: noteDate,
    academic_year: academicYear,
    parent_note_id: parentNoteId,
  };
}

function getStudentNotes(studentId, academicYear) {
  // Fetch all notes sorted so parent notes come first by date (desc), then
  // follow-ups immediately after their parent ordered by their own date asc.
  // We do this in JS since SQLite lacks recursive CTE in older versions.
  const all = db
    .prepare(
      `
    SELECT * FROM student_notes
    WHERE student_id = ? AND academic_year = ?
    ORDER BY note_date DESC, id DESC
  `
    )
    .all(Number(studentId), academicYear);

  // Separate roots (no parent) from follow-ups
  const roots = all.filter((n) => !n.parent_note_id);
  const followUpsMap = {};
  all
    .filter((n) => n.parent_note_id)
    .forEach((n) => {
      if (!followUpsMap[n.parent_note_id]) followUpsMap[n.parent_note_id] = [];
      followUpsMap[n.parent_note_id].push(n);
    });
  // Sort follow-ups oldest-first so the thread reads chronologically
  Object.values(followUpsMap).forEach((arr) =>
    arr.sort((a, b) => {
      if (a.note_date < b.note_date) return -1;
      if (a.note_date > b.note_date) return 1;
      return a.id - b.id;
    })
  );

  // Interleave: each root followed by its follow-ups
  const ordered = [];
  roots.forEach((r) => {
    ordered.push(r);
    if (followUpsMap[r.id]) ordered.push(...followUpsMap[r.id]);
  });
  return ordered;
}

function updateStudentNote(noteId, noteText, noteType, noteDate) {
  db.prepare(
    `
    UPDATE student_notes
    SET note_text = ?, note_type = ?, note_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  ).run(noteText, noteType || null, noteDate || null, Number(noteId));
  return db.prepare('SELECT * FROM student_notes WHERE id = ?').get(Number(noteId));
}

function deleteStudentNote(noteId) {
  // Also delete any follow-ups attached to this parent
  db.prepare(`DELETE FROM student_notes WHERE parent_note_id = ?`).run(Number(noteId));
  const res = db.prepare(`DELETE FROM student_notes WHERE id = ?`).run(Number(noteId));
  return res.changes > 0;
}
const Database = require('better-sqlite3');
let db;

// Increment this number every time you make a schema change and add a
// corresponding migration_N function below.  New installs jump straight
// to this version; existing databases run only the migrations they are
// missing.
const SCHEMA_VERSION = 20;

function init(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  runMigrations();
}

// ── Migration Engine ──────────────────────────────────────────────────────────
// PRAGMA user_version stores how far this database has been migrated.
// Fresh databases have user_version = 0 and no tables yet.
// Existing pre-versioning databases also have user_version = 0 but already
// have tables — we detect this by checking whether the students table exists.

function runMigrations() {
  const version = db.pragma('user_version', { simple: true });

  if (version === 0) {
    const tableExists = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'")
      .get();

    if (!tableExists) {
      // Brand-new database: create the full latest schema in one shot.
      createBaseTables();
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
      return;
    }
    // Existing database that pre-dates versioning: fall through and run
    // every migration below (each one is idempotent / guarded).
  }

  if (version < 1) migration_1_studentColumns();
  if (version < 2) migration_2_seatingChartColumns();
  if (version < 3) migration_3_lsaAssetColumns();
  if (version < 4) migration_4_lsaLessonAudio();
  if (version < 5) migration_5_penNotesTable();
  if (version < 6) migration_6_immaResultsTable();
  if (version < 7) migration_7_immaResultsTestType();
  if (version < 8) migration_8_assessmentDatesTable();
  if (version < 9) migration_9_assessmentRatingToJSON();
  if (version < 10) migration_10_yearScopedData();
  if (version < 11) migration_11_lsaLabelHistory();
  if (version < 12) migration_12_aptitudeSettings();
  if (version < 13) migration_13_chartSortOrder();
  if (version < 14) migration_14_seatingChartAcademicYear();
  if (version < 15) migration_15_studentGraduation();
  if (version < 16) migration_16_yearScopedAssessmentLibrary();
  if (version < 17) migration_17_yearScopedPenNotes();
  if (version < 18) migration_18_pruneOrphanedSeatingPlacements();
  if (version < 19) migration_19_recorderSongTracker();
  if (version < 20) migration_20_repairFreshInstallSortOrder();

  db.pragma(`user_version = ${SCHEMA_VERSION}`);
}

// ── Base schema (fresh installs only) ────────────────────────────────────────
// This must always reflect the COMPLETE latest schema so a new install never
// needs to run any of the migration functions above.

function createBaseTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      grade TEXT,
      teacher TEXT,
      notes TEXT,
      lsa_easy TEXT,
      lsa_medium TEXT,
      lsa_difficult TEXT,
      lsa_units TEXT,
      recorder_color TEXT,
      good_news_shared INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      student_number TEXT,
      color_dot TEXT,
      imma_t REAL,
      imma_r REAL,
      graduated_year TEXT
    );

    CREATE TABLE IF NOT EXISTS instruments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      quantity INTEGER DEFAULT 1,
      condition TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      grade TEXT,
      teacher TEXT,
      schedule TEXT,
      notes TEXT
    );

    CREATE TABLE IF NOT EXISTS seating_charts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      class_key TEXT NOT NULL DEFAULT '',
      arrangement TEXT NOT NULL DEFAULT '',
      academic_year TEXT,
      sort_order INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS seating_chart_items (
      chart_id INTEGER NOT NULL,
      student_id INTEGER NOT NULL,
      placed INTEGER NOT NULL DEFAULT 0,
      x REAL,
      y REAL,
      state TEXT,
      attendance TEXT,
      assessment_rating TEXT,
      color_dot TEXT,
      PRIMARY KEY (chart_id, student_id)
    );

    CREATE TABLE IF NOT EXISTS attendance_records (
      student_id INTEGER NOT NULL,
      attendance_date TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, attendance_date)
    );

    CREATE TABLE IF NOT EXISTS lsa_unit_placeholders (
      class_key TEXT NOT NULL DEFAULT '',
      unit_number INTEGER NOT NULL,
      x REAL NOT NULL,
      y REAL NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (class_key, unit_number)
    );

    CREATE TABLE IF NOT EXISTS lsa_unit_assets (
      class_key TEXT NOT NULL DEFAULT '',
      unit_number INTEGER NOT NULL,
      image_url TEXT,
      helper_label TEXT,
      audio_url TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (class_key, unit_number)
    );

    CREATE TABLE IF NOT EXISTS lsa_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      audio_url TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lsa_unit_labels_history (
      class_key TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (class_key, academic_year, unit_number)
    );

    CREATE TABLE IF NOT EXISTS lsa_grade_unit_map (
      grade_level TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      lesson_id INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (grade_level, unit_number)
    );

    CREATE TABLE IF NOT EXISTS lsa_custom_units (
      unit_number INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS assessment_library (
      grade_level TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      name TEXT,
      scale1 TEXT,
      scale2 TEXT,
      scale3 TEXT,
      scale4 TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (grade_level, assess_num)
    );

    CREATE TABLE IF NOT EXISTS assessment_library_year (
      grade_level TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      name TEXT,
      scale1 TEXT,
      scale2 TEXT,
      scale3 TEXT,
      scale4 TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (grade_level, academic_year, assess_num)
    );

    CREATE TABLE IF NOT EXISTS assessment_dates (
      chart_id   INTEGER NOT NULL,
      assess_num INTEGER NOT NULL,
      assessed_date TEXT NOT NULL,
      PRIMARY KEY (chart_id, assess_num)
    );

    CREATE TABLE IF NOT EXISTS assessment_dates_year (
      class_key TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      assessed_date TEXT NOT NULL,
      PRIMARY KEY (class_key, academic_year, assess_num)
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS aptitude_settings (
      grade_level INTEGER PRIMARY KEY,
      tonal_low_max INTEGER,
      tonal_med_max INTEGER,
      rhythm_low_max INTEGER,
      rhythm_med_max INTEGER
    );

    CREATE TABLE IF NOT EXISTS imma_scores (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      tonal INTEGER,
      rhythm INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year)
    );

    CREATE TABLE IF NOT EXISTS imma_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firestore_doc_id TEXT UNIQUE,
      student_id INTEGER REFERENCES students(id),
      student_name TEXT,
      student_email TEXT,
      teacher_code TEXT NOT NULL,
      test_type TEXT NOT NULL DEFAULT 'tonal',
      answers TEXT,
      score INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS lsa_pen_notes (
      student_id INTEGER NOT NULL,
      unit_number INTEGER NOT NULL,
      column_type TEXT NOT NULL,
      academic_year TEXT NOT NULL DEFAULT '',
      note_data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, unit_number, column_type, academic_year)
    );

    CREATE TABLE IF NOT EXISTS assessment_ratings (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      rating INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, assess_num)
    );

    CREATE TABLE IF NOT EXISTS lsa_scores (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      easy TEXT DEFAULT '',
      medium TEXT DEFAULT '',
      difficult TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, unit_number)
    );

    CREATE TABLE IF NOT EXISTS student_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      note_text TEXT NOT NULL,
      note_type TEXT,
      note_date TEXT,
      academic_year TEXT,
      parent_note_id INTEGER REFERENCES student_notes(id),
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recorder_song_library_year (
      academic_year TEXT NOT NULL,
      slot_num INTEGER NOT NULL,
      name TEXT,
      color_key TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academic_year, slot_num)
    );

    CREATE TABLE IF NOT EXISTS recorder_song_completions (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      slot_num INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, slot_num)
    );
  `);
}

// ── Individual migrations ─────────────────────────────────────────────────────
// Each function is idempotent: it checks before altering so it is safe to run
// even if the change was already applied by the old ensureX() guards.

function migration_1_studentColumns() {
  const cols = db
    .prepare('PRAGMA table_info(students)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('email')) db.exec('ALTER TABLE students ADD COLUMN email TEXT');
  if (!cols.includes('lsa_easy')) db.exec('ALTER TABLE students ADD COLUMN lsa_easy TEXT');
  if (!cols.includes('lsa_medium')) db.exec('ALTER TABLE students ADD COLUMN lsa_medium TEXT');
  if (!cols.includes('lsa_difficult'))
    db.exec('ALTER TABLE students ADD COLUMN lsa_difficult TEXT');
  if (!cols.includes('good_news_shared'))
    db.exec('ALTER TABLE students ADD COLUMN good_news_shared INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('recorder_color'))
    db.exec('ALTER TABLE students ADD COLUMN recorder_color TEXT');
  if (!cols.includes('lsa_units')) db.exec('ALTER TABLE students ADD COLUMN lsa_units TEXT');
  if (!cols.includes('is_active'))
    db.exec('ALTER TABLE students ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('student_number'))
    db.exec('ALTER TABLE students ADD COLUMN student_number TEXT');
  if (!cols.includes('color_dot')) db.exec('ALTER TABLE students ADD COLUMN color_dot TEXT');
  if (!cols.includes('imma_t')) db.exec('ALTER TABLE students ADD COLUMN imma_t REAL');
  if (!cols.includes('imma_r')) db.exec('ALTER TABLE students ADD COLUMN imma_r REAL');
}

function migration_2_seatingChartColumns() {
  const chartCols = db
    .prepare('PRAGMA table_info(seating_charts)')
    .all()
    .map((c) => c.name);
  if (!chartCols.includes('class_key'))
    db.exec("ALTER TABLE seating_charts ADD COLUMN class_key TEXT NOT NULL DEFAULT ''");
  if (!chartCols.includes('arrangement'))
    db.exec("ALTER TABLE seating_charts ADD COLUMN arrangement TEXT NOT NULL DEFAULT ''");

  const itemCols = db
    .prepare('PRAGMA table_info(seating_chart_items)')
    .all()
    .map((c) => c.name);
  if (!itemCols.includes('assessment_rating'))
    db.exec('ALTER TABLE seating_chart_items ADD COLUMN assessment_rating TEXT');

  const noteCols = db
    .prepare('PRAGMA table_info(student_notes)')
    .all()
    .map((c) => c.name);
  if (!noteCols.includes('parent_note_id'))
    db.exec(
      'ALTER TABLE student_notes ADD COLUMN parent_note_id INTEGER REFERENCES student_notes(id)'
    );
}

function migration_3_lsaAssetColumns() {
  const cols = db
    .prepare('PRAGMA table_info(lsa_unit_assets)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('helper_label'))
    db.exec('ALTER TABLE lsa_unit_assets ADD COLUMN helper_label TEXT');
  if (!cols.includes('audio_url')) db.exec('ALTER TABLE lsa_unit_assets ADD COLUMN audio_url TEXT');
}

function migration_4_lsaLessonAudio() {
  const cols = db
    .prepare('PRAGMA table_info(lsa_lessons)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('audio_url')) db.exec('ALTER TABLE lsa_lessons ADD COLUMN audio_url TEXT');
}

function migration_5_penNotesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lsa_pen_notes (
      student_id INTEGER NOT NULL,
      unit_number INTEGER NOT NULL,
      column_type TEXT NOT NULL,
      note_data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, unit_number, column_type)
    )
  `);
}

function migration_6_immaResultsTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS imma_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      firestore_doc_id TEXT UNIQUE,
      student_id INTEGER REFERENCES students(id),
      student_name TEXT,
      student_email TEXT,
      teacher_code TEXT NOT NULL,
      test_type TEXT NOT NULL DEFAULT 'tonal',
      answers TEXT,
      score INTEGER,
      is_complete INTEGER NOT NULL DEFAULT 0,
      fetched_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

function migration_7_immaResultsTestType() {
  const cols = db
    .prepare('PRAGMA table_info(imma_results)')
    .all()
    .map((c) => c.name);
  if (!cols.includes('test_type')) {
    db.exec("ALTER TABLE imma_results ADD COLUMN test_type TEXT NOT NULL DEFAULT 'tonal'");
  }
}

function migration_8_assessmentDatesTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_dates (
      chart_id   INTEGER NOT NULL,
      assess_num INTEGER NOT NULL,
      assessed_date TEXT NOT NULL,
      PRIMARY KEY (chart_id, assess_num)
    )
  `);
}

// Converts legacy bare-integer assessment_rating values (1–4) recorded before
// the multi-assessment JSON format was introduced.  A bare integer is treated
// as a score for assessment slot 1, matching the only assessment that existed
// at that time.  Rows already in JSON format (starting with '{') are untouched.
function migration_9_assessmentRatingToJSON() {
  db.exec(`
    UPDATE seating_chart_items
    SET assessment_rating = '{"1":' || assessment_rating || '}'
    WHERE assessment_rating IS NOT NULL
      AND assessment_rating IN ('1', '2', '3', '4')
      AND assessment_rating NOT LIKE '{%'
  `);
}

function migration_10_yearScopedData() {
  // 1. Add color_dot to seating_chart_items
  const sciCols = db
    .prepare('PRAGMA table_info(seating_chart_items)')
    .all()
    .map((c) => c.name);
  if (!sciCols.includes('color_dot')) {
    db.exec('ALTER TABLE seating_chart_items ADD COLUMN color_dot TEXT');
  }

  // 2. Add academic_year to lsa_pen_notes
  const pnCols = db
    .prepare('PRAGMA table_info(lsa_pen_notes)')
    .all()
    .map((c) => c.name);
  if (!pnCols.includes('academic_year')) {
    db.exec("ALTER TABLE lsa_pen_notes ADD COLUMN academic_year TEXT NOT NULL DEFAULT ''");
  }

  // 3. Create new year-scoped tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_ratings (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      rating INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, assess_num)
    );
    CREATE TABLE IF NOT EXISTS lsa_scores (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      easy TEXT DEFAULT '',
      medium TEXT DEFAULT '',
      difficult TEXT DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, unit_number)
    );
    CREATE TABLE IF NOT EXISTS assessment_dates_year (
      class_key TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      assessed_date TEXT NOT NULL,
      PRIMARY KEY (class_key, academic_year, assess_num)
    );
  `);

  // 4. Seed data using current academic year
  const currentYearRow = db
    .prepare("SELECT value FROM settings WHERE key='current_academic_year'")
    .get();
  const now = new Date();
  const m = now.getMonth() + 1;
  const sy = m >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const defaultYear = `${sy}-${String(sy + 1).slice(-2)}`;
  const currentYear = currentYearRow && currentYearRow.value ? currentYearRow.value : defaultYear;

  // 4a. Seed lsa_scores from students.lsa_units JSON
  const allStudents = db
    .prepare('SELECT id, lsa_units FROM students WHERE lsa_units IS NOT NULL')
    .all();
  const insertLsaScore = db.prepare(`
    INSERT OR IGNORE INTO lsa_scores (student_id, academic_year, unit_number, easy, medium, difficult)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const seedLsa = db.transaction(() => {
    for (const student of allStudents) {
      let units = {};
      try {
        units = JSON.parse(student.lsa_units) || {};
      } catch {
        units = {};
      }
      for (const [unitKey, scores] of Object.entries(units)) {
        const unitNum = Number(unitKey);
        if (!unitNum) continue;
        insertLsaScore.run(
          student.id,
          currentYear,
          unitNum,
          scores.easy || null,
          scores.medium || null,
          scores.difficult || null
        );
      }
    }
  });
  seedLsa();

  // 4b. Seed assessment_ratings from seating_chart_items.assessment_rating (latest chart wins)
  const allRatingRows = db
    .prepare(
      `
    SELECT sci.student_id, sci.assessment_rating
    FROM seating_chart_items sci
    WHERE sci.assessment_rating IS NOT NULL
    ORDER BY sci.chart_id ASC
  `
    )
    .all();
  const insertRating = db.prepare(`
    INSERT OR REPLACE INTO assessment_ratings (student_id, academic_year, assess_num, rating)
    VALUES (?, ?, ?, ?)
  `);
  const seedRatings = db.transaction(() => {
    for (const row of allRatingRows) {
      let parsed = {};
      try {
        parsed = JSON.parse(row.assessment_rating);
      } catch {
        continue;
      }
      for (const [assessNum, rating] of Object.entries(parsed)) {
        if (rating !== null && rating !== undefined) {
          insertRating.run(row.student_id, currentYear, Number(assessNum), Number(rating));
        }
      }
    }
  });
  seedRatings();

  // 4c. Seed color_dot from students.color_dot into seating_chart_items for each student's chart rows
  db.exec(`
    UPDATE seating_chart_items
    SET color_dot = (SELECT s.color_dot FROM students s WHERE s.id = seating_chart_items.student_id)
    WHERE color_dot IS NULL
  `);

  // 4d. Stamp lsa_pen_notes.academic_year with current year where not yet set
  db.prepare(`UPDATE lsa_pen_notes SET academic_year = ? WHERE academic_year = ''`).run(
    currentYear
  );

  // 4e. Seed assessment_dates_year from assessment_dates (oldest chart per class_key wins per assess_num)
  const chartDateRows = db
    .prepare(
      `
    SELECT sc.class_key, ad.assess_num, ad.assessed_date
    FROM assessment_dates ad
    JOIN seating_charts sc ON ad.chart_id = sc.id
    ORDER BY sc.id ASC
  `
    )
    .all();
  const insertDateYear = db.prepare(`
    INSERT OR IGNORE INTO assessment_dates_year (class_key, academic_year, assess_num, assessed_date)
    VALUES (?, ?, ?, ?)
  `);
  const seedDates = db.transaction(() => {
    for (const row of chartDateRows) {
      insertDateYear.run(row.class_key, currentYear, row.assess_num, row.assessed_date);
    }
  });
  seedDates();
}

function migration_11_lsaLabelHistory() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lsa_unit_labels_history (
      class_key TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      unit_number INTEGER NOT NULL,
      file_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (class_key, academic_year, unit_number)
    )
  `);
}

function migration_12_aptitudeSettings() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS aptitude_settings (
      grade_level INTEGER PRIMARY KEY,
      tonal_low_max INTEGER,
      tonal_med_max INTEGER,
      rhythm_low_max INTEGER,
      rhythm_med_max INTEGER
    )
  `);
}

function migration_13_chartSortOrder() {
  // Adds a sort_order column to seating_charts so teachers can drag-reorder
  // their chart list. Existing rows are seeded with a per-class position
  // derived from their creation order (id ASC) so nothing shifts on upgrade.
  const chartCols = db
    .prepare('PRAGMA table_info(seating_charts)')
    .all()
    .map((c) => c.name);
  if (!chartCols.includes('sort_order')) {
    db.exec('ALTER TABLE seating_charts ADD COLUMN sort_order INTEGER');
    // Seed existing rows with their current id-based order
    db.exec(`
      UPDATE seating_charts
      SET sort_order = (
        SELECT COUNT(*) FROM seating_charts sc2
        WHERE sc2.class_key = seating_charts.class_key AND sc2.id <= seating_charts.id
      )
    `);
  }
}

// Fresh installs at schema v13–v19 were created without seating_charts.sort_order,
// which broke chart listing/creation. Re-running the guarded migration repairs them.
function migration_20_repairFreshInstallSortOrder() {
  migration_13_chartSortOrder();
}

function migration_14_seatingChartAcademicYear() {
  // Existing rows are left NULL (unknown year) so the next CSV import that
  // touches their class_key clears them once, fixing pre-existing cross-year bleed.
  const chartCols = db
    .prepare('PRAGMA table_info(seating_charts)')
    .all()
    .map((c) => c.name);
  if (!chartCols.includes('academic_year')) {
    db.exec('ALTER TABLE seating_charts ADD COLUMN academic_year TEXT');
  }
}

function migration_15_studentGraduation() {
  const studentCols = db
    .prepare('PRAGMA table_info(students)')
    .all()
    .map((c) => c.name);
  if (!studentCols.includes('graduated_year')) {
    db.exec('ALTER TABLE students ADD COLUMN graduated_year TEXT');
  }
}

function migration_16_yearScopedAssessmentLibrary() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS assessment_library_year (
      grade_level TEXT NOT NULL,
      academic_year TEXT NOT NULL,
      assess_num INTEGER NOT NULL,
      name TEXT,
      scale1 TEXT,
      scale2 TEXT,
      scale3 TEXT,
      scale4 TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (grade_level, academic_year, assess_num)
    )
  `);

  const currentYearRow = db
    .prepare("SELECT value FROM settings WHERE key='current_academic_year'")
    .get();
  const now = new Date();
  const startYear = now.getMonth() + 1 >= 8 ? now.getFullYear() : now.getFullYear() - 1;
  const currentYear = currentYearRow?.value || `${startYear}-${String(startYear + 1).slice(-2)}`;
  db.prepare(
    `
      INSERT OR IGNORE INTO assessment_library_year
        (grade_level, academic_year, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
      SELECT grade_level, ?, assess_num, name, scale1, scale2, scale3, scale4, updated_at
      FROM assessment_library
    `
  ).run(currentYear);
}

function migration_17_yearScopedPenNotes() {
  db.exec(`
    ALTER TABLE lsa_pen_notes RENAME TO lsa_pen_notes_legacy;
    CREATE TABLE lsa_pen_notes (
      student_id INTEGER NOT NULL,
      unit_number INTEGER NOT NULL,
      column_type TEXT NOT NULL,
      academic_year TEXT NOT NULL DEFAULT '',
      note_data TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, unit_number, column_type, academic_year)
    );
    INSERT INTO lsa_pen_notes
      (student_id, unit_number, column_type, academic_year, note_data, updated_at)
    SELECT student_id, unit_number, column_type, academic_year, note_data, updated_at
    FROM lsa_pen_notes_legacy;
    DROP TABLE lsa_pen_notes_legacy;
  `);
}

// One-time cleanup for a past bug: changing a student's teacher/grade never
// removed their old seating_chart_items rows, leaving them stuck on their
// former class's chart(s) forever. class_key is stored as `${teacher}||${grade}`
// with teacher already trimmed, so comparing the class_key's teacher segment
// against the student's current teacher (same trim) finds every stale row.
// The graduated-students bucket uses a sentinel key, never a real teacher, so
// it's left untouched.
function migration_18_pruneOrphanedSeatingPlacements() {
  const GRADUATED_CLASS_KEY = '__GRADUATED__';
  const rows = db
    .prepare(
      `
      SELECT sci.chart_id, sci.student_id, sc.class_key, s.teacher
      FROM seating_chart_items sci
      JOIN seating_charts sc ON sc.id = sci.chart_id
      JOIN students s ON s.id = sci.student_id
    `
    )
    .all();

  const del = db.prepare('DELETE FROM seating_chart_items WHERE chart_id=? AND student_id=?');
  const run = db.transaction(() => {
    rows.forEach((row) => {
      const classKey = row.class_key || '';
      if (!classKey || classKey === GRADUATED_CLASS_KEY) return;
      const classTeacher = classKey.split('||')[0] || '';
      const studentTeacher = String(row.teacher || '').trim();
      if (classTeacher !== studentTeacher) {
        del.run(row.chart_id, row.student_id);
      }
    });
  });
  run();
}

function migration_19_recorderSongTracker() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS recorder_song_library_year (
      academic_year TEXT NOT NULL,
      slot_num INTEGER NOT NULL,
      name TEXT,
      color_key TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (academic_year, slot_num)
    );

    CREATE TABLE IF NOT EXISTS recorder_song_completions (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      slot_num INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year, slot_num)
    );
  `);
}

// --- LSA Unit Label History ---
function getLsaUnitLabelsHistory(classKey, academicYear) {
  return db
    .prepare(
      'SELECT unit_number, file_name FROM lsa_unit_labels_history WHERE class_key = ? AND academic_year = ? ORDER BY unit_number ASC'
    )
    .all(classKey, academicYear);
}

function snapshotLsaUnitLabels(classKey, academicYear, labels) {
  // labels: array of { unit_number, file_name }
  const upsert = db.prepare(`
    INSERT INTO lsa_unit_labels_history (class_key, academic_year, unit_number, file_name, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_key, academic_year, unit_number)
    DO UPDATE SET file_name = excluded.file_name, updated_at = excluded.updated_at
  `);
  const run = db.transaction(() => {
    for (const { unit_number, file_name } of labels) {
      upsert.run(classKey, academicYear, unit_number, file_name || '');
    }
  });
  run();
}

// --- Settings ---
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `
  ).run(key, String(value));
  return { key, value: String(value) };
}

// --- Aptitude Settings ---
function getAptitudeSettings() {
  return db
    .prepare(
      `
    SELECT grade_level, tonal_low_max, tonal_med_max, rhythm_low_max, rhythm_med_max
    FROM aptitude_settings
    ORDER BY grade_level ASC
  `
    )
    .all();
}

function saveAptitudeSettings(rows) {
  const insert = db.prepare(
    `
    INSERT INTO aptitude_settings (
      grade_level,
      tonal_low_max,
      tonal_med_max,
      rhythm_low_max,
      rhythm_med_max
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(grade_level)
    DO UPDATE SET
      tonal_low_max = excluded.tonal_low_max,
      tonal_med_max = excluded.tonal_med_max,
      rhythm_low_max = excluded.rhythm_low_max,
      rhythm_med_max = excluded.rhythm_med_max
  `
  );

  const transaction = db.transaction((inputRows) => {
    const normalizedRows = Array.isArray(inputRows) ? inputRows : [];
    for (const row of normalizedRows) {
      const gradeLevel = Number(row?.grade_level);
      if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 5) {
        continue;
      }
      insert.run(
        gradeLevel,
        row.tonal_low_max ?? null,
        row.tonal_med_max ?? null,
        row.rhythm_low_max ?? null,
        row.rhythm_med_max ?? null
      );
    }
  });

  transaction(rows);
  return getAptitudeSettings();
}

// --- IMMA Scores ---
function getImmaScores(studentId) {
  return db
    .prepare(
      `
    SELECT student_id, academic_year, tonal, rhythm, updated_at
    FROM imma_scores
    WHERE student_id = ?
    ORDER BY academic_year DESC
  `
    )
    .all(Number(studentId));
}

function getImmaScoresForClass(studentIds) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map((id) => Number(id))
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `
    SELECT student_id, academic_year, tonal, rhythm, updated_at
    FROM imma_scores
    WHERE student_id IN (${placeholders})
    ORDER BY student_id ASC, academic_year DESC
  `
    )
    .all(...validIds);
}

function upsertImmaScore(studentId, academicYear, tonal, rhythm) {
  const t =
    tonal !== null && tonal !== undefined && tonal !== ''
      ? Math.min(40, Math.max(0, Math.round(Number(tonal))))
      : null;
  const r =
    rhythm !== null && rhythm !== undefined && rhythm !== ''
      ? Math.min(40, Math.max(0, Math.round(Number(rhythm))))
      : null;
  db.prepare(
    `
    INSERT INTO imma_scores (student_id, academic_year, tonal, rhythm, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, academic_year)
    DO UPDATE SET tonal = excluded.tonal, rhythm = excluded.rhythm, updated_at = CURRENT_TIMESTAMP
  `
  ).run(Number(studentId), academicYear, t, r);
  return db
    .prepare(
      'SELECT student_id, academic_year, tonal, rhythm, updated_at FROM imma_scores WHERE student_id = ? AND academic_year = ?'
    )
    .get(Number(studentId), academicYear);
}

// --- Students ---
function getStudents() {
  return db.prepare('SELECT * FROM students ORDER BY last_name, first_name').all();
}

function addStudent(student) {
  const stmt = db.prepare(
    'INSERT INTO students (first_name, last_name, email, grade, teacher, notes, lsa_easy, lsa_medium, lsa_difficult, lsa_units, recorder_color, good_news_shared, is_active, student_number, color_dot) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    student.first_name,
    student.last_name,
    student.email || null,
    student.grade || null,
    student.teacher || null,
    student.notes || null,
    student.lsa_easy || null,
    student.lsa_medium || null,
    student.lsa_difficult || null,
    student.lsa_units || null,
    student.recorder_color || null,
    student.good_news_shared ? 1 : 0,
    student.is_active === 0 ? 0 : 1,
    student.student_number || null,
    student.color_dot || null
  );
  return { id: result.lastInsertRowid, ...student };
}

// Compares teacher/grade before and after an update to decide whether a
// student left their current class — used to purge stale seating chart
// placements so they never linger in a class the student is no longer part of.
function classIdentityChanged(before, after) {
  const norm = (v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase());
  return norm(before.teacher) !== norm(after.teacher) || norm(before.grade) !== norm(after.grade);
}

function updateStudent(student) {
  const previous = db.prepare('SELECT teacher, grade FROM students WHERE id=?').get(student.id);
  db.prepare(
    'UPDATE students SET first_name=?, last_name=?, email=?, grade=?, teacher=?, notes=?, lsa_easy=?, lsa_medium=?, lsa_difficult=?, lsa_units=?, recorder_color=?, good_news_shared=?, is_active=?, student_number=?, color_dot=? WHERE id=?'
  ).run(
    student.first_name,
    student.last_name,
    student.email || null,
    student.grade,
    student.teacher,
    student.notes,
    student.lsa_easy || null,
    student.lsa_medium || null,
    student.lsa_difficult || null,
    student.lsa_units || null,
    student.recorder_color || null,
    student.good_news_shared ? 1 : 0,
    student.is_active === 0 ? 0 : 1,
    student.student_number || null,
    student.color_dot || null,
    student.id
  );
  // Student changed teacher/grade — drop stale placements so they don't stay
  // stuck on their former class's seating chart(s).
  if (previous && classIdentityChanged(previous, student)) {
    db.prepare('DELETE FROM seating_chart_items WHERE student_id=?').run(student.id);
  }
  return student;
}

function deleteStudent(id) {
  db.prepare('DELETE FROM students WHERE id=?').run(id);
  db.prepare('DELETE FROM seating_chart_items WHERE student_id=?').run(id);
  db.prepare('DELETE FROM attendance_records WHERE student_id=?').run(id);
  db.prepare('DELETE FROM imma_scores WHERE student_id=?').run(id);
  return { id };
}

// --- Duplicate Student Merge ---

// Simple profile columns that can be safely backfilled/overwritten — excludes
// id, booleans (good_news_shared/is_active), and lsa_units (a JSON blob better
// left to a future dedicated merge tool).
const MERGE_PROFILE_FIELDS = [
  'first_name',
  'last_name',
  'email',
  'grade',
  'teacher',
  'notes',
  'lsa_easy',
  'lsa_medium',
  'lsa_difficult',
  'recorder_color',
  'student_number',
  'color_dot',
  'imma_t',
  'imma_r',
  'graduated_year',
];

// Tables keyed by (student_id, ...more) — a merge can collide if both students
// already have a row for the same key, so each needs conflict detection
// instead of a blind re-point.
const MERGE_TABLE_CONFIGS = [
  {
    table: 'seating_chart_items',
    keyCols: ['chart_id'],
    dataCols: ['placed', 'x', 'y', 'state', 'attendance', 'assessment_rating', 'color_dot'],
    label: (row) => `Seating chart #${row.chart_id}`,
  },
  {
    table: 'attendance_records',
    keyCols: ['attendance_date'],
    dataCols: ['status'],
    label: (row) => `Attendance ${row.attendance_date}`,
  },
  {
    table: 'imma_scores',
    keyCols: ['academic_year'],
    dataCols: ['tonal', 'rhythm'],
    label: (row) => `IMMA score ${row.academic_year}`,
  },
  {
    table: 'assessment_ratings',
    keyCols: ['academic_year', 'assess_num'],
    dataCols: ['rating'],
    label: (row) => `Assessment #${row.assess_num} (${row.academic_year})`,
  },
  {
    table: 'lsa_scores',
    keyCols: ['academic_year', 'unit_number'],
    dataCols: ['easy', 'medium', 'difficult'],
    label: (row) => `LSA unit ${row.unit_number} (${row.academic_year})`,
  },
  {
    table: 'lsa_pen_notes',
    keyCols: ['unit_number', 'column_type', 'academic_year'],
    dataCols: ['note_data'],
    label: (row) =>
      `Pen note \u2014 unit ${row.unit_number} (${row.column_type}, ${row.academic_year})`,
  },
];

// Tables with no composite key involving student_id — safe to re-point outright.
const MERGE_SAFE_TABLES = ['student_notes', 'imma_results'];

function normalizeMergeValue(v) {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function mergeKeyTuple(row, keyCols) {
  return keyCols.map((c) => String(row[c])).join('\u0001');
}

// Groups students sharing a normalized first+last name — the common shape of
// an accidental duplicate (manual add + unmatched CSV re-import).
function getDuplicateStudentGroups() {
  const allStudents = db.prepare('SELECT * FROM students').all();
  const groups = new Map();
  allStudents.forEach((s) => {
    const key = `${normalizeMergeValue(s.first_name).toLowerCase()}|${normalizeMergeValue(s.last_name).toLowerCase()}`;
    if (key === '|') return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  });
  return Array.from(groups.values())
    .filter((list) => list.length > 1)
    .map((list) => ({ students: list }));
}

// Builds a side-by-side diff for reviewing a merge before it runs: fields/rows
// that only exist on one side are auto-fill (no decision needed), fields/rows
// present on both sides with different values are conflicts requiring a choice.
function getStudentMergePreview(keepId, duplicateId) {
  const keep = db.prepare('SELECT * FROM students WHERE id=?').get(keepId);
  const duplicate = db.prepare('SELECT * FROM students WHERE id=?').get(duplicateId);
  if (!keep || !duplicate) {
    throw new Error('Both students must exist to preview a merge.');
  }

  const profileConflicts = [];
  const profileAutoFill = [];
  MERGE_PROFILE_FIELDS.forEach((field) => {
    const keepVal = normalizeMergeValue(keep[field]);
    const dupVal = normalizeMergeValue(duplicate[field]);
    if (keepVal === dupVal) return;
    if (!keepVal || !dupVal) {
      profileAutoFill.push({ field, value: keepVal ? keep[field] : duplicate[field] });
    } else {
      profileConflicts.push({ field, keepValue: keep[field], duplicateValue: duplicate[field] });
    }
  });

  const chartNames = new Map(
    db
      .prepare('SELECT id, name FROM seating_charts')
      .all()
      .map((c) => [c.id, c.name])
  );

  const tableConflicts = [];
  const tableAutoMoveCounts = {};
  MERGE_TABLE_CONFIGS.forEach((cfg) => {
    const keepRows = db.prepare(`SELECT * FROM ${cfg.table} WHERE student_id=?`).all(keepId);
    const dupRows = db.prepare(`SELECT * FROM ${cfg.table} WHERE student_id=?`).all(duplicateId);
    const keepByKey = new Map(keepRows.map((r) => [mergeKeyTuple(r, cfg.keyCols), r]));
    let autoMove = 0;
    dupRows.forEach((row) => {
      const key = mergeKeyTuple(row, cfg.keyCols);
      const keepRow = keepByKey.get(key);
      if (!keepRow) {
        autoMove++;
        return;
      }
      const differs = cfg.dataCols.some(
        (c) => normalizeMergeValue(row[c]) !== normalizeMergeValue(keepRow[c])
      );
      if (!differs) return;
      let label = cfg.label(row);
      if (cfg.table === 'seating_chart_items') {
        label = `Seating chart: ${chartNames.get(row.chart_id) || `#${row.chart_id}`}`;
      }
      tableConflicts.push({ table: cfg.table, key, label, keepRow, duplicateRow: row });
    });
    tableAutoMoveCounts[cfg.table] = autoMove;
  });

  return {
    keep,
    duplicate,
    profileConflicts,
    profileAutoFill,
    tableConflicts,
    tableAutoMoveCounts,
  };
}

// Merges duplicateId into keepId in one transaction: backfills blank profile
// fields, applies the caller's chosen resolutions for conflicting fields/rows,
// re-points every remaining reference, then deletes the now-empty duplicate.
//
// resolutions: {
//   profile: { [field]: 'keep' | 'duplicate' },
//   tables: { [table]: { [key]: 'keep' | 'duplicate' } },
// }
function mergeStudents(keepId, duplicateId, resolutions = {}) {
  const keep = db.prepare('SELECT * FROM students WHERE id=?').get(keepId);
  const duplicate = db.prepare('SELECT * FROM students WHERE id=?').get(duplicateId);
  if (!keep || !duplicate) {
    throw new Error('Both students must exist to merge.');
  }
  if (Number(keepId) === Number(duplicateId)) {
    throw new Error('Cannot merge a student into itself.');
  }

  const profileResolutions = resolutions.profile || {};
  const tableResolutions = resolutions.tables || {};

  const run = db.transaction(() => {
    // 1. Profile fields — backfill blanks, then apply chosen conflict resolutions.
    const updates = {};
    MERGE_PROFILE_FIELDS.forEach((field) => {
      const keepVal = normalizeMergeValue(keep[field]);
      const dupVal = normalizeMergeValue(duplicate[field]);
      if (keepVal === dupVal) return;
      if (!keepVal || !dupVal) {
        updates[field] = keepVal ? keep[field] : duplicate[field];
      } else if (profileResolutions[field] === 'duplicate') {
        updates[field] = duplicate[field];
      }
    });
    const updateFields = Object.keys(updates);
    if (updateFields.length > 0) {
      const setClause = updateFields.map((f) => `${f}=?`).join(', ');
      db.prepare(`UPDATE students SET ${setClause} WHERE id=?`).run(
        ...updateFields.map((f) => updates[f]),
        keepId
      );
    }

    // 2. Safe tables — no composite key, just re-point every row.
    MERGE_SAFE_TABLES.forEach((table) => {
      db.prepare(`UPDATE ${table} SET student_id=? WHERE student_id=?`).run(keepId, duplicateId);
    });

    // 3. Composite-key tables — move non-colliding rows, resolve conflicts, then
    // always drop the duplicate's copy so nothing is left pointing at it.
    MERGE_TABLE_CONFIGS.forEach((cfg) => {
      const keepRows = db.prepare(`SELECT * FROM ${cfg.table} WHERE student_id=?`).all(keepId);
      const dupRows = db.prepare(`SELECT * FROM ${cfg.table} WHERE student_id=?`).all(duplicateId);
      const keepByKey = new Map(keepRows.map((r) => [mergeKeyTuple(r, cfg.keyCols), r]));
      const tableRes = tableResolutions[cfg.table] || {};
      const dupWhereClause = ['student_id', ...cfg.keyCols].map((c) => `${c}=?`).join(' AND ');

      dupRows.forEach((row) => {
        const key = mergeKeyTuple(row, cfg.keyCols);
        const keepRow = keepByKey.get(key);

        if (!keepRow) {
          db.prepare(`UPDATE ${cfg.table} SET student_id=? WHERE ${dupWhereClause}`).run(
            keepId,
            duplicateId,
            ...cfg.keyCols.map((c) => row[c])
          );
          return;
        }

        if (tableRes[key] === 'duplicate') {
          const setClause = cfg.dataCols.map((c) => `${c}=?`).join(', ');
          const keepWhereClause = ['student_id', ...cfg.keyCols].map((c) => `${c}=?`).join(' AND ');
          db.prepare(`UPDATE ${cfg.table} SET ${setClause} WHERE ${keepWhereClause}`).run(
            ...cfg.dataCols.map((c) => row[c]),
            keepId,
            ...cfg.keyCols.map((c) => keepRow[c])
          );
        }
        db.prepare(`DELETE FROM ${cfg.table} WHERE ${dupWhereClause}`).run(
          duplicateId,
          ...cfg.keyCols.map((c) => row[c])
        );
      });
    });

    // 4. Nothing references duplicateId anymore — safe to remove.
    db.prepare('DELETE FROM students WHERE id=?').run(duplicateId);
  });

  run();
  return { keepId: Number(keepId), mergedId: Number(duplicateId) };
}

// --- Attendance Records ---
function getAttendanceRecords(studentIds = []) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map((id) => Number(id))
        .filter(Number.isFinite)
    : [];

  if (validIds.length === 0) {
    return [];
  }

  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `
    SELECT student_id, attendance_date, status, updated_at
    FROM attendance_records
    WHERE student_id IN (${placeholders})
    ORDER BY attendance_date ASC, student_id ASC
  `
    )
    .all(...validIds);
}

function upsertAttendanceRecord(studentId, attendanceDate, status) {
  db.prepare(
    `
    INSERT INTO attendance_records (student_id, attendance_date, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, attendance_date)
    DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `
  ).run(Number(studentId), attendanceDate, status);

  return db
    .prepare(
      `
    SELECT student_id, attendance_date, status, updated_at
    FROM attendance_records
    WHERE student_id=? AND attendance_date=?
  `
    )
    .get(Number(studentId), attendanceDate);
}

function deleteAttendanceRecord(studentId, attendanceDate) {
  db.prepare('DELETE FROM attendance_records WHERE student_id=? AND attendance_date=?').run(
    Number(studentId),
    attendanceDate
  );
  return { student_id: Number(studentId), attendance_date: attendanceDate };
}

function renameAttendanceDate(oldDate, newDate) {
  // UPDATE OR REPLACE handles PK conflicts: if a student already has a record on newDate,
  // the existing newDate record is replaced by the oldDate record.
  db.prepare(
    `
    UPDATE OR REPLACE attendance_records SET attendance_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE attendance_date = ?
  `
  ).run(newDate, oldDate);
  return { old_date: oldDate, new_date: newDate };
}

function resetStudentData() {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM attendance_records').run();
    db.prepare('DELETE FROM seating_chart_items').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM lsa_unit_placeholders').run();
    db.prepare('DELETE FROM lsa_unit_assets').run();
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('students')").run();
  });

  transaction();
  return { ok: true };
}

function resetFactoryData() {
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM attendance_records').run();
    db.prepare('DELETE FROM seating_chart_items').run();
    db.prepare('DELETE FROM seating_charts').run();
    db.prepare('DELETE FROM students').run();
    db.prepare('DELETE FROM classes').run();
    db.prepare('DELETE FROM instruments').run();
    db.prepare('DELETE FROM lsa_unit_placeholders').run();
    db.prepare('DELETE FROM lsa_unit_assets').run();
    db.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('students','classes','instruments','seating_charts')"
    ).run();
  });

  transaction();
  return { ok: true };
}

// --- LSA Unit Placeholder Positions ---
function getLsaUnitPlaceholders(classKey = '') {
  return db
    .prepare(
      `
    SELECT class_key, unit_number, x, y, updated_at
    FROM lsa_unit_placeholders
    WHERE class_key = ?
    ORDER BY unit_number ASC
  `
    )
    .all(classKey);
}

function upsertLsaUnitPlaceholder(classKey = '', unitNumber, x, y) {
  db.prepare(
    `
    INSERT INTO lsa_unit_placeholders (class_key, unit_number, x, y, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_key, unit_number)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = CURRENT_TIMESTAMP
  `
  ).run(classKey, Number(unitNumber), Number(x), Number(y));

  return db
    .prepare(
      `
    SELECT class_key, unit_number, x, y, updated_at
    FROM lsa_unit_placeholders
    WHERE class_key = ? AND unit_number = ?
  `
    )
    .get(classKey, Number(unitNumber));
}

function getLsaUnitAssets(classKey = '') {
  return db
    .prepare(
      `
    SELECT class_key, unit_number, image_url, helper_label, audio_url, updated_at
    FROM lsa_unit_assets
    WHERE class_key = ?
    ORDER BY unit_number ASC
  `
    )
    .all(classKey);
}

function upsertLsaUnitAsset(classKey = '', unitNumber, imageUrl, helperLabel, audioUrl) {
  const normalizedUnit = Number(unitNumber);
  const existing = db
    .prepare(
      `
    SELECT image_url, helper_label, audio_url
    FROM lsa_unit_assets
    WHERE class_key = ? AND unit_number = ?
  `
    )
    .get(classKey, normalizedUnit);

  const resolvedImageUrl =
    imageUrl === undefined ? (existing?.image_url ?? null) : imageUrl || null;

  const resolvedHelperLabel =
    helperLabel === undefined
      ? (existing?.helper_label ?? null)
      : String(helperLabel || '').trim() || null;

  const resolvedAudioUrl =
    audioUrl === undefined ? (existing?.audio_url ?? null) : audioUrl || null;

  db.prepare(
    `
    INSERT INTO lsa_unit_assets (class_key, unit_number, image_url, helper_label, audio_url, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_key, unit_number)
    DO UPDATE SET image_url = excluded.image_url, helper_label = excluded.helper_label, audio_url = excluded.audio_url, updated_at = CURRENT_TIMESTAMP
  `
  ).run(classKey, normalizedUnit, resolvedImageUrl, resolvedHelperLabel, resolvedAudioUrl);

  return db
    .prepare(
      `
    SELECT class_key, unit_number, image_url, helper_label, audio_url, updated_at
    FROM lsa_unit_assets
    WHERE class_key = ? AND unit_number = ?
  `
    )
    .get(classKey, normalizedUnit);
}

function setLsaLessonAudio(id, audioUrl) {
  db.prepare('UPDATE lsa_lessons SET audio_url = ? WHERE id = ?').run(audioUrl || null, Number(id));
  return db.prepare('SELECT * FROM lsa_lessons WHERE id = ?').get(Number(id));
}

// --- LSA Lesson Library ---
function getLsaLessons() {
  return db.prepare('SELECT * FROM lsa_lessons ORDER BY file_name ASC').all();
}

function addLsaLesson(fileName, imageUrl) {
  const result = db
    .prepare('INSERT INTO lsa_lessons (file_name, image_url) VALUES (?, ?)')
    .run(fileName, imageUrl);
  return db.prepare('SELECT * FROM lsa_lessons WHERE id = ?').get(result.lastInsertRowid);
}

function deleteLsaLesson(id) {
  db.prepare('UPDATE lsa_grade_unit_map SET lesson_id = NULL WHERE lesson_id = ?').run(Number(id));
  db.prepare('DELETE FROM lsa_lessons WHERE id = ?').run(Number(id));
  return { id: Number(id) };
}

// --- LSA Grade Unit Map ---
function getLsaGradeUnitMap(gradeLevel) {
  return db
    .prepare(
      `
    SELECT m.grade_level, m.unit_number, m.lesson_id, m.updated_at,
           l.file_name, l.image_url, l.audio_url
    FROM lsa_grade_unit_map m
    LEFT JOIN lsa_lessons l ON l.id = m.lesson_id
    WHERE m.grade_level = ?
    ORDER BY m.unit_number ASC
  `
    )
    .all(gradeLevel);
}

function upsertLsaGradeUnitMap(gradeLevel, unitNumber, lessonId) {
  const normalizedUnit = Number(unitNumber);
  const resolvedLessonId =
    lessonId !== null && lessonId !== undefined && lessonId !== '' ? Number(lessonId) : null;

  db.prepare(
    `
    INSERT INTO lsa_grade_unit_map (grade_level, unit_number, lesson_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(grade_level, unit_number)
    DO UPDATE SET lesson_id = excluded.lesson_id, updated_at = CURRENT_TIMESTAMP
  `
  ).run(gradeLevel, normalizedUnit, resolvedLessonId);

  return db
    .prepare(
      `
    SELECT m.grade_level, m.unit_number, m.lesson_id, m.updated_at,
           l.file_name, l.image_url
    FROM lsa_grade_unit_map m
    LEFT JOIN lsa_lessons l ON l.id = m.lesson_id
    WHERE m.grade_level = ? AND m.unit_number = ?
  `
    )
    .get(gradeLevel, normalizedUnit);
}

function clearLsaGradeUnitSlot(gradeLevel, unitNumber) {
  db.prepare('DELETE FROM lsa_grade_unit_map WHERE grade_level = ? AND unit_number = ?').run(
    gradeLevel,
    Number(unitNumber)
  );
  return { grade_level: gradeLevel, unit_number: Number(unitNumber) };
}

// --- LSA Custom Units ---
function getLsaCustomUnits() {
  return db
    .prepare('SELECT unit_number FROM lsa_custom_units ORDER BY unit_number ASC')
    .all()
    .map((r) => r.unit_number);
}

function addLsaCustomUnit(unitNumber) {
  const n = Number(unitNumber);
  db.prepare('INSERT OR IGNORE INTO lsa_custom_units (unit_number) VALUES (?)').run(n);
  return { unit_number: n };
}

// --- Seating Charts ---
// getSeatingCharts orders by sort_order so teacher-defined list order is respected.
function getSeatingCharts(classKey = '') {
  return db
    .prepare(
      `
    SELECT
      c.id,
      c.name,
      c.class_key,
      c.created_at,
      c.updated_at,
      COALESCE(SUM(CASE WHEN i.placed = 1 THEN 1 ELSE 0 END), 0) AS placed_count
    FROM seating_charts c
    LEFT JOIN seating_chart_items i ON i.chart_id = c.id
    WHERE c.class_key = ?
    GROUP BY c.id, c.name, c.class_key, c.created_at, c.updated_at
    ORDER BY COALESCE(c.sort_order, c.id) ASC, c.id ASC
  `
    )
    .all(classKey);
}

function getSeatingChart(chartId, classKey = '') {
  const chart = db
    .prepare('SELECT * FROM seating_charts WHERE id=? AND class_key=?')
    .get(chartId, classKey);
  if (!chart) {
    return null;
  }

  const items = db
    .prepare(
      `
    SELECT chart_id, student_id, placed, x, y, state, attendance, assessment_rating, color_dot
    FROM seating_chart_items
    WHERE chart_id=?
    ORDER BY student_id ASC
  `
    )
    .all(chartId);

  return { ...chart, items };
}

// Persists a new list order after a drag-reorder operation. Receives the full
// ordered array of chart IDs for a class and writes 1-based sort_order values
// in a single transaction, then returns the refreshed chart list.
function reorderSeatingCharts(classKey, orderedIds) {
  const update = db.prepare(
    'UPDATE seating_charts SET sort_order = ? WHERE id = ? AND class_key = ?'
  );
  const run = db.transaction(() => {
    orderedIds.forEach((id, index) => {
      update.run(index + 1, id, classKey);
    });
  });
  run();
  return getSeatingCharts(classKey);
}

function createSeatingChart(payload) {
  // sort_order is auto-assigned to MAX(sort_order)+1 for the class so new
  // charts always append to the bottom of the teacher's ordered list.
  const insertChart = db.prepare(
    'INSERT INTO seating_charts (name, class_key, arrangement, academic_year, sort_order, updated_at) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM seating_charts WHERE class_key = ?), CURRENT_TIMESTAMP)'
  );
  const insertItem = db.prepare(`
    INSERT INTO seating_chart_items (chart_id, student_id, placed, x, y, state, attendance, assessment_rating, color_dot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(
    ({ name, classKey = '', arrangement = '', academicYear = null, items = [] }) => {
      const result = insertChart.run(name, classKey, arrangement, academicYear || null, classKey);
      const chartId = result.lastInsertRowid;

      items.forEach((item) => {
        insertItem.run(
          chartId,
          item.student_id,
          item.placed ? 1 : 0,
          item.x ?? null,
          item.y ?? null,
          item.state || null,
          item.attendance || null,
          item.assessment_rating ?? null,
          item.color_dot ?? null
        );
      });

      return getSeatingChart(chartId, classKey);
    }
  );

  return transaction(payload);
}

function updateSeatingChartName(chartId, name, classKey = '') {
  db.prepare(
    'UPDATE seating_charts SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?'
  ).run(name, chartId, classKey);
  return getSeatingChart(chartId, classKey);
}

function saveSeatingChartLayout(payload) {
  const deleteItems = db.prepare('DELETE FROM seating_chart_items WHERE chart_id=?');
  const insertItem = db.prepare(`
    INSERT INTO seating_chart_items (chart_id, student_id, placed, x, y, state, attendance, assessment_rating, color_dot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(({ chartId, classKey = '', arrangement, items = [] }) => {
    deleteItems.run(chartId);
    items.forEach((item) => {
      insertItem.run(
        chartId,
        item.student_id,
        item.placed ? 1 : 0,
        item.x ?? null,
        item.y ?? null,
        item.state || null,
        item.attendance || null,
        item.assessment_rating ?? null,
        item.color_dot ?? null
      );
    });
    if (arrangement !== undefined) {
      db.prepare(
        'UPDATE seating_charts SET arrangement=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?'
      ).run(arrangement, chartId, classKey);
    } else {
      db.prepare(
        'UPDATE seating_charts SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?'
      ).run(chartId, classKey);
    }
    return getSeatingChart(chartId, classKey);
  });

  return transaction(payload);
}

function deleteSeatingChart(chartId, classKey = '') {
  const chart = db
    .prepare('SELECT id FROM seating_charts WHERE id=? AND class_key=?')
    .get(chartId, classKey);
  if (!chart) {
    return { id: chartId };
  }
  db.prepare('DELETE FROM seating_chart_items WHERE chart_id=?').run(chartId);
  db.prepare('DELETE FROM seating_charts WHERE id=? AND class_key=?').run(chartId, classKey);
  return { id: chartId };
}

// Wipes all seating chart data left over from a prior academic year (called
// once per new-year CSV import), so a class never mixes old and new roster
// placements. Not scoped to classes present in the import — a class whose
// entire prior roster moved away (retired teacher, grade reassignment, etc.)
// would otherwise never appear in scope and its stale chart would linger
// forever. Charts already stamped with the current year are left untouched.
function clearStaleSeatingChartsForYear(academicYear) {
  if (!academicYear) {
    return { clearedClasses: 0, clearedCharts: 0 };
  }

  const stale = db
    .prepare(
      'SELECT id, class_key FROM seating_charts WHERE academic_year IS NULL OR academic_year != ?'
    )
    .all(academicYear);

  if (stale.length === 0) {
    return { clearedClasses: 0, clearedCharts: 0 };
  }

  const clearedClassKeys = new Set();
  const transaction = db.transaction(() => {
    const ids = stale.map((c) => c.id);
    const placeholders = ids.map(() => '?').join(',');
    db.prepare(`DELETE FROM seating_chart_items WHERE chart_id IN (${placeholders})`).run(...ids);
    db.prepare(`DELETE FROM seating_charts WHERE id IN (${placeholders})`).run(...ids);
  });

  transaction();
  stale.forEach((c) => clearedClassKeys.add(c.class_key));

  return { clearedClasses: clearedClassKeys.size, clearedCharts: stale.length };
}

// --- Instruments ---
function getInstruments() {
  return db.prepare('SELECT * FROM instruments ORDER BY name').all();
}

function addInstrument(instrument) {
  const stmt = db.prepare(
    'INSERT INTO instruments (name, type, quantity, condition, notes) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    instrument.name,
    instrument.type || null,
    instrument.quantity ?? 1,
    instrument.condition || null,
    instrument.notes || null
  );
  return { id: result.lastInsertRowid, ...instrument };
}

function updateInstrument(instrument) {
  db.prepare(
    'UPDATE instruments SET name=?, type=?, quantity=?, condition=?, notes=? WHERE id=?'
  ).run(
    instrument.name,
    instrument.type,
    instrument.quantity,
    instrument.condition,
    instrument.notes,
    instrument.id
  );
  return instrument;
}

function deleteInstrument(id) {
  db.prepare('DELETE FROM instruments WHERE id=?').run(id);
  return { id };
}

// --- Classes ---
function getClasses() {
  return db.prepare('SELECT * FROM classes ORDER BY name').all();
}

function addClass(cls) {
  const stmt = db.prepare(
    'INSERT INTO classes (name, grade, teacher, schedule, notes) VALUES (?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    cls.name,
    cls.grade || null,
    cls.teacher || null,
    cls.schedule || null,
    cls.notes || null
  );
  return { id: result.lastInsertRowid, ...cls };
}

function updateClass(cls) {
  db.prepare('UPDATE classes SET name=?, grade=?, teacher=?, schedule=?, notes=? WHERE id=?').run(
    cls.name,
    cls.grade,
    cls.teacher,
    cls.schedule,
    cls.notes,
    cls.id
  );
  return cls;
}

function deleteClass(id) {
  db.prepare('DELETE FROM classes WHERE id=?').run(id);
  return { id };
}

// --- Bulk sync (CSV import) ---
// Returns { updated, created, reactivated, deactivated, graduated, unGraduated }
// teacherColumnMapped: true when the CSV actually has a Teacher column mapped,
// so a blank cell means "no teacher" rather than "no info" (avoids carrying a
// prior year's teacher forward and creating a stray one-student class).

// Reduces a raw grade string (e.g. "5th", "Fifth Grade", "grade 5") to a bare
// digit/K/Y5 so graduation eligibility can be checked without renderer.js's
// normalizeGrade() (this module runs in the main process, not the renderer).
function normalizeGradeForGraduationCheck(grade) {
  if (!grade) return '';
  const s = String(grade).trim().toLowerCase();
  if (!s) return '';
  if (['k', 'kindergarten', 'kinder', 'pre-k', 'prek'].includes(s)) return 'K';
  if (
    s === 'y5' ||
    s.replace(/[^a-z0-9]/g, '') === 'young5s' ||
    s.includes('young five') ||
    s.includes('young 5')
  )
    return 'Y5';
  const wordOrdinals = {
    first: 1,
    second: 2,
    third: 3,
    fourth: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
  };
  for (const [word, num] of Object.entries(wordOrdinals)) {
    if (s.includes(word)) return String(num);
  }
  const gradeMatch = s.match(/grade\s*(\d+)|(\d+)\s*grade/);
  if (gradeMatch) return String(Number(gradeMatch[1] || gradeMatch[2]));
  const numMatch = s.match(/^0*(\d+)/);
  if (numMatch) return String(Number(numMatch[1]));
  return s;
}

// Plain Levenshtein edit distance, used to flag likely-typo name mismatches.
function levenshteinDistance(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function describeStudentCandidate(s) {
  return {
    id: s.id,
    firstName: s.first_name,
    lastName: s.last_name,
    grade: s.grade,
    teacher: s.teacher,
    isActive: s.is_active !== 0,
    graduatedYear: s.graduated_year || null,
  };
}

// Read-only scan of a parsed CSV against the current roster, returning rows
// whose only path to a match is name-based and ambiguous (two+ DB students
// share that exact name) or a likely typo (no exact match, but a close one
// exists) — for the user to resolve manually before syncStudentsFromCsv runs.
function previewCsvSync(csvStudents) {
  const allDbStudents = db.prepare('SELECT * FROM students').all();
  const byNumber = new Map();
  const byEmail = new Map();
  const byNameList = new Map();
  allDbStudents.forEach((s) => {
    if (s.student_number) byNumber.set(s.student_number.trim(), s);
    if (s.email) byEmail.set(s.email.trim().toLowerCase(), s);
    const nameKey = `${(s.first_name || '').trim().toLowerCase()}|${(s.last_name || '').trim().toLowerCase()}`;
    if (!byNameList.has(nameKey)) byNameList.set(nameKey, []);
    byNameList.get(nameKey).push(s);
  });

  const flagged = [];
  csvStudents.forEach((r, rowIndex) => {
    const num = (r.student_number || '').trim();
    const email = (r.email || '').trim().toLowerCase();
    if (num && byNumber.has(num)) return;
    if (email && byEmail.has(email)) return;

    const first = (r.first_name || '').trim();
    const last = (r.last_name || '').trim();
    if (!first || !last) return;

    const nameKey = `${first.toLowerCase()}|${last.toLowerCase()}`;
    const exactMatches = byNameList.get(nameKey) || [];
    if (exactMatches.length > 1) {
      flagged.push({
        rowIndex,
        row: r,
        matchType: 'ambiguous',
        candidates: exactMatches.map(describeStudentCandidate),
      });
      return;
    }
    if (exactMatches.length === 1) return;

    const fullName = `${first.toLowerCase()} ${last.toLowerCase()}`;
    const nearMiss = allDbStudents.filter((s) => {
      const sFirst = (s.first_name || '').trim().toLowerCase();
      const sLast = (s.last_name || '').trim().toLowerCase();
      if (!sFirst || !sLast) return false;
      const sFull = `${sFirst} ${sLast}`;
      if (sFull === fullName) return false;
      return levenshteinDistance(sFull, fullName) <= 2;
    });
    if (nearMiss.length > 0) {
      flagged.push({
        rowIndex,
        row: r,
        matchType: 'near_miss',
        candidates: nearMiss.map(describeStudentCandidate),
      });
    }
  });

  return flagged;
}

// manualMatches: optional { [csvRowIndex]: studentId | 'new' } map from the
// resolve-matches review step, overriding the automatic number/email/name
// match for rows the user explicitly disambiguated.
function syncStudentsFromCsv(
  csvStudents,
  academicYear,
  teacherColumnMapped = false,
  manualMatches = {}
) {
  const allDbStudents = db.prepare('SELECT * FROM students').all();

  // Index DB students for fast lookup
  const byNumber = new Map();
  const byEmail = new Map();
  const byName = new Map();
  const byId = new Map();
  allDbStudents.forEach((s) => {
    if (s.student_number) byNumber.set(s.student_number.trim(), s);
    if (s.email) byEmail.set(s.email.trim().toLowerCase(), s);
    const nameKey = `${(s.first_name || '').trim().toLowerCase()}|${(s.last_name || '').trim().toLowerCase()}`;
    if (!byName.has(nameKey)) byName.set(nameKey, s);
    byId.set(s.id, s);
  });

  // Determine scope: which teacher+grade combos appear in CSV
  const scopedClassKeys = new Set();
  csvStudents.forEach((r) => {
    const teacher = (r.teacher || '').trim();
    const grade = (r.grade || '').trim();
    if (teacher || grade) scopedClassKeys.add(`${teacher}|${grade}`);
  });

  // IDs of students in the CSV scope in DB (will be deactivated if not in CSV)
  const scopedDbIds = new Set();
  allDbStudents.forEach((s) => {
    const teacher = (s.teacher || '').trim();
    const grade = (s.grade || '').trim();
    if (scopedClassKeys.has(`${teacher}|${grade}`)) scopedDbIds.add(s.id);
  });

  const updatedIds = new Set();
  let created = 0;
  let updated = 0;
  let reactivated = 0;
  let unGraduated = 0;

  const updateStmt = db.prepare(
    'UPDATE students SET first_name=?, last_name=?, email=?, grade=?, teacher=?, student_number=?, is_active=1, good_news_shared=?, graduated_year=NULL WHERE id=?'
  );
  const insertStmt = db.prepare(
    'INSERT INTO students (first_name, last_name, email, grade, teacher, student_number, good_news_shared, is_active) VALUES (?, ?, ?, ?, ?, ?, 0, 1)'
  );

  const transaction = db.transaction(() => {
    csvStudents.forEach((r, rowIndex) => {
      const num = (r.student_number || '').trim();
      const email = (r.email || '').trim().toLowerCase();
      const nameKey = `${(r.first_name || '').trim().toLowerCase()}|${(r.last_name || '').trim().toLowerCase()}`;

      let match = null;
      const manualChoice = manualMatches ? manualMatches[rowIndex] : undefined;
      if (manualChoice === 'new') {
        match = null;
      } else if (manualChoice !== undefined && manualChoice !== null && manualChoice !== '') {
        match = byId.get(Number(manualChoice)) || null;
      } else {
        if (num) match = byNumber.get(num) || null;
        if (!match && email) match = byEmail.get(email) || null;
        if (!match) match = byName.get(nameKey) || null;
      }

      const isNewYear = academicYear && match;
      const goodNewsReset = isNewYear ? 0 : match ? match.good_news_shared : 0;

      if (match) {
        const wasInactive = match.is_active === 0;
        if (match.graduated_year) unGraduated++;
        // When the Teacher column is mapped, a blank cell means this student
        // currently has no teacher — don't fall back to their old teacher,
        // or a promoted/leftover student would form a stray class at the new grade.
        const teacherValue = teacherColumnMapped
          ? r.teacher || null
          : r.teacher || match.teacher || null;
        const gradeValue = r.grade || match.grade || null;
        updateStmt.run(
          r.first_name || match.first_name,
          r.last_name || match.last_name,
          r.email || match.email || null,
          gradeValue,
          teacherValue,
          num || match.student_number || null,
          goodNewsReset,
          match.id
        );
        // Student changed teacher/grade via CSV — drop stale placements so
        // they don't stay stuck on their former class's seating chart(s).
        if (classIdentityChanged(match, { teacher: teacherValue, grade: gradeValue })) {
          db.prepare('DELETE FROM seating_chart_items WHERE student_id=?').run(match.id);
        }
        // Update lookup maps with new data
        if (num) byNumber.set(num, { ...match, id: match.id });
        if (email) byEmail.set(email, { ...match, id: match.id });
        if (wasInactive) reactivated++;
        else updated++;
        updatedIds.add(match.id);
      } else {
        const result = insertStmt.run(
          r.first_name,
          r.last_name,
          r.email || null,
          r.grade || null,
          r.teacher || null,
          num || null
        );
        updatedIds.add(result.lastInsertRowid);
        created++;
      }
    });

    // Deactivate scoped students not matched — students leaving the top
    // elementary grade are graduated instead, so they never inflate their
    // former teacher's class count and their teacher field is cleared.
    let deactivated = 0;
    let graduated = 0;
    scopedDbIds.forEach((id) => {
      if (updatedIds.has(id)) return;
      const student = byId.get(id);
      const isTerminalGrade = normalizeGradeForGraduationCheck(student && student.grade) === '5';
      if (isTerminalGrade && student && !student.graduated_year) {
        db.prepare(
          'UPDATE students SET is_active=0, teacher=NULL, grade=?, graduated_year=? WHERE id=?'
        ).run('6th', academicYear || null, id);
        // Graduating clears their teacher — drop stale placements so they
        // don't stay stuck on their former class's seating chart(s).
        db.prepare('DELETE FROM seating_chart_items WHERE student_id=?').run(id);
        graduated++;
      } else {
        db.prepare('UPDATE students SET is_active=0 WHERE id=?').run(id);
        deactivated++;
      }
    });

    return { updated, created, reactivated, deactivated, graduated, unGraduated };
  });

  return transaction();
}

// --- Assessment Library ---
function ensureAssessmentLibraryForYear(gradeLevel, academicYear) {
  if (!academicYear) return;
  const exists = db
    .prepare(
      'SELECT 1 FROM assessment_library_year WHERE grade_level = ? AND academic_year = ? LIMIT 1'
    )
    .get(gradeLevel, academicYear);
  if (exists) return;

  const previousYear = db
    .prepare(
      'SELECT MAX(academic_year) AS academic_year FROM assessment_library_year WHERE grade_level = ? AND academic_year < ?'
    )
    .get(gradeLevel, academicYear)?.academic_year;
  if (previousYear) {
    db.prepare(
      `
        INSERT INTO assessment_library_year
          (grade_level, academic_year, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
        SELECT grade_level, ?, assess_num, name, scale1, scale2, scale3, scale4, CURRENT_TIMESTAMP
        FROM assessment_library_year
        WHERE grade_level = ? AND academic_year = ?
      `
    ).run(academicYear, gradeLevel, previousYear);
    return;
  }

  db.prepare(
    `
      INSERT INTO assessment_library_year
        (grade_level, academic_year, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
      SELECT grade_level, ?, assess_num, name, scale1, scale2, scale3, scale4, CURRENT_TIMESTAMP
      FROM assessment_library
      WHERE grade_level = ?
    `
  ).run(academicYear, gradeLevel);
}

function getAssessmentLibrary(gradeLevel, academicYear) {
  if (!academicYear) {
    return db
      .prepare(
        `
      SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at
      FROM assessment_library
      WHERE grade_level = ?
      ORDER BY assess_num ASC
    `
      )
      .all(gradeLevel);
  }
  ensureAssessmentLibraryForYear(gradeLevel, academicYear);
  return db
    .prepare(
      `
    SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at
    FROM assessment_library_year
    WHERE grade_level = ? AND academic_year = ?
    ORDER BY assess_num ASC
  `
    )
    .all(gradeLevel, academicYear);
}

function upsertAssessmentLibraryItem(
  gradeLevel,
  academicYear,
  assessNum,
  name,
  scale1,
  scale2,
  scale3,
  scale4
) {
  ensureAssessmentLibraryForYear(gradeLevel, academicYear);
  db.prepare(
    `
    INSERT INTO assessment_library_year (grade_level, academic_year, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(grade_level, academic_year, assess_num)
    DO UPDATE SET name = excluded.name, scale1 = excluded.scale1, scale2 = excluded.scale2,
      scale3 = excluded.scale3, scale4 = excluded.scale4, updated_at = CURRENT_TIMESTAMP
  `
  ).run(
    gradeLevel,
    academicYear,
    Number(assessNum),
    name || null,
    scale1 || null,
    scale2 || null,
    scale3 || null,
    scale4 || null
  );
  return db
    .prepare(
      `
    SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at
      FROM assessment_library_year
      WHERE grade_level = ? AND academic_year = ? AND assess_num = ?
  `
    )
    .get(gradeLevel, academicYear, Number(assessNum));
}

function exportAssessmentLibrary() {
  return db
    .prepare(
      `
    SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4
    FROM assessment_library
    ORDER BY grade_level, assess_num
  `
    )
    .all();
}

function importAssessmentLibrary(rows) {
  const upsert = db.prepare(`
    INSERT INTO assessment_library (grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(grade_level, assess_num)
    DO UPDATE SET name = excluded.name, scale1 = excluded.scale1, scale2 = excluded.scale2,
      scale3 = excluded.scale3, scale4 = excluded.scale4, updated_at = CURRENT_TIMESTAMP
  `);
  const transaction = db.transaction((items) => {
    for (const row of items) {
      upsert.run(
        row.grade_level,
        Number(row.assess_num),
        row.name || null,
        row.scale1 || null,
        row.scale2 || null,
        row.scale3 || null,
        row.scale4 || null
      );
    }
  });
  transaction(rows);
  return { count: rows.length };
}

function deleteAssessmentLibraryItem(gradeLevel, academicYear, assessNum) {
  db.prepare(
    'DELETE FROM assessment_library_year WHERE grade_level = ? AND academic_year = ? AND assess_num = ?'
  ).run(gradeLevel, academicYear, Number(assessNum));
}

// --- LSA Pen Notes ---
function savePenNote(studentId, unitNumber, columnType, noteData) {
  if (!['easy', 'medium', 'difficult'].includes(columnType)) return null;
  if (noteData) {
    db.prepare(
      `
      INSERT INTO lsa_pen_notes (student_id, unit_number, column_type, note_data, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(student_id, unit_number, column_type)
      DO UPDATE SET note_data = excluded.note_data, updated_at = CURRENT_TIMESTAMP
    `
    ).run(Number(studentId), Number(unitNumber), columnType, noteData);
  } else {
    db.prepare(
      'DELETE FROM lsa_pen_notes WHERE student_id=? AND unit_number=? AND column_type=?'
    ).run(Number(studentId), Number(unitNumber), columnType);
  }
  return (
    db
      .prepare('SELECT * FROM lsa_pen_notes WHERE student_id=? AND unit_number=? AND column_type=?')
      .get(Number(studentId), Number(unitNumber), columnType) || null
  );
}

function getPenNotesForStudents(studentIds) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map((id) => Number(id))
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `
    SELECT student_id, unit_number, column_type, note_data, updated_at
    FROM lsa_pen_notes
    WHERE student_id IN (${placeholders})
    ORDER BY student_id ASC, unit_number ASC, column_type ASC
  `
    )
    .all(...validIds);
}

// ── MATS Results ────────────────────────────────────────────────────────────

function upsertMatsResult({
  firestore_doc_id,
  student_id,
  student_name,
  student_email,
  teacher_code,
  test_type,
  answers,
  score,
  is_complete,
}) {
  db.prepare(
    `
    INSERT INTO imma_results
      (firestore_doc_id, student_id, student_name, student_email, teacher_code, test_type, answers, score, is_complete, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(firestore_doc_id) DO UPDATE SET
      student_id    = excluded.student_id,
      student_name  = excluded.student_name,
      student_email = excluded.student_email,
      test_type     = excluded.test_type,
      answers       = excluded.answers,
      score         = excluded.score,
      is_complete   = excluded.is_complete,
      fetched_at    = CURRENT_TIMESTAMP
  `
  ).run(
    firestore_doc_id ?? null,
    student_id ?? null,
    student_name ?? null,
    student_email ?? null,
    teacher_code,
    test_type ?? 'tonal',
    answers ?? null,
    score ?? null,
    is_complete ?? 0
  );
}

function getMatsResultsForClass(studentIds) {
  if (!studentIds || studentIds.length === 0) return [];
  const placeholders = studentIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT * FROM imma_results WHERE student_id IN (${placeholders}) ORDER BY fetched_at DESC`
    )
    .all(...studentIds.map(Number));
}

function getMatsUnmatchedResults(teacherCode) {
  return db
    .prepare(
      `SELECT * FROM imma_results WHERE student_id IS NULL AND teacher_code = ? ORDER BY fetched_at DESC`
    )
    .all(teacherCode);
}

function deleteMatsResult(firestoreDocId) {
  db.prepare(`DELETE FROM imma_results WHERE firestore_doc_id = ?`).run(firestoreDocId);
}

// ── Assessment Dates ──────────────────────────────────────────────────────
function getAssessmentDates(chartId) {
  return db
    .prepare(`SELECT assess_num, assessed_date FROM assessment_dates WHERE chart_id = ?`)
    .all(chartId);
}

// Returns all non-null assessment_rating rows for every chart belonging to classKey,
// ordered oldest-chart-first so callers can merge with newest values winning.
function getClassAssessmentRatings(classKey) {
  return db
    .prepare(
      `
    SELECT sci.student_id, sci.assessment_rating
    FROM seating_chart_items sci
    JOIN seating_charts sc ON sci.chart_id = sc.id
    WHERE sc.class_key = ?
      AND sci.assessment_rating IS NOT NULL
    ORDER BY sc.id ASC
  `
    )
    .all(classKey);
}

// Returns all assessment dates recorded in any chart belonging to classKey,
// ordered oldest-chart-first so callers can use the first (oldest) date found per assess_num.
function getClassAssessmentDates(classKey) {
  return db
    .prepare(
      `
    SELECT ad.assess_num, ad.assessed_date
    FROM assessment_dates ad
    JOIN seating_charts sc ON ad.chart_id = sc.id
    WHERE sc.class_key = ?
    ORDER BY sc.id ASC
  `
    )
    .all(classKey);
}

function setAssessmentDate(chartId, assessNum, date) {
  if (!date) {
    db.prepare(`DELETE FROM assessment_dates WHERE chart_id = ? AND assess_num = ?`).run(
      chartId,
      assessNum
    );
  } else {
    db.prepare(
      `
      INSERT INTO assessment_dates (chart_id, assess_num, assessed_date)
      VALUES (?, ?, ?)
      ON CONFLICT(chart_id, assess_num) DO UPDATE SET assessed_date = excluded.assessed_date
    `
    ).run(chartId, assessNum, date);
  }
}

// ── Year-scoped Assessment Dates ──────────────────────────────────────────────
function getAssessmentDatesForClass(classKey, academicYear) {
  return db
    .prepare(
      `SELECT assess_num, assessed_date FROM assessment_dates_year WHERE class_key = ? AND academic_year = ?`
    )
    .all(classKey, academicYear);
}

function setAssessmentDateForClass(classKey, academicYear, assessNum, date) {
  if (!date) {
    db.prepare(
      `DELETE FROM assessment_dates_year WHERE class_key = ? AND academic_year = ? AND assess_num = ?`
    ).run(classKey, academicYear, assessNum);
  } else {
    db.prepare(
      `
      INSERT INTO assessment_dates_year (class_key, academic_year, assess_num, assessed_date)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(class_key, academic_year, assess_num) DO UPDATE SET assessed_date = excluded.assessed_date
    `
    ).run(classKey, academicYear, assessNum, date);
  }
}

// ── Year-scoped Assessment Ratings ────────────────────────────────────────────
function getAssessmentRatings(studentIds, academicYear) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map(Number)
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT student_id, assess_num, rating FROM assessment_ratings
       WHERE student_id IN (${placeholders}) AND academic_year = ?
       ORDER BY student_id ASC, assess_num ASC`
    )
    .all(...validIds, academicYear);
}

function upsertAssessmentRating(studentId, academicYear, assessNum, rating) {
  if (rating === null || rating === undefined) {
    db.prepare(
      `DELETE FROM assessment_ratings WHERE student_id = ? AND academic_year = ? AND assess_num = ?`
    ).run(Number(studentId), academicYear, Number(assessNum));
  } else {
    db.prepare(
      `
      INSERT INTO assessment_ratings (student_id, academic_year, assess_num, rating, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(student_id, academic_year, assess_num) DO UPDATE SET rating = excluded.rating, updated_at = CURRENT_TIMESTAMP
    `
    ).run(Number(studentId), academicYear, Number(assessNum), Number(rating));
  }
}

// ── Year-scoped LSA Scores ────────────────────────────────────────────────────
function getLsaScores(studentIds, academicYear) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map(Number)
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT student_id, unit_number, easy, medium, difficult FROM lsa_scores
       WHERE student_id IN (${placeholders}) AND academic_year = ?
       ORDER BY student_id ASC, unit_number ASC`
    )
    .all(...validIds, academicYear);
}

function upsertLsaScore(studentId, academicYear, unitNumber, easy, medium, difficult) {
  db.prepare(
    `
    INSERT INTO lsa_scores (student_id, academic_year, unit_number, easy, medium, difficult, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, academic_year, unit_number) DO UPDATE SET
      easy = excluded.easy,
      medium = excluded.medium,
      difficult = excluded.difficult,
      updated_at = CURRENT_TIMESTAMP
  `
  ).run(
    Number(studentId),
    academicYear,
    Number(unitNumber),
    easy || null,
    medium || null,
    difficult || null
  );
}

// ── Year-scoped Pen Notes ─────────────────────────────────────────────────────
function getPenNotesForStudentsYear(studentIds, academicYear) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map(Number)
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT student_id, unit_number, column_type, note_data, updated_at
       FROM lsa_pen_notes
       WHERE student_id IN (${placeholders}) AND academic_year = ?
       ORDER BY student_id ASC, unit_number ASC, column_type ASC`
    )
    .all(...validIds, academicYear);
}

function savePenNoteYear(studentId, unitNumber, columnType, noteData, academicYear) {
  if (!['easy', 'medium', 'difficult'].includes(columnType)) return null;
  if (noteData) {
    db.prepare(
      `
      INSERT INTO lsa_pen_notes (student_id, unit_number, column_type, academic_year, note_data, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(student_id, unit_number, column_type, academic_year)
      DO UPDATE SET note_data = excluded.note_data, updated_at = CURRENT_TIMESTAMP
    `
    ).run(Number(studentId), Number(unitNumber), columnType, academicYear || '', noteData);
  } else {
    db.prepare(
      'DELETE FROM lsa_pen_notes WHERE student_id=? AND unit_number=? AND column_type=? AND academic_year=?'
    ).run(Number(studentId), Number(unitNumber), columnType, academicYear || '');
  }
  return (
    db
      .prepare(
        'SELECT * FROM lsa_pen_notes WHERE student_id=? AND unit_number=? AND column_type=? AND academic_year=?'
      )
      .get(Number(studentId), Number(unitNumber), columnType, academicYear || '') || null
  );
}

// ── Recorder Song Tracker ─────────────────────────────────────────────────────
// Named palette of 10 pale background colors the user can choose from when
// assigning a color to each song column. Keys are stored in the DB; the
// renderer maps keys -> actual CSS colors so the palette can be re-themed
// without a data migration.
const DEFAULT_RECORDER_SONG_COLORS = [
  'white',
  'yellow',
  'orange',
  'green',
  'purple',
  'blue',
  'red',
  'pink',
  'brown',
  'black',
];

function ensureRecorderSongLibraryForYear(academicYear) {
  if (!academicYear) return;
  const exists = db
    .prepare('SELECT 1 FROM recorder_song_library_year WHERE academic_year = ? LIMIT 1')
    .get(academicYear);
  if (exists) return;

  const previousYear = db
    .prepare(
      'SELECT MAX(academic_year) AS academic_year FROM recorder_song_library_year WHERE academic_year < ?'
    )
    .get(academicYear)?.academic_year;

  if (previousYear) {
    db.prepare(
      `
        INSERT INTO recorder_song_library_year (academic_year, slot_num, name, color_key, updated_at)
        SELECT ?, slot_num, name, color_key, CURRENT_TIMESTAMP
        FROM recorder_song_library_year
        WHERE academic_year = ?
      `
    ).run(academicYear, previousYear);
    return;
  }

  // First-ever use: seed 10 blank slots, one per default color, in order.
  const insert = db.prepare(
    `
      INSERT INTO recorder_song_library_year (academic_year, slot_num, name, color_key, updated_at)
      VALUES (?, ?, '', ?, CURRENT_TIMESTAMP)
    `
  );
  const seed = db.transaction(() => {
    DEFAULT_RECORDER_SONG_COLORS.forEach((colorKey, index) => {
      insert.run(academicYear, index + 1, colorKey);
    });
  });
  seed();
}

function getRecorderSongLibrary(academicYear) {
  if (!academicYear) return [];
  ensureRecorderSongLibraryForYear(academicYear);
  return db
    .prepare(
      `
      SELECT academic_year, slot_num, name, color_key, updated_at
      FROM recorder_song_library_year
      WHERE academic_year = ?
      ORDER BY slot_num ASC
    `
    )
    .all(academicYear);
}

function upsertRecorderSongLibraryItem(academicYear, slotNum, name, colorKey) {
  ensureRecorderSongLibraryForYear(academicYear);
  db.prepare(
    `
    INSERT INTO recorder_song_library_year (academic_year, slot_num, name, color_key, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(academic_year, slot_num)
    DO UPDATE SET name = excluded.name, color_key = excluded.color_key, updated_at = CURRENT_TIMESTAMP
  `
  ).run(academicYear, Number(slotNum), name || '', colorKey || null);
  return db
    .prepare(
      `
      SELECT academic_year, slot_num, name, color_key, updated_at
      FROM recorder_song_library_year
      WHERE academic_year = ? AND slot_num = ?
    `
    )
    .get(academicYear, Number(slotNum));
}

function deleteRecorderSongLibraryItem(academicYear, slotNum) {
  db.prepare('DELETE FROM recorder_song_library_year WHERE academic_year = ? AND slot_num = ?').run(
    academicYear,
    Number(slotNum)
  );
  db.prepare('DELETE FROM recorder_song_completions WHERE academic_year = ? AND slot_num = ?').run(
    academicYear,
    Number(slotNum)
  );
}

function getRecorderSongCompletions(studentIds, academicYear) {
  const validIds = Array.isArray(studentIds)
    ? studentIds
        .filter((id) => id !== null && id !== undefined)
        .map(Number)
        .filter(Number.isFinite)
    : [];
  if (validIds.length === 0 || !academicYear) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db
    .prepare(
      `SELECT student_id, slot_num, completed FROM recorder_song_completions
       WHERE student_id IN (${placeholders}) AND academic_year = ?
       ORDER BY student_id ASC, slot_num ASC`
    )
    .all(...validIds, academicYear);
}

function upsertRecorderSongCompletion(studentId, academicYear, slotNum, completed) {
  db.prepare(
    `
    INSERT INTO recorder_song_completions (student_id, academic_year, slot_num, completed, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, academic_year, slot_num)
    DO UPDATE SET completed = excluded.completed, updated_at = CURRENT_TIMESTAMP
  `
  ).run(Number(studentId), academicYear, Number(slotNum), completed ? 1 : 0);
}

module.exports = {
  init,
  getStudents,
  addStudent,
  updateStudent,
  deleteStudent,
  getDuplicateStudentGroups,
  getStudentMergePreview,
  mergeStudents,
  syncStudentsFromCsv,
  previewCsvSync,
  getSetting,
  setSetting,
  getAptitudeSettings,
  saveAptitudeSettings,
  getImmaScores,
  getImmaScoresForClass,
  upsertImmaScore,
  upsertMatsResult,
  getMatsResultsForClass,
  getMatsUnmatchedResults,
  deleteMatsResult,
  getAttendanceRecords,
  upsertAttendanceRecord,
  deleteAttendanceRecord,
  renameAttendanceDate,
  resetStudentData,
  resetFactoryData,
  getLsaUnitPlaceholders,
  upsertLsaUnitPlaceholder,
  getLsaUnitAssets,
  upsertLsaUnitAsset,
  getLsaLessons,
  addLsaLesson,
  deleteLsaLesson,
  setLsaLessonAudio,
  getLsaGradeUnitMap,
  upsertLsaGradeUnitMap,
  clearLsaGradeUnitSlot,
  getLsaCustomUnits,
  addLsaCustomUnit,
  getAssessmentLibrary,
  upsertAssessmentLibraryItem,
  exportAssessmentLibrary,
  importAssessmentLibrary,
  deleteAssessmentLibraryItem,
  getInstruments,
  addInstrument,
  updateInstrument,
  deleteInstrument,
  getClasses,
  addClass,
  updateClass,
  deleteClass,
  getSeatingCharts,
  getSeatingChart,
  createSeatingChart,
  updateSeatingChartName,
  saveSeatingChartLayout,
  deleteSeatingChart,
  clearStaleSeatingChartsForYear,
  reorderSeatingCharts,
  savePenNote,
  getPenNotesForStudents,
  addStudentNote,
  addFollowUpNote,
  getStudentNotes,
  updateStudentNote,
  deleteStudentNote,
  getAssessmentDates,
  setAssessmentDate,
  getAssessmentDatesForClass,
  setAssessmentDateForClass,
  getAssessmentRatings,
  upsertAssessmentRating,
  getLsaScores,
  upsertLsaScore,
  getPenNotesForStudentsYear,
  savePenNoteYear,
  getClassAssessmentRatings,
  getClassAssessmentDates,
  getLsaUnitLabelsHistory,
  snapshotLsaUnitLabels,
  getRecorderSongLibrary,
  upsertRecorderSongLibraryItem,
  deleteRecorderSongLibraryItem,
  getRecorderSongCompletions,
  upsertRecorderSongCompletion,
};
