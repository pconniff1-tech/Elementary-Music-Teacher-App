const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Students
  getStudents: () => ipcRenderer.invoke('db.getStudents'),
  addStudent: (student) => ipcRenderer.invoke('db.addStudent', student),
  updateStudent: (student) => ipcRenderer.invoke('db.updateStudent', student),
  deleteStudent: (id) => ipcRenderer.invoke('db.deleteStudent', id),
  getAttendanceRecords: (studentIds) => ipcRenderer.invoke('db.getAttendanceRecords', studentIds),
  upsertAttendanceRecord: (studentId, attendanceDate, status) => ipcRenderer.invoke('db.upsertAttendanceRecord', studentId, attendanceDate, status),
  deleteAttendanceRecord: (studentId, attendanceDate) => ipcRenderer.invoke('db.deleteAttendanceRecord', studentId, attendanceDate),
  resetStudentData: () => ipcRenderer.invoke('db.resetStudentData'),
  resetFactoryData: () => ipcRenderer.invoke('db.resetFactoryData'),
  getLsaUnitPlaceholders: (classKey = '') => ipcRenderer.invoke('db.getLsaUnitPlaceholders', classKey),
  upsertLsaUnitPlaceholder: (classKey = '', unitNumber, x, y) => ipcRenderer.invoke('db.upsertLsaUnitPlaceholder', classKey, unitNumber, x, y),
  getLsaUnitAssets: (classKey = '') => ipcRenderer.invoke('db.getLsaUnitAssets', classKey),
  upsertLsaUnitAsset: (classKey = '', unitNumber, imageUrl, helperLabel, audioUrl) => ipcRenderer.invoke('db.upsertLsaUnitAsset', classKey, unitNumber, imageUrl, helperLabel, audioUrl),
  importLsaUnitImage: (classKey = '', unitNumber) => ipcRenderer.invoke('assets.importLsaUnitImage', classKey, unitNumber),
  exportStudentsCsv: () => ipcRenderer.invoke('db.exportStudentsCsv'),
  exportSelectedStudentsCsv: (studentIds) => ipcRenderer.invoke('db.exportSelectedStudentsCsv', studentIds),
  getSeatingCharts: (classKey = '') => ipcRenderer.invoke('db.getSeatingCharts', classKey),
  getSeatingChart: (chartId, classKey = '') => ipcRenderer.invoke('db.getSeatingChart', chartId, classKey),
  createSeatingChart: (payload) => ipcRenderer.invoke('db.createSeatingChart', payload),
  updateSeatingChartName: (chartId, name, classKey = '') => ipcRenderer.invoke('db.updateSeatingChartName', chartId, name, classKey),
  saveSeatingChartLayout: (payload) => ipcRenderer.invoke('db.saveSeatingChartLayout', payload),
  deleteSeatingChart: (chartId, classKey = '') => ipcRenderer.invoke('db.deleteSeatingChart', chartId, classKey),

  // Instruments
  getInstruments: () => ipcRenderer.invoke('db.getInstruments'),
  addInstrument: (instrument) => ipcRenderer.invoke('db.addInstrument', instrument),
  updateInstrument: (instrument) => ipcRenderer.invoke('db.updateInstrument', instrument),
  deleteInstrument: (id) => ipcRenderer.invoke('db.deleteInstrument', id),

  // Classes
  getClasses: () => ipcRenderer.invoke('db.getClasses'),
  addClass: (cls) => ipcRenderer.invoke('db.addClass', cls),
  updateClass: (cls) => ipcRenderer.invoke('db.updateClass', cls),
  deleteClass: (id) => ipcRenderer.invoke('db.deleteClass', id),
  // Lesson Library
  importLsaLessons: () => ipcRenderer.invoke('assets.importLsaLessons'),
  importLsaAudio: (lessonId) => ipcRenderer.invoke('assets.importLsaAudio', lessonId),
  setLsaLessonAudio: (id, audioUrl) => ipcRenderer.invoke('db.setLsaLessonAudio', id, audioUrl),
  getLsaLessons: () => ipcRenderer.invoke('db.getLsaLessons'),
  deleteLsaLesson: (id) => ipcRenderer.invoke('db.deleteLsaLesson', id),
  getLsaGradeUnitMap: (gradeLevel) => ipcRenderer.invoke('db.getLsaGradeUnitMap', gradeLevel),
  upsertLsaGradeUnitMap: (gradeLevel, unitNumber, lessonId) => ipcRenderer.invoke('db.upsertLsaGradeUnitMap', gradeLevel, unitNumber, lessonId),
  clearLsaGradeUnitSlot: (gradeLevel, unitNumber) => ipcRenderer.invoke('db.clearLsaGradeUnitSlot', gradeLevel, unitNumber),
  getLsaCustomUnits: () => ipcRenderer.invoke('db.getLsaCustomUnits'),
  addLsaCustomUnit: (unitNumber) => ipcRenderer.invoke('db.addLsaCustomUnit', unitNumber),
  getAssessmentLibrary: (gradeLevel) => ipcRenderer.invoke('db.getAssessmentLibrary', gradeLevel),
  upsertAssessmentLibraryItem: (gradeLevel, assessNum, name, scale1, scale2, scale3, scale4) => ipcRenderer.invoke('db.upsertAssessmentLibraryItem', gradeLevel, assessNum, name, scale1, scale2, scale3, scale4),
  exportAssessmentRubrics: () => ipcRenderer.invoke('db.exportAssessmentRubrics'),
  importAssessmentRubrics: () => ipcRenderer.invoke('db.importAssessmentRubrics'),
  getSetting: (key) => ipcRenderer.invoke('db.getSetting', key),
  setSetting: (key, value) => ipcRenderer.invoke('db.setSetting', key, value),
  getImmaScores: (studentId) => ipcRenderer.invoke('db.getImmaScores', studentId),
  getImmaScoresForClass: (studentIds) => ipcRenderer.invoke('db.getImmaScoresForClass', studentIds),
  upsertImmaScore: (studentId, academicYear, tonal, rhythm) => ipcRenderer.invoke('db.upsertImmaScore', studentId, academicYear, tonal, rhythm),
  syncStudentsFromCsv: (csvStudents, academicYear) => ipcRenderer.invoke('db.syncStudentsFromCsv', csvStudents, academicYear),
  // Updater
  checkForUpdates: () => ipcRenderer.invoke('updater.check'),
  downloadUpdate: () => ipcRenderer.invoke('updater.download'),
  installUpdate: () => ipcRenderer.invoke('updater.install'),
  onUpdateStatus: (callback) => ipcRenderer.on('update-available', (_, v) => callback('available', v))
    || ipcRenderer.on('update-not-available', () => callback('not-available'))
    || ipcRenderer.on('update-download-progress', (_, pct) => callback('progress', pct))
    || ipcRenderer.on('update-downloaded', () => callback('downloaded'))
    || ipcRenderer.on('update-error', (_, msg) => callback('error', msg)),
});
