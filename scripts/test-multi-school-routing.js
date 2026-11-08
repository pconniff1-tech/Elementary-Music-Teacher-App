// Run with ELECTRON_RUN_AS_NODE=1 using the Electron executable.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const phase = process.argv[2];
const dbPath = process.argv[3];
if (!phase) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-routing-'));
  try {
    for (const step of ['create', 'downgrade', 'migrate', 'routing', 'reopen', 'mats']) {
      const result = spawnSync(process.execPath, [__filename, step, path.join(dir, 'school.db')], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        encoding: 'utf8',
      });
      if (result.status !== 0)
        throw new Error(`${step} failed:\n${result.stdout}\n${result.stderr}`);
      process.stdout.write(result.stdout);
    }
  } finally {
    for (const name of ['school.db', 'school.db-wal', 'school.db-shm']) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    fs.rmdirSync(dir);
  }
} else if (phase === 'mats') {
  const vm = require('node:vm');
  const source = fs.readFileSync(path.join(__dirname, '..', 'mats-service.js'), 'utf8');
  const start = source.indexOf('function matchStudentId(');
  const end = source.indexOf('// ── Main export', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const students = [
    { id: 1, first_name: 'Alex', last_name: 'Test', email: 'alex@example.test' },
    { id: 2, first_name: 'Alex', last_name: 'Test', email: 'other@example.test' },
  ];
  assert.equal(context.matchStudentId(students, null, 'Alex Test'), null);
  assert.equal(context.matchStudentId(students, 'alex@example.test', 'Alex Test'), 1);
  students[1].email = students[0].email;
  assert.equal(context.matchStudentId(students, 'alex@example.test', 'Alex Test'), null);
  console.log('Ambiguous MATS matching: passed');
} else {
  const Database = require('better-sqlite3');
  const db = require('../db');
  if (phase === 'downgrade') {
    const raw = new Database(dbPath);
    raw.pragma('foreign_keys = OFF');
    raw.exec(`
      UPDATE seating_charts SET class_key = 'Smith||3';
      UPDATE lsa_unit_placeholders SET class_key = 'Smith||3';
      UPDATE lsa_unit_assets SET class_key = 'Smith||3' WHERE unit_number = 1;
      UPDATE lsa_unit_labels_history SET class_key = 'Smith||3';
      UPDATE assessment_dates_year SET class_key = 'Smith||3';
      ALTER TABLE students DROP COLUMN school_id;
      ALTER TABLE classes DROP COLUMN school_id;
      DROP TABLE schools;
      PRAGMA user_version = 21;
    `);
    raw.close();
  } else {
    db.init(dbPath);
    const raw = new Database(dbPath);
    if (phase === 'create') {
      assert.equal(raw.pragma('user_version', { simple: true }), 22);
      raw.exec(`
        INSERT INTO students (id, first_name, last_name, teacher, grade, student_number, school_id)
          VALUES (1, 'Alice', 'Test', 'Smith', '3', 'A', 1),
                 (2, 'Bob', 'Test', 'Smith', '4', 'B', 1),
                 (3, 'Inactive', 'Test', 'Jones', '1', 'C', 1);
        UPDATE students SET is_active = 0 WHERE id = 3;
        INSERT INTO imma_scores (student_id, academic_year, tonal) VALUES (1, '2026-27', 23);
        INSERT INTO seating_charts (name, class_key) VALUES ('Chart', 'school:1::Smith||3');
        INSERT INTO lsa_unit_placeholders (class_key, unit_number, x, y) VALUES ('school:1::Smith||3', 1, 0, 0);
        INSERT INTO lsa_unit_assets (class_key, unit_number) VALUES ('school:1::Smith||3', 1);
        INSERT INTO lsa_unit_assets (class_key, unit_number) VALUES ('', 2);
        INSERT INTO lsa_unit_labels_history (class_key, academic_year, unit_number) VALUES ('school:1::Smith||3', '2026-27', 1);
        INSERT INTO assessment_dates_year (class_key, academic_year, assess_num, assessed_date) VALUES ('school:1::Smith||3', '2026-27', 1, '2026-09-01');
      `);
      console.log('Fresh schema: passed');
    } else if (phase === 'migrate') {
      assert.equal(raw.pragma('user_version', { simple: true }), 22);
      assert.deepEqual(
        db.getStudents().map((s) => s.school_id),
        [1, 1, 1]
      );
      for (const table of [
        'seating_charts',
        'lsa_unit_placeholders',
        'lsa_unit_assets',
        'lsa_unit_labels_history',
        'assessment_dates_year',
      ]) {
        assert.equal(
          raw.prepare(`SELECT class_key FROM ${table} WHERE class_key != 'school:1::__ALL__'`).get()
            .class_key,
          'school:1::Smith||3'
        );
      }
      assert.equal(
        raw.prepare('SELECT class_key FROM lsa_unit_assets WHERE unit_number = 2').get().class_key,
        'school:1::__ALL__'
      );
      assert.equal(db.getImmaScores(1)[0].tonal, 23);
      console.log('Legacy migration and history: passed');
    } else if (phase === 'routing') {
      const school = db.addSchool('Second School');
      db.renameSchool(school.id, ' Renamed School ');
      assert.equal(db.getSchools().find((entry) => entry.id === school.id).name, 'Renamed School');
      assert.throws(() => db.renameSchool(school.id, ' '), /School name is required/);
      const emptySchool = db.addSchool('Empty School');
      db.deleteSchool(emptySchool.id);
      const cls = db.addClass({ name: 'Separate class', school_id: school.id });
      assert.equal(db.getClasses().find((entry) => entry.id === cls.id).school_id, school.id);
      db.deleteClass(cls.id);
      db.createSeatingChart({
        name: 'Other school chart',
        classKey: `school:${school.id}::Smith||3`,
      });
      assert.equal(db.getSeatingCharts('school:1::Smith||3').length, 1);
      assert.equal(db.getSeatingCharts(`school:${school.id}::Smith||3`).length, 1);
      const chartId = db.getSeatingCharts('school:1::Smith||3')[0].id;
      raw
        .prepare(
          'INSERT INTO seating_chart_items (chart_id, student_id, placed, x, y) VALUES (?, 2, 1, 25, 30)'
        )
        .run(chartId);
      db.saveSeatingChartLayout({
        chartId,
        classKey: 'school:1::Smith||3',
        items: [{ student_id: 1, placed: true, x: 5, y: 10 }],
      });
      assert.equal(
        raw
          .prepare('SELECT x FROM seating_chart_items WHERE chart_id = ? AND student_id = 2')
          .get(chartId).x,
        25
      );
      raw
        .prepare(
          'INSERT INTO students (id, first_name, last_name, teacher, grade, student_number, school_id) VALUES (4, ?, ?, ?, ?, ?, ?)'
        )
        .run('Other', 'Test', 'Smith', '3', 'D', school.id);
      const partialStudent = db.getStudents().find((s) => s.id === 4);
      delete partialStudent.school_id;
      delete partialStudent.is_active;
      db.updateStudent(partialStudent);
      assert.equal(db.getStudents().find((s) => s.id === 4).school_id, school.id);
      db.syncStudentsFromCsv(
        [
          {
            first_name: 'Alice',
            last_name: 'Test',
            teacher: 'Smith',
            grade: '3',
            student_number: 'A',
          },
        ],
        '2026-27',
        true,
        {},
        1
      );
      assert.equal(db.getStudents().find((s) => s.id === 4).is_active, 1);
      assert.equal(db.archiveTeacher(1, 'Smith'), 2);
      assert.equal(db.getStudents().find((s) => s.id === 1).school_id, null);
      assert.equal(db.getStudents().find((s) => s.id === 4).school_id, school.id);
      const row = {
        first_name: 'Alice',
        last_name: 'Test',
        teacher: 'Green',
        grade: '4',
        student_number: 'A',
      };
      assert.throws(() => db.syncStudentsFromCsv([row, row], '2026-27', true, {}, school.id));
      db.syncStudentsFromCsv([row], '2026-27', true, {}, school.id);
      assert.equal(db.getStudents().find((s) => s.id === 1).school_id, school.id);
      assert.equal(db.getImmaScores(1)[0].tonal, 23);
      const cross = db.previewCsvSync([row], 1);
      assert.equal(cross[0].matchType, 'cross_school');
      assert.throws(() => db.syncStudentsFromCsv([row], '2026-27', true, {}, 1));
      db.syncStudentsFromCsv([row], '2026-27', true, { 0: 1 }, 1);
      assert.equal(db.getStudents().find((s) => s.id === 1).school_id, 1);
      db.updateSchoolStatus(school.id, false);
      assert.equal(db.getStudents().find((s) => s.id === 4).school_id, null);
      assert.equal(db.getStudents().find((s) => s.id === 1).school_id, 1);
      db.updateSchoolStatus(school.id, true);
      assert.equal(db.getStudents().find((s) => s.id === 4).school_id, null);
      assert.throws(() => db.deleteSchool(school.id));
      assert.throws(() => db.deleteSchool(1));
      db.clearStaleSeatingChartsForYear('2026-27', 1);
      assert.equal(db.getSeatingCharts('school:1::Smith||3').length, 0);
      assert.equal(db.getSeatingCharts(`school:${school.id}::Smith||3`).length, 1);
      assert.equal(db.getImmaScores(1)[0].tonal, 23);
      console.log('School-scoped CSV, archives and cross-school matching: passed');
    } else {
      assert.equal(db.getSchools().length, 2);
      assert.ok(db.getSchools().some((school) => school.name === 'Renamed School'));
      assert.equal(db.getStudents().find((s) => s.id === 1).school_id, 1);
      assert.equal(db.getImmaScores(1)[0].tonal, 23);
      console.log('Persistence: passed');
    }
    raw.close();
  }
}
