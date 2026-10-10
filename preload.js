/**
 * @file preload.js
 * @process Preload — runs in a privileged Node.js context BEFORE the renderer page loads,
 *          but is ISOLATED from the renderer's JavaScript context by contextIsolation.
 *
 * Purpose:
 *   This script is the sole bridge between the sandboxed Browser Renderer and the
 *   Node.js Main process. It uses contextBridge.exposeInMainWorld() to publish a
 *   minimal, explicitly enumerated API surface as `window.api` in the renderer.
 *
 *   Every entry in `window.api` is a one-liner that calls ipcRenderer.invoke() —
 *   which means it is always asynchronous (returns a Promise) and always round-trips
 *   through the Main process. The renderer can never call Node/Electron APIs directly.
 *
 * IPC Direction convention used in this file:
 *   SEND →  channel name   (ipcRenderer.invoke — Renderer to Main, awaits response)
 *   LISTEN ← channel name  (ipcRenderer.on — receives one-way push from Main)
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * `window.api` — the entire public contract between the renderer and main process.
 * Keeping the surface narrow limits what a compromised renderer page could do even
 * if it somehow injected malicious script into this scope.
 */
contextBridge.exposeInMainWorld('api', {
  // SEND → 'app.getInfo' — About modal name/version
  getAppInfo: () => ipcRenderer.invoke('app.getInfo'),
  // Students
  // SEND → 'db.getStudents' | 'db.addStudent' | 'db.updateStudent' | 'db.deleteStudent'
  getStudents: () => ipcRenderer.invoke('db.getStudents'),
  addStudent: (student) => ipcRenderer.invoke('db.addStudent', student),
  updateStudent: (student) => ipcRenderer.invoke('db.updateStudent', student),
  deleteStudent: (id) => ipcRenderer.invoke('db.deleteStudent', id),
  // SEND → 'db.getDuplicateStudentGroups' | 'db.getStudentMergePreview' | 'db.mergeStudents'
  getDuplicateStudentGroups: () => ipcRenderer.invoke('db.getDuplicateStudentGroups'),
  getStudentMergePreview: (keepId, duplicateId) =>
    ipcRenderer.invoke('db.getStudentMergePreview', keepId, duplicateId),
  mergeStudents: (keepId, duplicateId, resolutions) =>
    ipcRenderer.invoke('db.mergeStudents', keepId, duplicateId, resolutions),

  // Student Notes (Note Mode)
  // SEND → 'db.addStudentNote' | 'db.addFollowUpNote' | 'db.getStudentNotes' | 'db.updateStudentNote' | 'db.deleteStudentNote'
  addStudentNote: (studentId, noteText, noteType, noteDate, academicYear) =>
    ipcRenderer.invoke('db.addStudentNote', studentId, noteText, noteType, noteDate, academicYear),
  addFollowUpNote: (parentNoteId, studentId, noteText, noteType, noteDate, academicYear) =>
    ipcRenderer.invoke(
      'db.addFollowUpNote',
      parentNoteId,
      studentId,
      noteText,
      noteType,
      noteDate,
      academicYear
    ),
  getStudentNotes: (studentId, academicYear) =>
    ipcRenderer.invoke('db.getStudentNotes', studentId, academicYear),
  updateStudentNote: (noteId, noteText, noteType, noteDate) =>
    ipcRenderer.invoke('db.updateStudentNote', noteId, noteText, noteType, noteDate),
  deleteStudentNote: (noteId) => ipcRenderer.invoke('db.deleteStudentNote', noteId),
  // SEND → 'db.getAttendanceRecords' | 'db.upsertAttendanceRecord' | 'db.deleteAttendanceRecord' | 'db.renameAttendanceDate'
  getAttendanceRecords: (studentIds) => ipcRenderer.invoke('db.getAttendanceRecords', studentIds),
  upsertAttendanceRecord: (studentId, attendanceDate, status) =>
    ipcRenderer.invoke('db.upsertAttendanceRecord', studentId, attendanceDate, status),
  deleteAttendanceRecord: (studentId, attendanceDate) =>
    ipcRenderer.invoke('db.deleteAttendanceRecord', studentId, attendanceDate),
  renameAttendanceDate: (oldDate, newDate) =>
    ipcRenderer.invoke('db.renameAttendanceDate', oldDate, newDate),
  // SEND → 'db.resetStudentData' | 'db.resetFactoryData'
  resetStudentData: () => ipcRenderer.invoke('db.resetStudentData'),
  resetFactoryData: () => ipcRenderer.invoke('db.resetFactoryData'),
  // SEND → 'db.getLsaUnitPlaceholders' | 'db.upsertLsaUnitPlaceholder' | 'db.getLsaUnitAssets' | 'db.upsertLsaUnitAsset'
  // SEND → 'assets.importLsaUnitImage' — triggers Main-side file dialog; Main copies file to userData
  getLsaUnitPlaceholders: (classKey = '') =>
    ipcRenderer.invoke('db.getLsaUnitPlaceholders', classKey),
  upsertLsaUnitPlaceholder: (classKey = '', unitNumber, x, y) =>
    ipcRenderer.invoke('db.upsertLsaUnitPlaceholder', classKey, unitNumber, x, y),
  getLsaUnitAssets: (classKey = '') => ipcRenderer.invoke('db.getLsaUnitAssets', classKey),
  upsertLsaUnitAsset: (classKey = '', unitNumber, imageUrl, helperLabel, audioUrl) =>
    ipcRenderer.invoke(
      'db.upsertLsaUnitAsset',
      classKey,
      unitNumber,
      imageUrl,
      helperLabel,
      audioUrl
    ),
  importLsaUnitImage: (classKey = '', unitNumber) =>
    ipcRenderer.invoke('assets.importLsaUnitImage', classKey, unitNumber),
  // SEND → 'db.exportStudentsCsv' | 'db.exportSelectedStudentsCsv' — Main opens save dialog
  exportStudentsCsv: () => ipcRenderer.invoke('db.exportStudentsCsv'),
  exportSelectedStudentsCsv: (studentIds) =>
    ipcRenderer.invoke('db.exportSelectedStudentsCsv', studentIds),
  // SEND → 'db.getSeatingCharts' | 'db.getSeatingChart' | 'db.createSeatingChart'
  //          'db.updateSeatingChartName' | 'db.saveSeatingChartLayout' | 'db.deleteSeatingChart'
  //          'db.reorderSeatingCharts' — persists drag-reorder of the chart list
  getSeatingCharts: (classKey = '') => ipcRenderer.invoke('db.getSeatingCharts', classKey),
  getSeatingChart: (chartId, classKey = '') =>
    ipcRenderer.invoke('db.getSeatingChart', chartId, classKey),
  createSeatingChart: (payload) => ipcRenderer.invoke('db.createSeatingChart', payload),
  clearStaleSeatingChartsForYear: (academicYear) =>
    ipcRenderer.invoke('db.clearStaleSeatingChartsForYear', academicYear),
  updateSeatingChartName: (chartId, name, classKey = '') =>
    ipcRenderer.invoke('db.updateSeatingChartName', chartId, name, classKey),
  saveSeatingChartLayout: (payload) => ipcRenderer.invoke('db.saveSeatingChartLayout', payload),
  deleteSeatingChart: (chartId, classKey = '') =>
    ipcRenderer.invoke('db.deleteSeatingChart', chartId, classKey),
  reorderSeatingCharts: (classKey, orderedIds) =>
    ipcRenderer.invoke('db.reorderSeatingCharts', classKey, orderedIds),

  // Instruments
  // SEND → 'db.getInstruments' | 'db.addInstrument' | 'db.updateInstrument' | 'db.deleteInstrument'
  getInstruments: () => ipcRenderer.invoke('db.getInstruments'),
  addInstrument: (instrument) => ipcRenderer.invoke('db.addInstrument', instrument),
  updateInstrument: (instrument) => ipcRenderer.invoke('db.updateInstrument', instrument),
  deleteInstrument: (id) => ipcRenderer.invoke('db.deleteInstrument', id),

  // Classes
  // SEND → 'db.getClasses' | 'db.addClass' | 'db.updateClass' | 'db.deleteClass'
  getClasses: () => ipcRenderer.invoke('db.getClasses'),
  addClass: (cls) => ipcRenderer.invoke('db.addClass', cls),
  updateClass: (cls) => ipcRenderer.invoke('db.updateClass', cls),
  deleteClass: (id) => ipcRenderer.invoke('db.deleteClass', id),
  // Lesson Library
  // SEND → 'assets.importLsaLessons' | 'assets.importLsaAudio' — both trigger Main-side file dialogs
  // SEND → 'db.setLsaLessonAudio' | 'db.getLsaLessons' | 'db.deleteLsaLesson'
  //          'db.getLsaGradeUnitMap' | 'db.upsertLsaGradeUnitMap' | 'db.clearLsaGradeUnitSlot'
  importLsaLessons: () => ipcRenderer.invoke('assets.importLsaLessons'),
  importLsaAudio: (lessonId) => ipcRenderer.invoke('assets.importLsaAudio', lessonId),
  setLsaLessonAudio: (id, audioUrl) => ipcRenderer.invoke('db.setLsaLessonAudio', id, audioUrl),
  getLsaLessons: () => ipcRenderer.invoke('db.getLsaLessons'),
  deleteLsaLesson: (id) => ipcRenderer.invoke('db.deleteLsaLesson', id),
  getLsaGradeUnitMap: (gradeLevel) => ipcRenderer.invoke('db.getLsaGradeUnitMap', gradeLevel),
  upsertLsaGradeUnitMap: (gradeLevel, unitNumber, lessonId) =>
    ipcRenderer.invoke('db.upsertLsaGradeUnitMap', gradeLevel, unitNumber, lessonId),
  clearLsaGradeUnitSlot: (gradeLevel, unitNumber) =>
    ipcRenderer.invoke('db.clearLsaGradeUnitSlot', gradeLevel, unitNumber),
  getLsaCustomUnits: () => ipcRenderer.invoke('db.getLsaCustomUnits'),
  addLsaCustomUnit: (unitNumber) => ipcRenderer.invoke('db.addLsaCustomUnit', unitNumber),
  // SEND → 'db.getAssessmentLibrary' | 'db.upsertAssessmentLibraryItem' | 'db.deleteAssessmentLibraryItem'
  // SEND → 'db.getAssessmentDates' | 'db.setAssessmentDate'
  // SEND → 'db.getClassAssessmentRatings' | 'db.getClassAssessmentDates'
  // SEND → 'db.exportAssessmentRubrics' | 'db.importAssessmentRubrics' — Main handles file dialogs
  getAssessmentLibrary: (gradeLevel, academicYear) =>
    ipcRenderer.invoke('db.getAssessmentLibrary', gradeLevel, academicYear),
  upsertAssessmentLibraryItem: (
    gradeLevel,
    academicYear,
    assessNum,
    name,
    scale1,
    scale2,
    scale3,
    scale4
  ) =>
    ipcRenderer.invoke(
      'db.upsertAssessmentLibraryItem',
      gradeLevel,
      academicYear,
      assessNum,
      name,
      scale1,
      scale2,
      scale3,
      scale4
    ),
  deleteAssessmentLibraryItem: (gradeLevel, academicYear, assessNum) =>
    ipcRenderer.invoke('db.deleteAssessmentLibraryItem', gradeLevel, academicYear, assessNum),
  getAssessmentDates: (chartId) => ipcRenderer.invoke('db.getAssessmentDates', chartId),
  setAssessmentDate: (chartId, assessNum, date) =>
    ipcRenderer.invoke('db.setAssessmentDate', chartId, assessNum, date),
  getAssessmentDatesForClass: (classKey, academicYear) =>
    ipcRenderer.invoke('db.getAssessmentDatesForClass', classKey, academicYear),
  setAssessmentDateForClass: (classKey, academicYear, assessNum, date) =>
    ipcRenderer.invoke('db.setAssessmentDateForClass', classKey, academicYear, assessNum, date),
  getAssessmentRatings: (studentIds, academicYear) =>
    ipcRenderer.invoke('db.getAssessmentRatings', studentIds, academicYear),
  upsertAssessmentRating: (studentId, academicYear, assessNum, rating) =>
    ipcRenderer.invoke('db.upsertAssessmentRating', studentId, academicYear, assessNum, rating),
  getLsaScores: (studentIds, academicYear) =>
    ipcRenderer.invoke('db.getLsaScores', studentIds, academicYear),
  upsertLsaScore: (studentId, academicYear, unitNumber, easy, medium, difficult) =>
    ipcRenderer.invoke(
      'db.upsertLsaScore',
      studentId,
      academicYear,
      unitNumber,
      easy,
      medium,
      difficult
    ),
  getPenNotesForStudentsYear: (studentIds, academicYear) =>
    ipcRenderer.invoke('db.getPenNotesForStudentsYear', studentIds, academicYear),
  savePenNoteYear: (studentId, unitNumber, columnType, noteData, academicYear) =>
    ipcRenderer.invoke(
      'db.savePenNoteYear',
      studentId,
      unitNumber,
      columnType,
      noteData,
      academicYear
    ),
  getClassAssessmentRatings: (classKey) =>
    ipcRenderer.invoke('db.getClassAssessmentRatings', classKey),
  getClassAssessmentDates: (classKey) => ipcRenderer.invoke('db.getClassAssessmentDates', classKey),
  getLsaUnitLabelsHistory: (classKey, academicYear) =>
    ipcRenderer.invoke('db.getLsaUnitLabelsHistory', classKey, academicYear),
  snapshotLsaUnitLabels: (classKey, academicYear, labels) =>
    ipcRenderer.invoke('db.snapshotLsaUnitLabels', classKey, academicYear, labels),
  getRecorderSongLibrary: (academicYear) =>
    ipcRenderer.invoke('db.getRecorderSongLibrary', academicYear),
  upsertRecorderSongLibraryItem: (academicYear, slotNum, name, colorKey) =>
    ipcRenderer.invoke('db.upsertRecorderSongLibraryItem', academicYear, slotNum, name, colorKey),
  deleteRecorderSongLibraryItem: (academicYear, slotNum) =>
    ipcRenderer.invoke('db.deleteRecorderSongLibraryItem', academicYear, slotNum),
  getRecorderSongCompletions: (studentIds, academicYear) =>
    ipcRenderer.invoke('db.getRecorderSongCompletions', studentIds, academicYear),
  upsertRecorderSongCompletion: (studentId, academicYear, slotNum, completed) =>
    ipcRenderer.invoke(
      'db.upsertRecorderSongCompletion',
      studentId,
      academicYear,
      slotNum,
      completed
    ),
  exportAssessmentRubrics: () => ipcRenderer.invoke('db.exportAssessmentRubrics'),
  importAssessmentRubrics: () => ipcRenderer.invoke('db.importAssessmentRubrics'),
  // SEND → 'db.getSetting' | 'db.setSetting'
  getSetting: (key) => ipcRenderer.invoke('db.getSetting', key),
  setSetting: (key, value) => ipcRenderer.invoke('db.setSetting', key, value),
  getAptitudeSettings: () => ipcRenderer.invoke('db.getAptitudeSettings'),
  saveAptitudeSettings: (rows) => ipcRenderer.invoke('db.saveAptitudeSettings', rows),
  // SEND → 'db.getImmaScores' | 'db.getImmaScoresForClass' | 'db.upsertImmaScore'
  getImmaScores: (studentId) => ipcRenderer.invoke('db.getImmaScores', studentId),
  getImmaScoresForClass: (studentIds) => ipcRenderer.invoke('db.getImmaScoresForClass', studentIds),
  upsertImmaScore: (studentId, academicYear, tonal, rhythm) =>
    ipcRenderer.invoke('db.upsertImmaScore', studentId, academicYear, tonal, rhythm),
  // MATS (Music Aptitude Test System)
  // SEND → 'db.getMatsResultsForClass' | 'db.getMatsUnmatchedResults'
  // SEND → 'mats.hasServiceAccount' | 'mats.setupServiceAccount' | 'mats.fetchAndImport' | 'mats.resetForRetake'
  getMatsResultsForClass: (studentIds) =>
    ipcRenderer.invoke('db.getMatsResultsForClass', studentIds),
  getMatsUnmatchedResults: (teacherCode) =>
    ipcRenderer.invoke('db.getMatsUnmatchedResults', teacherCode),
  matsHasServiceAccount: () => ipcRenderer.invoke('mats.hasServiceAccount'),
  matsSetupServiceAccount: () => ipcRenderer.invoke('mats.setupServiceAccount'),
  matsFetchAndImport: (teacherCode) => ipcRenderer.invoke('mats.fetchAndImport', teacherCode),
  matsResetForRetake: (firestoreDocId) => ipcRenderer.invoke('mats.resetForRetake', firestoreDocId),
  // SEND → 'db.previewCsvSync' | 'db.syncStudentsFromCsv'
  previewCsvSync: (csvStudents) => ipcRenderer.invoke('db.previewCsvSync', csvStudents),
  syncStudentsFromCsv: (csvStudents, academicYear, teacherColumnMapped, manualMatches) =>
    ipcRenderer.invoke(
      'db.syncStudentsFromCsv',
      csvStudents,
      academicYear,
      teacherColumnMapped,
      manualMatches
    ),
  // SEND → 'db.savePenNote' | 'db.getPenNotesForStudents' | 'db.savePenNoteYear' | 'db.getPenNotesForStudentsYear'
  savePenNote: (studentId, unitNumber, columnType, noteData) =>
    ipcRenderer.invoke('db.savePenNote', studentId, unitNumber, columnType, noteData),
  getPenNotesForStudents: (studentIds) =>
    ipcRenderer.invoke('db.getPenNotesForStudents', studentIds),
  // Updater
  // SEND → 'updater.check' | 'updater.download' | 'updater.install'
  checkForUpdates: () => ipcRenderer.invoke('updater.check'),
  downloadUpdate: () => ipcRenderer.invoke('updater.download'),
  installUpdate: () => ipcRenderer.invoke('updater.install'),
  /**
   * Registers listeners for all one-way PUSH notifications sent from Main → Renderer.
   * These are the ONLY channels where Main initiates communication to the Renderer.
   *
   * LISTEN ← 'update-available'        payload: version string
   * LISTEN ← 'update-not-available'
   * LISTEN ← 'update-download-progress' payload: integer percent 0-100
   * LISTEN ← 'update-downloaded'
   * LISTEN ← 'update-error'            payload: error message string
   *
   * @param {function(status: string, payload?: any): void} callback
   */
  onUpdateStatus: (callback) => {
    ipcRenderer.on('update-available', (_, v) => callback('available', v));
    ipcRenderer.on('update-not-available', () => callback('not-available'));
    ipcRenderer.on('update-download-progress', (_, pct) => callback('progress', pct));
    ipcRenderer.on('update-downloaded', () => callback('downloaded'));
    ipcRenderer.on('update-error', (_, msg) => callback('error', msg));
  },
  // LISTEN ← 'display-scale-changed' — Main re-applied the DPI-compensation zoom
  // (OS scale setting changed, or the window moved to a differently-scaled monitor).
  onDisplayScaleChanged: (callback) => ipcRenderer.on('display-scale-changed', () => callback()),
});
