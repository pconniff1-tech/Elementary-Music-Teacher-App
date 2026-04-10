const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const db = require('./db');

// --- Auto-updater (disabled during dev, active in packaged builds) ---
let autoUpdater = null;
let mainWindowRef = null;
if (app.isPackaged) {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  const secrets = app.isPackaged
    ? require(require('path').join(process.resourcesPath, 'secrets.js'))
    : require('./secrets');
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'pconniff1-tech',
    repo: 'Elementary-Music-Teacher-App',
    token: secrets.GH_TOKEN
  });
  autoUpdater.on('update-available', (info) => {
    mainWindowRef?.webContents.send('update-available', info.version);
  });
  autoUpdater.on('update-not-available', () => {
    mainWindowRef?.webContents.send('update-not-available');
  });
  autoUpdater.on('download-progress', (progress) => {
    mainWindowRef?.webContents.send('update-download-progress', Math.round(progress.percent));
  });
  autoUpdater.on('update-downloaded', () => {
    mainWindowRef?.webContents.send('update-downloaded');
  });
  autoUpdater.on('error', (err) => {
    mainWindowRef?.webContents.send('update-error', err.message);
  });
}

ipcMain.handle('updater.check', () => {
  if (autoUpdater) autoUpdater.checkForUpdates();
  else mainWindowRef?.webContents.send('update-not-available');
});
ipcMain.handle('updater.download', () => { autoUpdater?.downloadUpdate(); });
ipcMain.handle('updater.install', () => { autoUpdater?.quitAndInstall(); });
// --- End auto-updater ---

const appDataRoot = app.getPath('appData');
const fixedUserDataPath = path.join(appDataRoot, 'elementary-music-management-app');
app.setName('elementary-music-management-app');
app.setPath('userData', fixedUserDataPath);

function createWindow() {
  const workArea = screen.getPrimaryDisplay().workArea;
  const margin = 16;
  const width = Math.max(760, Math.min(1100, workArea.width - margin * 2));
  const height = Math.max(560, Math.min(800, workArea.height - margin * 2));
  const x = workArea.x + Math.max(margin, Math.floor((workArea.width - width) / 2));
  const y = workArea.y + Math.max(margin, Math.floor((workArea.height - height) / 2));

  const mainWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      enableRemoteModule: false,
    },
  });

  mainWindow.maximize();

  mainWindowRef = mainWindow;
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  // mainWindow.webContents.openDevTools();
}

app.whenReady().then(() => {
  const dbPath = path.join(app.getPath('userData'), 'music-management.db');
  db.init(dbPath);
  try {
    const studentCount = db.getStudents().length;
    console.log(`[startup] userData path: ${app.getPath('userData')}`);
    console.log(`[startup] db path: ${dbPath}`);
    console.log(`[startup] students loaded: ${studentCount}`);
  } catch (error) {
    console.error('[startup] failed to read students count:', error.message);
  }
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

function sanitizeFileSegment(value, fallback = 'unit') {
  const safe = String(value || '').replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return safe || fallback;
}

// --- Student IPC handlers ---
ipcMain.handle('db.getStudents', async () => db.getStudents());
ipcMain.handle('db.addStudent', async (event, student) => db.addStudent(student));
ipcMain.handle('db.updateStudent', async (event, student) => db.updateStudent(student));
ipcMain.handle('db.deleteStudent', async (event, id) => db.deleteStudent(id));
ipcMain.handle('db.getAttendanceRecords', async (event, studentIds) => db.getAttendanceRecords(studentIds));
ipcMain.handle('db.upsertAttendanceRecord', async (event, studentId, attendanceDate, status) => db.upsertAttendanceRecord(studentId, attendanceDate, status));
ipcMain.handle('db.deleteAttendanceRecord', async (event, studentId, attendanceDate) => db.deleteAttendanceRecord(studentId, attendanceDate));
ipcMain.handle('db.resetStudentData', async () => db.resetStudentData());
ipcMain.handle('db.resetFactoryData', async () => db.resetFactoryData());
ipcMain.handle('db.getLsaUnitPlaceholders', async (event, classKey = '') => db.getLsaUnitPlaceholders(classKey));
ipcMain.handle('db.upsertLsaUnitPlaceholder', async (event, classKey = '', unitNumber, x, y) => db.upsertLsaUnitPlaceholder(classKey, unitNumber, x, y));
ipcMain.handle('db.getLsaUnitAssets', async (event, classKey = '') => db.getLsaUnitAssets(classKey));
ipcMain.handle('db.upsertLsaUnitAsset', async (event, classKey = '', unitNumber, imageUrl, helperLabel) => db.upsertLsaUnitAsset(classKey, unitNumber, imageUrl, helperLabel));
ipcMain.handle('assets.importLsaUnitImage', async (event, classKey = '', unitNumber) => {
  const unit = Number(unitNumber);
  if (!Number.isFinite(unit) || unit < 1) {
    throw new Error('Invalid unit number for LSA image import.');
  }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Import Image for LSA ${unit}`,
    properties: ['openFile'],
    filters: [
      { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const sourcePath = filePaths[0];
  const ext = path.extname(sourcePath) || '.png';
  const assetsDir = path.join(app.getPath('userData'), 'assets', 'lsa-units');
  fs.mkdirSync(assetsDir, { recursive: true });

  const classToken = sanitizeFileSegment(classKey || 'all-classes', 'all-classes');
  const fileName = `${classToken}-lsa-${unit}-${Date.now()}${ext.toLowerCase()}`;
  const destinationPath = path.join(assetsDir, fileName);

  fs.copyFileSync(sourcePath, destinationPath);

  const imageUrl = pathToFileURL(destinationPath).toString();
  const saved = db.upsertLsaUnitAsset(classKey, unit, imageUrl);

  return {
    canceled: false,
    class_key: saved.class_key,
    unit_number: saved.unit_number,
    image_url: saved.image_url,
    helper_label: saved.helper_label,
  };
});
ipcMain.handle('db.exportStudentsCsv', async () => {
  const students = db.getStudents();
  const csvHeader = [
    'id',
    'first_name',
    'last_name',
    'email',
    'grade',
    'teacher',
    'notes',
    'lsa_easy',
    'lsa_medium',
    'lsa_difficult',
    'lsa_units',
    'recorder_color',
    'good_news_shared',
    'imma_t',
    'imma_r',
  ];

  const escapeCsv = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = students.map(student => csvHeader.map(key => escapeCsv(student[key])).join(','));
  const csvText = [csvHeader.join(','), ...csvRows].join('\r\n');

  const defaultFileName = `students-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Save Student Backup',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(filePath, csvText, 'utf8');
  return { canceled: false, filePath, count: students.length };
});

ipcMain.handle('db.exportSelectedStudentsCsv', async (event, studentIds) => {
  const allStudents = db.getStudents();
  const idSet = new Set(Array.isArray(studentIds) ? studentIds.map(Number) : []);
  const students = allStudents.filter(s => idSet.has(s.id));

  const csvHeader = [
    'id',
    'first_name',
    'last_name',
    'email',
    'grade',
    'teacher',
    'notes',
    'lsa_easy',
    'lsa_medium',
    'lsa_difficult',
    'lsa_units',
    'recorder_color',
    'good_news_shared',
    'imma_t',
    'imma_r',
  ];

  const escapeCsv = (value) => {
    if (value === null || value === undefined) {
      return '';
    }
    const str = String(value);
    if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const csvRows = students.map(student => csvHeader.map(key => escapeCsv(student[key])).join(','));
  const csvText = [csvHeader.join(','), ...csvRows].join('\r\n');

  const defaultFileName = `students-selected-${new Date().toISOString().slice(0, 10)}.csv`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Selected Students',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'CSV Files', extensions: ['csv'] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(filePath, csvText, 'utf8');
  return { canceled: false, filePath, count: students.length };
});

// --- Seating Chart IPC handlers ---
ipcMain.handle('db.getSeatingCharts', async (event, classKey = '') => db.getSeatingCharts(classKey));
ipcMain.handle('db.getSeatingChart', async (event, chartId, classKey = '') => db.getSeatingChart(chartId, classKey));
ipcMain.handle('db.createSeatingChart', async (event, payload) => db.createSeatingChart(payload));
ipcMain.handle('db.updateSeatingChartName', async (event, chartId, name, classKey = '') => db.updateSeatingChartName(chartId, name, classKey));
ipcMain.handle('db.saveSeatingChartLayout', async (event, payload) => db.saveSeatingChartLayout(payload));
ipcMain.handle('db.deleteSeatingChart', async (event, chartId, classKey = '') => db.deleteSeatingChart(chartId, classKey));

// --- Instrument IPC handlers ---
ipcMain.handle('db.getInstruments', async () => db.getInstruments());
ipcMain.handle('db.addInstrument', async (event, instrument) => db.addInstrument(instrument));
ipcMain.handle('db.updateInstrument', async (event, instrument) => db.updateInstrument(instrument));
ipcMain.handle('db.deleteInstrument', async (event, id) => db.deleteInstrument(id));

// --- Class IPC handlers ---
ipcMain.handle('db.getClasses', async () => db.getClasses());
ipcMain.handle('db.addClass', async (event, cls) => db.addClass(cls));
ipcMain.handle('db.updateClass', async (event, cls) => db.updateClass(cls));
ipcMain.handle('db.deleteClass', async (event, id) => db.deleteClass(id));

// --- LSA Lesson Library IPC handlers ---
ipcMain.handle('assets.importLsaLessons', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Lesson Images',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true, imported: [] };
  }

  const assetsDir = path.join(app.getPath('userData'), 'assets', 'lsa-library');
  fs.mkdirSync(assetsDir, { recursive: true });

  const imported = [];
  for (const sourcePath of filePaths) {
    const originalName = path.basename(sourcePath);
    const ext = path.extname(sourcePath) || '.png';
    const baseName = path.basename(sourcePath, ext);
    const safeBase = sanitizeFileSegment(baseName, 'lesson');
    const fileName = `${safeBase}-${Date.now()}${ext.toLowerCase()}`;
    const destinationPath = path.join(assetsDir, fileName);

    try {
      fs.copyFileSync(sourcePath, destinationPath);
      const imageUrl = pathToFileURL(destinationPath).toString();
      const lesson = db.addLsaLesson(originalName, imageUrl);
      imported.push(lesson);
    } catch (err) {
      console.error(`[importLsaLessons] failed to import ${sourcePath}:`, err.message);
    }
  }

  return { canceled: false, imported };
});

ipcMain.handle('db.getLsaLessons', async () => db.getLsaLessons());
ipcMain.handle('db.deleteLsaLesson', async (event, id) => db.deleteLsaLesson(id));

ipcMain.handle('assets.importLsaAudio', async (event, lessonId) => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Lesson Audio',
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'aac'] },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true, lesson: null };
  }

  const audioDir = path.join(app.getPath('userData'), 'assets', 'lsa-audio');
  fs.mkdirSync(audioDir, { recursive: true });

  const sourcePath = filePaths[0];
  const ext = path.extname(sourcePath).toLowerCase() || '.mp3';
  const baseName = path.basename(sourcePath, path.extname(sourcePath));
  const safeBase = sanitizeFileSegment(baseName, 'audio');
  const fileName = `${safeBase}-${Date.now()}${ext}`;
  const destinationPath = path.join(audioDir, fileName);

  try {
    fs.copyFileSync(sourcePath, destinationPath);
    const audioUrl = pathToFileURL(destinationPath).toString();
    const lesson = db.setLsaLessonAudio(lessonId, audioUrl);
    return { canceled: false, lesson };
  } catch (err) {
    console.error(`[importLsaAudio] failed to import audio:`, err.message);
    return { canceled: true, lesson: null };
  }
});

ipcMain.handle('db.setLsaLessonAudio', async (event, id, audioUrl) => db.setLsaLessonAudio(id, audioUrl));
ipcMain.handle('db.getLsaGradeUnitMap', async (event, gradeLevel) => db.getLsaGradeUnitMap(gradeLevel));
ipcMain.handle('db.upsertLsaGradeUnitMap', async (event, gradeLevel, unitNumber, lessonId) => db.upsertLsaGradeUnitMap(gradeLevel, unitNumber, lessonId));
ipcMain.handle('db.clearLsaGradeUnitSlot', async (event, gradeLevel, unitNumber) => db.clearLsaGradeUnitSlot(gradeLevel, unitNumber));
ipcMain.handle('db.getLsaCustomUnits', async () => db.getLsaCustomUnits());
ipcMain.handle('db.addLsaCustomUnit', async (event, unitNumber) => db.addLsaCustomUnit(unitNumber));
ipcMain.handle('db.getAssessmentLibrary', async (event, gradeLevel) => db.getAssessmentLibrary(gradeLevel));
ipcMain.handle('db.upsertAssessmentLibraryItem', async (event, gradeLevel, assessNum, name, scale1, scale2, scale3, scale4) => db.upsertAssessmentLibraryItem(gradeLevel, assessNum, name, scale1, scale2, scale3, scale4));
ipcMain.handle('db.getSetting', async (event, key) => db.getSetting(key));
ipcMain.handle('db.setSetting', async (event, key, value) => db.setSetting(key, value));
ipcMain.handle('db.getImmaScores', async (event, studentId) => db.getImmaScores(studentId));
ipcMain.handle('db.getImmaScoresForClass', async (event, studentIds) => db.getImmaScoresForClass(studentIds));
ipcMain.handle('db.upsertImmaScore', async (event, studentId, academicYear, tonal, rhythm) => db.upsertImmaScore(studentId, academicYear, tonal, rhythm));
ipcMain.handle('db.syncStudentsFromCsv', async (event, csvStudents, academicYear) => db.syncStudentsFromCsv(csvStudents, academicYear));
