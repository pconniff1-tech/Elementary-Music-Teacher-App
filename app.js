/**
 * @file app.js
 * @process Main — Node.js / Electron Main Process
 *
 * Entry point for the Electron main process. Responsible for:
 *   - Creating and configuring the BrowserWindow (with security-hardened webPreferences)
 *   - Registering ALL ipcMain.handle() receivers that service database, file-system,
 *     asset-import, auto-update, and MATS operations
 *   - Bootstrapping the SQLite database before the renderer window opens
 *
 * IPC Direction convention used in this file:
 *   RECEIVE  ← channel name   (ipcMain.handle / ipcMain.on)
 *   PUSH     → channel name   (webContents.send)
 */

const { app, BrowserWindow, ipcMain, screen, dialog } = require('electron');

// --- Student Notes (Note Mode) IPC handlers ---
// RECEIVE ← 'db.addStudentNote'  (sent by Renderer via window.api.addStudentNote)
// RECEIVE ← 'db.addStudentNote' | 'db.addFollowUpNote' | 'db.getStudentNotes' | 'db.updateStudentNote' | 'db.deleteStudentNote'
ipcMain.handle(
  'db.addStudentNote',
  async (event, studentId, noteText, noteType, noteDate, academicYear) =>
    db.addStudentNote(studentId, noteText, noteType, noteDate, academicYear)
);
ipcMain.handle(
  'db.addFollowUpNote',
  async (event, parentNoteId, studentId, noteText, noteType, noteDate, academicYear) =>
    db.addFollowUpNote(parentNoteId, studentId, noteText, noteType, noteDate, academicYear)
);
ipcMain.handle('db.getStudentNotes', async (event, studentId, academicYear) =>
  db.getStudentNotes(studentId, academicYear)
);
ipcMain.handle('db.updateStudentNote', async (event, noteId, noteText, noteType, noteDate) =>
  db.updateStudentNote(noteId, noteText, noteType, noteDate)
);
ipcMain.handle('db.deleteStudentNote', async (event, noteId) => {
  try {
    return db.deleteStudentNote(noteId);
  } catch (err) {
    console.error('[main] deleteStudentNote error:', err);
    throw err;
  }
});
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const db = require('./db');
const pkg = require('./package.json');

// RECEIVE ← 'app.getInfo' (Renderer → Main: About modal requests name + version)
ipcMain.handle('app.getInfo', () => ({
  name: pkg.build?.productName || pkg.name,
  version: app.getVersion(),
  arch: process.arch,
}));

// --- Auto-updater (disabled during dev, active in packaged builds) ---
// These webContents.send() calls are one-way PUSH notifications from Main → Renderer.
// The renderer has no way to initiate these; it only listens via onUpdateStatus().
let autoUpdater = null;
let mainWindowRef = null;
if (app.isPackaged) {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.setFeedURL({
    provider: 'github',
    owner: 'pconniff1-tech',
    repo: 'Elementary-Music-Teacher-App',
  });
  // PUSH → 'update-available'        (Main → Renderer, carries new version string)
  autoUpdater.on('update-available', (info) => {
    mainWindowRef?.webContents.send('update-available', info.version);
  });
  // PUSH → 'update-not-available'     (Main → Renderer)
  autoUpdater.on('update-not-available', () => {
    mainWindowRef?.webContents.send('update-not-available');
  });
  // PUSH → 'update-download-progress' (Main → Renderer, carries integer percent)
  autoUpdater.on('download-progress', (progress) => {
    mainWindowRef?.webContents.send('update-download-progress', Math.round(progress.percent));
  });
  // PUSH → 'update-downloaded'        (Main → Renderer)
  autoUpdater.on('update-downloaded', () => {
    mainWindowRef?.webContents.send('update-downloaded');
  });
  // PUSH → 'update-error'             (Main → Renderer, carries error message string)
  autoUpdater.on('error', (err) => {
    mainWindowRef?.webContents.send('update-error', err.message);
  });
}

// RECEIVE ← 'updater.check'    (Renderer → Main: user clicked "Check for Updates")
ipcMain.handle('updater.check', () => {
  if (autoUpdater) autoUpdater.checkForUpdates();
  // In dev builds autoUpdater is null; reply immediately so the UI doesn't hang.
  else mainWindowRef?.webContents.send('update-not-available');
});
// RECEIVE ← 'updater.download'  (Renderer → Main: user confirmed download)
ipcMain.handle('updater.download', () => {
  autoUpdater?.downloadUpdate();
});
// RECEIVE ← 'updater.install'   (Renderer → Main: user confirmed install — quits app)
ipcMain.handle('updater.install', () => {
  autoUpdater?.quitAndInstall();
});
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
      /**
       * preload — the ONLY script that runs with Node.js access before the renderer loads.
       * It bridges Main ↔ Renderer by exposing a narrow, hand-crafted API via contextBridge.
       * All other renderer code is sandboxed and cannot require() Node modules.
       */
      preload: path.join(__dirname, 'preload.js'),
      /**
       * contextIsolation: true — the preload script and the renderer page live in separate
       * JavaScript contexts. This prevents the renderer from reaching into the preload's
       * Node.js scope through prototype manipulation or global property access, which is
       * the primary defense against XSS-driven privilege escalation.
       */
      contextIsolation: true,
      /**
       * nodeIntegration: false — the renderer page cannot call require() or use any Node.js
       * APIs directly. Combined with contextIsolation this ensures that even if malicious
       * content is loaded, it cannot access the file system or spawn processes.
       */
      nodeIntegration: false,
      /**
       * enableRemoteModule: false — disables the legacy `remote` module, which allowed
       * renderers to call synchronous main-process APIs directly. It has been removed in
       * modern Electron but explicitly setting false guards against older-version regressions.
       */
      enableRemoteModule: false,
    },
  });

  mainWindow.maximize();

  mainWindowRef = mainWindow;
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  // mainWindow.webContents.openDevTools();

  // Counteract Windows display scaling (125%/150%/etc.) by zooming Chromium's
  // native page-zoom to the inverse of the display's scale factor, so the app
  // always renders at the logical equivalent of 100% scale. This is done via
  // webContents.setZoomFactor (not a CSS zoom/transform hack) because it's the
  // only mechanism that correctly recalculates vh/dvh-based layout together
  // with the rest of the page — a CSS-only approach left 100dvh referencing
  // the unscaled viewport, causing blank space and vertical card misplacement.
  const applyZoomForCurrentDisplay = () => {
    if (mainWindow.isDestroyed()) return;
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const scaleFactor = (display && display.scaleFactor) || 1;
    mainWindow.webContents.setZoomFactor(1 / scaleFactor);
    mainWindow.webContents.send('display-scale-changed');
  };

  mainWindow.webContents.on('did-finish-load', applyZoomForCurrentDisplay);

  // Re-check when the window is dragged to a different (possibly differently
  // scaled) monitor — debounced since 'move' fires continuously while dragging.
  let moveDebounceTimer = null;
  mainWindow.on('move', () => {
    clearTimeout(moveDebounceTimer);
    moveDebounceTimer = setTimeout(applyZoomForCurrentDisplay, 200);
  });

  // Re-check when the OS scale setting itself changes live.
  screen.on('display-metrics-changed', (event, display, changedMetrics) => {
    if (changedMetrics.includes('scaleFactor')) applyZoomForCurrentDisplay();
  });

  // Block Chromium's zoom shortcuts (Ctrl+/Ctrl-/Ctrl+0/Ctrl+scroll) so users
  // can't drift away from the computed compensation zoom — the app has its
  // own dedicated chart zoom control for viewing card text larger.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '_', '0'].includes(input.key)) {
      event.preventDefault();
    }
  });
  mainWindow.webContents.on('zoom-changed', (event) => event.preventDefault());
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
  const safe = String(value || '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return safe || fallback;
}

// --- Student IPC handlers ---
// RECEIVE ← 'db.getStudents' | 'db.addStudent' | 'db.updateStudent' | 'db.deleteStudent'
ipcMain.handle('db.getStudents', async () => db.getStudents());
ipcMain.handle('db.addStudent', async (event, student) => db.addStudent(student));
ipcMain.handle('db.updateStudent', async (event, student) => db.updateStudent(student));
ipcMain.handle('db.deleteStudent', async (event, id) => db.deleteStudent(id));
// RECEIVE ← 'db.getDuplicateStudentGroups' | 'db.getStudentMergePreview' | 'db.mergeStudents'
ipcMain.handle('db.getDuplicateStudentGroups', async () => db.getDuplicateStudentGroups());
ipcMain.handle('db.getStudentMergePreview', async (event, keepId, duplicateId) =>
  db.getStudentMergePreview(keepId, duplicateId)
);
ipcMain.handle('db.mergeStudents', async (event, keepId, duplicateId, resolutions) =>
  db.mergeStudents(keepId, duplicateId, resolutions)
);
// RECEIVE ← 'db.getAttendanceRecords' | 'db.upsertAttendanceRecord' | 'db.deleteAttendanceRecord' | 'db.renameAttendanceDate'
ipcMain.handle('db.getAttendanceRecords', async (event, studentIds) =>
  db.getAttendanceRecords(studentIds)
);
ipcMain.handle('db.upsertAttendanceRecord', async (event, studentId, attendanceDate, status) =>
  db.upsertAttendanceRecord(studentId, attendanceDate, status)
);
ipcMain.handle('db.deleteAttendanceRecord', async (event, studentId, attendanceDate) =>
  db.deleteAttendanceRecord(studentId, attendanceDate)
);
ipcMain.handle('db.renameAttendanceDate', async (event, oldDate, newDate) =>
  db.renameAttendanceDate(oldDate, newDate)
);
// RECEIVE ← 'db.resetStudentData' | 'db.resetFactoryData'
ipcMain.handle('db.resetStudentData', async () => db.resetStudentData());
ipcMain.handle('db.resetFactoryData', async () => db.resetFactoryData());
ipcMain.handle('db.getLsaUnitPlaceholders', async (event, classKey = '') =>
  db.getLsaUnitPlaceholders(classKey)
);
ipcMain.handle('db.upsertLsaUnitPlaceholder', async (event, classKey = '', unitNumber, x, y) =>
  db.upsertLsaUnitPlaceholder(classKey, unitNumber, x, y)
);
ipcMain.handle('db.getLsaUnitAssets', async (event, classKey = '') =>
  db.getLsaUnitAssets(classKey)
);
ipcMain.handle(
  'db.upsertLsaUnitAsset',
  async (event, classKey = '', unitNumber, imageUrl, helperLabel) =>
    db.upsertLsaUnitAsset(classKey, unitNumber, imageUrl, helperLabel)
);
ipcMain.handle('assets.importLsaUnitImage', async (event, classKey = '', unitNumber) => {
  const unit = Number(unitNumber);
  if (!Number.isFinite(unit) || unit < 1) {
    throw new Error('Invalid unit number for LSA image import.');
  }

  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: `Import Image for LSA ${unit}`,
    properties: ['openFile'],
    filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
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

  const csvRows = students.map((student) =>
    csvHeader.map((key) => escapeCsv(student[key])).join(',')
  );
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
  const students = allStudents.filter((s) => idSet.has(s.id));

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

  const csvRows = students.map((student) =>
    csvHeader.map((key) => escapeCsv(student[key])).join(',')
  );
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
// RECEIVE ← 'db.getSeatingCharts' | 'db.getSeatingChart' | 'db.createSeatingChart'
//           'db.updateSeatingChartName' | 'db.saveSeatingChartLayout' | 'db.deleteSeatingChart'
ipcMain.handle('db.getSeatingCharts', async (event, classKey = '') =>
  db.getSeatingCharts(classKey)
);
ipcMain.handle('db.getSeatingChart', async (event, chartId, classKey = '') =>
  db.getSeatingChart(chartId, classKey)
);
ipcMain.handle('db.createSeatingChart', async (event, payload) => db.createSeatingChart(payload));
ipcMain.handle('db.clearStaleSeatingChartsForYear', async (event, academicYear) =>
  db.clearStaleSeatingChartsForYear(academicYear)
);
ipcMain.handle('db.updateSeatingChartName', async (event, chartId, name, classKey = '') =>
  db.updateSeatingChartName(chartId, name, classKey)
);
ipcMain.handle('db.saveSeatingChartLayout', async (event, payload) =>
  db.saveSeatingChartLayout(payload)
);
ipcMain.handle('db.deleteSeatingChart', async (event, chartId, classKey = '') =>
  db.deleteSeatingChart(chartId, classKey)
);
ipcMain.handle('db.reorderSeatingCharts', async (event, classKey, orderedIds) =>
  // Seating chart drag-reorder: persists the new sort_order for each chart id
  // in the ordered array, scoped to the given class key.
  db.reorderSeatingCharts(classKey, orderedIds)
);

// --- Instrument IPC handlers ---
// RECEIVE ← 'db.getInstruments' | 'db.addInstrument' | 'db.updateInstrument' | 'db.deleteInstrument'
ipcMain.handle('db.getInstruments', async () => db.getInstruments());
ipcMain.handle('db.addInstrument', async (event, instrument) => db.addInstrument(instrument));
ipcMain.handle('db.updateInstrument', async (event, instrument) => db.updateInstrument(instrument));
ipcMain.handle('db.deleteInstrument', async (event, id) => db.deleteInstrument(id));

// --- Class IPC handlers ---
// RECEIVE ← 'db.getClasses' | 'db.addClass' | 'db.updateClass' | 'db.deleteClass'
ipcMain.handle('db.getClasses', async () => db.getClasses());
ipcMain.handle('db.addClass', async (event, cls) => db.addClass(cls));
ipcMain.handle('db.updateClass', async (event, cls) => db.updateClass(cls));
ipcMain.handle('db.deleteClass', async (event, id) => db.deleteClass(id));

// --- LSA Lesson Library IPC handlers ---
// RECEIVE ← 'assets.importLsaLessons' — opens native file picker on Main so the renderer
//   never touches the file system directly; returned lesson objects are safe plain data.
ipcMain.handle('assets.importLsaLessons', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Lesson Images',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Image Files', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
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
    filters: [{ name: 'Audio Files', extensions: ['mp3', 'm4a', 'wav', 'ogg', 'aac'] }],
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

ipcMain.handle('db.setLsaLessonAudio', async (event, id, audioUrl) =>
  db.setLsaLessonAudio(id, audioUrl)
);
ipcMain.handle('db.getLsaGradeUnitMap', async (event, gradeLevel) =>
  db.getLsaGradeUnitMap(gradeLevel)
);
ipcMain.handle('db.upsertLsaGradeUnitMap', async (event, gradeLevel, unitNumber, lessonId) =>
  db.upsertLsaGradeUnitMap(gradeLevel, unitNumber, lessonId)
);
ipcMain.handle('db.clearLsaGradeUnitSlot', async (event, gradeLevel, unitNumber) =>
  db.clearLsaGradeUnitSlot(gradeLevel, unitNumber)
);
ipcMain.handle('db.getLsaCustomUnits', async () => db.getLsaCustomUnits());
ipcMain.handle('db.addLsaCustomUnit', async (event, unitNumber) => db.addLsaCustomUnit(unitNumber));
ipcMain.handle('db.getAssessmentLibrary', async (event, gradeLevel, academicYear) =>
  db.getAssessmentLibrary(gradeLevel, academicYear)
);
ipcMain.handle(
  'db.upsertAssessmentLibraryItem',
  async (event, gradeLevel, academicYear, assessNum, name, scale1, scale2, scale3, scale4) =>
    db.upsertAssessmentLibraryItem(
      gradeLevel,
      academicYear,
      assessNum,
      name,
      scale1,
      scale2,
      scale3,
      scale4
    )
);
ipcMain.handle(
  'db.deleteAssessmentLibraryItem',
  async (event, gradeLevel, academicYear, assessNum) =>
    db.deleteAssessmentLibraryItem(gradeLevel, academicYear, assessNum)
);
ipcMain.handle('db.getAssessmentDates', async (event, chartId) => db.getAssessmentDates(chartId));
ipcMain.handle('db.setAssessmentDate', async (event, chartId, assessNum, date) =>
  db.setAssessmentDate(chartId, assessNum, date)
);
ipcMain.handle('db.getAssessmentDatesForClass', async (event, classKey, academicYear) =>
  db.getAssessmentDatesForClass(classKey, academicYear)
);
ipcMain.handle(
  'db.setAssessmentDateForClass',
  async (event, classKey, academicYear, assessNum, date) =>
    db.setAssessmentDateForClass(classKey, academicYear, assessNum, date)
);
ipcMain.handle('db.getAssessmentRatings', async (event, studentIds, academicYear) =>
  db.getAssessmentRatings(studentIds, academicYear)
);
ipcMain.handle(
  'db.upsertAssessmentRating',
  async (event, studentId, academicYear, assessNum, rating) =>
    db.upsertAssessmentRating(studentId, academicYear, assessNum, rating)
);
ipcMain.handle('db.getLsaScores', async (event, studentIds, academicYear) =>
  db.getLsaScores(studentIds, academicYear)
);
ipcMain.handle(
  'db.upsertLsaScore',
  async (event, studentId, academicYear, unitNumber, easy, medium, difficult) =>
    db.upsertLsaScore(studentId, academicYear, unitNumber, easy, medium, difficult)
);
ipcMain.handle('db.getPenNotesForStudentsYear', async (event, studentIds, academicYear) =>
  db.getPenNotesForStudentsYear(studentIds, academicYear)
);
ipcMain.handle(
  'db.savePenNoteYear',
  async (event, studentId, unitNumber, columnType, noteData, academicYear) =>
    db.savePenNoteYear(studentId, unitNumber, columnType, noteData, academicYear)
);
ipcMain.handle('db.getClassAssessmentRatings', async (event, classKey) =>
  db.getClassAssessmentRatings(classKey)
);
ipcMain.handle('db.getClassAssessmentDates', async (event, classKey) =>
  db.getClassAssessmentDates(classKey)
);
ipcMain.handle('db.getLsaUnitLabelsHistory', async (event, classKey, academicYear) =>
  db.getLsaUnitLabelsHistory(classKey, academicYear)
);
ipcMain.handle('db.snapshotLsaUnitLabels', async (event, classKey, academicYear, labels) =>
  db.snapshotLsaUnitLabels(classKey, academicYear, labels)
);
ipcMain.handle('db.getRecorderSongLibrary', async (event, academicYear) =>
  db.getRecorderSongLibrary(academicYear)
);
ipcMain.handle(
  'db.upsertRecorderSongLibraryItem',
  async (event, academicYear, slotNum, name, colorKey) =>
    db.upsertRecorderSongLibraryItem(academicYear, slotNum, name, colorKey)
);
ipcMain.handle('db.deleteRecorderSongLibraryItem', async (event, academicYear, slotNum) =>
  db.deleteRecorderSongLibraryItem(academicYear, slotNum)
);
ipcMain.handle('db.getRecorderSongCompletions', async (event, studentIds, academicYear) =>
  db.getRecorderSongCompletions(studentIds, academicYear)
);
ipcMain.handle(
  'db.upsertRecorderSongCompletion',
  async (event, studentId, academicYear, slotNum, completed) =>
    db.upsertRecorderSongCompletion(studentId, academicYear, slotNum, completed)
);
ipcMain.handle('db.exportAssessmentRubrics', async () => {
  const rows = db.exportAssessmentLibrary();
  if (!rows.length) return { canceled: false, count: 0 };
  const defaultFileName = `assessment-rubrics-${new Date().toISOString().slice(0, 10)}.json`;
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export Assessment Rubrics',
    defaultPath: path.join(app.getPath('documents'), defaultFileName),
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePath) return { canceled: true };
  fs.writeFileSync(filePath, JSON.stringify(rows, null, 2), 'utf8');
  return { canceled: false, filePath, count: rows.length };
});
ipcMain.handle('db.importAssessmentRubrics', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Assessment Rubrics',
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths.length) return { canceled: true };
  let rows;
  try {
    const text = fs.readFileSync(filePaths[0], 'utf8');
    rows = JSON.parse(text);
  } catch (err) {
    return { canceled: false, error: 'Invalid file — could not parse JSON.' };
  }
  if (!Array.isArray(rows)) return { canceled: false, error: 'Invalid file format.' };
  const result = db.importAssessmentLibrary(rows);
  return { canceled: false, count: result.count };
});
ipcMain.handle('db.getSetting', async (event, key) => db.getSetting(key));
ipcMain.handle('db.setSetting', async (event, key, value) => db.setSetting(key, value));
ipcMain.handle('db.getAptitudeSettings', async () => db.getAptitudeSettings());
ipcMain.handle('db.saveAptitudeSettings', async (event, rows) => db.saveAptitudeSettings(rows));
ipcMain.handle('db.getImmaScores', async (event, studentId) => db.getImmaScores(studentId));
ipcMain.handle('db.getImmaScoresForClass', async (event, studentIds) =>
  db.getImmaScoresForClass(studentIds)
);
ipcMain.handle('db.upsertImmaScore', async (event, studentId, academicYear, tonal, rhythm) =>
  db.upsertImmaScore(studentId, academicYear, tonal, rhythm)
);
ipcMain.handle('db.getMatsResultsForClass', async (event, studentIds) =>
  db.getMatsResultsForClass(studentIds)
);
ipcMain.handle('db.getMatsUnmatchedResults', async (event, teacherCode) =>
  db.getMatsUnmatchedResults(teacherCode)
);

// --- MATS IPC handlers ---
// RECEIVE ← 'mats.hasServiceAccount' | 'mats.setupServiceAccount' | 'mats.fetchAndImport' | 'mats.resetForRetake'
// The MATS service account JSON (Firebase credentials) is kept in userData and never
// exposed to the renderer — the renderer only ever receives plain result objects.
const matsService = require('./mats-service');

ipcMain.handle('mats.hasServiceAccount', async () => {
  return matsService.hasServiceAccount(app.getPath('userData'));
});

ipcMain.handle('mats.setupServiceAccount', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Select Firebase Service Account JSON',
    properties: ['openFile'],
    filters: [{ name: 'JSON Files', extensions: ['json'] }],
  });
  if (canceled || !filePaths || filePaths.length === 0) return { canceled: true };
  const destPath = path.join(app.getPath('userData'), 'mats-service-account.json');
  fs.copyFileSync(filePaths[0], destPath);
  return { canceled: false };
});

ipcMain.handle('mats.fetchAndImport', async (event, teacherCode) => {
  if (!teacherCode || typeof teacherCode !== 'string') {
    throw new Error('Teacher code is required.');
  }
  const students = db.getStudents();
  return matsService.fetchAndImport({
    userDataPath: app.getPath('userData'),
    teacherCode: teacherCode.toUpperCase().trim(),
    db,
    students,
  });
});

ipcMain.handle('mats.resetForRetake', async (event, firestoreDocId) => {
  if (!firestoreDocId || typeof firestoreDocId !== 'string') {
    throw new Error('firestoreDocId is required.');
  }
  return matsService.resetForRetake({
    userDataPath: app.getPath('userData'),
    firestoreDocId,
    db,
  });
});

ipcMain.handle('db.previewCsvSync', async (event, csvStudents) => db.previewCsvSync(csvStudents));
ipcMain.handle(
  'db.syncStudentsFromCsv',
  async (event, csvStudents, academicYear, teacherColumnMapped, manualMatches) =>
    db.syncStudentsFromCsv(csvStudents, academicYear, teacherColumnMapped, manualMatches)
);
ipcMain.handle('db.savePenNote', async (event, studentId, unitNumber, columnType, noteData) =>
  db.savePenNote(studentId, unitNumber, columnType, noteData)
);
ipcMain.handle('db.getPenNotesForStudents', async (event, studentIds) =>
  db.getPenNotesForStudents(studentIds)
);
