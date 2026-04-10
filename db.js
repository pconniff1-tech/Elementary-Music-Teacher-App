const Database = require('better-sqlite3');
let db;

function init(dbPath) {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  createTables();
}

function createTables() {
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
      is_active INTEGER NOT NULL DEFAULT 1
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
      assessment_rating INTEGER,
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
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (class_key, unit_number)
    );

    CREATE TABLE IF NOT EXISTS lsa_lessons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      image_url TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
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

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS imma_scores (
      student_id INTEGER NOT NULL,
      academic_year TEXT NOT NULL,
      tonal INTEGER,
      rhythm INTEGER,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_id, academic_year)
    );
  `);

  ensureStudentColumns();
  ensureSeatingChartColumns();
  ensureLsaUnitAssetColumns();
  ensureLsaLessonColumns();
  ensureSettingsAndImma();
}

function ensureStudentColumns() {
  const studentColumns = db.prepare('PRAGMA table_info(students)').all();
  const hasEmail = studentColumns.some(column => column.name === 'email');

  if (!hasEmail) {
    db.exec('ALTER TABLE students ADD COLUMN email TEXT');
  }
  const hasLsaEasy = studentColumns.some(column => column.name === 'lsa_easy');
  if (!hasLsaEasy) {
    db.exec('ALTER TABLE students ADD COLUMN lsa_easy TEXT');
  }
  const hasLsaMedium = studentColumns.some(column => column.name === 'lsa_medium');
  if (!hasLsaMedium) {
    db.exec('ALTER TABLE students ADD COLUMN lsa_medium TEXT');
  }
  const hasLsaDifficult = studentColumns.some(column => column.name === 'lsa_difficult');
  if (!hasLsaDifficult) {
    db.exec('ALTER TABLE students ADD COLUMN lsa_difficult TEXT');
  }
  const hasGoodNewsShared = studentColumns.some(column => column.name === 'good_news_shared');
  if (!hasGoodNewsShared) {
    db.exec('ALTER TABLE students ADD COLUMN good_news_shared INTEGER NOT NULL DEFAULT 0');
  }
  const hasRecorderColor = studentColumns.some(column => column.name === 'recorder_color');
  if (!hasRecorderColor) {
    db.exec('ALTER TABLE students ADD COLUMN recorder_color TEXT');
  }
  const hasLsaUnits = studentColumns.some(column => column.name === 'lsa_units');
  if (!hasLsaUnits) {
    db.exec('ALTER TABLE students ADD COLUMN lsa_units TEXT');
  }
  const hasIsActive = studentColumns.some(column => column.name === 'is_active');
  if (!hasIsActive) {
    db.exec('ALTER TABLE students ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1');
  }
  const hasStudentNumber = studentColumns.some(column => column.name === 'student_number');
  if (!hasStudentNumber) {
    db.exec('ALTER TABLE students ADD COLUMN student_number TEXT');
  }
  const hasColorDot = studentColumns.some(column => column.name === 'color_dot');
  if (!hasColorDot) {
    db.exec('ALTER TABLE students ADD COLUMN color_dot TEXT');
  }
  const hasImmaT = studentColumns.some(column => column.name === 'imma_t');
  if (!hasImmaT) {
    db.exec('ALTER TABLE students ADD COLUMN imma_t REAL');
  }
  const hasImmaR = studentColumns.some(column => column.name === 'imma_r');
  if (!hasImmaR) {
    db.exec('ALTER TABLE students ADD COLUMN imma_r REAL');
  }
}

function ensureSeatingChartColumns() {
  const seatingChartColumns = db.prepare('PRAGMA table_info(seating_charts)').all();
  const hasClassKey = seatingChartColumns.some(column => column.name === 'class_key');
  if (!hasClassKey) {
    db.exec("ALTER TABLE seating_charts ADD COLUMN class_key TEXT NOT NULL DEFAULT ''");
  }
  const hasArrangement = seatingChartColumns.some(column => column.name === 'arrangement');
  if (!hasArrangement) {
    db.exec("ALTER TABLE seating_charts ADD COLUMN arrangement TEXT NOT NULL DEFAULT ''");
  }

  const chartItemColumns = db.prepare('PRAGMA table_info(seating_chart_items)').all();
  const hasAssessmentRating = chartItemColumns.some(column => column.name === 'assessment_rating');
  if (!hasAssessmentRating) {
    db.exec('ALTER TABLE seating_chart_items ADD COLUMN assessment_rating INTEGER');
  }
}

function ensureLsaUnitAssetColumns() {
  const lsaAssetColumns = db.prepare('PRAGMA table_info(lsa_unit_assets)').all();
  const hasHelperLabel = lsaAssetColumns.some(column => column.name === 'helper_label');
  if (!hasHelperLabel) {
    db.exec('ALTER TABLE lsa_unit_assets ADD COLUMN helper_label TEXT');
  }
  const hasAudioUrl = lsaAssetColumns.some(column => column.name === 'audio_url');
  if (!hasAudioUrl) {
    db.exec('ALTER TABLE lsa_unit_assets ADD COLUMN audio_url TEXT');
  }
}

function ensureLsaLessonColumns() {
  const cols = db.prepare('PRAGMA table_info(lsa_lessons)').all();
  const hasAudioUrl = cols.some(column => column.name === 'audio_url');
  if (!hasAudioUrl) {
    db.exec('ALTER TABLE lsa_lessons ADD COLUMN audio_url TEXT');
  }
}

function ensureSettingsAndImma() {
  // settings table created in createTables; no migration needed
  // imma_scores table created in createTables; no migration needed
  // Ensure student_number exists (handled in ensureStudentColumns)
}

// --- Settings ---
function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
  return { key, value: String(value) };
}

// --- IMMA Scores ---
function getImmaScores(studentId) {
  return db.prepare(`
    SELECT student_id, academic_year, tonal, rhythm, updated_at
    FROM imma_scores
    WHERE student_id = ?
    ORDER BY academic_year DESC
  `).all(Number(studentId));
}

function getImmaScoresForClass(studentIds) {
  const validIds = Array.isArray(studentIds)
    ? studentIds.filter(id => id !== null && id !== undefined).map(id => Number(id)).filter(Number.isFinite)
    : [];
  if (validIds.length === 0) return [];
  const placeholders = validIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT student_id, academic_year, tonal, rhythm, updated_at
    FROM imma_scores
    WHERE student_id IN (${placeholders})
    ORDER BY student_id ASC, academic_year DESC
  `).all(...validIds);
}

function upsertImmaScore(studentId, academicYear, tonal, rhythm) {
  const t = (tonal !== null && tonal !== undefined && tonal !== '') ? Math.min(40, Math.max(0, Math.round(Number(tonal)))) : null;
  const r = (rhythm !== null && rhythm !== undefined && rhythm !== '') ? Math.min(40, Math.max(0, Math.round(Number(rhythm)))) : null;
  db.prepare(`
    INSERT INTO imma_scores (student_id, academic_year, tonal, rhythm, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, academic_year)
    DO UPDATE SET tonal = excluded.tonal, rhythm = excluded.rhythm, updated_at = CURRENT_TIMESTAMP
  `).run(Number(studentId), academicYear, t, r);
  return db.prepare('SELECT student_id, academic_year, tonal, rhythm, updated_at FROM imma_scores WHERE student_id = ? AND academic_year = ?')
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

function updateStudent(student) {
  db.prepare(
    'UPDATE students SET first_name=?, last_name=?, email=?, grade=?, teacher=?, notes=?, lsa_easy=?, lsa_medium=?, lsa_difficult=?, lsa_units=?, recorder_color=?, good_news_shared=?, is_active=?, student_number=?, color_dot=? WHERE id=?'
  ).run(student.first_name, student.last_name, student.email || null, student.grade, student.teacher, student.notes, student.lsa_easy || null, student.lsa_medium || null, student.lsa_difficult || null, student.lsa_units || null, student.recorder_color || null, student.good_news_shared ? 1 : 0, student.is_active === 0 ? 0 : 1, student.student_number || null, student.color_dot || null, student.id);
  return student;
}

function deleteStudent(id) {
  db.prepare('DELETE FROM students WHERE id=?').run(id);
  db.prepare('DELETE FROM seating_chart_items WHERE student_id=?').run(id);
  db.prepare('DELETE FROM attendance_records WHERE student_id=?').run(id);
  db.prepare('DELETE FROM imma_scores WHERE student_id=?').run(id);
  return { id };
}

// --- Attendance Records ---
function getAttendanceRecords(studentIds = []) {
  const validIds = Array.isArray(studentIds)
    ? studentIds.filter(id => id !== null && id !== undefined).map(id => Number(id)).filter(Number.isFinite)
    : [];

  if (validIds.length === 0) {
    return [];
  }

  const placeholders = validIds.map(() => '?').join(',');
  return db.prepare(`
    SELECT student_id, attendance_date, status, updated_at
    FROM attendance_records
    WHERE student_id IN (${placeholders})
    ORDER BY attendance_date ASC, student_id ASC
  `).all(...validIds);
}

function upsertAttendanceRecord(studentId, attendanceDate, status) {
  db.prepare(`
    INSERT INTO attendance_records (student_id, attendance_date, status, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(student_id, attendance_date)
    DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP
  `).run(Number(studentId), attendanceDate, status);

  return db.prepare(`
    SELECT student_id, attendance_date, status, updated_at
    FROM attendance_records
    WHERE student_id=? AND attendance_date=?
  `).get(Number(studentId), attendanceDate);
}

function deleteAttendanceRecord(studentId, attendanceDate) {
  db.prepare('DELETE FROM attendance_records WHERE student_id=? AND attendance_date=?').run(Number(studentId), attendanceDate);
  return { student_id: Number(studentId), attendance_date: attendanceDate };
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
    db.prepare("DELETE FROM sqlite_sequence WHERE name IN ('students','classes','instruments','seating_charts')").run();
  });

  transaction();
  return { ok: true };
}

// --- LSA Unit Placeholder Positions ---
function getLsaUnitPlaceholders(classKey = '') {
  return db.prepare(`
    SELECT class_key, unit_number, x, y, updated_at
    FROM lsa_unit_placeholders
    WHERE class_key = ?
    ORDER BY unit_number ASC
  `).all(classKey);
}

function upsertLsaUnitPlaceholder(classKey = '', unitNumber, x, y) {
  db.prepare(`
    INSERT INTO lsa_unit_placeholders (class_key, unit_number, x, y, updated_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_key, unit_number)
    DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = CURRENT_TIMESTAMP
  `).run(classKey, Number(unitNumber), Number(x), Number(y));

  return db.prepare(`
    SELECT class_key, unit_number, x, y, updated_at
    FROM lsa_unit_placeholders
    WHERE class_key = ? AND unit_number = ?
  `).get(classKey, Number(unitNumber));
}

function getLsaUnitAssets(classKey = '') {
  return db.prepare(`
    SELECT class_key, unit_number, image_url, helper_label, audio_url, updated_at
    FROM lsa_unit_assets
    WHERE class_key = ?
    ORDER BY unit_number ASC
  `).all(classKey);
}

function upsertLsaUnitAsset(classKey = '', unitNumber, imageUrl, helperLabel, audioUrl) {
  const normalizedUnit = Number(unitNumber);
  const existing = db.prepare(`
    SELECT image_url, helper_label, audio_url
    FROM lsa_unit_assets
    WHERE class_key = ? AND unit_number = ?
  `).get(classKey, normalizedUnit);

  const resolvedImageUrl = imageUrl === undefined
    ? (existing?.image_url ?? null)
    : (imageUrl || null);

  const resolvedHelperLabel = helperLabel === undefined
    ? (existing?.helper_label ?? null)
    : (String(helperLabel || '').trim() || null);

  const resolvedAudioUrl = audioUrl === undefined
    ? (existing?.audio_url ?? null)
    : (audioUrl || null);

  db.prepare(`
    INSERT INTO lsa_unit_assets (class_key, unit_number, image_url, helper_label, audio_url, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(class_key, unit_number)
    DO UPDATE SET image_url = excluded.image_url, helper_label = excluded.helper_label, audio_url = excluded.audio_url, updated_at = CURRENT_TIMESTAMP
  `).run(classKey, normalizedUnit, resolvedImageUrl, resolvedHelperLabel, resolvedAudioUrl);

  return db.prepare(`
    SELECT class_key, unit_number, image_url, helper_label, audio_url, updated_at
    FROM lsa_unit_assets
    WHERE class_key = ? AND unit_number = ?
  `).get(classKey, normalizedUnit);
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
  const result = db.prepare(
    'INSERT INTO lsa_lessons (file_name, image_url) VALUES (?, ?)'
  ).run(fileName, imageUrl);
  return db.prepare('SELECT * FROM lsa_lessons WHERE id = ?').get(result.lastInsertRowid);
}

function deleteLsaLesson(id) {
  db.prepare('UPDATE lsa_grade_unit_map SET lesson_id = NULL WHERE lesson_id = ?').run(Number(id));
  db.prepare('DELETE FROM lsa_lessons WHERE id = ?').run(Number(id));
  return { id: Number(id) };
}

// --- LSA Grade Unit Map ---
function getLsaGradeUnitMap(gradeLevel) {
  return db.prepare(`
    SELECT m.grade_level, m.unit_number, m.lesson_id, m.updated_at,
           l.file_name, l.image_url, l.audio_url
    FROM lsa_grade_unit_map m
    LEFT JOIN lsa_lessons l ON l.id = m.lesson_id
    WHERE m.grade_level = ?
    ORDER BY m.unit_number ASC
  `).all(gradeLevel);
}

function upsertLsaGradeUnitMap(gradeLevel, unitNumber, lessonId) {
  const normalizedUnit = Number(unitNumber);
  const resolvedLessonId = (lessonId !== null && lessonId !== undefined && lessonId !== '')
    ? Number(lessonId)
    : null;

  db.prepare(`
    INSERT INTO lsa_grade_unit_map (grade_level, unit_number, lesson_id, updated_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(grade_level, unit_number)
    DO UPDATE SET lesson_id = excluded.lesson_id, updated_at = CURRENT_TIMESTAMP
  `).run(gradeLevel, normalizedUnit, resolvedLessonId);

  return db.prepare(`
    SELECT m.grade_level, m.unit_number, m.lesson_id, m.updated_at,
           l.file_name, l.image_url
    FROM lsa_grade_unit_map m
    LEFT JOIN lsa_lessons l ON l.id = m.lesson_id
    WHERE m.grade_level = ? AND m.unit_number = ?
  `).get(gradeLevel, normalizedUnit);
}

function clearLsaGradeUnitSlot(gradeLevel, unitNumber) {
  db.prepare('DELETE FROM lsa_grade_unit_map WHERE grade_level = ? AND unit_number = ?')
    .run(gradeLevel, Number(unitNumber));
  return { grade_level: gradeLevel, unit_number: Number(unitNumber) };
}

// --- LSA Custom Units ---
function getLsaCustomUnits() {
  return db.prepare('SELECT unit_number FROM lsa_custom_units ORDER BY unit_number ASC').all()
    .map(r => r.unit_number);
}

function addLsaCustomUnit(unitNumber) {
  const n = Number(unitNumber);
  db.prepare('INSERT OR IGNORE INTO lsa_custom_units (unit_number) VALUES (?)').run(n);
  return { unit_number: n };
}

// --- Seating Charts ---
function getSeatingCharts(classKey = '') {
  return db.prepare(`
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
    ORDER BY c.id ASC
  `).all(classKey);
}

function getSeatingChart(chartId, classKey = '') {
  const chart = db.prepare('SELECT * FROM seating_charts WHERE id=? AND class_key=?').get(chartId, classKey);
  if (!chart) {
    return null;
  }

  const items = db.prepare(`
    SELECT chart_id, student_id, placed, x, y, state, attendance, assessment_rating
    FROM seating_chart_items
    WHERE chart_id=?
    ORDER BY student_id ASC
  `).all(chartId);

  return { ...chart, items };
}

function createSeatingChart(payload) {
  const insertChart = db.prepare('INSERT INTO seating_charts (name, class_key, arrangement, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)');
  const insertItem = db.prepare(`
    INSERT INTO seating_chart_items (chart_id, student_id, placed, x, y, state, attendance, assessment_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(({ name, classKey = '', arrangement = '', items = [] }) => {
    const result = insertChart.run(name, classKey, arrangement);
    const chartId = result.lastInsertRowid;

    items.forEach(item => {
      insertItem.run(
        chartId,
        item.student_id,
        item.placed ? 1 : 0,
        item.x ?? null,
        item.y ?? null,
        item.state || null,
        item.attendance || null,
        item.assessment_rating ?? null
      );
    });

    return getSeatingChart(chartId, classKey);
  });

  return transaction(payload);
}

function updateSeatingChartName(chartId, name, classKey = '') {
  db.prepare('UPDATE seating_charts SET name=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?').run(name, chartId, classKey);
  return getSeatingChart(chartId, classKey);
}

function saveSeatingChartLayout(payload) {
  const deleteItems = db.prepare('DELETE FROM seating_chart_items WHERE chart_id=?');
  const insertItem = db.prepare(`
    INSERT INTO seating_chart_items (chart_id, student_id, placed, x, y, state, attendance, assessment_rating)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(({ chartId, classKey = '', arrangement, items = [] }) => {
    deleteItems.run(chartId);
    items.forEach(item => {
      insertItem.run(
        chartId,
        item.student_id,
        item.placed ? 1 : 0,
        item.x ?? null,
        item.y ?? null,
        item.state || null,
        item.attendance || null,
        item.assessment_rating ?? null
      );
    });
    if (arrangement !== undefined) {
      db.prepare('UPDATE seating_charts SET arrangement=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?').run(arrangement, chartId, classKey);
    } else {
      db.prepare('UPDATE seating_charts SET updated_at=CURRENT_TIMESTAMP WHERE id=? AND class_key=?').run(chartId, classKey);
    }
    return getSeatingChart(chartId, classKey);
  });

  return transaction(payload);
}

function deleteSeatingChart(chartId, classKey = '') {
  const chart = db.prepare('SELECT id FROM seating_charts WHERE id=? AND class_key=?').get(chartId, classKey);
  if (!chart) {
    return { id: chartId };
  }
  db.prepare('DELETE FROM seating_chart_items WHERE chart_id=?').run(chartId);
  db.prepare('DELETE FROM seating_charts WHERE id=? AND class_key=?').run(chartId, classKey);
  return { id: chartId };
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
  ).run(instrument.name, instrument.type, instrument.quantity, instrument.condition, instrument.notes, instrument.id);
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
  db.prepare(
    'UPDATE classes SET name=?, grade=?, teacher=?, schedule=?, notes=? WHERE id=?'
  ).run(cls.name, cls.grade, cls.teacher, cls.schedule, cls.notes, cls.id);
  return cls;
}

function deleteClass(id) {
  db.prepare('DELETE FROM classes WHERE id=?').run(id);
  return { id };
}

// --- Bulk sync (CSV import) ---
// Returns { updated, created, reactivated, deactivated }
function syncStudentsFromCsv(csvStudents, academicYear) {
  const allDbStudents = db.prepare('SELECT * FROM students').all();

  // Index DB students for fast lookup
  const byNumber = new Map();
  const byEmail  = new Map();
  const byName   = new Map();
  allDbStudents.forEach(s => {
    if (s.student_number) byNumber.set(s.student_number.trim(), s);
    if (s.email)          byEmail.set(s.email.trim().toLowerCase(), s);
    const nameKey = `${(s.first_name||'').trim().toLowerCase()}|${(s.last_name||'').trim().toLowerCase()}`;
    if (!byName.has(nameKey)) byName.set(nameKey, s);
  });

  // Determine scope: which teacher+grade combos appear in CSV
  const scopedClassKeys = new Set();
  csvStudents.forEach(r => {
    const teacher = (r.teacher || '').trim();
    const grade   = (r.grade || '').trim();
    if (teacher || grade) scopedClassKeys.add(`${teacher}|${grade}`);
  });

  // IDs of students in the CSV scope in DB (will be deactivated if not in CSV)
  const scopedDbIds = new Set();
  allDbStudents.forEach(s => {
    const teacher = (s.teacher || '').trim();
    const grade   = (s.grade || '').trim();
    if (scopedClassKeys.has(`${teacher}|${grade}`)) scopedDbIds.add(s.id);
  });

  const updatedIds   = new Set();
  let created = 0;
  let updated = 0;
  let reactivated = 0;

  const updateStmt = db.prepare(
    'UPDATE students SET first_name=?, last_name=?, email=?, grade=?, teacher=?, student_number=?, is_active=1, good_news_shared=? WHERE id=?'
  );
  const insertStmt = db.prepare(
    'INSERT INTO students (first_name, last_name, email, grade, teacher, student_number, good_news_shared, is_active) VALUES (?, ?, ?, ?, ?, ?, 0, 1)'
  );

  const transaction = db.transaction(() => {
    csvStudents.forEach(r => {
      const num   = (r.student_number || '').trim();
      const email = (r.email || '').trim().toLowerCase();
      const nameKey = `${(r.first_name||'').trim().toLowerCase()}|${(r.last_name||'').trim().toLowerCase()}`;

      let match = null;
      if (num)   match = byNumber.get(num)  || null;
      if (!match && email) match = byEmail.get(email) || null;
      if (!match) match = byName.get(nameKey) || null;

      const isNewYear = academicYear && match;
      const goodNewsReset = isNewYear ? 0 : (match ? match.good_news_shared : 0);

      if (match) {
        const wasInactive = match.is_active === 0;
        updateStmt.run(
          r.first_name || match.first_name,
          r.last_name  || match.last_name,
          r.email      || match.email || null,
          r.grade      || match.grade || null,
          r.teacher    || match.teacher || null,
          num          || match.student_number || null,
          goodNewsReset,
          match.id
        );
        // Update lookup maps with new data
        if (num) byNumber.set(num, { ...match, id: match.id });
        if (email) byEmail.set(email, { ...match, id: match.id });
        if (wasInactive) reactivated++; else updated++;
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

    // Deactivate scoped students not matched
    let deactivated = 0;
    scopedDbIds.forEach(id => {
      if (!updatedIds.has(id)) {
        db.prepare('UPDATE students SET is_active=0 WHERE id=?').run(id);
        deactivated++;
      }
    });

    return { updated, created, reactivated, deactivated };
  });

  return transaction();
}

// --- Assessment Library ---
function getAssessmentLibrary(gradeLevel) {
  return db.prepare(`
    SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at
    FROM assessment_library
    WHERE grade_level = ?
    ORDER BY assess_num ASC
  `).all(gradeLevel);
}

function upsertAssessmentLibraryItem(gradeLevel, assessNum, name, scale1, scale2, scale3, scale4) {
  db.prepare(`
    INSERT INTO assessment_library (grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(grade_level, assess_num)
    DO UPDATE SET name = excluded.name, scale1 = excluded.scale1, scale2 = excluded.scale2,
      scale3 = excluded.scale3, scale4 = excluded.scale4, updated_at = CURRENT_TIMESTAMP
  `).run(gradeLevel, Number(assessNum), name || null, scale1 || null, scale2 || null, scale3 || null, scale4 || null);
  return db.prepare(`
    SELECT grade_level, assess_num, name, scale1, scale2, scale3, scale4, updated_at
    FROM assessment_library
    WHERE grade_level = ? AND assess_num = ?
  `).get(gradeLevel, Number(assessNum));
}

module.exports = {
  init,
  getStudents, addStudent, updateStudent, deleteStudent,
  syncStudentsFromCsv,
  getSetting, setSetting,
  getImmaScores, getImmaScoresForClass, upsertImmaScore,
  getAttendanceRecords, upsertAttendanceRecord, deleteAttendanceRecord,
  resetStudentData, resetFactoryData,
  getLsaUnitPlaceholders, upsertLsaUnitPlaceholder,
  getLsaUnitAssets, upsertLsaUnitAsset,
  getLsaLessons, addLsaLesson, deleteLsaLesson, setLsaLessonAudio,
  getLsaGradeUnitMap, upsertLsaGradeUnitMap, clearLsaGradeUnitSlot,
  getLsaCustomUnits, addLsaCustomUnit,
  getAssessmentLibrary, upsertAssessmentLibraryItem,
  getInstruments, addInstrument, updateInstrument, deleteInstrument,
  getClasses, addClass, updateClass, deleteClass,
  getSeatingCharts, getSeatingChart, createSeatingChart, updateSeatingChartName, saveSeatingChartLayout, deleteSeatingChart,
};
