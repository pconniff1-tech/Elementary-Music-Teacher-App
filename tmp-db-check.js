const Database = require('better-sqlite3');
try {
  const dbPath = process.env.APPDATA + '\\elementary-music-management-app\\music-management.db';
  const db = new Database(dbPath);
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all();
  const count = db.prepare('select count(*) as c from students').get().c;
  const rows = db
    .prepare('select id, first_name, last_name from students order by id desc limit 10')
    .all();
  console.log('DB_PATH=' + dbPath);
  console.log('TABLES=' + JSON.stringify(tables));
  console.log('STUDENTS=' + count);
  console.log('ROWS=' + JSON.stringify(rows));
} catch (e) {
  console.error('ERR=' + e.message);
  process.exitCode = 1;
}
