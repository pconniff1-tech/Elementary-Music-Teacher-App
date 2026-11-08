// Run with Electron's Node runtime: ELECTRON_RUN_AS_NODE=1 electron scripts/test-mats-completion.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const phase = process.argv[2];
const dbPath = process.argv[3];

if (!phase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mats-completion-'));
  try {
    for (const testPhase of ['fresh', 'reopen', 'migration', 'renderer']) {
      const result = spawnSync(
        process.execPath,
        [__filename, testPhase, path.join(dir, 'test.db')],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          encoding: 'utf8',
        }
      );
      if (result.status !== 0) {
        throw new Error(`${testPhase} failed:\n${result.stdout}\n${result.stderr}`);
      }
      process.stdout.write(result.stdout);
    }
  } finally {
    for (const name of [
      'test.db',
      'test.db-wal',
      'test.db-shm',
      'test.db.legacy',
      'test.db.legacy-wal',
      'test.db.legacy-shm',
    ]) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  }
} else if (phase === 'renderer') {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'renderer.js'), 'utf8');
  const start = source.indexOf('async function renderImmaGrid()');
  const end = source.indexOf('// ── MATS Import Modal', start);
  assert.ok(start >= 0 && end > start);
  const canvas = { innerHTML: '', querySelectorAll: () => [] };
  const scores = {
    '2026-27': { tonal: 0, tonal_complete: 0, rhythm: 33, rhythm_complete: 1 },
    '2025-26': { tonal: 20, tonal_complete: 1, rhythm: 19, rhythm_complete: 0 },
  };
  const context = {
    immaGridCanvas: canvas,
    currentAcademicYear: '2026-27',
    immaTabYear: '2026-27',
    immaHistoryVisible: true,
    getStudentsInActiveScope: () => [{ id: 1, grade: 3 }],
    getDefaultAcademicYear: () => '2026-27',
    getImmaAvailableYears: () => ['2026-27', '2025-26'],
    getImmaScoreEntry: (id, year) => scores[year],
    getAptitudeClassName: () => '',
    getDisplayName: () => 'Test Student',
    escHtml: String,
    document: { getElementById: () => null },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  context
    .renderImmaGrid()
    .then(() => {
      assert.equal(
        (canvas.innerHTML.match(/class="imma-td-score[^"]*imma-unfinished/g) || []).length,
        2
      );
      assert.match(canvas.innerHTML, /aria-label="Tonal score, MATS test not finished"/);
      assert.match(
        canvas.innerHTML,
        /imma-history-score[^"]*imma-unfinished" title="MATS test not finished">\s*19/
      );
      assert.match(canvas.innerHTML, /Unfinished MATS test/);
      console.log('Renderer indicators: passed');
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
} else {
  const Database = require('better-sqlite3');
  const db = require('../db');
  if (phase === 'migration') {
    const old = new Database(':memory:');
    old.exec(`CREATE TABLE students (id INTEGER PRIMARY KEY);
      CREATE TABLE classes (id INTEGER PRIMARY KEY);
      CREATE TABLE seating_charts (class_key TEXT);
      CREATE TABLE lsa_unit_placeholders (class_key TEXT);
      CREATE TABLE lsa_unit_assets (class_key TEXT);
      CREATE TABLE lsa_unit_labels_history (class_key TEXT);
      CREATE TABLE assessment_dates_year (class_key TEXT);
      CREATE TABLE imma_scores (student_id INTEGER NOT NULL, academic_year TEXT NOT NULL,
        tonal INTEGER, rhythm INTEGER, updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (student_id, academic_year));
      INSERT INTO imma_scores (student_id, academic_year, tonal, rhythm) VALUES (9, '2025-26', 15, 20);
      PRAGMA user_version = 20;`);
    const legacyPath = `${dbPath}.legacy`;
    old
      .backup(legacyPath)
      .then(() => {
        old.close();
        db.init(legacyPath);
        const row = db.getImmaScores(9)[0];
        assert.equal(row.tonal, 15);
        assert.equal(row.rhythm, 20);
        assert.equal(row.tonal_complete, null);
        assert.equal(row.rhythm_complete, null);
        console.log('Version 20 migration: passed');
      })
      .catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  } else {
    db.init(dbPath);
    const result = (student, type, score, complete) => ({
      student_id: student,
      test_type: type,
      score,
      is_complete: complete,
    });
    const get = (student, year = '2026-27') =>
      db.getImmaScores(student).find((row) => row.academic_year === year);
    if (phase === 'fresh') {
      const inspector = new Database(dbPath);
      assert.equal(inspector.pragma('user_version', { simple: true }), 22);
      inspector.exec(
        "INSERT INTO students (id, first_name, last_name) VALUES (1, 'A', 'Test'), (2, 'A', 'Test')"
      );
      db.importMatsScores('2026-27', [
        result(1, 'tonal', 0, false),
        result(1, 'rhythm', 25, true),
        result(2, 'rhythm', 30, false),
        result(null, 'tonal', 10, false),
      ]);
      assert.deepEqual(
        [get(1).tonal, get(1).tonal_complete, get(1).rhythm, get(1).rhythm_complete],
        [0, 0, 25, 1]
      );
      db.importMatsScores('2026-27', [result(2, 'tonal', 22, false)]);
      assert.deepEqual([get(2).rhythm, get(2).rhythm_complete], [30, 0]);
      db.importMatsScores('2025-26', [result(1, 'tonal', 13, false)]);
      db.importMatsScores('2026-27', [result(1, 'tonal', 35, true)]);
      assert.equal(get(1).tonal_complete, 1);
      assert.equal(get(1, '2025-26').tonal_complete, 0);
      db.upsertImmaScore(2, '2026-27', 23, 30);
      assert.deepEqual([get(2).tonal_complete, get(2).rhythm_complete], [null, 0]);
      db.upsertImmaScore(2, '2026-27', 23, null);
      assert.equal(get(2).rhythm_complete, null);
      db.importMatsScores('2026-27', [result(2, 'rhythm', null, false)]);
      assert.equal(get(2).rhythm_complete, null);
      db.upsertMatsResult({
        firestore_doc_id: 'retake-test',
        student_id: 1,
        teacher_code: 'TEST',
        test_type: 'tonal',
        score: 35,
        is_complete: 1,
      });
      db.deleteMatsResult('retake-test');
      assert.deepEqual([get(1).tonal, get(1).tonal_complete], [35, 1]);
      db.importMatsScores('2026-27', [result(1, 'tonal', 10, false)]);
      assert.deepEqual([get(1).tonal, get(1).tonal_complete], [10, 0]);
      assert.throws(() =>
        db.importMatsScores('2026-27', [
          result(2, 'tonal', 19, false),
          result(2, 'rhythm', 99, false),
        ])
      );
      assert.equal(get(2).tonal, 23);
      const preview = db.getStudentMergePreview(1, 2);
      const conflict = preview.tableConflicts.find((row) => row.table === 'imma_scores');
      assert.ok(conflict);
      db.mergeStudents(1, 2, { tables: { imma_scores: { [conflict.key]: 'duplicate' } } });
      assert.equal(get(1).tonal, 23);
      assert.equal(get(1).tonal_complete, null);
      inspector.close();
      console.log('Fresh database, imports, edits, years, rollback and merge: passed');
    } else {
      assert.equal(get(1).tonal, 23);
      assert.equal(get(1, '2025-26').tonal_complete, 0);
      console.log('Persistence after restart: passed');
    }
  }
}
