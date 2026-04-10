// Utility: Parse a class key into teacher and grade parts
function parseClassKey(key) {
  if (!key) return { teacher: '', grade: '' };
  const idx = key.indexOf('||');
  if (idx === -1) return { teacher: key, grade: '' }; // legacy key fallback
  return { teacher: key.substring(0, idx), grade: key.substring(idx + 2) };
}

// Assessment label constants for all assessment types
const ASSESSMENT_LABELS = {
  1: 'Tonal 1',     2: 'Tonal 2',     3: 'Tonal 3',     4: 'Tonal 4',
  5: 'Rhythm 1',    6: 'Rhythm 2',    7: 'Rhythm 3',    8: 'Rhythm 4',
  9: 'Movement 1',  10: 'Movement 2', 11: 'Movement 3', 12: 'Movement 4',
  13: 'Instrument 1', 14: 'Instrument 2', 15: 'Instrument 3', 16: 'Instrument 4',
};
// Returns the active class grade for assessment/gradebook context
function getActiveClassGrade() {
  if (!activeClassTeacher) return null;
  const { grade } = parseClassKey(activeClassTeacher);
  return grade || null;
}

// Returns the base and subtitle for an assessment label, used in assessment grid headers
function getAssessmentLabelParts(num) {
  const grade = getActiveClassGrade() || assessLibraryGrade;
  const gradeMap = assessmentLibraryDb.get(grade);
  const base = ASSESSMENT_LABELS[num] || `Assessment ${num}`;
  const subtitle = gradeMap?.get(num)?.name || '';
  return { base, subtitle };
}

// Returns the full assessment label for a given assessment number
function getAssessmentLabel(num) {
  const { base, subtitle } = getAssessmentLabelParts(num);
  return subtitle ? `${base}: ${subtitle}` : base;
}
// Returns { 1: text, 2: text, 3: text, 4: text } scale descriptions for a given assessment number
function getAssessmentScaleTexts(num) {
  const grade = getActiveClassGrade() || assessLibraryGrade;
  const entry = assessmentLibraryDb.get(grade)?.get(num);
  return {
    1: entry?.scale1 || '',
    2: entry?.scale2 || '',
    3: entry?.scale3 || '',
    4: entry?.scale4 || '',
  };
}
const fallbackStudents = [
  { id: 'sample-1', first_name: 'Mia', last_name: 'R.', grade: '3rd', teacher: 'Ms. Rivera', notes: '', recorder_color: null, isSample: true },
  { id: 'sample-2', first_name: 'Leo', last_name: 'T.', grade: '4th', teacher: 'Mr. Jones', notes: '', recorder_color: null, isSample: true },
  { id: 'sample-3', first_name: 'Ava', last_name: 'K.', grade: '5th', teacher: 'Mrs. Chen', notes: '', recorder_color: null, isSample: true },
  { id: 'sample-4', first_name: 'Noah', last_name: 'P.', grade: '4th', teacher: 'Ms. Patel', notes: '', recorder_color: null, isSample: true },
  { id: 'sample-5', first_name: 'Ella', last_name: 'G.', grade: '3rd', teacher: 'Mr. Carter', notes: '', recorder_color: null, isSample: true },
];

const recorderColorOptions = ['Red', 'Blue', 'Yellow', 'Orange', 'Fuschia', 'Green', 'Black', 'Purple'];

const recorderColorLightBackgrounds = {
  Red: '#f8dddd',
  Blue: '#dee9fa',
  Yellow: '#fbf6d3',
  Orange: '#fce8d2',
  Fuschia: '#f8def2',
  Green: '#def4df',
  Black: '#e5e5e5',
  Purple: '#ece2f8',
};

let students = [];
let usingSampleRoster = false;
let selectedStudentId = null;
let activeFilter = 'all';
let activeView = 'seating';
let activeGradebookTab = 'attendance';
let attendanceMode = false;
let lsaMode = false;
let assessmentMode = false;
let activeAssessmentNumber = 1;
let activeLsaUnit = 1;
let editMode = false;
let manageStudentsVisible = false;
let manageSeatingVisible = false;
let exportSelectedStudentsList = []; // students chosen in export-selected modal
let manageChartToolsVisible = false;
let manageUnitsVisible = false;
let manageAssessmentsVisible = false;
// 'asc' = 1 is best (1=green … 4=red), 'desc' = 4 is best (4=green … 1=red)
let ratingDirection = localStorage.getItem('ratingDirection') || 'asc';
// assessmentLibraryDb: Map<gradeLevel, Map<assessNum, {name, scale1..4}>>
const assessmentLibraryDb = new Map();
let assessLibraryGrade = '';
// Set of normalized teacher names that have self-contained multi-grade classes
const multiGradeTeachers = new Set(JSON.parse(localStorage.getItem('multiGradeTeachers') || '[]'));
let activeClassTeacher = null;
let seatingCharts = [];
let activeSeatingChartId = null;
let seatingChartsCollapsed = true;
let classesCollapsed = true;
let chartSwitchRenderTimer = null;
let lastClearedChartSnapshot = null;
let dragPickupOffset = null;
let teacherCirclePos = null; // { x, y } of the teacher card when circle mode is active
let chartPanX = 0;
let chartPanY = 0;
let chartZoom = 1;
const CHART_ZOOM_MIN = 0.4;
const CHART_ZOOM_MAX = 2.5;
const TEACHER_CARD_W = 40;
const TEACHER_CARD_H = 24;
let attendanceByDateByStudent = new Map();
let totalLsaUnits = 14;
const lsaUnitPlaceholderPositions = new Map();
const assessmentPlaceholderPositions = new Map();
const assessmentCardSizes = new Map();
const lsaUnitPromptImages = new Map();
const lsaUnitHelperLabels = new Map();
const lsaUnitPromptSizes = new Map();
const lsaUnitLessonFileNames = new Map();
const lsaUnitAudioPaths = new Map();
let activeLsaAudio = null; // currently playing Audio instance for LSA prompt cards
let currentAcademicYear = '';       // e.g. "2025-26", loaded from settings on startup

let immaTabYear = '';               // year shown in the IMMA gradebook tab (may differ from currentAcademicYear)
let lessonLibraryOpen = false;
let lessonLibraryTab = 'library';
let lessonLibraryLessons = [];
let lessonLibrarySelectedGrade = '';
let lessonLibraryPickUnit = null; // unit number being replaced, or null for browse mode
let lessonLibrarySelectedId = null; // selected card id for remove actions
let csvImportStep = 1;
let csvParsedRows = [];   // all rows including header at [0]
let csvMapping = {};      // { first_name: 3, last_name: 1, ... } (-1 = skip)
let csvImporting = false;
let settingsMenuOpen = false;

const layoutState = new Map();

const studentSearchInput = document.getElementById('student-search');
const rosterList = document.getElementById('roster-list');
const chartCanvas = document.getElementById('chart-canvas');
const chartShell  = chartCanvas.closest('.chart-shell') || chartCanvas.parentElement;
// Fixed canvas dimensions captured from the maximized shell at startup.
// All layout calculations use these constants so the canvas size never
// changes when the window is resized — a smaller window just shows a
// viewport into the same fixed canvas space.
let CANVAS_W = 1100;
let CANVAS_H = 720;
const attendanceCanvas = document.getElementById('attendance-canvas');
const sampleNote = document.getElementById('sample-note');
const selectionCard = document.getElementById('selection-card');
const attendanceToggleBtn = document.getElementById('toggle-attendance-btn');
const lsaToggleBtn = document.getElementById('toggle-lsa-btn');
const assessmentToggleBtn = document.getElementById('toggle-assessment-btn');
const assessmentSubmenu = document.getElementById('assessment-submenu');
const showAssessmentsBtn = document.getElementById('show-assessments-btn');
const manageStudentsBtn = document.getElementById('manage-students-btn');
const addStudentBtn = document.getElementById('add-student-btn');
const editModeToggleBtn = document.getElementById('toggle-edit-mode-btn');
const backupStudentsBtn = document.getElementById('backup-students-btn');
const exportSelectedStudentsBtn = document.getElementById('export-selected-students-btn');
const exportSelectedModal = document.getElementById('export-selected-modal');
const chartToolsBtn = document.getElementById('chart-tools-btn');
const chartToolsSubmenu = document.getElementById('chart-tools-submenu');
const manageStudentsSubmenu = document.getElementById('manage-students-submenu');
const attendanceSubmenu = document.getElementById('attendance-submenu');
const lsaSubmenu = document.getElementById('lsa-submenu');
const manageClassesBtn = null; // removed
const showUnitsBtn = document.getElementById('show-units-btn');
const clearChartBtn = document.getElementById('clear-chart-btn');
const undoClearChartBtn = document.getElementById('undo-clear-chart-btn');
const arrangeRowsBtn = document.getElementById('arrange-rows-btn');
const arrangeCircleBtn = document.getElementById('arrange-circle-btn');
const arrangePair = null; // replaced by individual buttons
const neatenPair = null;  // replaced by individual buttons
const neathenRowsBtn = document.getElementById('neaten-rows-btn');
const neathenCircleBtn = document.getElementById('neaten-circle-btn');
const seatingChartLibrary = document.getElementById('seating-chart-library');
const seatingChartList = document.getElementById('seating-chart-list');
const classLibrary = document.getElementById('class-library');
const classList = document.getElementById('class-list');
const unitsLibrary = document.getElementById('units-library');
const unitsList = document.getElementById('units-list');
const assessmentsLibrary = document.getElementById('assessments-library');
const assessmentsList = document.getElementById('assessments-list');
const seatingChartLibraryBody = document.getElementById('seating-chart-library-body');
const toggleSeatingChartsListBtn = document.getElementById('toggle-seating-charts-list-btn');
const toggleClassesListBtn = document.getElementById('toggle-classes-list-btn');
const classLibraryBody = document.getElementById('class-library-body');
const addSeatingChartBtn = document.getElementById('add-seating-chart-btn');

const viewSeatingBtn = document.getElementById('view-seating-btn');
const viewGradebookBtn = document.getElementById('view-gradebook-btn');
const seatingView = document.getElementById('seating-view');
const gradebookView = document.getElementById('gradebook-view');
const gradebookTabAttendanceBtn = document.getElementById('gradebook-tab-attendance');
const gradebookTabLsaBtn = document.getElementById('gradebook-tab-lsa');
const gradebookTabAssessmentBtn = document.getElementById('gradebook-tab-assessment');
const gradebookTabRhythmBtn = document.getElementById('gradebook-tab-rhythm');
const gradebookTabMovementBtn = document.getElementById('gradebook-tab-movement');
const gradebookTabInstrumentBtn = document.getElementById('gradebook-tab-instrument');
const gradebookTabRecordersBtn = document.getElementById('gradebook-tab-recorders');
const gradebookAttendancePanel = document.getElementById('gradebook-attendance-panel');
const gradebookLsaPanel = document.getElementById('gradebook-lsa-panel');
const gradebookAssessmentPanel = document.getElementById('gradebook-assessment-panel');
const gradebookRhythmPanel = document.getElementById('gradebook-rhythm-panel');
const gradebookMovementPanel = document.getElementById('gradebook-movement-panel');
const gradebookInstrumentPanel = document.getElementById('gradebook-instrument-panel');
const gradebookRecordersPanel = document.getElementById('gradebook-recorders-panel');
const gradebookClassSubtitle = document.getElementById('gradebook-class-subtitle');
const currentViewLabel = document.getElementById('current-view-label');
const lsaGridCanvas = document.getElementById('lsa-grid-canvas');
const assessmentGridCanvas = document.getElementById('assessment-grid-canvas');
const rhythmGridCanvas = document.getElementById('rhythm-grid-canvas');
const movementGridCanvas = document.getElementById('movement-grid-canvas');
const instrumentGridCanvas = document.getElementById('instrument-grid-canvas');
const recordersGridCanvas = document.getElementById('recorders-grid-canvas');
const gradebookTabImmaBtn = document.getElementById('gradebook-tab-imma');
const gradebookImmaPanel = document.getElementById('gradebook-imma-panel');
const immaGridCanvas = document.getElementById('imma-grid-canvas');
const showInactiveBtn = document.getElementById('show-inactive-btn');
const academicYearDisplay = document.getElementById('academic-year-display');
const settingsGearBtn = document.getElementById('settings-gear-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
const fontSwitcher = document.getElementById('font-switcher');
const resetStudentDataBtn = document.getElementById('reset-student-data-btn');
const resetFactoryBtn = document.getElementById('reset-factory-btn');
const checkForUpdatesBtn = document.getElementById('check-for-updates-btn');
const updateStatusLine = document.getElementById('update-status-line');
const exportRubricsBtn = document.getElementById('export-rubrics-btn');
const importRubricsBtn = document.getElementById('import-rubrics-btn');
const studentModal = document.getElementById('student-modal');
const lessonLibraryModal = document.getElementById('lesson-library-modal');
const lessonLibraryBtn = document.getElementById('lesson-library-btn');
const lessonLibCloseBtn = document.getElementById('lesson-lib-close-btn');
const lessonLibImportBtn = document.getElementById('lesson-lib-import-btn');
const lessonLibGrid = document.getElementById('lesson-lib-grid');
const lessonLibGradeSelect = document.getElementById('lesson-lib-grade-select');
const lessonLibAssignWrap = document.getElementById('lesson-lib-assign-wrap');
const lessonLibAddUnitBtn = document.getElementById('lesson-lib-add-unit-btn');
const csvImportModal = document.getElementById('csv-import-modal');
const assessmentLibraryModal = document.getElementById('assessment-library-modal');
const assessLibCloseBtn = document.getElementById('assess-lib-close-btn');
const multiGradeModal = document.getElementById('multi-grade-modal');
const multiGradeCloseBtn = document.getElementById('multi-grade-close-btn');
const multiGradeDoneBtn = document.getElementById('multi-grade-done-btn');
const multiGradeGearBtn = document.getElementById('multi-grade-gear-btn');
const multiGradeList = document.getElementById('multi-grade-list');
const assessLibGradeSelect = document.getElementById('assess-lib-grade-select');
const assessLibContent = document.getElementById('assess-lib-content');
const assessLibDirectionBtn = document.getElementById('assess-lib-direction-btn');
const assessLibDirectionLabel = document.getElementById('assess-lib-direction-label');
const assessmentLibraryBtn = document.getElementById('assessment-library-btn');
const ratingDirectionBtn = document.getElementById('rating-direction-btn');
const ratingDirectionLabel = document.getElementById('rating-direction-label');
const importStudentsCsvBtn = document.getElementById('import-students-csv-btn');
const csvFileInput = document.getElementById('csv-file-input');
const csvDropZone = document.getElementById('csv-drop-zone');
const csvFileNameDisplay = document.getElementById('csv-file-name');
const csvStep1Next = document.getElementById('csv-step1-next');
const csvStep2Back = document.getElementById('csv-step2-back');
const csvStep2Next = document.getElementById('csv-step2-next');
const csvStep3Back = document.getElementById('csv-step3-back');
const csvStep3Import = document.getElementById('csv-step3-import');
const csvMapTbody = document.getElementById('csv-map-tbody');
const csvImportResult = document.getElementById('csv-import-result');
const zoomResetBtn = document.getElementById('zoom-reset-btn');

function getShowInactiveStudents() {
  return localStorage.getItem('showInactiveStudents') === 'true';
}

function applyChartPan() {
  const t = `translate(${chartPanX}px, ${chartPanY}px) scale(${chartZoom})`;
  chartCanvas.style.transform = (chartPanX === 0 && chartPanY === 0 && chartZoom === 1) ? '' : t;
  const atDefault = chartPanX === 0 && chartPanY === 0 && Math.abs(chartZoom - 1) < 0.001;
  zoomResetBtn.classList.toggle('hidden', atDefault);
  zoomResetBtn.textContent = `${Math.round(chartZoom * 100)}%`;
}

document.addEventListener('DOMContentLoaded', () => {
addStudentBtn.addEventListener('click', () => openStudentModal(null));
backupStudentsBtn.addEventListener('click', backupStudentsCsv);
exportSelectedStudentsBtn.addEventListener('click', openExportSelectedModal);
manageStudentsBtn.addEventListener('click', toggleManageStudents);
clearChartBtn.addEventListener('click', clearChart);
undoClearChartBtn.addEventListener('click', undoClearChart);
chartToolsBtn.addEventListener('click', toggleChartTools);
// Toggle the visibility of the units library panel
function toggleManageUnits() {
  if (!lsaMode) {
    manageUnitsVisible = false;
    renderWorkspace();
    return;
  }
  manageUnitsVisible = !manageUnitsVisible;
  renderWorkspace();
}
showUnitsBtn.addEventListener('click', toggleManageUnits);
lessonLibraryBtn.addEventListener('click', openLessonLibraryModal);
lessonLibraryModal.addEventListener('click', (event) => {
  if (event.target === lessonLibraryModal) closeLessonLibraryModal();
});

importStudentsCsvBtn.addEventListener('click', openCsvImportModal);
csvImportModal.addEventListener('click', (event) => {
  if (event.target === csvImportModal) closeCsvImportModal();
});
document.getElementById('csv-import-close-btn').addEventListener('click', closeCsvImportModal);
csvFileInput.addEventListener('change', (event) => {
  if (event.target.files && event.target.files[0]) handleCsvFileSelect(event.target.files[0]);
});
csvDropZone.addEventListener('dragover', (event) => {
  event.preventDefault();
  csvDropZone.classList.add('drag-over');
});
csvDropZone.addEventListener('dragleave', () => csvDropZone.classList.remove('drag-over'));
csvDropZone.addEventListener('drop', (event) => {
  event.preventDefault();
  csvDropZone.classList.remove('drag-over');
  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (file) handleCsvFileSelect(file);
});
csvStep1Next.addEventListener('click', () => goToCsvStep(2));
csvStep2Back.addEventListener('click', () => goToCsvStep(1));
csvStep2Next.addEventListener('click', () => { saveCsvMapping(); goToCsvStep(3); });
csvStep3Back.addEventListener('click', () => goToCsvStep(2));
csvStep3Import.addEventListener('click', executeCsvImport);
lessonLibCloseBtn.addEventListener('click', closeLessonLibraryModal);
lessonLibAddUnitBtn.addEventListener('click', addLsaUnit);
document.querySelectorAll('.lesson-lib-tab').forEach(btn => {
  btn.addEventListener('click', () => switchLessonLibTab(btn.dataset.tab));
});
lessonLibImportBtn.addEventListener('click', importLessonLibImages);
lessonLibGradeSelect.addEventListener('change', async () => {
  lessonLibrarySelectedGrade = lessonLibGradeSelect.value;
  if (lessonLibrarySelectedGrade) {
    await renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
  } else {
    showGradeAssignmentPlaceholder();
  }
});
arrangeRowsBtn.addEventListener('click', () => autoArrangeChart('rows'));
arrangeCircleBtn.addEventListener('click', () => autoArrangeChart('circle'));
neathenRowsBtn.addEventListener('click', neathenRows);
neathenCircleBtn.addEventListener('click', neathenCircle);
editModeToggleBtn.addEventListener('click', toggleEditMode);
attendanceToggleBtn.addEventListener('click', toggleAttendanceMode);
document.getElementById('mark-all-present-btn').addEventListener('click', markAllPresent);
document.getElementById('clear-good-news-btn').addEventListener('click', clearGoodNewsChecks);
document.getElementById('clear-color-dots-btn').addEventListener('click', clearColorDots);
lsaToggleBtn.addEventListener('click', toggleLsaMode);
assessmentToggleBtn.addEventListener('click', toggleAssessmentMode);
// Toggle the visibility of the assessments library panel
function toggleManageAssessments() {
  if (!assessmentMode) {
    manageAssessmentsVisible = false;
    renderWorkspace();
    return;
  }
  manageAssessmentsVisible = !manageAssessmentsVisible;
  renderWorkspace();
}
showAssessmentsBtn.addEventListener('click', toggleManageAssessments);
assessmentLibraryBtn.addEventListener('click', openAssessmentLibrary);
ratingDirectionBtn.addEventListener('click', toggleRatingDirection);
assessLibDirectionBtn.addEventListener('click', toggleRatingDirection);
assessLibCloseBtn.addEventListener('click', closeAssessmentLibrary);
assessmentLibraryModal.addEventListener('click', event => { if (event.target === assessmentLibraryModal) closeAssessmentLibrary(); });
multiGradeGearBtn.addEventListener('click', openMultiGradeModal);
multiGradeCloseBtn.addEventListener('click', closeMultiGradeModal);
multiGradeDoneBtn.addEventListener('click', closeMultiGradeModal);
multiGradeModal.addEventListener('click', event => { if (event.target === multiGradeModal) closeMultiGradeModal(); });
assessLibGradeSelect.addEventListener('change', async () => {
  assessLibraryGrade = assessLibGradeSelect.value;
  await loadAssessmentLibraryForGrade(assessLibraryGrade);
  renderAssessLibContent();
});
toggleSeatingChartsListBtn.addEventListener('click', toggleSeatingChartsList);
toggleClassesListBtn.addEventListener('click', toggleClassesList);
addSeatingChartBtn.addEventListener('click', createAdditionalSeatingChart);
settingsGearBtn.addEventListener('click', toggleSettingsMenu);
resetStudentDataBtn.addEventListener('click', handleResetStudentData);
resetFactoryBtn.addEventListener('click', handleResetFactoryData);
exportRubricsBtn.addEventListener('click', handleExportRubrics);
importRubricsBtn.addEventListener('click', handleImportRubrics);

checkForUpdatesBtn.addEventListener('click', () => {
  setUpdateStatus('checking', 'Checking for updates…');
  window.api.checkForUpdates();
});

function setUpdateStatus(type, text) {
  updateStatusLine.textContent = text;
  updateStatusLine.className = 'update-status-line';
  if (type === 'success') updateStatusLine.classList.add('success');
  if (type === 'error') updateStatusLine.classList.add('error');
  updateStatusLine.classList.remove('hidden');
}

window.api.onUpdateStatus((status, payload) => {
  if (status === 'not-available') {
    setUpdateStatus('success', 'You have the latest version.');
  } else if (status === 'available') {
    setUpdateStatus('checking', `Version ${payload} available — downloading…`);
    window.api.downloadUpdate();
  } else if (status === 'progress') {
    setUpdateStatus('checking', `Downloading… ${payload}%`);
  } else if (status === 'downloaded') {
    setUpdateStatus('success', 'Update ready.');
    checkForUpdatesBtn.textContent = 'Restart to Update';
    checkForUpdatesBtn.addEventListener('click', () => window.api.installUpdate(), { once: true });
  } else if (status === 'error') {
    setUpdateStatus('error', `Update error: ${payload}`);
  }
});

// Font switcher — load saved choice and wire up change
(function initFontSwitcher() {
  const saved = localStorage.getItem('appFont');
  if (saved) {
    document.body.style.fontFamily = saved;
    fontSwitcher.value = saved;
  }
  fontSwitcher.addEventListener('change', () => {
    document.body.style.fontFamily = fontSwitcher.value;
    localStorage.setItem('appFont', fontSwitcher.value);
  });
})()

// View selector event listeners
viewSeatingBtn.addEventListener('click', () => switchView('seating'));
viewGradebookBtn.addEventListener('click', () => switchView('gradebook'));
gradebookTabAttendanceBtn.addEventListener('click', () => setGradebookTab('attendance'));
gradebookTabLsaBtn.addEventListener('click', () => setGradebookTab('lsa'));
gradebookTabAssessmentBtn.addEventListener('click', () => setGradebookTab('assessment'));
gradebookTabRhythmBtn.addEventListener('click', () => setGradebookTab('rhythm'));
gradebookTabMovementBtn.addEventListener('click', () => setGradebookTab('movement'));
gradebookTabInstrumentBtn.addEventListener('click', () => setGradebookTab('instrument'));
gradebookTabRecordersBtn.addEventListener('click', () => setGradebookTab('recorders'));
gradebookTabImmaBtn.addEventListener('click', () => setGradebookTab('imma'));



showInactiveBtn.addEventListener('click', () => {
  const newState = !getShowInactiveStudents();
  localStorage.setItem('showInactiveStudents', newState);
  renderWorkspace();
});


document.addEventListener('click', event => {
  if (!settingsMenuOpen) {
    return;
  }

  if (event.target !== settingsGearBtn && !settingsDropdown.contains(event.target)) {
    setSettingsMenuOpen(false);
  }
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && settingsMenuOpen) {
    setSettingsMenuOpen(false);
  }
});

document.getElementById('student-modal-close').addEventListener('click', closeStudentModal);
studentModal.addEventListener('click', event => {
  if (event.target.id === 'student-modal') {
    closeStudentModal();
  }
});
studentModal.querySelector('.modal').addEventListener('click', event => {
  event.stopPropagation();
});

document.getElementById('student-form').addEventListener('submit', async event => {
  event.preventDefault();

  const id = document.getElementById('student-id').value;
  const student = {
    first_name: document.getElementById('student-first-name').value.trim(),
    last_name: document.getElementById('student-last-name').value.trim(),
    email: document.getElementById('student-email').value.trim(),
    student_number: document.getElementById('student-number').value.trim() || null,
    grade: document.getElementById('student-grade').value.trim(),
    teacher: document.getElementById('student-teacher').value.trim(),
    notes: document.getElementById('student-notes').value.trim(),
    is_active: document.getElementById('student-is-active').checked ? 1 : 0,
  };

  if (id) {
    const existingStudent = students.find(s => s.id === Number(id));
    student.lsa_easy = existingStudent ? (existingStudent.lsa_easy || null) : null;
    student.lsa_medium = existingStudent ? (existingStudent.lsa_medium || null) : null;
    student.lsa_difficult = existingStudent ? (existingStudent.lsa_difficult || null) : null;
    student.lsa_units = existingStudent ? JSON.stringify(existingStudent.lsa_units || {}) : null;
    student.recorder_color = existingStudent ? (existingStudent.recorder_color || null) : null;
    student.good_news_shared = existingStudent ? (existingStudent.good_news_shared ? 1 : 0) : 0;
    student.is_active = student.is_active === 0 ? 0 : 1;
    student.id = Number(id);
    await window.api.updateStudent(student);
  } else {
    student.lsa_units = null;
    student.recorder_color = null;
    student.good_news_shared = 0;
    student.is_active = 1;
    await window.api.addStudent(student);
  }

  closeStudentModal();
  studentSearchInput.value = '';
  await loadStudents(true);
  await loadSeatingCharts(true);
  if (activeSeatingChartId) {
    await persistActiveSeatingChart();
  }
  renderWorkspace();
});

studentSearchInput.addEventListener('input', () => renderWorkspace());

// Drop zone covers the full chart-shell so dragging works at any zoom level.
// Visual drag-over feedback is applied to chartCanvas (the styled inner element).
chartShell.addEventListener('dragover', event => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  chartCanvas.classList.add('drag-over');
});
chartShell.addEventListener('dragleave', event => {
  if (!chartShell.contains(event.relatedTarget)) {
    chartCanvas.classList.remove('drag-over');
  }
});
chartShell.addEventListener('drop', event => {
  event.preventDefault();
  chartCanvas.classList.remove('drag-over');
  const studentId = event.dataTransfer.getData('text/plain');
  if (!studentId) return;
  Promise.resolve(handleChartDrop(studentId, event)).catch(error => {
    console.error('[renderer] drop handler failed:', error);
  });
});
setupDropZone(rosterList, handleRosterDrop);

// --- Chart pan (right-click drag + two-finger touch) ---

zoomResetBtn.addEventListener('click', () => {
  chartPanX = 0;
  chartPanY = 0;
  chartZoom = 1;
  applyChartPan();
});

(function setupChartPan() {
  const shell = chartCanvas.closest('.chart-shell') || chartCanvas.parentElement;
  if (!shell) return;

  // Prevent the browser context menu on right-click inside the chart area
  shell.addEventListener('contextmenu', event => event.preventDefault());

  // Scroll-wheel zoom (centered on cursor)
  shell.addEventListener('wheel', event => {
    event.preventDefault();
    const shellRect = shell.getBoundingClientRect();
    const mx = event.clientX - shellRect.left;
    const my = event.clientY - shellRect.top;
    const delta = event.deltaY > 0 ? 0.9 : 1 / 0.9;
    const newZoom = Math.min(CHART_ZOOM_MAX, Math.max(CHART_ZOOM_MIN, chartZoom * delta));
    chartPanX = mx - (mx - chartPanX) * (newZoom / chartZoom);
    chartPanY = my - (my - chartPanY) * (newZoom / chartZoom);
    chartZoom = newZoom;
    applyChartPan();
  }, { passive: false });

  // Right-click drag (mouse)
  shell.addEventListener('mousedown', event => {
    if (event.button !== 2) return;
    event.preventDefault();
    shell.style.cursor = 'grabbing';
    const startX = event.clientX - chartPanX;
    const startY = event.clientY - chartPanY;

    function onMove(e) {
      chartPanX = e.clientX - startX;
      chartPanY = e.clientY - startY;
      applyChartPan();
    }
    function onUp() {
      shell.style.cursor = '';
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  // Two-finger touch pan
  let panTouches = null;
  let pinchStartDist = null;
  let pinchStartZoom = 1;
  shell.addEventListener('touchstart', event => {
    if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      pinchStartDist = Math.hypot(dx, dy);
      pinchStartZoom = chartZoom;
      panTouches = {
        startPanX: chartPanX,
        startPanY: chartPanY,
        startCX: (event.touches[0].clientX + event.touches[1].clientX) / 2,
        startCY: (event.touches[0].clientY + event.touches[1].clientY) / 2,
      };
    } else {
      panTouches = null;
      pinchStartDist = null;
    }
  }, { passive: true });

  shell.addEventListener('touchmove', event => {
    if (!panTouches || event.touches.length !== 2) return;
    const dx = event.touches[0].clientX - event.touches[1].clientX;
    const dy = event.touches[0].clientY - event.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
    const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
    const shellRect = shell.getBoundingClientRect();
    const mx = cx - shellRect.left;
    const my = cy - shellRect.top;
    const newZoom = Math.min(CHART_ZOOM_MAX, Math.max(CHART_ZOOM_MIN, pinchStartZoom * dist / pinchStartDist));
    // Keep the pinch midpoint fixed in canvas-local space
    chartPanX = (cx - shellRect.left) - ((panTouches.startCX - shellRect.left) - panTouches.startPanX) * newZoom;
    chartPanY = (cy - shellRect.top)  - ((panTouches.startCY - shellRect.top)  - panTouches.startPanY) * newZoom;
    chartZoom = newZoom;
    applyChartPan();
  }, { passive: true });

  shell.addEventListener('touchend', () => { panTouches = null; pinchStartDist = null; }, { passive: true });
  shell.addEventListener('touchcancel', () => { panTouches = null; pinchStartDist = null; }, { passive: true });
})();

async function loadCustomUnits() {
  if (!window.api.getLsaCustomUnits) return;
  try {
    const customUnitNumbers = await window.api.getLsaCustomUnits();
    if (customUnitNumbers.length > 0) {
      totalLsaUnits = Math.max(14, Math.max(...customUnitNumbers));
    }
  } catch (err) {
    console.error('[renderer] failed to load custom units:', err);
  }
}

async function initializeWorkspace() {
  await loadAcademicYear();
  await loadCustomUnits();
  await loadStudents(true);
  await loadSeatingCharts(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  await loadAssessmentLibraryForGrade(getActiveClassGrade());
  renderWorkspace();
}

async function loadLsaUnitPlaceholderPositions(skipRender = false) {
  if (!window.api.getLsaUnitPlaceholders) {
    return;
  }

  const classKey = getActiveClassKeyForCharts();
  let rows = [];
  try {
    rows = await window.api.getLsaUnitPlaceholders(classKey);
  } catch (error) {
    // Do not block class switching/workspace rendering if placeholder persistence is unavailable.
    console.error('[renderer] failed to load LSA placeholder positions:', error);
    return;
  }

  Array.from(lsaUnitPlaceholderPositions.keys()).forEach(key => {
    if (key.startsWith(`${classKey}::unit-`)) {
      lsaUnitPlaceholderPositions.delete(key);
    }
  });

  rows.forEach(row => {
    const key = `${classKey}::unit-${Number(row.unit_number)}`;
    lsaUnitPlaceholderPositions.set(key, { x: Number(row.x), y: Number(row.y) });
  });

  if (!skipRender) {
    renderWorkspace();
  }
}

async function loadLsaUnitPromptImages(skipRender = false) {
  const classKey = getActiveClassKeyForCharts();

  // Clear existing data for this class key
  Array.from(lsaUnitPromptImages.keys()).forEach(key => {
    if (key.startsWith(`${classKey}::unit-`)) {
      lsaUnitPromptImages.delete(key);
      lsaUnitHelperLabels.delete(key);
      lsaUnitLessonFileNames.delete(key);
      lsaUnitAudioPaths.delete(key);
    }
  });

  // Step 1: seed from grade-level library assignments as the base
  if (classKey && window.api.getLsaGradeUnitMap) {
    const grade = getActiveClassGrade();
    if (grade) {
      try {
        const gradeRows = await window.api.getLsaGradeUnitMap(grade);
        if (gradeRows && gradeRows.length > 0) {
          gradeRows.forEach(row => {
            if (row.lesson_id && row.image_url) {
              const key = `${classKey}::unit-${Number(row.unit_number)}`;
              lsaUnitPromptImages.set(key, row.image_url);
              lsaUnitLessonFileNames.set(key, row.file_name || '');
              if (row.audio_url) lsaUnitAudioPaths.set(key, row.audio_url);
            }
          });
        }
      } catch (err) {
        console.error('[renderer] failed to load grade unit map:', err);
      }
    }
  }

  // Step 2: overlay class-specific overrides on top of grade defaults
  if (window.api.getLsaUnitAssets) {
    try {
      const rows = await window.api.getLsaUnitAssets(classKey);
      rows.forEach(row => {
        if (row.image_url) {
          const key = `${classKey}::unit-${Number(row.unit_number)}`;
          lsaUnitPromptImages.set(key, row.image_url);
          lsaUnitLessonFileNames.set(key, row.file_name || lsaUnitLessonFileNames.get(key) || '');
          if (row.audio_url) lsaUnitAudioPaths.set(key, row.audio_url);
        }
      });
    } catch (error) {
      console.error('[renderer] failed to load LSA unit prompt images:', error);
    }
  }

  if (!skipRender) {
    renderWorkspace();
  }
}

function createDefaultLayout(index) {
  return {
    placed: false,
    x: 32 + (index % 3) * 162,
    y: 96 + Math.floor(index / 3) * 108,
    state: 'ready',
    attendance: null,
    assessmentRatings: {},
  };
}

async function loadStudents(skipRender = false) {
  try {
    const storedStudents = await window.api.getStudents();
    usingSampleRoster = storedStudents.length === 0;
    students = usingSampleRoster ? fallbackStudents : storedStudents;
    students.forEach(student => normalizeStudentLsaUnits(student));
    if (usingSampleRoster) {
      activeClassTeacher = null;
    }
    syncLayoutState();
    await loadAttendanceRecordsForScope(true);
    if (!skipRender) {
      renderWorkspace();
    }
    console.log('[renderer] students loaded:', storedStudents.length);
  } catch (error) {
    console.error('[renderer] failed to load students:', error);
    usingSampleRoster = true;
    students = fallbackStudents;
    students.forEach(student => normalizeStudentLsaUnits(student));
    activeClassTeacher = null;
    syncLayoutState();
    await loadAttendanceRecordsForScope(true);
    if (!skipRender) {
      renderWorkspace();
    }
  }
}

async function loadSeatingCharts(skipRender = false) {
  if (usingSampleRoster || !hasSelectedClassContext()) {
    seatingCharts = [];
    activeSeatingChartId = null;
    applySeatingChartItems([]);
    if (!skipRender) {
      renderWorkspace();
    }
    return;
  }

  seatingCharts = await window.api.getSeatingCharts(getActiveClassKeyForCharts());

  if (activeSeatingChartId && !seatingCharts.some(chart => chart.id === activeSeatingChartId)) {
    activeSeatingChartId = null;
  }

  if (!activeSeatingChartId && seatingCharts.length > 0) {
    activeSeatingChartId = seatingCharts[0].id;
  }

  if (activeSeatingChartId) {
    await loadSeatingChartIntoLayout(activeSeatingChartId, skipRender);
  } else {
    applySeatingChartItems([]);
    if (!skipRender) {
      renderWorkspace();
    }
  }
}

async function loadSeatingChartIntoLayout(chartId, skipRender = false) {
  const chart = await window.api.getSeatingChart(chartId, getActiveClassKeyForCharts());
  if (!chart) {
    return;
  }

  activeSeatingChartId = chart.id;
  applySeatingChartItems(chart.items || [], chart.arrangement || '');
  syncTodayAttendanceToLayout();

  if (!skipRender) {
    renderWorkspace();
  }
}

function applySeatingChartItems(items, arrangement = '') {
  // Reset all circle-mode canvas state so switching charts never carries over stale card sizing.
  chartCanvas.dataset.circle = '';
  chartCanvas.dataset.compactCircle = '';
  chartCanvas.dataset.superCompactCircle = '';
  chartCanvas.style.removeProperty('--circle-card-w');
  chartCanvas.style.removeProperty('--circle-card-h');
  chartCanvas.style.removeProperty('--circle-card-scale');
  teacherCirclePos = null;

  const itemMap = new Map(items.map(item => [String(item.student_id), item]));

  students.forEach((student, index) => {
    const studentId = String(student.id);
    const item = itemMap.get(studentId);
    const fallbackLayout = createDefaultLayout(index);
    const layout = layoutState.get(studentId) || fallbackLayout;

    layout.placed = Boolean(item?.placed);
    layout.x = item?.x ?? fallbackLayout.x;
    layout.y = item?.y ?? fallbackLayout.y;
    layout.state = item?.state || 'ready';
    layout.attendance = item?.attendance || null;
    layout.assessmentRatings = item?.assessment_rating ? (typeof item.assessment_rating === 'string' ? JSON.parse(item.assessment_rating) : item.assessment_rating) : {};
    layoutState.set(studentId, layout);
  });

  // If the saved chart was a circle arrangement, recompute circle sizing and teacher position
  // so cards render at the correct compact size without requiring a manual neaten/arrange.
  if (arrangement === 'circle') {
    const placed = students.filter(s => getStudentLayout(s.id).placed);
    if (placed.length > 0) {
      computeCircleSlots(placed, CANVAS_W, CANVAS_H);
    }
  }
}

function syncLayoutState() {
  const validIds = new Set(students.map(student => String(student.id)));

  Array.from(layoutState.keys()).forEach(studentId => {
    if (!validIds.has(studentId)) {
      layoutState.delete(studentId);
    }
  });

  students.forEach((student, index) => {
    const studentId = String(student.id);
    if (!layoutState.has(studentId)) {
      layoutState.set(studentId, createDefaultLayout(index));
    } else {
      const layout = layoutState.get(studentId);
      if (!Object.prototype.hasOwnProperty.call(layout, 'attendance')) {
        layout.attendance = null;
      }
      if (!Object.prototype.hasOwnProperty.call(layout, 'state')) {
        layout.state = 'ready';
      }
    }
  });

  if (selectedStudentId && !validIds.has(selectedStudentId)) {
    selectedStudentId = null;
  }
}

// After chart cards are in the DOM, shrink any first-name text that still overflows.
function fitStudentNames() {
  requestAnimationFrame(() => {
    [chartCanvas, rosterList].forEach(container => {
      container.querySelectorAll('.student-name-first').forEach(el => {
        el.style.fontSize = '';
        if (el.scrollWidth <= el.clientWidth) return;
        const base = parseFloat(getComputedStyle(el).fontSize);
        const min = base * 0.62;
        let size = base;
        while (el.scrollWidth > el.clientWidth && size > min) {
          size -= 1;
          el.style.fontSize = `${size}px`;
        }
      });
    });
  });
}

function setSettingsMenuOpen(isOpen) {
  settingsMenuOpen = isOpen;
  settingsDropdown.classList.toggle('hidden', !isOpen);
  settingsGearBtn.setAttribute('aria-expanded', String(isOpen));
}

function toggleSettingsMenu(event) {
  event.stopPropagation();
  setSettingsMenuOpen(!settingsMenuOpen);
}

async function refreshAllWorkspaceData() {
  await loadStudents(true);
  await loadSeatingCharts(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  renderWorkspace();
}

async function handleResetStudentData() {
  setSettingsMenuOpen(false);

  const confirmed = window.confirm(
    'Reset Student Data Only?\n\nThis removes students, attendance, seating placements, and LSA placeholder positions. Classes, instruments, and seating chart names remain.'
  );
  if (!confirmed) {
    return;
  }

  try {
    await window.api.resetStudentData();
    selectedStudentId = null;
    activeClassTeacher = null;
    activeSeatingChartId = null;
    activeLsaUnit = 1;
    lsaUnitPlaceholderPositions.clear();
    lsaUnitPromptImages.clear();
    lsaUnitHelperLabels.clear();
    await refreshAllWorkspaceData();
    alert('Student data reset complete.');
  } catch (error) {
    console.error('[renderer] reset student data failed:', error);
    alert('Could not reset student data. Please try again.');
  }
}

async function handleResetFactoryData() {
  setSettingsMenuOpen(false);

  const confirmed = window.confirm(
    'Full Factory Reset?\n\nThis removes all app data: students, attendance, seating charts, classes, instruments, responses, and unit placeholder positions.'
  );
  if (!confirmed) {
    return;
  }

  try {
    await window.api.resetFactoryData();
    selectedStudentId = null;
    activeClassTeacher = null;
    activeSeatingChartId = null;
    activeLsaUnit = 1;
    manageUnitsVisible = false;
    lsaUnitPlaceholderPositions.clear();
    lsaUnitPromptImages.clear();
    lsaUnitHelperLabels.clear();
    await refreshAllWorkspaceData();
    alert('Factory reset complete.');
  } catch (error) {
    console.error('[renderer] factory reset failed:', error);
    alert('Could not complete factory reset. Please try again.');
  }
}

function normalizeStudentLsaUnits(student) {
  let parsed = {};
  if (student.lsa_units && typeof student.lsa_units === 'string') {
    try {
      parsed = JSON.parse(student.lsa_units) || {};
    } catch {
      parsed = {};
    }
  } else if (student.lsa_units && typeof student.lsa_units === 'object') {
    parsed = student.lsa_units;
  }

  const unitKey = '1';
  if (!parsed[unitKey]) {
    parsed[unitKey] = {};
  }
  if (!parsed[unitKey].easy && student.lsa_easy) {
    parsed[unitKey].easy = student.lsa_easy;
  }
  if (!parsed[unitKey].medium && student.lsa_medium) {
    parsed[unitKey].medium = student.lsa_medium;
  }
  if (!parsed[unitKey].difficult && student.lsa_difficult) {
    parsed[unitKey].difficult = student.lsa_difficult;
  }

  student.lsa_units = parsed;
}

function getStudentUnitScore(student, unitNumber, activity) {
  const unitKey = String(unitNumber);
  return student.lsa_units?.[unitKey]?.[activity] || null;
}

function setStudentUnitScore(student, unitNumber, activity, value) {
  const unitKey = String(unitNumber);
  if (!student.lsa_units || typeof student.lsa_units !== 'object') {
    student.lsa_units = {};
  }
  if (!student.lsa_units[unitKey]) {
    student.lsa_units[unitKey] = {};
  }

  if (value) {
    student.lsa_units[unitKey][activity] = value;
  } else {
    delete student.lsa_units[unitKey][activity];
  }

  if (unitNumber === 1) {
    if (activity === 'easy') student.lsa_easy = value;
    if (activity === 'medium') student.lsa_medium = value;
    if (activity === 'difficult') student.lsa_difficult = value;
  }
}

function isFourthGradeClassSelected() {
  if (usingSampleRoster || activeClassTeacher === null) {
    return false;
  }

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    return false;
  }

  return scopedStudents.every(student => normalizeGrade(student.grade) === '4');
}

function renderRecordersTabVisibility() {
  const shouldShow = isFourthGradeClassSelected();
  gradebookTabRecordersBtn.classList.toggle('hidden', !shouldShow);

  if (!shouldShow && activeGradebookTab === 'recorders') {
    setGradebookTab('attendance');
  }
}

function renderGradebookClassSubtitle() {
  if (!gradebookClassSubtitle) {
    return;
  }

  const classLabel = usingSampleRoster
    ? 'Sample Roster'
    : activeClassTeacher === null
      ? 'All Classes'
      : getTeacherLabel(activeClassTeacher);

  gradebookClassSubtitle.textContent = `Class: ${classLabel}`;
}

function getTodayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateHeader(isoDate) {
  const [year, month, day] = String(isoDate).split('-');
  if (!year || !month || !day) {
    return isoDate;
  }
  return `${month}/${day}/${year.slice(-2)}`;
}

function getAttendanceNameColumnWidths(scopedStudents) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) {
    return { first: 132, last: 132 };
  }

  context.font = '13px Georgia, "Times New Roman", serif';
  const firstLabelWidth = context.measureText('First').width;
  const lastLabelWidth = context.measureText('Last').width;

  let firstMax = firstLabelWidth;
  let lastMax = lastLabelWidth;

  scopedStudents.forEach(student => {
    const first = String(student.first_name || '');
    const last = String(student.last_name || '');
    firstMax = Math.max(firstMax, context.measureText(first).width);
    lastMax = Math.max(lastMax, context.measureText(last).width);
  });

  // Add cell padding and clamp to reasonable bounds.
  return {
    first: Math.min(260, Math.max(82, Math.ceil(firstMax + 24))),
    last: Math.min(260, Math.max(82, Math.ceil(lastMax + 24))),
  };
}

function getAttendanceStatusForDate(studentId, isoDate) {
  const studentMap = attendanceByDateByStudent.get(String(studentId));
  if (!studentMap) {
    return null;
  }
  return studentMap.get(isoDate) || null;
}

function setAttendanceStatusForDate(studentId, isoDate, status) {
  const key = String(studentId);
  if (!attendanceByDateByStudent.has(key)) {
    attendanceByDateByStudent.set(key, new Map());
  }
  const studentMap = attendanceByDateByStudent.get(key);
  if (!status) {
    studentMap.delete(isoDate);
    return;
  }
  studentMap.set(isoDate, status);
}

function getNextAttendanceStatus(currentStatus) {
  if (!currentStatus) return 'present';
  if (currentStatus === 'present') return 'absent';
  if (currentStatus === 'absent') return 'late';
  return null;
}

async function updateAttendanceByDate(studentId, isoDate, nextStatus) {
  setAttendanceStatusForDate(studentId, isoDate, nextStatus);

  if (isoDate === getTodayIsoDate()) {
    const layout = getStudentLayout(studentId);
    if (layout) {
      layout.attendance = nextStatus;
    }
  }

  renderWorkspace();

  try {
    if (nextStatus) {
      await window.api.upsertAttendanceRecord(studentId, isoDate, nextStatus);
    } else {
      await window.api.deleteAttendanceRecord(studentId, isoDate);
    }
  } catch (error) {
    console.error('[renderer] failed to update attendance by date:', error);
  }
}

function syncTodayAttendanceToLayout() {
  const today = getTodayIsoDate();
  students.forEach(student => {
    const layout = getStudentLayout(student.id);
    if (!layout) return;
    layout.attendance = getAttendanceStatusForDate(student.id, today);
  });
}

async function loadAttendanceRecordsForScope(skipRender = false) {
  if (usingSampleRoster) {
    attendanceByDateByStudent = new Map();
    if (!skipRender) {
      renderWorkspace();
    }
    return;
  }

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    attendanceByDateByStudent = new Map();
    syncTodayAttendanceToLayout();
    if (!skipRender) {
      renderWorkspace();
    }
    return;
  }

  const records = await window.api.getAttendanceRecords(scopedStudents.map(student => student.id));
  const nextMap = new Map();
  records.forEach(record => {
    const key = String(record.student_id);
    if (!nextMap.has(key)) {
      nextMap.set(key, new Map());
    }
    nextMap.get(key).set(record.attendance_date, record.status);
  });

  attendanceByDateByStudent = nextMap;
  syncTodayAttendanceToLayout();

  if (!skipRender) {
    renderWorkspace();
  }
}

function renderAttendanceGrid() {
  if (!attendanceCanvas) {
    return;
  }

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    attendanceCanvas.style.setProperty('--att-col0-width', '52px');
    attendanceCanvas.style.setProperty('--att-col1-width', '132px');
    attendanceCanvas.style.setProperty('--att-col2-width', '132px');
    attendanceCanvas.innerHTML = '<div class="attendance-empty">Select a class with students to view attendance history.</div>';
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  attendanceCanvas.style.setProperty('--att-col0-width', '52px');
  attendanceCanvas.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  attendanceCanvas.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);

  const dateSet = new Set([getTodayIsoDate()]);
  scopedStudents.forEach(student => {
    const studentMap = attendanceByDateByStudent.get(String(student.id));
    if (!studentMap) return;
    Array.from(studentMap.keys()).forEach(dateKey => dateSet.add(dateKey));
  });

  const dateColumns = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  const headerCells = dateColumns
    .map(dateKey => `<th>${escHtml(formatDateHeader(dateKey))}</th>`)
    .join('');

  const rows = [...scopedStudents]
    .sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    })
    .map((student, index) => {
      const dateCells = dateColumns
        .map(dateKey => {
          const status = getAttendanceStatusForDate(student.id, dateKey);
          const label = status === 'present'
            ? 'P'
            : status === 'absent'
              ? 'AB'
              : status === 'late'
                ? 'Late'
                : '';
          const statusClass = status ? ` ${status}` : '';
                  return `<td class="attendance-cell attendance-editable${statusClass}" data-student-id="${escHtml(String(student.id))}" data-attendance-date="${escHtml(dateKey)}" title="Click to cycle: P → AB → Late → Clear">${escHtml(label)}</td>`;
        })
        .join('');

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escHtml(student.first_name || '')}</td>
          <td>${escHtml(student.last_name || '')}</td>
          ${dateCells}
        </tr>
      `;
    })
    .join('');

  attendanceCanvas.innerHTML = `
    <table class="attendance-grid">
      <thead>
        <tr>
          <th></th>
          <th>First</th>
          <th>Last</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  attendanceCanvas.querySelectorAll('.attendance-editable').forEach(cell => {
    cell.addEventListener('click', async () => {
      const studentId = Number(cell.dataset.studentId);
      const attendanceDate = cell.dataset.attendanceDate;
      if (!studentId || !attendanceDate) {
        return;
      }
      const current = getAttendanceStatusForDate(studentId, attendanceDate);
      const next = getNextAttendanceStatus(current);
      await updateAttendanceByDate(studentId, attendanceDate, next);
    });
  });
}

function renderLsaGrid() {
  if (!lsaGridCanvas) {
    return;
  }

  const canEdit = lsaMode;

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    lsaGridCanvas.style.setProperty('--att-col0-width', '52px');
    lsaGridCanvas.style.setProperty('--att-col1-width', '132px');
    lsaGridCanvas.style.setProperty('--att-col2-width', '132px');
    lsaGridCanvas.innerHTML = '<div class="attendance-empty">Select a class with students to view LSA records.</div>';
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  const lsaValueColumnWidth = 34;
  const lsaValueColumnCount = totalLsaUnits * 3;
  const lsaTableWidth = 52 + nameColumnWidths.first + nameColumnWidths.last + (lsaValueColumnCount * lsaValueColumnWidth);
  lsaGridCanvas.style.setProperty('--att-col0-width', '52px');
  lsaGridCanvas.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  lsaGridCanvas.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);
  lsaGridCanvas.style.setProperty('--lsa-col-width', `${lsaValueColumnWidth}px`);

  const scoreMarkup = (score) => {
    if (score === 'teacher') return '<span class="lsa-mark lsa-mark-teacher">│</span>';
    if (score === 'eval') return '<span class="lsa-mark lsa-mark-eval">+</span>';
    return '';
  };

  const scoreClass = (score) => {
    if (score === 'teacher') return ' teacher';
    if (score === 'eval') return ' eval';
    return '';
  };

  const rows = [...scopedStudents]
    .sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    })
    .map((student, index) => {
      const unitCells = Array.from({ length: totalLsaUnits }, (_, unitOffset) => {
        const unitNumber = unitOffset + 1;
        return ['easy', 'medium', 'difficult'].map(activity => {
          const score = getStudentUnitScore(student, unitNumber, activity);
          const isEditable = canEdit && unitNumber === activeLsaUnit;
          return `<td class="attendance-cell lsa-cell ${isEditable ? 'lsa-editable' : 'readonly'}${scoreClass(score)}" data-student-id="${escHtml(String(student.id))}" data-lsa-unit="${unitNumber}" data-lsa-activity="${activity}" title="${isEditable ? 'Click to cycle: Empty → │ → + → Clear' : 'Select this unit in Show Units to edit'}">${scoreMarkup(score)}</td>`;
        }).join('');
      }).join('');

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escHtml(student.first_name || '')}</td>
          <td>${escHtml(student.last_name || '')}</td>
          ${unitCells}
        </tr>
      `;
    })
    .join('');

  const classKey = getActiveClassKeyForCharts();
  const lsaGroupHeaders = Array.from({ length: totalLsaUnits }, (_, i) => {
    const unitNumber = i + 1;
    const unitKey = `${classKey}::unit-${unitNumber}`;
    const rawFileName = lsaUnitLessonFileNames.get(unitKey) || '';
    const label = rawFileName ? rawFileName.replace(/\.[^/.]+$/, '') : `LSA ${unitNumber}`;
    return `<th colspan="3">${escHtml(label)}</th>`;
  }).join('');
  const lsaSubHeaders = Array.from({ length: totalLsaUnits }, () => '<th>E</th><th>M</th><th>D</th>').join('');
  const lsaValueCols = Array.from({ length: lsaValueColumnCount }, () => `<col style="width:${lsaValueColumnWidth}px; min-width:${lsaValueColumnWidth}px; max-width:${lsaValueColumnWidth}px;">`).join('');

  lsaGridCanvas.innerHTML = `
    <table class="attendance-grid lsa-grid" style="width:${lsaTableWidth}px; min-width:${lsaTableWidth}px; max-width:${lsaTableWidth}px;">
      <colgroup>
        <col style="width:var(--att-col0-width, 52px); min-width:var(--att-col0-width, 52px); max-width:var(--att-col0-width, 52px);">
        <col style="width:var(--att-col1-width, 132px); min-width:var(--att-col1-width, 132px); max-width:var(--att-col1-width, 132px);">
        <col style="width:var(--att-col2-width, 132px); min-width:var(--att-col2-width, 132px); max-width:var(--att-col2-width, 132px);">
        ${lsaValueCols}
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2"></th>
          <th rowspan="2">First</th>
          <th rowspan="2">Last</th>
          ${lsaGroupHeaders}
        </tr>
        <tr>
          ${lsaSubHeaders}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  if (!canEdit) {
    return;
  }

  lsaGridCanvas.querySelectorAll('.lsa-editable').forEach(cell => {
    cell.addEventListener('click', async () => {
      const studentId = Number(cell.dataset.studentId);
      const unit = Number(cell.dataset.lsaUnit || activeLsaUnit);
      const activity = cell.dataset.lsaActivity;
      if (!studentId || !activity) {
        return;
      }
      await cycleLsaScore(studentId, activity, unit);
    });
  });

}

function renderAssessGroupGrid(assessNums, canvasEl, emptyMsg) {
  if (!canvasEl) return;

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    canvasEl.style.setProperty('--att-col0-width', '52px');
    canvasEl.style.setProperty('--att-col1-width', '132px');
    canvasEl.style.setProperty('--att-col2-width', '132px');
    canvasEl.innerHTML = `<div class="attendance-empty">${escHtml(emptyMsg)}</div>`;
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  const ratingColWidth = 60;
  const tableWidth = 52 + nameColumnWidths.first + nameColumnWidths.last + (assessNums.length * ratingColWidth);

  canvasEl.style.setProperty('--att-col0-width', '52px');
  canvasEl.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  canvasEl.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);

  const ratingLabel = { 1: '1', 2: '2', 3: '3', 4: '4' };

  const rows = [...scopedStudents]
    .sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    })
    .map((student, index) => {
      const layout = layoutState.get(String(student.id));
      const ratings = layout?.assessmentRatings || {};
      const cells = assessNums.map(n => {
        const r = ratings[n] ?? null;
        const cls = r ? ` ${getRatingClass(r)}` : '';
        return `<td class="attendance-cell assess-grid-cell assess-grid-editable${cls}" data-student-id="${escHtml(String(student.id))}" data-assess-num="${n}" title="Click to cycle: Empty \u2192 1 \u2192 2 \u2192 3 \u2192 4 \u2192 Clear">${r ? escHtml(ratingLabel[r]) : ''}</td>`;
      }).join('');
      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escHtml(student.first_name || '')}</td>
          <td>${escHtml(student.last_name || '')}</td>
          ${cells}
        </tr>
      `;
    })
    .join('');

  const ratingCols = assessNums.map(() =>
    `<col style="width:${ratingColWidth}px; min-width:${ratingColWidth}px; max-width:${ratingColWidth}px;">`
  ).join('');

  const headerCells = assessNums.map(n => {
    const { base, subtitle } = getAssessmentLabelParts(n);
    const subSpan = subtitle ? `<span class="assess-th-sub">${escHtml(subtitle)}</span>` : '';
    return `<th title="${escHtml(getAssessmentLabel(n))}"><span class="assess-th-base">${escHtml(base)}</span>${subSpan}</th>`;
  }).join('');

  const savedScrollLeft = canvasEl.scrollLeft;
  const savedScrollTop = canvasEl.scrollTop;
  canvasEl.innerHTML = `
    <table class="attendance-grid assessment-grid" style="width:${tableWidth}px; min-width:${tableWidth}px; max-width:${tableWidth}px;">
      <colgroup>
        <col style="width:var(--att-col0-width, 52px); min-width:var(--att-col0-width, 52px); max-width:var(--att-col0-width, 52px);">
        <col style="width:var(--att-col1-width, 132px); min-width:var(--att-col1-width, 132px); max-width:var(--att-col1-width, 132px);">
        <col style="width:var(--att-col2-width, 132px); min-width:var(--att-col2-width, 132px); max-width:var(--att-col2-width, 132px);">
        ${ratingCols}
      </colgroup>
      <thead>
        <tr>
          <th></th>
          <th>First</th>
          <th>Last</th>
          ${headerCells}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  canvasEl.scrollLeft = savedScrollLeft;
  canvasEl.scrollTop = savedScrollTop;

  canvasEl.querySelectorAll('.assess-grid-editable').forEach(cell => {
    cell.addEventListener('click', async () => {
      const studentId = Number(cell.dataset.studentId);
      const assessNum = Number(cell.dataset.assessNum);
      if (!studentId || !assessNum) return;
      await cycleAssessmentRating(studentId, assessNum);
    });
  });
}

function renderAssessmentGrid() {
  renderAssessGroupGrid([1, 2, 3, 4], assessmentGridCanvas, 'Select a class with students to view tonal assessment records.');
}

function renderRhythmGrid() {
  renderAssessGroupGrid([5, 6, 7, 8], rhythmGridCanvas, 'Select a class with students to view rhythm assessment records.');
}

function renderMovementGrid() {
  renderAssessGroupGrid([9, 10, 11, 12], movementGridCanvas, 'Select a class with students to view movement assessment records.');
}

function renderInstrumentGrid() {
  renderAssessGroupGrid([13, 14, 15, 16], instrumentGridCanvas, 'Select a class with students to view instrument assessment records.');
}

async function cycleAssessmentRating(studentId, assessNum) {
  const layout = getStudentLayout(studentId);
  if (!layout) return;
  if (!layout.assessmentRatings) layout.assessmentRatings = {};
  const current = layout.assessmentRatings[assessNum] ?? null;
  const next = current === null ? 1 : current === 4 ? null : current + 1;
  layout.assessmentRatings[assessNum] = next;
  renderWorkspace();
  await persistActiveSeatingChart();
}


function renderRecordersGrid() {
  if (!recordersGridCanvas) {
    return;
  }

  const scopedStudents = getStudentsInActiveScope().filter(student => !student.isSample);
  if (scopedStudents.length === 0) {
    recordersGridCanvas.style.setProperty('--att-col0-width', '52px');
    recordersGridCanvas.style.setProperty('--att-col1-width', '132px');
    recordersGridCanvas.style.setProperty('--att-col2-width', '132px');
    recordersGridCanvas.innerHTML = '<div class="attendance-empty">Select a 4th grade class to use the Recorders grid.</div>';
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  recordersGridCanvas.style.setProperty('--att-col0-width', '52px');
  recordersGridCanvas.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  recordersGridCanvas.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);

  const rows = [...scopedStudents]
    .sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    })
    .map((student, index) => {
      const selectedColor = recorderColorOptions.includes(student.recorder_color)
        ? student.recorder_color
        : '';
      const options = ['<option value="">Select</option>', ...recorderColorOptions.map(color => {
        const bg = recorderColorLightBackgrounds[color] || '';
        const style = bg ? ` style="background:${bg};"` : '';
        return `<option value="${escHtml(color)}"${selectedColor === color ? ' selected' : ''}${style}>${escHtml(color)}</option>`;
      })].join('');

      return `
        <tr>
          <td>${index + 1}</td>
          <td>${escHtml(student.first_name || '')}</td>
          <td>${escHtml(student.last_name || '')}</td>
          <td class="attendance-cell" style="${escHtml(getRecorderCellStyle(selectedColor))}">
            <select class="recorder-color-select" data-student-id="${escHtml(String(student.id))}" style="${escHtml(getRecorderCellStyle(selectedColor))}">
              ${options}
            </select>
          </td>
        </tr>
      `;
    })
    .join('');

  recordersGridCanvas.innerHTML = `
    <table class="attendance-grid">
      <thead>
        <tr>
          <th></th>
          <th>First</th>
          <th>Last</th>
          <th>Recorder Color</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  recordersGridCanvas.querySelectorAll('.recorder-color-select').forEach(select => {
    select.addEventListener('change', async () => {
      const studentId = Number(select.dataset.studentId);
      if (!studentId) {
        return;
      }
      await setRecorderColor(studentId, select.value);
    });
  });
}

function normalizeTeacher(teacher) {
  return String(teacher || '').trim();
}

function getDefaultAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

function buildAcademicYearOptions(selectedYear) {
  const base = new Date().getFullYear();
  const options = [];
  for (let y = base - 3; y <= base + 2; y++) {
    const label = `${y}-${String(y + 1).slice(-2)}`;
    options.push(`<option value="${label}"${label === selectedYear ? ' selected' : ''}>${label}</option>`);
  }
  return options.join('');
}

function populateAcademicYearSelect(selectedYear) {
  // Used for inline selectors (e.g. CSV import modal) — not the sidebar display.
  const el = document.getElementById('csv-year-select');
  if (el) el.innerHTML = buildAcademicYearOptions(selectedYear);
}

function renderAcademicYearDisplay() {
  if (academicYearDisplay) {
    academicYearDisplay.textContent = currentAcademicYear || getDefaultAcademicYear();
  }
}

async function loadAcademicYear() {
  try {
    const stored = await window.api.getSetting('current_academic_year');
    currentAcademicYear = stored || getDefaultAcademicYear();
  } catch (err) {
    console.warn('[year] failed to load setting, using default:', err);
    currentAcademicYear = getDefaultAcademicYear();
  }
  if (!immaTabYear) immaTabYear = currentAcademicYear;
  renderAcademicYearDisplay();
}

async function renderImmaGrid() {
  if (!immaGridCanvas) return;

  const scopedStudents = getStudentsInActiveScope().filter(s => !s.isSample);

  if (scopedStudents.length === 0) {
    immaGridCanvas.innerHTML = '<div class="imma-empty">No students in the current class selection.</div>';
    return;
  }

  const year = immaTabYear || currentAcademicYear || getDefaultAcademicYear();
  const studentIds = scopedStudents.map(s => s.id);
  const scoreMap = {};

  try {
    const scores = await window.api.getImmaScoresForClass(studentIds);
    for (const score of scores) {
      if (score.academic_year === year) {
        scoreMap[score.student_id] = score;
      }
    }
  } catch (err) {
    console.error('[imma-grid] failed to load scores:', err);
  }

  let html = `
    <div class="imma-toolbar">
      <label for="imma-year-select" class="imma-year-label">Year:</label>
      <select id="imma-year-select" class="imma-year-select">
        ${buildAcademicYearOptions(year)}
      </select>
    </div>
    <table class="imma-table">
      <thead>
        <tr>
          <th class="imma-th-name">Student</th>
          <th class="imma-th-score">Tonal <span style="font-weight:normal;font-size:0.75em">(0–40)</span></th>
          <th class="imma-th-score">Rhythm <span style="font-weight:normal;font-size:0.75em">(0–40)</span></th>
        </tr>
      </thead>
      <tbody>
  `;

  for (const student of scopedStudents) {
    const score = scoreMap[student.id] || {};
    html += `
      <tr data-student-id="${student.id}">
        <td class="imma-td-name">${escHtml(getDisplayName(student))}</td>
        <td class="imma-td-score">
          <input type="number" class="imma-score-input" data-field="tonal" min="0" max="40"
            value="${score.tonal != null ? score.tonal : ''}"
            placeholder="—" />
        </td>
        <td class="imma-td-score">
          <input type="number" class="imma-score-input" data-field="rhythm" min="0" max="40"
            value="${score.rhythm != null ? score.rhythm : ''}"
            placeholder="—" />
        </td>
      </tr>
    `;
  }

  html += '</tbody></table>';
  immaGridCanvas.innerHTML = html;

  const yearSelectEl = document.getElementById('imma-year-select');
  if (yearSelectEl) {
    yearSelectEl.addEventListener('change', () => {
      immaTabYear = yearSelectEl.value;
      renderImmaGrid();
    });
  }

  const activeYear = immaTabYear || currentAcademicYear || getDefaultAcademicYear();
  const isPastYear = activeYear < (currentAcademicYear || getDefaultAcademicYear());

  immaGridCanvas.querySelectorAll('.imma-score-input').forEach(input => {
    // Store the value at focus so we can revert if the user cancels the warning.
    input.addEventListener('focus', (event) => {
      event.target.dataset.valueAtFocus = event.target.value;
    });

    input.addEventListener('change', async (event) => {
      const row = event.target.closest('tr[data-student-id]');
      if (!row) return;

      if (isPastYear) {
        const studentName = row.querySelector('.imma-td-name')?.textContent || 'this student';
        const confirmed = window.confirm(
          `You are editing IMMA scores for a past year (${activeYear}).\n\nEdit ${studentName}'s score anyway?`
        );
        if (!confirmed) {
          event.target.value = event.target.dataset.valueAtFocus ?? '';
          return;
        }
      }

      const studentId = Number(row.dataset.studentId);

      const tonalInput = row.querySelector('.imma-score-input[data-field="tonal"]');
      const rhythmInput = row.querySelector('.imma-score-input[data-field="rhythm"]');
      const tonal = tonalInput && tonalInput.value.trim() !== ''
        ? Math.round(clamp(Number(tonalInput.value), 0, 40))
        : null;
      const rhythm = rhythmInput && rhythmInput.value.trim() !== ''
        ? Math.round(clamp(Number(rhythmInput.value), 0, 40))
        : null;

      try {
        await window.api.upsertImmaScore(studentId, activeYear, tonal, rhythm);
      } catch (err) {
        console.error('[imma-grid] failed to save score:', err);
      }
    });
  });
}

function getTeacherLabel(teacher) {
  const normalized = normalizeTeacher(teacher);
  return normalized || 'Unassigned Teacher';
}

function gradeRank(grade) {
  if (!grade) return 999;
  if (grade === 'Y5') return -1;
  if (grade === 'K') return 0;
  const n = parseInt(grade, 10);
  return isNaN(n) ? 998 : n;
}


function getTeacherClasses() {
  const classesMap = new Map();

  students
    .filter(student => !student.isSample)
    .forEach(student => {
      const teacher = normalizeTeacher(student.teacher);
      // Unassigned teacher and multi-grade teachers always merge all grades into one class
      const isMultiGrade = !teacher || multiGradeTeachers.has(teacher);
      const grade = isMultiGrade ? '' : (normalizeGrade(student.grade) || '');
      const key = `${teacher}||${grade}`;
      if (!classesMap.has(key)) {
        classesMap.set(key, {
          key,
          teacher,
          grade,
          isMultiGrade,
          label: getTeacherLabel(teacher),
          count: 0,
        });
      }
      classesMap.get(key).count += 1;
    });

  return Array.from(classesMap.values()).sort((a, b) => {
    const gr = gradeRank(a.grade) - gradeRank(b.grade);
    if (gr !== 0) return gr;
    return a.label.localeCompare(b.label);
  });
}

function normalizeGrade(grade) {
  if (!grade) return null;
  const s = String(grade).trim().toLowerCase();
  if (['k', 'kindergarten', 'kinder', 'pre-k', 'prek'].includes(s)) return 'K';
  if (s === 'y5' || s === 'young5s' || s.replace(/[^a-z0-9]/g, '') === 'young5s' ||
      s.includes('young five') || s.includes('young 5')) return 'Y5';
  // word ordinals: "first", "fourth grade", etc.
  const wordOrdinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };
  for (const [word, num] of Object.entries(wordOrdinals)) {
    if (s.includes(word)) return String(num);
  }
  // "grade N" or "N grade"
  const gradeMatch = s.match(/grade\s*(\d+)|(\d+)\s*grade/);
  if (gradeMatch) return String(Number(gradeMatch[1] || gradeMatch[2]));
  // leading digits: "4", "04", "4th"
  const numMatch = s.match(/^0*(\d+)/);
  if (numMatch) return String(Number(numMatch[1]));
  return String(grade).trim() || null;
}

function getActiveClassGrade() {
  if (!activeClassTeacher) return null;
  const { grade } = parseClassKey(activeClassTeacher);
  return grade || null;
}

function hasSelectedClassContext() {
  return activeClassTeacher !== null;
}

function getActiveClassKeyForCharts() {
  return activeClassTeacher === null ? '' : activeClassTeacher;
}

function renderClassLibrary() {
  const shouldShowLibrary = !usingSampleRoster;
  classLibrary.classList.toggle('hidden', !shouldShowLibrary);
  toggleClassesListBtn.setAttribute('aria-expanded', String(!classesCollapsed));
  classLibraryBody.classList.toggle('hidden', classesCollapsed);
  classLibrary.classList.toggle('collapsed', classesCollapsed);

  if (!shouldShowLibrary) {
    return;
  }

  const classes = getTeacherClasses();
  if (activeClassTeacher !== null && !classes.some(entry => entry.key === activeClassTeacher)) {
    activeClassTeacher = null;
  }

  classList.innerHTML = '';

  if (classes.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent = 'No classes yet. Add students with teacher names to create class filters.';
    classList.appendChild(emptyState);
    return;
  }

  const allClassesCount = classes.reduce((sum, entry) => sum + entry.count, 0);
  const allClassesButton = document.createElement('button');
  allClassesButton.type = 'button';
  allClassesButton.className = 'class-pill';
  if (activeClassTeacher === null) {
    allClassesButton.classList.add('active');
  }
  allClassesButton.textContent = `All Classes (${allClassesCount})`;
  allClassesButton.addEventListener('click', () => {
    Promise.resolve(selectClassTeacher(null))
      .then(() => {
        renderWorkspace();
      })
      .catch(error => {
        console.error('[renderer] failed to switch class context:', error);
      });
  });
  classList.appendChild(allClassesButton);

  classes.forEach(entry => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'class-pill';
    if (entry.key === activeClassTeacher) {
      button.classList.add('active');
    }
    button.textContent = `${entry.isMultiGrade ? 'Multi-Grade \u2014 ' : entry.grade ? `${entry.grade} \u2014 ` : ''}${entry.label} (${entry.count})`;
    button.addEventListener('click', () => {
      Promise.resolve(selectClassTeacher(entry.key))
        .then(() => {
          renderWorkspace();
        })
        .catch(error => {
          console.error('[renderer] failed to switch class context:', error);
        });
    });
    classList.appendChild(button);
  });
}

function renderSeatingChartLibrary() {
  const shouldShowLibrary = !usingSampleRoster;
  const hasClassContext = hasSelectedClassContext();
  const shouldShowButton = shouldShowLibrary && hasClassContext && seatingCharts.length > 0;
  
  seatingChartLibrary.classList.toggle('hidden', !shouldShowLibrary);
  addSeatingChartBtn.classList.toggle('hidden', !shouldShowButton || seatingChartsCollapsed);
  toggleSeatingChartsListBtn.setAttribute('aria-expanded', String(!seatingChartsCollapsed));
  seatingChartLibraryBody.classList.toggle('hidden', seatingChartsCollapsed);
  seatingChartLibrary.classList.toggle('collapsed', seatingChartsCollapsed);

  if (!shouldShowLibrary) {
    return;
  }

  // Don't wipe the list while a chart name is being edited inline.
  if (seatingChartList.querySelector('.chart-name-edit')) return;

  seatingChartList.innerHTML = '';

  if (!hasClassContext) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent = 'Select a class first to view and manage that class\'s seating charts.';
    seatingChartList.appendChild(emptyState);
    return;
  }

  if (seatingCharts.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent = 'Drag a student to the canvas, or click Arrange Circle or Arrange Rows in Chart Tools, to create your first seating chart.';
    seatingChartList.appendChild(emptyState);
    return;
  }

  seatingCharts.forEach(chart => {
    const row = document.createElement('div');
    row.className = 'chart-row';
    if (chart.id === activeSeatingChartId) {
      row.classList.add('active');
    }

    const placedCount = Number(chart.placed_count || 0);
    row.innerHTML = `
      <button class="chart-row-main" type="button">
        <span class="chart-row-name">${escHtml(chart.name)}</span>
        <span class="chart-row-meta">${placedCount} placed</span>
      </button>
      <div class="chart-row-actions">
        <button class="chart-mini-btn" data-chart-action="rename" type="button" title="Rename" aria-label="Rename"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm14.71-9.04c.39-.39.39-1.02 0-1.41l-2.5-2.5a.9959.9959 0 0 0-1.41 0l-1.96 1.96 3.75 3.75 2.12-2.1z"></path></svg></button>
        <button class="chart-mini-btn danger" data-chart-action="delete" type="button" title="Delete" aria-label="Delete"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2zm1 7h2v8h-2v-8zm4 0h2v8h-2v-8zM7 10h2v8H7v-8z"></path></svg></button>
      </div>
    `;

    row.querySelector('.chart-row-main').addEventListener('click', () => {
      selectSeatingChart(chart.id);
    });

    const renameBtn = row.querySelector('[data-chart-action="rename"]');
    if (renameBtn) {
      renameBtn.addEventListener('click', event => {
        event.stopPropagation();
        activateChartNameEdit(row, chart.id, chart.name);
      });
    }

    const deleteBtn = row.querySelector('[data-chart-action="delete"]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', event => {
        event.stopPropagation();
        deleteSeatingChart(chart.id);
      });
    }

    seatingChartList.appendChild(row);
  });
}

function renderRoster() {
  if (!studentSearchInput || !rosterList) return;

  const query = studentSearchInput.value.trim().toLowerCase();
  rosterList.innerHTML = '';

  const baseStudents = getStudentsInActiveScope();
  const showInactive = getShowInactiveStudents();
  const rosterStudents = baseStudents.filter(student => {
    const layout = getStudentLayout(student.id);
    if (activeFilter === 'placed' || layout.placed) {
      return false;
    }
    if (!showInactive && student.is_active === 0) {
      return false;
    }
    return !query || getStudentSearchText(student).includes(query);
  });

  if (rosterStudents.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'detail-card';
    emptyState.innerHTML = `
      <div class="detail-name">No roster cards to show</div>
      <div class="empty-copy">Try a different search, or clear the chart to return students here.</div>
    `;
    rosterList.appendChild(emptyState);
    return;
  }

  rosterStudents.forEach(student => {
    const card = createStudentCard(student, false);
    rosterList.appendChild(card);
  });
}

function renderChart() {
  chartCanvas.innerHTML = '';

  // Remove any inactive students from the layout before rendering
  students.forEach(student => {
    if (student.is_active === 0) {
      const layout = getStudentLayout(student.id);
      if (layout.placed) {
        layout.placed = false;
        layout.x = 0;
        layout.y = 0;
      }
    }
  });

  const placedStudents = students.filter(student => {
    const layout = getStudentLayout(student.id);
    return activeFilter !== 'roster' && layout.placed && student.is_active !== 0;
  });

  placedStudents.forEach(student => {
    const layout = getStudentLayout(student.id);
    const card = createStudentCard(student, true);
    card.style.left = `${layout.x}px`;
    card.style.top = `${layout.y}px`;
    chartCanvas.appendChild(card);
  });

  // Teacher card fixed at cardinal south when a circle arrangement is active
  if (chartCanvas.dataset.circle === 'true' && teacherCirclePos) {
    const teacherCard = document.createElement('div');
    teacherCard.className = 'teacher-circle-card';
    teacherCard.textContent = 'T';
    teacherCard.style.left = `${teacherCirclePos.x}px`;
    teacherCard.style.top = `${teacherCirclePos.y}px`;
    chartCanvas.appendChild(teacherCard);
  }

  if (lsaMode && activeLsaUnit) {
    const placeholder = document.createElement('div');
    placeholder.className = 'lsa-unit-placeholder';
    const placeholderKey = getLsaPlaceholderKey();
    const imageUrl = lsaUnitPromptImages.get(placeholderKey);
    const audioUrl = lsaUnitAudioPaths.get(placeholderKey) || null;
    const savedSize = lsaUnitPromptSizes.get(placeholderKey);
    const rawFileName = lsaUnitLessonFileNames.get(placeholderKey) || '';
    const lessonFileName = rawFileName ? rawFileName.replace(/\.[^/.]+$/, '') : '';
    const promptTitle = lessonFileName ? `LSA ${activeLsaUnit} - ${lessonFileName}` : `LSA ${activeLsaUnit} Prompt`;
    const audioBtn = audioUrl ? `<button class="lsa-audio-play-btn" type="button" title="Play audio pattern" aria-label="Play audio pattern">&#9654;</button>` : '';

    if (imageUrl) {
      placeholder.innerHTML = `
        <div class="lsa-unit-placeholder-title">${escHtml(promptTitle)}${audioBtn}</div>
        <div class="lsa-unit-placeholder-media" style="width:${Number(savedSize?.width) > 0 ? Number(savedSize.width) : 260}px;">
          <img class="lsa-unit-placeholder-image" src="${escHtml(imageUrl)}" alt="LSA ${activeLsaUnit} prompt image">
          <span class="lsa-resize-handle lsa-resize-handle-e" data-resize="e" aria-hidden="true"></span>
          <span class="lsa-resize-handle lsa-resize-handle-s" data-resize="s" aria-hidden="true"></span>
          <span class="lsa-resize-handle lsa-resize-handle-se" data-resize="se" aria-hidden="true"></span>
        </div>
      `;
    } else {
      placeholder.innerHTML = `
        <div class="lsa-unit-placeholder-title">${escHtml(promptTitle)}${audioBtn}</div>
        <div class="lsa-unit-placeholder-empty">Import an image from Show Units to display here.</div>
      `;
    }

    chartCanvas.appendChild(placeholder);

    if (audioUrl) {
      const playBtn = placeholder.querySelector('.lsa-audio-play-btn');
      if (playBtn) {
        playBtn.addEventListener('pointerdown', e => e.stopPropagation());
        playBtn.addEventListener('click', e => {
          e.stopPropagation();
          if (!playBtn.classList.contains('playing')) {
            playLsaAudio(audioUrl, playBtn);
          }
        });
      }
    }

    const savedPos = lsaUnitPlaceholderPositions.get(placeholderKey);
    const fallbackX = Math.max(8, CANVAS_W - (placeholder.offsetWidth || 220) - 16);
    const fallbackY = 16;
    const initial = clampLsaPlaceholderPosition(
      savedPos?.x ?? fallbackX,
      savedPos?.y ?? fallbackY,
      placeholder
    );

    placeholder.style.left = `${initial.x}px`;
    placeholder.style.top = `${initial.y}px`;
    placeholder.style.right = 'auto';
    lsaUnitPlaceholderPositions.set(placeholderKey, initial);

    if (imageUrl) {
      setupLsaPlaceholderResizing(placeholder, placeholderKey);
    }

    placeholder.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const canvasRect = chartCanvas.getBoundingClientRect();
      const cardRect = placeholder.getBoundingClientRect();
      // offsetX/Y in canvas-local space (divide screen delta by zoom)
      const offsetX = (event.clientX - cardRect.left) / chartZoom;
      const offsetY = (event.clientY - cardRect.top) / chartZoom;

      placeholder.setPointerCapture(event.pointerId);

      const onMove = moveEvent => {
        const next = clampLsaPlaceholderPosition(
          (moveEvent.clientX - canvasRect.left) / chartZoom - offsetX,
          (moveEvent.clientY - canvasRect.top) / chartZoom - offsetY,
          placeholder
        );
        placeholder.style.left = `${next.x}px`;
        placeholder.style.top = `${next.y}px`;
        lsaUnitPlaceholderPositions.set(placeholderKey, next);
      };

      const onUp = upEvent => {
        placeholder.releasePointerCapture(upEvent.pointerId);
        placeholder.removeEventListener('pointermove', onMove);
        placeholder.removeEventListener('pointerup', onUp);
        placeholder.removeEventListener('pointercancel', onUp);

        const finalPos = lsaUnitPlaceholderPositions.get(placeholderKey);
        if (finalPos && window.api.upsertLsaUnitPlaceholder) {
          window.api.upsertLsaUnitPlaceholder(getActiveClassKeyForCharts(), activeLsaUnit, finalPos.x, finalPos.y)
            .catch(error => console.error('[renderer] failed to persist LSA placeholder position:', error));
        }
      };

      placeholder.addEventListener('pointermove', onMove);
      placeholder.addEventListener('pointerup', onUp);
      placeholder.addEventListener('pointercancel', onUp);
    });
  }

  if (assessmentMode && activeAssessmentNumber && getActiveClassKeyForCharts()) {
    const assessCard = document.createElement('div');
    assessCard.className = 'assessment-scale-card';
    const label = getAssessmentLabel(activeAssessmentNumber);
    const scales = getAssessmentScaleTexts(activeAssessmentNumber);
    const grade = getActiveClassGrade() || assessLibraryGrade;
    const hasSubtitle = !!(assessmentLibraryDb.get(grade)?.get(activeAssessmentNumber)?.name);
    const cardTitle = hasSubtitle ? label : `${label} \u2014 Rating Scale`;
    const posKey = activeAssessmentNumber;
    const savedSize = assessmentCardSizes.get(posKey) || {};
    const savedWidth = savedSize.width || 220;
    const savedHeight = savedSize.height || null;
    const savedScale = savedSize.scale || 1;
    // Always display descriptions in their entered order (position 1 = best text, position 4 = worst text).
    // Only the number label shown changes based on direction, so the text never moves.
    const posLabel = pos => ratingDirection === 'desc' ? (5 - pos) : pos;
    const posClass = pos => ['', 'assess-r1', 'assess-r2', 'assess-r3', 'assess-r4'][pos] || '';
    const scaleRows = [1, 2, 3, 4].map(pos => {
      const text = scales[pos];
      const colorClass = posClass(pos);
      const num = posLabel(pos);
      return text
        ? `<div class="assessment-scale-row ${colorClass}"><span class="assessment-scale-num">${num}</span><span class="assessment-scale-text">${escHtml(text)}</span></div>`
        : `<div class="assessment-scale-row assessment-scale-empty ${colorClass}"><span class="assessment-scale-num">${num}</span><span class="assessment-scale-text">\u2014</span></div>`;
    }).join('');
    assessCard.innerHTML = `
      <div class="assessment-scale-title">${escHtml(cardTitle)}</div>
      <div class="assessment-scale-inner" style="width:${savedWidth}px;${savedHeight ? ` height:${savedHeight}px;` : ''}">
        <div class="assessment-scale-body">${scaleRows}</div>
        <span class="lsa-resize-handle lsa-resize-handle-e" data-resize="e" aria-hidden="true"></span>
        <span class="lsa-resize-handle lsa-resize-handle-s" data-resize="s" aria-hidden="true"></span>
        <span class="lsa-resize-handle lsa-resize-handle-se" data-resize="se" aria-hidden="true"></span>
      </div>
    `;
    assessCard.style.transform = `scale(${savedScale})`;
    assessCard.style.transformOrigin = 'top left';
    chartCanvas.appendChild(assessCard);
    setupAssessmentCardResizing(assessCard, posKey);
    const savedPos = assessmentPlaceholderPositions.get(posKey);
    const fallbackX = 16;
    const fallbackY = Math.max(8, CANVAS_H - (assessCard.offsetHeight || 100) - 16);
    const clamped = clampLsaPlaceholderPosition(
      savedPos?.x ?? fallbackX,
      savedPos?.y ?? fallbackY,
      assessCard
    );
    assessCard.style.left = `${clamped.x}px`;
    assessCard.style.top = `${clamped.y}px`;
    assessmentPlaceholderPositions.set(posKey, clamped);

    assessCard.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.classList.contains('lsa-resize-handle')) return;
      event.preventDefault();
      event.stopPropagation();
      const canvasRect = chartCanvas.getBoundingClientRect();
      const cardRect = assessCard.getBoundingClientRect();
      const offsetX = (event.clientX - cardRect.left) / chartZoom;
      const offsetY = (event.clientY - cardRect.top) / chartZoom;
      assessCard.setPointerCapture(event.pointerId);
      const onMove = moveEvent => {
        const next = clampLsaPlaceholderPosition(
          (moveEvent.clientX - canvasRect.left) / chartZoom - offsetX,
          (moveEvent.clientY - canvasRect.top) / chartZoom - offsetY,
          assessCard
        );
        assessCard.style.left = `${next.x}px`;
        assessCard.style.top = `${next.y}px`;
        assessmentPlaceholderPositions.set(posKey, next);
      };
      const onUp = upEvent => {
        assessCard.releasePointerCapture(upEvent.pointerId);
        assessCard.removeEventListener('pointermove', onMove);
        assessCard.removeEventListener('pointerup', onUp);
        assessCard.removeEventListener('pointercancel', onUp);
      };
      assessCard.addEventListener('pointermove', onMove);
      assessCard.addEventListener('pointerup', onUp);
      assessCard.addEventListener('pointercancel', onUp);
    });
  }
}

function setupAssessmentCardResizing(card, posKey) {
  const inner = card.querySelector('.assessment-scale-inner');
  if (!inner) return;

  const titleEl = card.querySelector('.assessment-scale-title');
  const titleMinWidth = titleEl ? titleEl.offsetWidth : 160;

  // Enforce min-width on initial render so scale lines never appear narrower than the title.
  const initialMinW = Math.max(160, titleMinWidth);
  if (inner.offsetWidth < initialMinW) {
    inner.style.width = `${initialMinW}px`;
    assessmentCardSizes.set(posKey, { ...(assessmentCardSizes.get(posKey) || {}), width: initialMinW });
  }

  const getSaved = () => assessmentCardSizes.get(posKey) || {};

  const applySize = (rawWidth, rawHeight) => {
    const maxW = Math.max(160, CANVAS_W - 56);
    const minW = Math.max(160, titleMinWidth);
    const width = clamp(rawWidth, minW, Math.min(520, maxW));
    inner.style.width = `${width}px`;
    const saved = { ...getSaved(), width };
    if (rawHeight !== null) {
      const height = clamp(rawHeight, 60, CANVAS_H - 56);
      inner.style.height = `${height}px`;
      saved.height = height;
    }
    assessmentCardSizes.set(posKey, saved);
    const currentX = parseFloat(card.style.left || '0');
    const currentY = parseFloat(card.style.top || '0');
    const clamped = clampLsaPlaceholderPosition(currentX, currentY, card);
    card.style.left = `${clamped.x}px`;
    card.style.top = `${clamped.y}px`;
    assessmentPlaceholderPositions.set(posKey, clamped);
  };

  const applyScale = (rawScale) => {
    const scale = clamp(rawScale, 0.4, 4);
    card.style.transform = `scale(${scale})`;
    card.style.transformOrigin = 'top left';
    assessmentCardSizes.set(posKey, { ...getSaved(), scale });
  };

  card.querySelectorAll('.lsa-resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const mode = handle.dataset.resize || 'se';
      const startX = event.clientX;
      const startY = event.clientY;
      // Read unscaled CSS dimensions (offsetWidth/offsetHeight are unaffected by transform)
      const startWidth = inner.offsetWidth;
      const startHeight = inner.offsetHeight;
      const naturalWidth = card.offsetWidth;
      const startScale = parseFloat(card.style.transform?.replace('scale(', '') || 1) || 1;
      handle.setPointerCapture(event.pointerId);
      const onMove = moveEvent => {
        // Divide by both chartZoom and card scale so drag delta maps 1:1 to CSS pixels
        const dx = (moveEvent.clientX - startX) / (chartZoom * startScale);
        const dy = (moveEvent.clientY - startY) / (chartZoom * startScale);
        if (mode === 'e') {
          applySize(startWidth + dx, null);
        } else if (mode === 's') {
          applySize(startWidth, startHeight + dy);
        } else {
          // SE: scale content — drag right/down = bigger, anchored top-left
          const rawDx = moveEvent.clientX - startX;
          const rawDy = moveEvent.clientY - startY;
          const newScale = startScale + (rawDx + rawDy) / 2 / (naturalWidth * chartZoom);
          applyScale(newScale);
        }
      };
      const onUp = upEvent => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  });
}

function getLsaPlaceholderKey() {
  return getLsaUnitKey(activeLsaUnit);
}

function getLsaUnitKey(unitNumber) {
  return `${getActiveClassKeyForCharts()}::unit-${Number(unitNumber)}`;
}

function clampLsaPlaceholderPosition(x, y, placeholderElement) {
  const cardWidth = placeholderElement.offsetWidth || 220;
  const cardHeight = placeholderElement.offsetHeight || 56;
  const maxX = Math.max(8, CANVAS_W - cardWidth - 8);
  const maxY = Math.max(8, CANVAS_H - cardHeight - 80);

  return {
    x: clamp(x, 8, maxX),
    y: clamp(y, 8, maxY),
  };
}

function setupLsaPlaceholderResizing(placeholder, placeholderKey) {
  const media = placeholder.querySelector('.lsa-unit-placeholder-media');
  const image = placeholder.querySelector('.lsa-unit-placeholder-image');
  if (!media || !image) {
    return;
  }

  const getAspectRatio = () => {
    if (image.naturalWidth > 0 && image.naturalHeight > 0) {
      return image.naturalWidth / image.naturalHeight;
    }
    const rect = image.getBoundingClientRect();
    return rect.height > 0 ? rect.width / rect.height : 1.35;
  };

  const applyWidth = (rawWidth) => {
    const maxWidthByCanvas = Math.max(160, CANVAS_W - 56);
    const width = clamp(rawWidth, 160, Math.min(520, maxWidthByCanvas));
    media.style.width = `${width}px`;
    lsaUnitPromptSizes.set(placeholderKey, { width });

    const currentX = parseFloat(placeholder.style.left || '0');
    const currentY = parseFloat(placeholder.style.top || '0');
    const clamped = clampLsaPlaceholderPosition(currentX, currentY, placeholder);
    placeholder.style.left = `${clamped.x}px`;
    placeholder.style.top = `${clamped.y}px`;
    lsaUnitPlaceholderPositions.set(placeholderKey, clamped);
  };

  placeholder.querySelectorAll('.lsa-resize-handle').forEach(handle => {
    handle.addEventListener('pointerdown', event => {
      if (event.pointerType === 'mouse' && event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      const mode = handle.dataset.resize || 'se';
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = media.getBoundingClientRect().width;
      const ratio = getAspectRatio();

      handle.setPointerCapture(event.pointerId);

      const onMove = moveEvent => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        let nextWidth = startWidth;

        if (mode === 'e') {
          nextWidth = startWidth + dx;
        } else if (mode === 's') {
          nextWidth = startWidth + dy * ratio;
        } else {
          nextWidth = startWidth + ((dx + (dy * ratio)) / 2);
        }

        applyWidth(nextWidth);
      };

      const onUp = upEvent => {
        handle.releasePointerCapture(upEvent.pointerId);
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
      };

      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });
  });
}

function animateChartSwitchToCurrentLayout() {
  if (chartSwitchRenderTimer) {
    clearTimeout(chartSwitchRenderTimer);
    chartSwitchRenderTimer = null;
  }

  const existingCards = Array.from(chartCanvas.querySelectorAll('.chart-student'));
  if (existingCards.length === 0) {
    renderWorkspace();
    return;
  }

  let hasVisualChange = false;

  existingCards.forEach(card => {
    const studentId = card.dataset.studentId;
    const layout = getStudentLayout(studentId);
    const shouldRemainPlaced = activeFilter !== 'roster' && layout?.placed;

    if (shouldRemainPlaced) {
      const nextLeft = `${layout.x}px`;
      const nextTop = `${layout.y}px`;

      if (card.style.left !== nextLeft || card.style.top !== nextTop) {
        hasVisualChange = true;
      }

      card.style.opacity = '1';
      card.style.left = nextLeft;
      card.style.top = nextTop;
      return;
    }

    hasVisualChange = true;
    card.style.opacity = '0';
  });

  if (!hasVisualChange) {
    renderWorkspace();
    return;
  }

  chartSwitchRenderTimer = setTimeout(() => {
    chartSwitchRenderTimer = null;
    renderWorkspace();
  }, 430);
}

function createStudentCard(student, isPlaced) {
  const layout = getStudentLayout(student.id);
  const card = document.createElement('article');
  const studentId = String(student.id);
  const firstName = escHtml(student.first_name || 'Unknown');
  const lastName = escHtml(student.last_name || '');
  const isInactive = student.is_active === 0;
  const inactiveBadge = isInactive ? '<span class="inactive-badge">Inactive</span>' : '';
  const cardNameMarkup = `
    <span class="student-name-wrap">
      <strong class="student-name-first">${firstName}</strong>
      <span class="student-name-last">${lastName}</span>${inactiveBadge}
    </span>
  `;
  const showAllClassesRosterMeta = !isPlaced;
  const rosterMetaMarkup = showAllClassesRosterMeta
    ? `<div class="student-roster-meta">${escHtml(student.grade || 'Ungraded')} · ${escHtml(student.teacher || 'Teacher TBD')}</div>`
    : '';
  const editButtonMarkup = !editMode || student.isSample
    ? ''
    : '<button class="student-edit-btn" type="button" aria-label="Edit student" title="Edit student">&#9998;</button>';
  const colorDot = student.color_dot || null;
  const colorDotMarkup = student.isSample ? '' :
    `<button class="color-dot-btn${colorDot ? ` color-dot-${colorDot}` : ''}" data-color-dot="true" type="button" aria-label="Color tag" title="Color tag"></button>`;
  card.className = isPlaced ? 'chart-student' : 'roster-card';
  card.dataset.studentId = studentId;
  card.dataset.attendance = layout.attendance || 'none';
  card.draggable = true;
  card.tabIndex = 0;

  if (isInactive) {
    card.classList.add('inactive-student');
  }

  if (selectedStudentId === studentId) {
    card.classList.add('selected');
  }

  if (lsaMode) {
    if (isPlaced) card.classList.add('lsa-card');
    const unitEasy = getStudentUnitScore(student, activeLsaUnit, 'easy');
    const unitMedium = getStudentUnitScore(student, activeLsaUnit, 'medium');
    const unitDifficult = getStudentUnitScore(student, activeLsaUnit, 'difficult');
    const lsaCardMarkup = (score) => {
      if (score === 'teacher') return '<span class="lsa-mark lsa-mark-teacher">│</span>';
      if (score === 'eval') return '<span class="lsa-mark lsa-mark-eval">+</span>';
      return '';
    };
    const lsaNameMarkup = isPlaced
      ? `<strong class="student-name-first">${firstName}</strong>`
      : cardNameMarkup;
    card.innerHTML = `
      ${editButtonMarkup}
      ${colorDotMarkup}
      <div class="student-topline single">
        ${lsaNameMarkup}
      </div>
      ${rosterMetaMarkup}
      <div class="lsa-row">
        <div class="lsa-col">
          <span class="lsa-col-label">E</span>
          <button class="lsa-btn" data-activity="easy" data-score="${unitEasy || 'none'}" type="button">${lsaCardMarkup(unitEasy)}</button>
        </div>
        <div class="lsa-col">
          <span class="lsa-col-label">M</span>
          <button class="lsa-btn" data-activity="medium" data-score="${unitMedium || 'none'}" type="button">${lsaCardMarkup(unitMedium)}</button>
        </div>
        <div class="lsa-col">
          <span class="lsa-col-label">D</span>
          <button class="lsa-btn" data-activity="difficult" data-score="${unitDifficult || 'none'}" type="button">${lsaCardMarkup(unitDifficult)}</button>
        </div>
      </div>
    `;
  } else if (attendanceMode) {
    card.classList.add('attendance-card');
    const hasSharedGoodNews = Number(student.good_news_shared || 0) === 1;
    const todayAttendance = getAttendanceStatusForDate(student.id, getTodayIsoDate());
    const goodNewsMarkup = student.isSample ? '' :
      `<button class="good-news-btn ${hasSharedGoodNews ? 'active' : ''}" data-good-news="true" type="button" aria-label="Shared good news" title="Shared good news">&#10003;</button>`;
    const attendanceNameMarkup = `
      <span class="student-name-wrap">
        <strong class="student-name-first">${firstName}</strong>
        <span class="student-name-last-row">
          <span class="student-name-last">${lastName}</span>
        </span>
      </span>
    `;
    card.innerHTML = `
      ${editButtonMarkup}
      ${colorDotMarkup}
      <div class="student-topline single">
        ${attendanceNameMarkup}
      </div>
      ${rosterMetaMarkup}
      <div class="attendance-row">
        <button class="attendance-btn ${todayAttendance === 'present' ? 'active' : ''}" data-attendance="present" type="button">P</button>
        <button class="attendance-btn ${todayAttendance === 'absent' ? 'active' : ''}" data-attendance="absent" type="button">A</button>
        <button class="attendance-btn ${todayAttendance === 'late' ? 'active' : ''}" data-attendance="late" type="button">L</button>
        ${goodNewsMarkup}
      </div>
    `;
  } else if (assessmentMode) {
    if (isPlaced) card.classList.add('assessment-card');
    const rating = layout.assessmentRatings?.[activeAssessmentNumber] ?? null;
    const assessNameMarkup = isPlaced
      ? `<strong class="student-name-first">${firstName}</strong>`
      : cardNameMarkup;
    card.innerHTML = `
      ${editButtonMarkup}
      ${colorDotMarkup}
      <div class="student-topline single">
        ${assessNameMarkup}
      </div>
      ${rosterMetaMarkup}
      <div class="assess-row">
        <button class="assess-btn ${getRatingClass(1)} ${rating === 1 ? 'active' : ''}" data-rating="1" type="button">1</button>
        <button class="assess-btn ${getRatingClass(2)} ${rating === 2 ? 'active' : ''}" data-rating="2" type="button">2</button>
        <button class="assess-btn ${getRatingClass(3)} ${rating === 3 ? 'active' : ''}" data-rating="3" type="button">3</button>
        <button class="assess-btn ${getRatingClass(4)} ${rating === 4 ? 'active' : ''}" data-rating="4" type="button">4</button>
      </div>
    `;
  } else {
    card.innerHTML = `
      ${editButtonMarkup}
      ${colorDotMarkup}
      <div class="student-topline">
        ${cardNameMarkup}
      </div>
      ${rosterMetaMarkup}
    `;
  }

  card.addEventListener('click', () => selectStudent(studentId));
  card.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectStudent(studentId);
    }
  });

  card.addEventListener('dragstart', event => {
    // Avoid full rerender during dragstart; rebuilding the card tree can cancel the drag gesture.
    selectedStudentId = studentId;
    renderSelectionDetails();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', studentId);
    dragPickupOffset = {
      x: clamp(typeof event.offsetX === 'number' ? event.offsetX : card.offsetWidth / 2, 0, card.offsetWidth),
      y: clamp(typeof event.offsetY === 'number' ? event.offsetY : card.offsetHeight / 2, 0, card.offsetHeight),
    };
    // Use a flat ghost image so the card looks flush with the cursor, not lifted
    const ghost = card.cloneNode(true);
    Object.assign(ghost.style, {
      boxShadow: 'none',
      transform: 'none',
      transition: 'none',
      position: 'fixed',
      top: '-9999px',
      left: '0',
      width: card.offsetWidth + 'px',
      pointerEvents: 'none',
    });
    document.body.appendChild(ghost);
    event.dataTransfer.setDragImage(ghost, dragPickupOffset.x, dragPickupOffset.y);
    requestAnimationFrame(() => ghost.remove());
  });

  card.addEventListener('dragend', () => {
    dragPickupOffset = null;
  });

  const editBtn = card.querySelector('.student-edit-btn');
  if (editBtn) {
    editBtn.addEventListener('mousedown', event => {
      event.stopPropagation();
    });

    editBtn.addEventListener('dragstart', event => {
      event.preventDefault();
    });

    editBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      openStudentModal(student.id);
    });
  }

  if (lsaMode) {
    card.querySelectorAll('.lsa-btn').forEach(button => {
      button.addEventListener('mousedown', event => {
        event.stopPropagation();
      });

      button.addEventListener('dragstart', event => {
        event.preventDefault();
      });

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        cycleLsaScore(studentId, button.dataset.activity, activeLsaUnit);
      });
    });
  } else if (attendanceMode) {
    const goodNewsBtn = card.querySelector('.good-news-btn');
    if (goodNewsBtn) {
      goodNewsBtn.addEventListener('mousedown', event => {
        event.stopPropagation();
      });

      goodNewsBtn.addEventListener('dragstart', event => {
        event.preventDefault();
      });

      goodNewsBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        toggleGoodNewsShared(studentId);
      });
    }

    card.querySelectorAll('.attendance-btn').forEach(button => {
      button.addEventListener('mousedown', event => {
        event.stopPropagation();
      });

      button.addEventListener('dragstart', event => {
        event.preventDefault();
      });

      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setAttendance(studentId, button.dataset.attendance);
      });
    });
  } else if (assessmentMode) {
    card.querySelectorAll('.assess-btn').forEach(button => {
      button.addEventListener('mousedown', event => {
        event.stopPropagation();
      });
      button.addEventListener('dragstart', event => {
        event.preventDefault();
      });
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        setAssessmentRating(studentId, Number(button.dataset.rating));
      });
    });
  }

  const colorDotBtn = card.querySelector('.color-dot-btn');
  if (colorDotBtn) {
    colorDotBtn.addEventListener('mousedown', event => { event.stopPropagation(); });
    colorDotBtn.addEventListener('dragstart', event => { event.preventDefault(); });
    colorDotBtn.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      cycleColorDot(studentId);
    });
  }

  return card;
}

function renderSelectionDetails() {
  const student = students.find(entry => String(entry.id) === selectedStudentId);

  if (!student) {
    selectionCard.innerHTML = `
      <div class="detail-name">No student selected</div>
      <div class="detail-copy">Click a roster card or a placed seat to inspect it here.</div>
    `;
    return;
  }

  const layout = getStudentLayout(student.id);
  const placementText = layout.placed ? 'Placed on chart' : 'In roster bank';

  selectionCard.innerHTML = `
    <div class="detail-name">${escHtml(getDisplayName(student))}</div>
    <div class="detail-meta">${escHtml(student.grade || 'Ungraded')} · ${escHtml(student.teacher || 'Teacher TBD')}</div>
    ${student.student_number ? `<div class="detail-meta" style="font-size:0.8em;color:var(--muted)">ID: ${escHtml(String(student.student_number))}</div>` : ''}
    <div class="detail-copy">${escHtml(student.notes || placementText)}</div>
    <div id="detail-imma-section" class="detail-imma-section"></div>
  `;

  if (!student.isSample) {
    loadImmaHistoryForDetailCard(student.id);
  }
}

async function loadImmaHistoryForDetailCard(studentId) {
  try {
    const scores = await window.api.getImmaScores(studentId);
    if (!scores || scores.length === 0) return;
    const section = document.getElementById('detail-imma-section');
    if (!section) return;
    if (selectedStudentId !== String(studentId)) return;
    section.innerHTML = `
      <div class="detail-imma-title">IMMA Scores</div>
      <table class="detail-imma-table">
        <thead><tr><th>Year</th><th>Tonal</th><th>Rhythm</th></tr></thead>
        <tbody>
          ${scores.map(s => `<tr>
            <td>${escHtml(s.academic_year)}</td>
            <td>${s.tonal != null ? s.tonal : '—'}</td>
            <td>${s.rhythm != null ? s.rhythm : '—'}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('[imma-history] failed to load:', err);
  }
}

function getStudentsInActiveScope() {
  const showInactive = getShowInactiveStudents();
  if (usingSampleRoster || activeClassTeacher === null) {
    return students.filter(student => showInactive || student.is_active !== 0);
  }

  const { teacher, grade } = parseClassKey(activeClassTeacher);
  return students.filter(student => {
    if (!showInactive && student.is_active === 0) return false;
    if (normalizeTeacher(student.teacher) !== teacher) return false;
    if (grade) return (normalizeGrade(student.grade) || '') === grade;
    return true;
  });
}

function renderCounts() {
  const scopedStudents = getStudentsInActiveScope();
  const placedCount = scopedStudents.filter(student => getStudentLayout(student.id).placed).length;
  document.getElementById('student-count').textContent = String(scopedStudents.length);
  document.getElementById('seated-count').textContent = String(placedCount);
  document.getElementById('roster-count').textContent = String(scopedStudents.length - placedCount);

  const teacherLabel = document.getElementById('chart-teacher-label');
  if (teacherLabel) {
    teacherLabel.textContent = (!usingSampleRoster && activeClassTeacher !== null)
      ? getTeacherLabel(activeClassTeacher)
      : '';
  }
}

function renderAttendanceSummary() {
  const scopedStudents = getStudentsInActiveScope();
  const today = getTodayIsoDate();

  const totals = scopedStudents.reduce(
    (acc, student) => {
      const status = getAttendanceStatusForDate(student.id, today);
      if (!status) {
        acc.unmarked += 1;
      } else if (status === 'present') {
        acc.present += 1;
      } else if (status === 'absent') {
        acc.absent += 1;
      } else if (status === 'late') {
        acc.present += 1;
        acc.late += 1;
      } else {
        acc.unmarked += 1;
      }
      return acc;
    },
    { present: 0, absent: 0, late: 0, unmarked: 0 }
  );

  document.getElementById('present-count').textContent = String(totals.present);
  document.getElementById('absent-count').textContent = String(totals.absent);
  document.getElementById('late-count').textContent = String(totals.late);
  document.getElementById('unmarked-count').textContent = String(totals.unmarked);
}

function renderAttendanceToggle() {
  attendanceToggleBtn.classList.toggle('active', attendanceMode);
  attendanceSubmenu.classList.toggle('open', attendanceMode);
}

function normalizeModes() {
  if (attendanceMode && lsaMode) {
    lsaMode = false;
  }
  if (assessmentMode && (attendanceMode || lsaMode)) {
    assessmentMode = false;
  }
}

function setActiveFilter(filter) {
  activeFilter = filter;
  renderWorkspace();
}

function selectStudent(studentId) {
  selectedStudentId = studentId;
  renderWorkspace();
}

async function setAttendance(studentId, attendance) {
  const layout = getStudentLayout(studentId);
  if (!layout) {
    return;
  }

  const today = getTodayIsoDate();
  const current = getAttendanceStatusForDate(studentId, today);
  const next = current === attendance ? null : attendance;

  layout.attendance = next;
  setAttendanceStatusForDate(studentId, today, next);
  selectedStudentId = String(studentId);
  renderWorkspace();

  try {
    if (next) {
      await window.api.upsertAttendanceRecord(studentId, today, next);
    } else {
      await window.api.deleteAttendanceRecord(studentId, today);
    }
  } catch (error) {
    console.error('[renderer] failed to save attendance record:', error);
  }

  await persistActiveSeatingChart();
}

async function setAssessmentRating(studentId, rating) {
  const layout = getStudentLayout(studentId);
  if (!layout) return;
  if (!layout.assessmentRatings) layout.assessmentRatings = {};
  // Clicking the already-active rating clears it; otherwise set the new rating.
  const current = layout.assessmentRatings[activeAssessmentNumber];
  layout.assessmentRatings[activeAssessmentNumber] = current === rating ? null : rating;
  selectedStudentId = String(studentId);
  renderWorkspace();
  await persistActiveSeatingChart();
}

function toggleAttendanceMode() {
  const nextMode = !attendanceMode;
  attendanceMode = nextMode;
  if (nextMode) {
    lsaMode = false;
    assessmentMode = false;
  }
  renderWorkspace();
}

function toggleLsaMode() {
  const nextMode = !lsaMode;
  lsaMode = nextMode;
  if (nextMode) {
    attendanceMode = false;
    assessmentMode = false;
    manageAssessmentsVisible = false;
  } else {
    manageUnitsVisible = false;
  }
  renderWorkspace();
}

function toggleAssessmentMode() {
  const nextMode = !assessmentMode;
  assessmentMode = nextMode;
  if (nextMode) {
    attendanceMode = false;
    lsaMode = false;
    manageUnitsVisible = false;
  } else {
    manageAssessmentsVisible = false;
  }
  renderWorkspace();
}

function switchView(viewName) {
  if (!['seating', 'gradebook'].includes(viewName)) return;
  
  activeView = viewName;
  
  // Update pill active states
  viewSeatingBtn.classList.toggle('active', viewName === 'seating');
  viewGradebookBtn.classList.toggle('active', viewName === 'gradebook');
  
  // Update view label text
  const labelTexts = {
    seating: 'Seating Chart View',
    gradebook: 'Gradebook View'
  };
  currentViewLabel.textContent = labelTexts[viewName];
  
  // Show/hide view containers
  seatingView.classList.toggle('active', viewName === 'seating');
  gradebookView.classList.toggle('active', viewName === 'gradebook');
  seatingView.classList.toggle('hidden', viewName !== 'seating');
  gradebookView.classList.toggle('hidden', viewName !== 'gradebook');

  if (viewName === 'gradebook') {
    loadAttendanceRecordsForScope();
  }
}

function setGradebookTab(tabName) {
  if (!['attendance', 'lsa', 'assessment', 'rhythm', 'movement', 'instrument', 'recorders', 'imma'].includes(tabName)) {
    return;
  }

  if (tabName === 'recorders' && !isFourthGradeClassSelected()) {
    return;
  }

  activeGradebookTab = tabName;
  gradebookTabAttendanceBtn.classList.toggle('active', tabName === 'attendance');
  gradebookTabLsaBtn.classList.toggle('active', tabName === 'lsa');
  gradebookTabAssessmentBtn.classList.toggle('active', tabName === 'assessment');
  gradebookTabRhythmBtn.classList.toggle('active', tabName === 'rhythm');
  gradebookTabMovementBtn.classList.toggle('active', tabName === 'movement');
  gradebookTabInstrumentBtn.classList.toggle('active', tabName === 'instrument');
  gradebookTabRecordersBtn.classList.toggle('active', tabName === 'recorders');
  gradebookTabImmaBtn.classList.toggle('active', tabName === 'imma');
  gradebookAttendancePanel.classList.toggle('active', tabName === 'attendance');
  gradebookLsaPanel.classList.toggle('active', tabName === 'lsa');
  gradebookAssessmentPanel.classList.toggle('active', tabName === 'assessment');
  gradebookRhythmPanel.classList.toggle('active', tabName === 'rhythm');
  gradebookMovementPanel.classList.toggle('active', tabName === 'movement');
  gradebookInstrumentPanel.classList.toggle('active', tabName === 'instrument');
  gradebookRecordersPanel.classList.toggle('active', tabName === 'recorders');
  gradebookImmaPanel.classList.toggle('active', tabName === 'imma');

  if (tabName === 'attendance') {
    loadAttendanceRecordsForScope();
  }
  if (tabName === 'assessment') {
    renderAssessmentGrid();
  }
  if (tabName === 'rhythm') {
    renderRhythmGrid();
  }
  if (tabName === 'movement') {
    renderMovementGrid();
  }
  if (tabName === 'instrument') {
    renderInstrumentGrid();
  }
  if (tabName === 'imma') {
    renderImmaGrid();
  }
}

async function cycleLsaScore(studentId, activity, unitNumber = activeLsaUnit) {
  const student = students.find(s => String(s.id) === String(studentId));
  if (!student || student.isSample) return;

  if (!['easy', 'medium', 'difficult'].includes(activity)) {
    return;
  }

  const current = getStudentUnitScore(student, unitNumber, activity);
  const next = current === null ? 'teacher' : current === 'teacher' ? 'eval' : null;
  setStudentUnitScore(student, unitNumber, activity, next);

  try {
    await window.api.updateStudent(buildStudentUpdatePayload(student));
    selectedStudentId = String(studentId);
    renderWorkspace();
  } catch (error) {
    setStudentUnitScore(student, unitNumber, activity, current);
    console.error('[renderer] failed to save LSA score:', error);
    renderWorkspace();
  }
}

function buildStudentUpdatePayload(student, overrides = {}) {
  return {
    id: student.id,
    first_name: student.first_name,
    last_name: student.last_name,
    email: student.email || null,
    grade: student.grade || null,
    teacher: student.teacher || null,
    notes: student.notes || null,
    lsa_easy: student.lsa_easy || null,
    lsa_medium: student.lsa_medium || null,
    lsa_difficult: student.lsa_difficult || null,
    lsa_units: JSON.stringify(student.lsa_units || {}),
    recorder_color: student.recorder_color || null,
    good_news_shared: student.good_news_shared ? 1 : 0,
    color_dot: student.color_dot || null,
    ...overrides,
  };
}

function getRecorderCellStyle(color) {
  const bg = recorderColorLightBackgrounds[color];
  return bg ? `background:${bg};` : '';
}

async function setRecorderColor(studentId, color) {
  const student = students.find(entry => String(entry.id) === String(studentId));
  if (!student || student.isSample) {
    return;
  }

  const normalized = recorderColorOptions.includes(color) ? color : null;
  const previous = student.recorder_color || null;
  student.recorder_color = normalized;

  try {
    await window.api.updateStudent(buildStudentUpdatePayload(student));
    renderWorkspace();
  } catch (error) {
    student.recorder_color = previous;
    console.error('[renderer] failed to save recorder color:', error);
    renderWorkspace();
  }
}

function renderLsaToggle() {
  lsaToggleBtn.classList.toggle('active', lsaMode);
  lsaSubmenu.classList.toggle('open', lsaMode);
}

function renderAssessmentToggle() {
  assessmentToggleBtn.classList.toggle('active', assessmentMode);
  assessmentSubmenu.classList.toggle('open', assessmentMode);
  showAssessmentsBtn.classList.toggle('active', manageAssessmentsVisible);
  const dirLabel = ratingDirection === 'asc' ? '1 is Best in Rating Scales' : '4 is Best in Rating Scales';
  ratingDirectionLabel.textContent = dirLabel;
  assessLibDirectionLabel.textContent = dirLabel;
  ratingDirectionBtn.classList.toggle('active', ratingDirection === 'desc');
  assessLibDirectionBtn.classList.toggle('active', ratingDirection === 'desc');
}

function renderManageStudentsToggle() {
  manageStudentsBtn.classList.toggle('active', manageStudentsVisible);
  manageStudentsSubmenu.classList.toggle('open', manageStudentsVisible);
}

function renderEditModeToggle() {
  editModeToggleBtn.classList.toggle('active', editMode);
}

function renderManageSeatingToggle() {
  chartToolsBtn.classList.toggle('active', manageChartToolsVisible);
  chartToolsSubmenu.classList.toggle('open', manageChartToolsVisible);
  undoClearChartBtn.classList.toggle('hidden', !manageChartToolsVisible || !lastClearedChartSnapshot);
}

function renderManageUnitsToggle() {
  showUnitsBtn.classList.toggle('active', manageUnitsVisible);
}

function renderUnitsLibrary() {
  const shouldShow = lsaMode && manageUnitsVisible;
  unitsLibrary.classList.toggle('hidden', !shouldShow);

  if (!shouldShow) {
    return;
  }

  unitsList.innerHTML = '';
  for (let i = 1; i <= totalLsaUnits; i += 1) {
    const unitKey = getLsaUnitKey(i);
    const imageUrl = lsaUnitPromptImages.get(unitKey) || '';
    const row = document.createElement('div');
    row.className = 'unit-pill-row';
    if (imageUrl) {
      row.classList.add('has-preview');
    }

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'class-pill';
    if (i === activeLsaUnit) {
      pill.classList.add('active');
    }
    const rawFileName = lsaUnitLessonFileNames.get(unitKey) || '';
    const lessonFileName = rawFileName ? rawFileName.replace(/\.[^/.]+$/, '') : '';
    pill.textContent = lessonFileName ? `LSA ${i} - ${lessonFileName}` : `LSA ${i}`;
    pill.addEventListener('click', () => {
      activeLsaUnit = i;
      renderWorkspace();
    });

    const importBtn = imageUrl ? document.createElement('button') : null;
    if (importBtn) {
      importBtn.type = 'button';
      importBtn.className = 'unit-icon-btn';
      importBtn.setAttribute('aria-label', `Replace image for LSA ${i}`);
      importBtn.title = 'Replace image';
      importBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6V3L8 7l4 4V8a4 4 0 0 1 3.87 3h2.02A6.01 6.01 0 0 0 12 6zm-4.89 5H5.09A6.01 6.01 0 0 0 12 18v3l4-4-4-4v3a4 4 0 0 1-3.89-5z"></path></svg>';
      importBtn.addEventListener('click', event => {
        event.stopPropagation();
        openLessonLibraryForUnit(i);
      });
    }

    row.appendChild(pill);
    if (importBtn) row.appendChild(importBtn);

    if (imageUrl) {
      const hint = document.createElement('div');
      hint.className = 'unit-image-hint';
      hint.innerHTML = `<img class="unit-image-hint-img" src="${escHtml(imageUrl)}" alt="LSA ${i} prompt preview">`;
      row.appendChild(hint);
    }

    unitsList.appendChild(row);
  }
}

function renderWorkspace() {
  normalizeModes();
  renderSeatingChartLibrary();
  renderClassLibrary();
  renderUnitsLibrary();
  renderAssessmentLibrary();
  renderRoster();
  renderChart();
  fitStudentNames();
  renderSelectionDetails();
  renderCounts();
  renderAttendanceSummary();
  renderAttendanceToggle();
  renderLsaToggle();
  renderAssessmentToggle();
  renderManageStudentsToggle();
  renderEditModeToggle();
  renderManageSeatingToggle();
  renderManageUnitsToggle();
  renderGradebookClassSubtitle();
  renderRecordersTabVisibility();
  renderAttendanceGrid();
  renderLsaGrid();
  renderAssessmentGrid();
  renderRhythmGrid();
  renderMovementGrid();
  renderInstrumentGrid();
  renderRecordersGrid();
  if (activeGradebookTab === 'imma') renderImmaGrid();
  sampleNote.classList.toggle('hidden', !usingSampleRoster);

  // Update the toggle button label to match the latest state
  showInactiveBtn.querySelector('strong').textContent = getShowInactiveStudents()
    ? 'Hide Inactive Students'
    : 'Show Inactive Students';

  // --- Mark first visible sub-action button in each submenu ---
  const submenus = document.querySelectorAll('.chart-tools-submenu');
  submenus.forEach(submenu => {
    // Remove any previous 'first-visible' classes
    submenu.querySelectorAll('button.first-visible').forEach(btn => btn.classList.remove('first-visible'));
    // Find first visible button
    const firstVisible = Array.from(submenu.children).find(
      el => el.tagName === 'BUTTON' && !el.classList.contains('hidden')
    );
    if (firstVisible) {
      firstVisible.classList.add('first-visible');
    }
    // Remove 'first-visible' from hidden buttons just in case
    submenu.querySelectorAll('button.hidden.first-visible').forEach(btn => btn.classList.remove('first-visible'));
  });
}

// Returns the CSS class that should color a cell for a given rating number,
// accounting for ratingDirection ('asc' = 1 best, 'desc' = 4 best).
function getRatingClass(rating) {
  const ORDER_ASC  = { 1: 'assess-r1', 2: 'assess-r2', 3: 'assess-r3', 4: 'assess-r4' };
  const ORDER_DESC = { 1: 'assess-r4', 2: 'assess-r3', 3: 'assess-r2', 4: 'assess-r1' };
  return (ratingDirection === 'desc' ? ORDER_DESC : ORDER_ASC)[rating] || '';
}

// Returns [1,2,3,4] or [4,3,2,1] for display order on the scale card.
function getRatingDisplayOrder() {
  return ratingDirection === 'desc' ? [4, 3, 2, 1] : [1, 2, 3, 4];
}

// Plays an LSA audio file, stopping any currently playing one first.
function playLsaAudio(url, btn) {
  if (activeLsaAudio) {
    activeLsaAudio.pause();
    activeLsaAudio.currentTime = 0;
    activeLsaAudio = null;
  }

  let stopHandler = null;

  function resetBtn() {
    if (!btn) return;
    btn.classList.remove('playing');
    btn.innerHTML = '&#9654;';
    if (stopHandler) {
      btn.removeEventListener('click', stopHandler);
      stopHandler = null;
    }
  }

  const audio = new Audio(url);
  activeLsaAudio = audio;

  if (btn) {
    btn.classList.add('playing');
    btn.innerHTML = `<span class="lsa-audio-progress-fill" style="width:0%"></span><span class="lsa-audio-stop-label">&#9646;&#9646; STOP</span>`;
    stopHandler = e => {
      e.stopPropagation();
      audio.pause();
      audio.currentTime = 0;
      activeLsaAudio = null;
      resetBtn();
    };
    btn.addEventListener('click', stopHandler);

    audio.addEventListener('timeupdate', () => {
      if (!audio.duration) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      const fill = btn.querySelector('.lsa-audio-progress-fill');
      if (fill) fill.style.width = `${pct}%`;
    });
  }

  audio.play().catch(err => console.error('[lsa-audio] play failed:', err));
  audio.addEventListener('ended', () => {
    activeLsaAudio = null;
    resetBtn();
  });
}

function toggleRatingDirection() {
  ratingDirection = ratingDirection === 'asc' ? 'desc' : 'asc';
  localStorage.setItem('ratingDirection', ratingDirection);
  renderWorkspace();
  // Also refresh lib content if the modal is open
  if (!assessmentLibraryModal.classList.contains('hidden')) {
    renderAssessLibContent();
  }
}

async function loadAssessmentLibraryForGrade(grade) {
  if (!grade || !window.api.getAssessmentLibrary) return;
  try {
    const rows = await window.api.getAssessmentLibrary(grade);
    const gradeMap = new Map();
    rows.forEach(row => gradeMap.set(row.assess_num, { name: row.name, scale1: row.scale1, scale2: row.scale2, scale3: row.scale3, scale4: row.scale4 }));
    assessmentLibraryDb.set(grade, gradeMap);
  } catch (err) {
    console.error('[renderer] failed to load assessment library:', err);
  }
}

async function openAssessmentLibrary() {
  const grade = getActiveClassGrade();
  if (grade) {
    assessLibraryGrade = grade;
    assessLibGradeSelect.value = grade;
    await loadAssessmentLibraryForGrade(grade);
  }
  assessmentLibraryModal.classList.remove('hidden');
  renderAssessLibContent();
}

function closeAssessmentLibrary() {
  assessmentLibraryModal.classList.add('hidden');
}

function openMultiGradeModal() {
  renderMultiGradeModal();
  multiGradeModal.classList.remove('hidden');
}

function closeMultiGradeModal() {
  multiGradeModal.classList.add('hidden');
}

function renderMultiGradeModal() {
  const allTeachers = Array.from(
    new Set(
      students
        .filter(s => !s.isSample)
        .map(s => normalizeTeacher(s.teacher))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  if (allTeachers.length === 0) {
    multiGradeList.innerHTML = '<div class="multi-grade-empty">No teachers found. Add students with teacher names first.</div>';
    return;
  }

  multiGradeList.innerHTML = '';
  allTeachers.forEach(teacher => {
    const id = `mg-${CSS.escape(teacher)}`;
    const row = document.createElement('div');
    row.className = 'multi-grade-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.id = id;
    checkbox.checked = multiGradeTeachers.has(teacher);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        multiGradeTeachers.add(teacher);
      } else {
        multiGradeTeachers.delete(teacher);
      }
      localStorage.setItem('multiGradeTeachers', JSON.stringify(Array.from(multiGradeTeachers)));
      // Reset active class if it was split/merged by this change
      activeClassTeacher = null;
      renderWorkspace();
    });
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = getTeacherLabel(teacher);
    row.appendChild(checkbox);
    row.appendChild(label);
    multiGradeList.appendChild(row);
  });
}

function renderAssessLibContent() {
  if (!assessLibraryGrade) {
    assessLibContent.innerHTML = '<div class="assess-lib-placeholder">Select a grade to view and edit assessments.</div>';
    return;
  }
  const gradeMap = assessmentLibraryDb.get(assessLibraryGrade) || new Map();
  assessLibContent.innerHTML = '';
  for (let i = 1; i <= 16; i++) {
    const entry = gradeMap.get(i) || {};
    const defaultLabel = ASSESSMENT_LABELS[i] || `Assessment ${i}`;
    const item = document.createElement('div');
    item.className = 'assess-lib-item';
    item.innerHTML = `
      <div class="assess-lib-item-header">
        <span class="assess-lib-num">${escHtml(defaultLabel)}</span>
        <span class="assess-lib-label-sep">\u2014</span>
        <input class="assess-lib-name-input" type="text" placeholder="Add a subtitle\u2026"
          value="${escHtml(entry.name || '')}" data-assess-num="${i}" data-field="name" />
      </div>
      <div class="assess-lib-scale-grid">
        ${[1,2,3,4].map(pos => {
          const ratingNum = ratingDirection === 'desc' ? (5 - pos) : pos;
          const colorClass = ['', 'assess-r1', 'assess-r2', 'assess-r3', 'assess-r4'][pos] || '';
          return `
          <div class="assess-lib-scale-item ${colorClass}">
            <label>Rating ${ratingNum}</label>
            <textarea data-assess-num="${i}" data-field="scale${pos}" placeholder="Describe rating ${ratingNum}…">${escHtml(entry[`scale${pos}`] || '')}</textarea>
          </div>`;
        }).join('')}
      </div>
    `;
    item.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('change', () => saveAssessLibItem(i, item));
    });
    assessLibContent.appendChild(item);
  }
}

async function saveAssessLibItem(num, itemEl) {
  const grade = assessLibraryGrade;
  if (!grade) return;
  const name = itemEl.querySelector('[data-field="name"]').value.trim();
  const scale1 = itemEl.querySelector('[data-field="scale1"]').value.trim();
  const scale2 = itemEl.querySelector('[data-field="scale2"]').value.trim();
  const scale3 = itemEl.querySelector('[data-field="scale3"]').value.trim();
  const scale4 = itemEl.querySelector('[data-field="scale4"]').value.trim();
  try {
    await window.api.upsertAssessmentLibraryItem(grade, num, name, scale1, scale2, scale3, scale4);
    const gradeMap = assessmentLibraryDb.get(grade) || new Map();
    gradeMap.set(num, { name: name || null, scale1: scale1 || null, scale2: scale2 || null, scale3: scale3 || null, scale4: scale4 || null });
    assessmentLibraryDb.set(grade, gradeMap);
    renderWorkspace();
  } catch (err) {
    console.error('[renderer] failed to save assessment library item:', err);
  }
}

function renderAssessmentLibrary() {
  const shouldShow = assessmentMode && manageAssessmentsVisible;
  assessmentsLibrary.classList.toggle('hidden', !shouldShow);

  if (!shouldShow) return;

  assessmentsList.innerHTML = '';
  for (let i = 1; i <= 16; i++) {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'class-pill';
    if (i === activeAssessmentNumber) pill.classList.add('active');
    pill.textContent = getAssessmentLabel(i);
    pill.addEventListener('click', () => {
      activeAssessmentNumber = i;
      renderWorkspace();
    });
    const row = document.createElement('div');
    row.className = 'unit-pill-row';
    row.appendChild(pill);
    assessmentsList.appendChild(row);
  }
}

async function openLessonLibraryForUnit(unitNumber) {
  lessonLibraryPickUnit = unitNumber;
  lessonLibraryOpen = true;
  lessonLibraryModal.classList.remove('hidden');
  switchLessonLibTab('library');
  document.querySelector('.lesson-lib-header h3').textContent = `Select Image for LSA ${unitNumber}`;
  try {
    lessonLibraryLessons = await window.api.getLsaLessons() || [];
  } catch (err) {
    console.error('[lesson-library] failed to load lessons:', err);
    lessonLibraryLessons = [];
  }
  renderLessonLibraryGrid();
}

async function assignUnitFromLibrary(lesson) {
  const unitNumber = lessonLibraryPickUnit;
  if (!unitNumber || !lesson) return;

  const classKey = getActiveClassKeyForCharts();
  const key = getLsaUnitKey(unitNumber);

  try {
    await window.api.upsertLsaUnitAsset(classKey, unitNumber, lesson.image_url, null, lesson.audio_url || null);
    lsaUnitPromptImages.set(key, lesson.image_url);
    lsaUnitLessonFileNames.set(key, lesson.file_name || '');
    if (lesson.audio_url) {
      lsaUnitAudioPaths.set(key, lesson.audio_url);
    } else {
      lsaUnitAudioPaths.delete(key);
    }
    closeLessonLibraryModal();
    renderWorkspace();
  } catch (err) {
    console.error('[renderer] failed to assign unit from library:', err);
    alert('Could not assign image. Please try again.');
  }
}

async function openLessonLibraryModal() {
  lessonLibraryOpen = true;
  lessonLibraryModal.classList.remove('hidden');
  try {
    lessonLibraryLessons = await window.api.getLsaLessons() || [];
  } catch (err) {
    console.error('[lesson-library] failed to load lessons:', err);
    lessonLibraryLessons = [];
  }
  renderLessonLibraryGrid();
  if (lessonLibraryTab === 'assignments' && lessonLibrarySelectedGrade) {
    await renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
  }
}

function closeLessonLibraryModal() {
  lessonLibraryOpen = false;
  lessonLibraryPickUnit = null;
  lessonLibrarySelectedId = null;
  document.querySelector('.lesson-lib-header h3').textContent = 'Lesson Library';
  lessonLibraryModal.classList.add('hidden');
}

function switchLessonLibTab(tab) {
  lessonLibraryTab = tab;
  document.querySelectorAll('.lesson-lib-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('lesson-lib-panel-library').classList.toggle('active', tab === 'library');
  document.getElementById('lesson-lib-panel-assignments').classList.toggle('active', tab === 'assignments');
  if (tab === 'assignments' && lessonLibrarySelectedGrade) {
    renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
  }
}

function renderLessonLibraryGrid() {
  lessonLibGrid.innerHTML = '';
  const pickMode = lessonLibraryPickUnit !== null;
  lessonLibGrid.classList.toggle('pick-mode', pickMode);

  if (lessonLibraryLessons.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'lesson-lib-empty';
    empty.textContent = 'No lessons yet. Import images to get started.';
    lessonLibGrid.appendChild(empty);
    return;
  }
  lessonLibraryLessons.forEach(lesson => {
    const card = document.createElement('div');
    card.className = 'lesson-lib-card';
    if (pickMode) {
      card.classList.add('pick-mode');
      card.addEventListener('click', () => assignUnitFromLibrary(lesson));
    }

    if (!pickMode) {
      // Delete button — upper right
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'lesson-lib-delete-btn';
      deleteBtn.setAttribute('aria-label', `Delete ${lesson.file_name}`);
      deleteBtn.textContent = '\u00d7';
      deleteBtn.addEventListener('click', () => deleteLessonFromLibrary(lesson.id));
      card.appendChild(deleteBtn);

      // Audio pills — upper left
      const pillsWrap = document.createElement('div');
      pillsWrap.className = 'lesson-lib-audio-pills';

      const addAudioPill = document.createElement('button');
      addAudioPill.type = 'button';
      addAudioPill.className = `lesson-lib-audio-pill${lesson.audio_url ? ' has-audio' : ''}`;
      if (lesson.audio_url) {
        const raw = decodeURIComponent(lesson.audio_url.split(/[\\/]/).pop());
        addAudioPill.textContent = raw.replace(/-\d{10,}(\.[^.]+)$/, '$1');
        addAudioPill.style.cursor = 'default';
        addAudioPill.style.pointerEvents = 'none';
      } else {
        addAudioPill.textContent = 'Add Audio';
        addAudioPill.dataset.tooltip = 'Click to add an audio file';
        addAudioPill.setAttribute('aria-label', `Add audio for ${lesson.file_name}`);
        addAudioPill.addEventListener('click', () => importLessonAudio(lesson.id));
      }
      pillsWrap.appendChild(addAudioPill);

      if (lesson.audio_url) {
        const removeAudioPill = document.createElement('button');
        removeAudioPill.type = 'button';
        removeAudioPill.className = 'lesson-lib-remove-audio-pill';
        removeAudioPill.textContent = 'Remove Audio';
        removeAudioPill.setAttribute('aria-label', `Remove audio from ${lesson.file_name}`);
        removeAudioPill.addEventListener('click', async () => {
          try {
            await window.api.setLsaLessonAudio(lesson.id, null);
            lessonLibraryLessons = lessonLibraryLessons.map(l =>
              l.id === lesson.id ? { ...l, audio_url: null } : l
            );
            renderLessonLibraryGrid();
          } catch (err) {
            console.error('[lesson-library] remove audio failed:', err);
          }
        });
        pillsWrap.appendChild(removeAudioPill);
      }

      card.appendChild(pillsWrap);
    }

    const thumb = document.createElement('img');
    thumb.className = 'lesson-lib-thumb';
    thumb.src = lesson.image_url;
    thumb.alt = lesson.file_name;

    const name = document.createElement('div');
    name.className = 'lesson-lib-filename';
    name.textContent = lesson.file_name;

    card.appendChild(thumb);
    card.appendChild(name);
    lessonLibGrid.appendChild(card);
  });
}

async function importLessonLibImages() {
  if (!window.api.importLsaLessons) return;
  try {
    const result = await window.api.importLsaLessons();
    if (!result || result.canceled) return;
    lessonLibraryLessons = [...lessonLibraryLessons, ...result.imported]
      .sort((a, b) => (a.file_name || '').localeCompare(b.file_name || '', undefined, { numeric: true, sensitivity: 'base' }));
    renderLessonLibraryGrid();
  } catch (err) {
    console.error('[lesson-library] import failed:', err);
    alert('Could not import lesson images. Please try again.');
  }
}

async function importLessonAudio(lessonId) {
  if (!window.api.importLsaAudio) return;
  try {
    const result = await window.api.importLsaAudio(lessonId);
    if (!result || result.canceled || !result.lesson) return;
    lessonLibraryLessons = lessonLibraryLessons.map(l => l.id === lessonId ? result.lesson : l);
    renderLessonLibraryGrid();
  } catch (err) {
    console.error('[lesson-library] audio import failed:', err);
    alert('Could not import audio file. Please try again.');
  }
}

async function addLsaUnit() {
  const nextUnit = totalLsaUnits + 1;
  try {
    await window.api.addLsaCustomUnit(nextUnit);
    totalLsaUnits = nextUnit;
    if (lessonLibrarySelectedGrade) {
      await renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
    }
    renderWorkspace();
  } catch (err) {
    console.error('[renderer] failed to add custom unit:', err);
    alert('Could not add unit. Please try again.');
  }
}

async function deleteLessonFromLibrary(lessonId) {
  if (!window.api.deleteLsaLesson) return;
  try {
    await window.api.deleteLsaLesson(lessonId);
    lessonLibraryLessons = lessonLibraryLessons.filter(l => l.id !== lessonId);
    renderLessonLibraryGrid();
    if (lessonLibrarySelectedGrade) {
      await renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
    }
    await loadLsaUnitPromptImages(false);
  } catch (err) {
    console.error('[lesson-library] delete failed:', err);
  }
}

function showGradeAssignmentPlaceholder() {
  lessonLibAssignWrap.innerHTML = '';
  const p = document.createElement('div');
  p.className = 'lesson-lib-assign-placeholder';
  p.textContent = 'Select a grade to view unit assignments.';
  lessonLibAssignWrap.appendChild(p);
}

async function renderGradeAssignmentsTable(gradeLevel) {
  if (!window.api.getLsaGradeUnitMap) return;
  let gradeMap = [];
  try {
    gradeMap = await window.api.getLsaGradeUnitMap(gradeLevel);
  } catch (err) {
    console.error('[lesson-library] failed to load grade map:', err);
    return;
  }

  const unitLessonMap = new Map();
  gradeMap.forEach(row => {
    if (row.lesson_id) unitLessonMap.set(row.unit_number, row);
  });

  lessonLibAssignWrap.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'lesson-lib-assign-table';
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Unit</th><th>Assigned Lesson</th><th></th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (let i = 1; i <= totalLsaUnits; i++) {
    const assignment = unitLessonMap.get(i);
    const tr = document.createElement('tr');

    const unitTd = document.createElement('td');
    unitTd.innerHTML = `<span class="lesson-lib-unit-label">LSA ${i}</span>`;

    const selectTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'lesson-lib-assign-select';
    const blankOpt = document.createElement('option');
    blankOpt.value = '';
    blankOpt.textContent = '\u2014 Unassigned \u2014';
    select.appendChild(blankOpt);
    lessonLibraryLessons.forEach(lesson => {
      const opt = document.createElement('option');
      opt.value = String(lesson.id);
      opt.textContent = lesson.file_name;
      if (assignment && assignment.lesson_id === lesson.id) opt.selected = true;
      select.appendChild(opt);
    });

    const previewTd = document.createElement('td');
    updateAssignmentRowPreview(previewTd, assignment || null);

    select.addEventListener('change', async () => {
      const lessonId = select.value ? Number(select.value) : null;
      try {
        await window.api.upsertLsaGradeUnitMap(gradeLevel, i, lessonId);
        const newLesson = lessonId ? lessonLibraryLessons.find(l => l.id === lessonId) : null;
        updateAssignmentRowPreview(previewTd, newLesson || null);
        const currentGrade = getActiveClassGrade();
        if (currentGrade && normalizeGrade(currentGrade) === normalizeGrade(gradeLevel)) {
          await loadLsaUnitPromptImages(false);
        }
      } catch (err) {
        console.error('[lesson-library] failed to save assignment:', err);
      }
    });

    selectTd.appendChild(select);
    tr.appendChild(unitTd);
    tr.appendChild(selectTd);
    tr.appendChild(previewTd);
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  lessonLibAssignWrap.appendChild(table);
}

function updateAssignmentRowPreview(td, assignment) {
  td.innerHTML = '';
  if (assignment && assignment.image_url) {
    const img = document.createElement('img');
    img.className = 'lesson-lib-assign-preview';
    img.src = assignment.image_url;
    img.alt = assignment.file_name || '';
    td.appendChild(img);
  }
}

// --- CSV Student Import ---

const CSV_IMPORT_FIELDS = [
  { key: 'first_name',     label: 'First Name',     required: true },
  { key: 'last_name',      label: 'Last Name',      required: true },
  { key: 'student_number', label: 'Student ID #',   required: false },
  { key: 'grade',          label: 'Grade',          required: false },
  { key: 'teacher',        label: 'Teacher',        required: false },
  { key: 'email',          label: 'Email',          required: false },
  { key: 'notes',          label: 'Notes',          required: false },
  { key: 'recorder_color', label: 'Recorder Color', required: false },
];

function parseCSVText(text) {
  const rows = [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let i = 0;
  while (i < normalized.length) {
    const row = [];
    while (i < normalized.length) {
      let field = '';
      if (normalized[i] === '"') {
        i++;
        while (i < normalized.length) {
          if (normalized[i] === '"') {
            if (normalized[i + 1] === '"') { field += '"'; i += 2; }
            else { i++; break; }
          } else {
            field += normalized[i++];
          }
        }
      } else {
        while (i < normalized.length && normalized[i] !== ',' && normalized[i] !== '\n') {
          field += normalized[i++];
        }
      }
      row.push(field);
      if (i < normalized.length && normalized[i] === ',') { i++; }
      else { break; }
    }
    if (i < normalized.length && normalized[i] === '\n') i++;
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

function autoDetectCsvMapping(headers) {
  const mapping = {};
  const normalized = headers.map(h => h.toLowerCase().trim().replace(/[^a-z0-9]/g, ''));
  const matchers = {
    first_name:     ['firstname', 'first', 'fname', 'givenname', 'preferredname', 'studentfirstname'],
    last_name:      ['lastname', 'last', 'lname', 'surname', 'familyname', 'studentlastname'],
    student_number: ['studentnumber', 'studentid', 'studentnum', 'idnumber', 'id', 'localid', 'sis'],
    grade:          ['grade', 'gradelevel', 'gradelvl', 'level'],
    teacher:        ['teacher', 'teachername', 'instructor', 'classroom', 'homeroom'],
    email:          ['email', 'emailaddress', 'mail', 'studentemail'],
    notes:          ['notes', 'note', 'comments', 'comment', 'remarks'],
    recorder_color: ['recordercolor', 'recorder', 'color', 'colour'],
  };
  CSV_IMPORT_FIELDS.forEach(field => {
    const candidates = matchers[field.key] || [];
    const idx = normalized.findIndex(h => candidates.includes(h));
    mapping[field.key] = idx >= 0 ? idx : -1;
  });
  return mapping;
}

function openCsvImportModal() {
  // Reset state
  csvImportStep = 1;
  csvParsedRows = [];
  csvMapping = {};
  csvImporting = false;
  csvFileInput.value = '';
  csvFileNameDisplay.textContent = '';
  csvStep1Next.disabled = true;
  csvImportResult.classList.add('hidden');
  csvImportResult.className = 'csv-import-result hidden';
  csvStep3Import.textContent = 'Import Students';
  csvStep3Import.disabled = false;
  goToCsvStep(1, true);
  csvImportModal.classList.remove('hidden');
}

function closeCsvImportModal() {
  csvImportModal.classList.add('hidden');
  csvImporting = false;
}

function goToCsvStep(step, skipRender) {
  csvImportStep = step;
  [1, 2, 3].forEach(n => {
    const panel = document.getElementById(`csv-step-panel-${n}`);
    const ind = document.getElementById(`csv-step-ind-${n}`);
    if (panel) panel.classList.toggle('hidden', n !== step);
    if (ind) {
      ind.classList.toggle('active', n === step);
      ind.classList.toggle('done', n < step);
    }
  });
  if (!skipRender) {
    if (step === 2) renderCsvMappingTable();
    if (step === 3) renderCsvPreview();
  }
}

function handleCsvFileSelect(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const rows = parseCSVText(text);
    if (rows.length < 2) {
      csvFileNameDisplay.textContent = 'File appears empty — no data rows found.';
      csvStep1Next.disabled = true;
      return;
    }
    csvParsedRows = rows;
    csvMapping = autoDetectCsvMapping(rows[0]);
    csvFileNameDisplay.textContent = `${file.name}  (${rows.length - 1} data rows)`;
    csvStep1Next.disabled = false;
  };
  reader.onerror = () => {
    csvFileNameDisplay.textContent = 'Could not read file. Please try again.';
    csvStep1Next.disabled = true;
  };
  reader.readAsText(file);
}

function renderCsvMappingTable() {
  if (!csvParsedRows.length) return;
  const headers = csvParsedRows[0];
  const firstDataRow = csvParsedRows[1] || [];

  const makeSkipOption = () => {
    const opt = document.createElement('option');
    opt.value = '-1';
    opt.textContent = '— Skip —';
    return opt;
  };

  csvMapTbody.innerHTML = '';
  CSV_IMPORT_FIELDS.forEach(field => {
    const tr = document.createElement('tr');

    const labelTd = document.createElement('td');
    labelTd.innerHTML = `<span class="csv-map-field-label">${escHtml(field.label)}${field.required ? ' <span class="csv-map-required">*</span>' : ''}</span>`;

    const selectTd = document.createElement('td');
    const select = document.createElement('select');
    select.className = 'csv-map-select';
    select.dataset.fieldKey = field.key;
    select.appendChild(makeSkipOption());
    headers.forEach((h, idx) => {
      const opt = document.createElement('option');
      opt.value = String(idx);
      opt.textContent = h || `Column ${idx + 1}`;
      if (csvMapping[field.key] === idx) opt.selected = true;
      select.appendChild(opt);
    });

    const previewTd = document.createElement('td');
    previewTd.className = 'csv-map-preview-cell';

    const updatePreview = () => {
      const idx = Number(select.value);
      previewTd.textContent = (idx >= 0 && firstDataRow[idx] !== undefined)
        ? firstDataRow[idx]
        : '';
    };

    select.addEventListener('change', updatePreview);
    updatePreview();

    selectTd.appendChild(select);
    tr.appendChild(labelTd);
    tr.appendChild(selectTd);
    tr.appendChild(previewTd);
    csvMapTbody.appendChild(tr);
  });
}

function saveCsvMapping() {
  csvMapTbody.querySelectorAll('select[data-field-key]').forEach(select => {
    csvMapping[select.dataset.fieldKey] = Number(select.value);
  });
}

function ordinalSuffix(n) {
  if (n === 1) return 'st';
  if (n === 2) return 'nd';
  if (n === 3) return 'rd';
  return 'th';
}

function normalizeGradeForStorage(grade) {
  if (!grade) return '';
  const s = String(grade).trim();
  if (!s) return '';
  const lower = s.toLowerCase();
  if (['k', 'kindergarten', 'kinder', 'pre-k', 'prek'].includes(lower)) return 'K';
  if (lower === 'y5' || lower.replace(/[^a-z0-9]/g, '') === 'young5s' ||
      lower.includes('young five') || lower.includes('young 5')) return 'Y5';
  const wordOrdinals = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8 };
  for (const [word, num] of Object.entries(wordOrdinals)) {
    if (lower.includes(word)) return num + ordinalSuffix(num);
  }
  const gradeMatch = lower.match(/grade\s*(\d+)|(\d+)\s*grade/);
  if (gradeMatch) {
    const n = Number(gradeMatch[1] || gradeMatch[2]);
    return n + ordinalSuffix(n);
  }
  const numMatch = s.match(/^0*(\d+)/);
  if (numMatch) {
    const n = Number(numMatch[1]);
    return n + ordinalSuffix(n);
  }
  return s;
}

function buildMappedRow(rawRow) {
  const obj = {};
  CSV_IMPORT_FIELDS.forEach(field => {
    const idx = csvMapping[field.key];
    const raw = (idx >= 0 && rawRow[idx] !== undefined) ? String(rawRow[idx]).trim() : '';
    obj[field.key] = field.key === 'grade' ? normalizeGradeForStorage(raw) : raw;
  });
  return obj;
}

function renderCsvPreview() {
  const calendarYear = getDefaultAcademicYear();

  // Populate and wire the year selector in the CSV step 3 panel.
  const csvYearSelect = document.getElementById('csv-year-select');
  if (csvYearSelect) {
    csvYearSelect.innerHTML = buildAcademicYearOptions(currentAcademicYear || calendarYear);
    csvYearSelect.onchange = async () => {
      currentAcademicYear = csvYearSelect.value;
      renderAcademicYearDisplay();
      try {
        await window.api.setSetting('current_academic_year', currentAcademicYear);
      } catch (err) {
        console.error('[csv-year] failed to save:', err);
      }
      renderCsvPreview(); // re-render with updated year lock state
    };
  }

  const year = currentAcademicYear || calendarYear;
  const yearMismatch = year !== calendarYear;

  // Lock or unlock the Sync button based on year match.
  csvStep3Import.disabled = yearMismatch;

  const countEl = document.getElementById('csv-preview-count');
  if (yearMismatch) {
    countEl.innerHTML = `<span style="color:#b45309;font-weight:600;">&#9888; Cannot sync: selected year (${escHtml(year)}) does not match the current school year (${escHtml(calendarYear)}). Change the year above to continue.</span>`;
  } else {
    const mappedFields = CSV_IMPORT_FIELDS.filter(f => (csvMapping[f.key] ?? -1) >= 0);
    const dataRows = csvParsedRows.slice(1);
    const validRows = dataRows.filter(row => {
      const mapped = buildMappedRow(row);
      return mapped.first_name && mapped.last_name;
    });
    const skippedCount = dataRows.length - validRows.length;
    let countText = `${validRows.length} student${validRows.length !== 1 ? 's' : ''} will be synced for ${year}`;
    if (skippedCount > 0) countText += ` · ${skippedCount} row${skippedCount !== 1 ? 's' : ''} skipped (missing name)`;
    countEl.textContent = countText;
  }

  const mappedFields = CSV_IMPORT_FIELDS.filter(f => (csvMapping[f.key] ?? -1) >= 0);
  const dataRows = csvParsedRows.slice(1);
  const validRows = dataRows.filter(row => {
    const mapped = buildMappedRow(row);
    return mapped.first_name && mapped.last_name;
  });
  const skippedCount = dataRows.length - validRows.length;

  const thead = document.getElementById('csv-preview-thead');
  const tbody = document.getElementById('csv-preview-tbody');
  thead.innerHTML = `<tr>${mappedFields.map(f => `<th>${escHtml(f.label)}</th>`).join('')}</tr>`;
  tbody.innerHTML = '';

  const previewRows = validRows.slice(0, 6);
  previewRows.forEach(row => {
    const mapped = buildMappedRow(row);
    const tr = document.createElement('tr');
    mappedFields.forEach(field => {
      const td = document.createElement('td');
      td.textContent = mapped[field.key] || '';
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  if (validRows.length > 6) {
    const moreRow = document.createElement('tr');
    const moreTd = document.createElement('td');
    moreTd.colSpan = mappedFields.length;
    moreTd.style.cssText = 'font-size:0.78rem;color:var(--ink-light);padding:6px 10px;font-style:italic;';
    moreTd.textContent = `…and ${validRows.length - 6} more`;
    moreRow.appendChild(moreTd);
    tbody.appendChild(moreRow);
  }

  csvStep3Import.disabled = validRows.length === 0;
}

async function executeCsvImport() {
  if (csvImporting) return;
  saveCsvMapping();

  // Hard block: never allow syncing to a year that doesn't match the calendar year.
  const year = currentAcademicYear || getDefaultAcademicYear();
  if (year !== getDefaultAcademicYear()) {
    showCsvImportResult('Sync blocked: selected year does not match the current school year.', false);
    return;
  }

  const dataRows = csvParsedRows.slice(1);
  const validRows = dataRows.filter(row => {
    const mapped = buildMappedRow(row);
    return mapped.first_name && mapped.last_name;
  });

  if (validRows.length === 0) {
    showCsvImportResult('No valid rows to import. Ensure First Name and Last Name columns are mapped.', false);
    return;
  }

  csvImporting = true;
  csvStep3Import.disabled = true;
  csvStep3Import.textContent = 'Importing…';
  csvStep3Back.disabled = true;

  const csvStudents = validRows.map(row => buildMappedRow(row));
  const syncYear = currentAcademicYear || getDefaultAcademicYear();

  let result = null;
  try {
    result = await window.api.syncStudentsFromCsv(csvStudents, syncYear);
  } catch (err) {
    console.error('[csv-import] sync failed:', err);
    csvImporting = false;
    csvStep3Back.disabled = false;
    csvStep3Import.disabled = false;
    csvStep3Import.textContent = 'Import Students';
    showCsvImportResult('Import failed. Please try again.', false);
    return;
  }

  csvImporting = false;
  csvStep3Back.disabled = false;

  // Reload student list
  try {
    students = await window.api.getStudents();
    usingSampleRoster = false;
    renderWorkspace();
  } catch (err) {
    console.error('[csv-import] failed to reload students:', err);
  }

  const { updated = 0, created = 0, reactivated = 0, deactivated = 0 } = result || {};
  const skipped = dataRows.length - validRows.length;
  const parts = [];
  if (created > 0)      parts.push(`${created} added`);
  if (updated > 0)      parts.push(`${updated} updated`);
  if (reactivated > 0)  parts.push(`${reactivated} reactivated`);
  if (deactivated > 0)  parts.push(`${deactivated} marked inactive`);
  if (skipped > 0)      parts.push(`${skipped} skipped (missing name)`);
  const message = parts.length > 0 ? parts.join(', ') + '.' : 'No changes made.';

  showCsvImportResult(message, true);
  csvStep3Import.textContent = 'Done';
  csvStep3Import.addEventListener('click', closeCsvImportModal, { once: true });
}

function showCsvImportResult(message, isSuccess) {
  csvImportResult.textContent = message;
  csvImportResult.className = `csv-import-result ${isSuccess ? 'success' : 'error'}`;
}

function getCurrentChartSnapshot() {
  return students
    .filter(student => !student.isSample)
    .map((student, index) => {
      const layout = getStudentLayout(student.id) || createDefaultLayout(index);
      return {
        student_id: student.id,
        placed: Boolean(layout.placed),
        x: layout.x,
        y: layout.y,
        state: layout.state || 'ready',
        attendance: layout.attendance || null,
        assessment_rating: Object.keys(layout.assessmentRatings || {}).length > 0 ? JSON.stringify(layout.assessmentRatings) : null,
      };
    });
}

function getNextSeatingChartName() {
  let nextNumber = seatingCharts.length + 1;
  let candidate = `Seating Chart ${nextNumber}`;

  while (seatingCharts.some(chart => chart.name === candidate)) {
    nextNumber += 1;
    candidate = `Seating Chart ${nextNumber}`;
  }

  return candidate;
}

async function refreshSeatingChartsList(skipRender = false) {
  if (!hasSelectedClassContext()) {
    seatingCharts = [];
    activeSeatingChartId = null;
    if (!skipRender) {
      renderWorkspace();
    }
    return;
  }

  seatingCharts = await window.api.getSeatingCharts(getActiveClassKeyForCharts());

  if (activeSeatingChartId && !seatingCharts.some(chart => chart.id === activeSeatingChartId)) {
    activeSeatingChartId = seatingCharts[0]?.id ?? null;
  }

  if (!skipRender) {
    renderWorkspace();
  }
}

async function persistActiveSeatingChart() {
  if (usingSampleRoster || !hasSelectedClassContext()) {
    return;
  }

  const realStudents = students.filter(student => !student.isSample);
  if (realStudents.length === 0) {
    return;
  }

  const hasPlacedStudents = realStudents.some(student => getStudentLayout(student.id)?.placed);
  const items = getCurrentChartSnapshot();
  const arrangement = chartCanvas.dataset.circle === 'true' ? 'circle' : '';

  if (!activeSeatingChartId) {
    if (!hasPlacedStudents) {
      return;
    }

    const createdChart = await window.api.createSeatingChart({
      name: getNextSeatingChartName(),
      classKey: getActiveClassKeyForCharts(),
      arrangement,
      items,
    });

    activeSeatingChartId = createdChart.id;
    await refreshSeatingChartsList(true);
    renderWorkspace();
    return;
  }

  await window.api.saveSeatingChartLayout({
    chartId: activeSeatingChartId,
    classKey: getActiveClassKeyForCharts(),
    arrangement,
    items,
  });

  await refreshSeatingChartsList(true);
  renderWorkspace();
}

async function selectSeatingChart(chartId) {
  chartPanX = 0;
  chartPanY = 0;
  chartZoom = 1;
  applyChartPan();
  await loadSeatingChartIntoLayout(chartId, true);
  await refreshSeatingChartsList(true);
  animateChartSwitchToCurrentLayout();
}

async function createAdditionalSeatingChart() {
  if (!hasSelectedClassContext()) {
    alert('Select a class first before creating seating charts.');
    return;
  }

  const name = getNextSeatingChartName();
  try {
    const snapshot = getCurrentChartSnapshot();
    const createdChart = await window.api.createSeatingChart({
      name,
      classKey: getActiveClassKeyForCharts(),
      items: snapshot,
    });

    activeSeatingChartId = createdChart.id;
    await refreshSeatingChartsList(true);
    renderWorkspace();
  } catch (err) {
    console.error('Failed to create seating chart:', err);
    alert('Error creating seating chart. Check console for details.');
  }
}

function activateChartNameEdit(rowElement, chartId, currentName) {
  const nameSpan = rowElement.querySelector('.chart-row-name');
  if (!nameSpan) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'chart-name-edit';
  input.value = currentName;

  nameSpan.replaceWith(input);
  input.focus();
  input.select();

  let committed = false;

  async function saveChartName() {
    if (committed) return;
    committed = true;
    input.removeEventListener('blur', saveChartName);

    const newName = input.value.trim();
    if (!newName || newName === currentName) {
      cancelEdit();
      return;
    }

    // Replace input with a placeholder span before renderWorkspace so the
    // "don't wipe during edit" guard doesn't block the list from rebuilding.
    const tempSpan = document.createElement('span');
    tempSpan.className = 'chart-row-name';
    tempSpan.textContent = newName;
    input.replaceWith(tempSpan);

    await window.api.updateSeatingChartName(chartId, newName, getActiveClassKeyForCharts());
    await refreshSeatingChartsList(true);
    renderWorkspace();
  }

  function cancelEdit() {
    committed = true;
    input.removeEventListener('blur', saveChartName);
    const newSpan = document.createElement('span');
    newSpan.className = 'chart-row-name';
    newSpan.textContent = currentName;
    input.replaceWith(newSpan);
  }

  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveChartName();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelEdit();
    }
  });

  input.addEventListener('blur', saveChartName);
}

async function renameSeatingChart(chartId) {
  const chart = seatingCharts.find(entry => entry.id === chartId);
  if (!chart) {
    return;
  }

  const nextName = window.prompt('Rename seating chart:', chart.name);
  if (!nextName || !nextName.trim() || nextName.trim() === chart.name) {
    return;
  }

  await window.api.updateSeatingChartName(chartId, nextName.trim(), getActiveClassKeyForCharts());
  await refreshSeatingChartsList(true);
  renderWorkspace();
}

async function deleteSeatingChart(chartId) {
  const chart = seatingCharts.find(entry => entry.id === chartId);
  if (!chart) {
    return;
  }

  const confirmed = window.confirm(`Delete seating chart "${chart.name}"?`);
  if (!confirmed) {
    return;
  }

  await window.api.deleteSeatingChart(chartId, getActiveClassKeyForCharts());

  if (activeSeatingChartId === chartId) {
    activeSeatingChartId = null;
  }

  await loadSeatingCharts(true);
  renderWorkspace();
}

function toggleEditMode() {
  editMode = !editMode;
  renderWorkspace();
}

function toggleManageStudents() {
  manageStudentsVisible = !manageStudentsVisible;
  renderWorkspace();
}

function toggleChartTools() {
  manageChartToolsVisible = !manageChartToolsVisible;
  renderWorkspace();
}

async function selectClassTeacher(teacherKey) {
  const nextTeacher = teacherKey === null
    ? null
    : (activeClassTeacher === teacherKey ? null : teacherKey);
  console.log('[selectClassTeacher] teacherKey:', teacherKey, 'nextTeacher:', nextTeacher);
  activeClassTeacher = nextTeacher;
  activeSeatingChartId = null;
  chartPanX = 0;
  chartPanY = 0;
  chartZoom = 1;
  applyChartPan();

  // No need to manually update showInactiveStudents here; renderWorkspace will always use the latest state

  await loadSeatingCharts(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  // For multi-grade teachers, getActiveClassGrade() returns null — load 'multi' library instead.
  const activeGrade = getActiveClassGrade();
  let gradeForLibrary = activeGrade;
  if (!gradeForLibrary && activeClassTeacher) {
    const { teacher } = parseClassKey(activeClassTeacher);
    if (!teacher || multiGradeTeachers.has(teacher)) {
      gradeForLibrary = 'multi';
      assessLibraryGrade = 'multi';
      assessLibGradeSelect.value = 'multi';
    }
  }
  await loadAssessmentLibraryForGrade(gradeForLibrary);
  renderWorkspace();
}

function toggleSeatingChartsList() {
  seatingChartsCollapsed = !seatingChartsCollapsed;
  renderWorkspace();
}

function toggleClassesList() {
  classesCollapsed = !classesCollapsed;
  renderWorkspace();
}

async function backupStudentsCsv() {
  try {
    const result = await window.api.exportStudentsCsv();
    if (result && !result.canceled) {
      console.log(`[backup] saved ${result.count} students to ${result.filePath}`);
      alert(`Backup saved to:\n${result.filePath}`);
    }
  } catch (error) {
    console.error('[backup] export failed:', error);
    alert('Backup failed. Check the console for details.');
  }
}

async function handleExportRubrics() {
  try {
    const result = await window.api.exportAssessmentRubrics();
    if (result.canceled) return;
    if (result.count === 0) {
      alert('No assessment rubrics found to export.');
      return;
    }
    alert(`Exported ${result.count} rubric${result.count !== 1 ? 's' : ''} to:\n${result.filePath}`);
  } catch (err) {
    console.error('[exportRubrics] failed:', err);
    alert('Export failed. Check the console for details.');
  }
}

async function handleImportRubrics() {
  try {
    const result = await window.api.importAssessmentRubrics();
    if (result.canceled) return;
    if (result.error) {
      alert(`Import failed: ${result.error}`);
      return;
    }
    alert(`Imported ${result.count} rubric${result.count !== 1 ? 's' : ''}.`);
    if (assessmentMode && assessLibraryGrade) {
      await loadAssessmentLibraryForGrade(assessLibraryGrade);
      renderAssessLibContent();
    }
  } catch (err) {
    console.error('[importRubrics] failed:', err);
    alert('Import failed. Check the console for details.');
  }
}

// ── Export Selected Students modal ──────────────────────────────────────────

function openExportSelectedModal() {
  exportSelectedStudentsList = [];
  document.getElementById('export-select-search').value = '';
  renderExportSelectedModal();
  exportSelectedModal.classList.remove('hidden');
  document.getElementById('export-select-search').focus();
}

function closeExportSelectedModal() {
  exportSelectedModal.classList.add('hidden');
}

function renderExportSelectedModal() {
  const query = (document.getElementById('export-select-search').value || '').toLowerCase();
  const selectedIds = new Set(exportSelectedStudentsList.map(s => s.id));

  const allStudents = [...students].sort((a, b) => {
    const la = (a.last_name || '').toLowerCase();
    const lb = (b.last_name || '').toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    const fa = (a.first_name || '').toLowerCase();
    const fb = (b.first_name || '').toLowerCase();
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  const filtered = query
    ? allStudents.filter(s => {
        const searchable = `${s.first_name} ${s.last_name} ${s.grade || ''} ${s.teacher || ''}`.toLowerCase();
        return searchable.includes(query);
      })
    : allStudents;

  const allList = document.getElementById('export-select-all-list');
  allList.innerHTML = filtered.map(s => {
    const isChosen = selectedIds.has(s.id);
    const metaParts = [s.grade, s.teacher].filter(Boolean);
    const nameClass = s.is_active === 0 ? 'export-select-name inactive-student' : 'export-select-name';
    return `<div class="export-select-item${isChosen ? ' already-selected' : ''}" data-id="${s.id}" role="button" tabindex="0">
      <span class="${nameClass}">${s.last_name || ''}, ${s.first_name || ''}</span>
      ${metaParts.length ? `<span class="export-select-meta">${metaParts.join(' · ')}</span>` : ''}
      ${isChosen ? '<span class="export-select-check">✓</span>' : ''}
    </div>`;
  }).join('');

  const chosenList = document.getElementById('export-select-chosen-list');
  chosenList.innerHTML = exportSelectedStudentsList.map(s =>
    `<div class="export-chosen-item" data-id="${s.id}">
      <span class="export-chosen-name">${s.last_name || ''}, ${s.first_name || ''}</span>
      <button class="export-chosen-remove" data-remove-id="${s.id}" type="button" aria-label="Remove ${s.first_name}">✕</button>
    </div>`
  ).join('');

  const count = exportSelectedStudentsList.length;
  document.getElementById('export-selected-count').textContent =
    `${count} student${count !== 1 ? 's' : ''} selected`;
  document.getElementById('export-selected-btn').disabled = count === 0;
}

exportSelectedModal.addEventListener('click', event => {
  // Add student from left list
  const item = event.target.closest('.export-select-item');
  if (item) {
    const id = Number(item.dataset.id);
    if (!exportSelectedStudentsList.some(s => s.id === id)) {
      const student = students.find(s => s.id === id);
      if (student) {
        exportSelectedStudentsList.push(student);
        renderExportSelectedModal();
      }
    }
    return;
  }
  // Remove student from right panel
  const removeBtn = event.target.closest('.export-chosen-remove');
  if (removeBtn) {
    const removeId = Number(removeBtn.dataset.removeId);
    exportSelectedStudentsList = exportSelectedStudentsList.filter(s => s.id !== removeId);
    renderExportSelectedModal();
    return;
  }
  // Export button
  if (event.target.closest('#export-selected-btn')) {
    exportSelectedToCsv();
  }
});

document.getElementById('export-selected-modal-close').addEventListener('click', closeExportSelectedModal);
document.getElementById('export-selected-cancel-btn').addEventListener('click', closeExportSelectedModal);

document.getElementById('export-select-search').addEventListener('input', renderExportSelectedModal);

async function exportSelectedToCsv() {
  if (exportSelectedStudentsList.length === 0) return;
  try {
    const ids = exportSelectedStudentsList.map(s => s.id);
    const result = await window.api.exportSelectedStudentsCsv(ids);
    if (result && !result.canceled) {
      console.log(`[export-selected] saved ${result.count} students to ${result.filePath}`);
      closeExportSelectedModal();
      alert(`Exported ${result.count} student${result.count !== 1 ? 's' : ''} to:\n${result.filePath}`);
    }
  } catch (error) {
    console.error('[export-selected] export failed:', error);
    alert('Export failed. Check the console for details.');
  }
}

// ── Custom tooltip (data-tooltip attribute) ──────────────────────────────────
(function initAppTooltip() {
  const tooltip = document.getElementById('app-tooltip');
  if (!tooltip) return;
  let activeTarget = null;

  function show(el, event) {
    activeTarget = el;
    tooltip.textContent = el.dataset.tooltip;
    position(event);
    tooltip.classList.add('visible');
  }

  function hide() {
    activeTarget = null;
    tooltip.classList.remove('visible');
  }

  function position(event) {
    const offset = 14;
    let x = event.clientX + offset;
    let y = event.clientY + offset;
    // nudge back inside viewport
    const tw = tooltip.offsetWidth;
    const th = tooltip.offsetHeight;
    if (x + tw > window.innerWidth - 8) x = event.clientX - tw - offset;
    if (y + th > window.innerHeight - 8) y = event.clientY - th - offset;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
  }

  document.addEventListener('mouseover', event => {
    const el = event.target.closest('[data-tooltip]');
    if (el && el !== activeTarget) show(el, event);
  });
  document.addEventListener('mousemove', event => {
    if (activeTarget) position(event);
  });
  document.addEventListener('mouseout', event => {
    if (activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
  });
})();

async function markAllPresent() {
  const scopedStudents = getStudentsInActiveScope();
  const today = getTodayIsoDate();
  const updates = [];

  scopedStudents.forEach(student => {
    const layout = getStudentLayout(student.id);
    if (layout && layout.placed) {
      layout.attendance = 'present';
      setAttendanceStatusForDate(student.id, today, 'present');
      if (!student.isSample) {
        updates.push(window.api.upsertAttendanceRecord(student.id, today, 'present'));
      }
    }
  });

  if (updates.length > 0) {
    try {
      await Promise.all(updates);
    } catch (error) {
      console.error('[renderer] failed to mark all present in attendance records:', error);
    }
  }

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function toggleGoodNewsShared(studentId) {
  const student = students.find(entry => String(entry.id) === String(studentId));
  if (!student || student.isSample) {
    return;
  }

  const previous = student.good_news_shared ? 1 : 0;
  student.good_news_shared = previous ? 0 : 1;

  try {
    await window.api.updateStudent(buildStudentUpdatePayload(student));
    selectedStudentId = String(studentId);
    renderWorkspace();
  } catch (error) {
    student.good_news_shared = previous;
    console.error('[renderer] failed to save good news check:', error);
    renderWorkspace();
  }
}

const COLOR_DOT_CYCLE = [null, 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];

async function cycleColorDot(studentId) {
  const student = students.find(entry => String(entry.id) === String(studentId));
  if (!student || student.isSample) return;
  const current = student.color_dot || null;
  const idx = COLOR_DOT_CYCLE.indexOf(current);
  const next = COLOR_DOT_CYCLE[(idx + 1) % COLOR_DOT_CYCLE.length];
  const previous = student.color_dot;
  student.color_dot = next;
  try {
    await window.api.updateStudent(buildStudentUpdatePayload(student));
    renderWorkspace();
  } catch (error) {
    student.color_dot = previous;
    console.error('[renderer] failed to save color dot:', error);
    renderWorkspace();
  }
}

async function clearGoodNewsChecks() {
  const scopedStudents = getStudentsInActiveScope();
  const targetStudents = scopedStudents.filter(student => !student.isSample && Number(student.good_news_shared || 0) === 1);
  if (targetStudents.length === 0) {
    alert('There are no good news checks to clear.');
    return;
  }

  const confirmed = window.confirm(`Clear good news checks for ${targetStudents.length} ${targetStudents.length === 1 ? 'student' : 'students'}?`);
  if (!confirmed) {
    return;
  }

  const previousById = new Map(targetStudents.map(student => [student.id, student.good_news_shared ? 1 : 0]));
  targetStudents.forEach(student => {
    student.good_news_shared = 0;
  });

  try {
    await Promise.all(targetStudents.map(student => window.api.updateStudent(buildStudentUpdatePayload(student, {
      good_news_shared: 0,
    }))));
    renderWorkspace();
  } catch (error) {
    targetStudents.forEach(student => {
      student.good_news_shared = previousById.get(student.id) || 0;
    });
    console.error('[renderer] failed to clear good news checks:', error);
    alert('Could not clear good news checks. Please try again.');
    renderWorkspace();
  }
}

async function clearColorDots() {
  const scopedStudents = getStudentsInActiveScope();
  const targetStudents = scopedStudents.filter(student => !student.isSample && student.color_dot);
  if (targetStudents.length === 0) {
    alert('There are no color dots to clear.');
    return;
  }

  const confirmed = window.confirm(`Clear color dots for ${targetStudents.length} ${targetStudents.length === 1 ? 'student' : 'students'}?`);
  if (!confirmed) return;

  const previousById = new Map(targetStudents.map(student => [student.id, student.color_dot]));
  targetStudents.forEach(student => { student.color_dot = null; });

  try {
    await Promise.all(targetStudents.map(student => window.api.updateStudent(buildStudentUpdatePayload(student, { color_dot: null }))));
    renderWorkspace();
  } catch (error) {
    targetStudents.forEach(student => { student.color_dot = previousById.get(student.id); });
    console.error('[renderer] failed to clear color dots:', error);
    alert('Could not clear color dots. Please try again.');
    renderWorkspace();
  }
}

function setupDropZone(element, onDrop) {
  element.addEventListener('dragover', event => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    element.classList.add('drag-over');
  });

  element.addEventListener('dragleave', event => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove('drag-over');
    }
  });

  element.addEventListener('drop', event => {
    event.preventDefault();
    element.classList.remove('drag-over');
    const studentId = event.dataTransfer.getData('text/plain');
    if (!studentId) {
      return;
    }
    Promise.resolve(onDrop(studentId, event)).catch(error => {
      console.error('[renderer] drop handler failed:', error);
    });
  });
}

async function handleChartDrop(studentId, event) {
  const cardWidth = window.innerWidth <= 720 ? 138 : 148;
  const cardHeight = lsaMode ? 118 : 96;
  const topPadding = 8;
  const bottomReserved = 24;
  // offsetWidth/offsetHeight are the canvas's logical CSS dimensions, unaffected by CSS transform
  const intrinsicW = CANVAS_W;
  const intrinsicH = CANVAS_H;
  const maxX = Math.max(0, intrinsicW - cardWidth - 8);
  const maxY = Math.max(topPadding, intrinsicH - cardHeight - bottomReserved);
  const pickupOffsetX = dragPickupOffset?.x ?? cardWidth / 2;
  const pickupOffsetY = dragPickupOffset?.y ?? cardHeight / 2;

  // Convert screen position to canvas-local coordinates.
  // Canvas layout origin is shell origin; transform is translate(panX,panY) scale(zoom).
  // Inverse: canvasLocal = (shellRelative - pan) / zoom
  const shellBounds = chartShell.getBoundingClientRect();
  const x = clamp((event.clientX - shellBounds.left - chartPanX) / chartZoom - pickupOffsetX, 8, maxX);
  const y = clamp((event.clientY - shellBounds.top  - chartPanY) / chartZoom - pickupOffsetY, topPadding, maxY);

  const layout = getStudentLayout(studentId);
  layout.placed = true;
  layout.x = x;
  layout.y = y;
  selectedStudentId = studentId;
  dragPickupOffset = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function handleRosterDrop(studentId) {
  const layout = getStudentLayout(studentId);
  layout.placed = false;
  selectedStudentId = studentId;
  dragPickupOffset = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function clearChart() {
  const placedCount = students.filter(student => getStudentLayout(student.id).placed).length;
  if (placedCount === 0) {
    alert('There are no placed students to clear.');
    return;
  }

  const confirmed = window.confirm(
    `Clear chart for ${placedCount} placed ${placedCount === 1 ? 'student' : 'students'}?\n\nYou can use Undo Clear immediately after.`
  );
  if (!confirmed) {
    return;
  }

  lastClearedChartSnapshot = getCurrentChartSnapshot().map(item => ({ ...item }));

  layoutState.forEach(layout => {
    layout.placed = false;
  });

  selectedStudentId = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function undoClearChart() {
  if (!lastClearedChartSnapshot) {
    alert('Nothing to undo yet.');
    return;
  }

  const hasCurrentPlacedStudents = students.some(student => getStudentLayout(student.id).placed);
  if (hasCurrentPlacedStudents) {
    const overwriteConfirmed = window.confirm('Undo Clear will replace current seating positions. Continue?');
    if (!overwriteConfirmed) {
      return;
    }
  }

  applySeatingChartItems(lastClearedChartSnapshot.map(item => ({ ...item })));
  lastClearedChartSnapshot = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

// Returns `count` parametric angles evenly spaced by arc length around an ellipse,
// starting at startAngle and proceeding clockwise.
function evenArcAngles(rx, ry, count, startAngle) {
  const N = Math.max(count * 80, 720);
  const dTheta = (2 * Math.PI) / N;
  const cumArc = [0];
  for (let i = 0; i < N; i++) {
    const a = startAngle - (i + 0.5) * dTheta; // clockwise midpoint
    const ds = Math.sqrt(
      Math.pow(rx * Math.sin(a), 2) + Math.pow(ry * Math.cos(a), 2)
    ) * dTheta;
    cumArc.push(cumArc[i] + ds);
  }
  const total = cumArc[N];
  const interval = total / count;
  const result = [];
  let si = 0;
  for (let k = 0; k < count; k++) {
    const target = k * interval;
    while (si < N - 1 && cumArc[si + 1] < target) si++;
    const frac = cumArc[si + 1] > cumArc[si]
      ? (target - cumArc[si]) / (cumArc[si + 1] - cumArc[si])
      : 0;
    result.push(startAngle - (si + frac) * dTheta);
  }
  return result;
}

// Returns `count` parametric angles around an ellipse with spacing weighted so that
// adjacent cards never overlap regardless of where on the oval they sit.
//
// Key insight: the cumulative weight w(a) controls how many angle steps are
// consumed per unit of "budget".  Large w → fast accumulation → small angular
// gap.  Small w → slow accumulation → large angular gap.
//
// We want the physical arc length between adjacent centers to equal the card's
// projected footprint along the tangent at that angle, so:
//   dTheta_gap ∝ footprint_pixels / |T|   →   w ∝ |T| / footprint_pixels
//                                              = |T|² / (cardW·rx·|sin a| + cardH·ry·|cos a|)
//
// This naturally gives:
//   • Most spacing at the 45° diagonals (card corners project farthest)
//   • More spacing at N/S than E/W (wide cards need horizontal room)
//   • Least spacing at E/W (tall-ish edge faces the tangent)
function widthAwareCircleAngles(rx, ry, count, startAngle, cardW, cardH, spanAngle = 2 * Math.PI) {
  const N = Math.max(count * 120, 1080);
  const dTheta = spanAngle / N;
  const cumWeighted = [0];

  for (let i = 0; i < N; i++) {
    const a = startAngle - (i + 0.5) * dTheta; // clockwise midpoint
    const tanX = rx * Math.abs(Math.sin(a));
    const tanY = ry * Math.abs(Math.cos(a));
    const T2 = tanX * tanX + tanY * tanY;
    const footprintScale = cardW * tanX + cardH * tanY; // proportional to pixel footprint × |T|
    // Add a floor proportional to cardH·|T| so east/west (where tanY→0) still
    // reserves enough horizontal separation to prevent the two adjacent cards from touching.
    // Additive gap: ensures exactly GAP_PX pixels of edge space between adjacent cards
    // at every position on the oval, regardless of mode or card aspect ratio.
    // Extra N/S bias: at north/south tanY≈|T|, so this term adds ~cardH*extra_gap worth
    // of additional arc breathing room where cards are tallest-facing, without widening E/W.
    const nsGap = cardH * (tanY / Math.max(Math.sqrt(T2), 0.001));
    const w = T2 / Math.max(footprintScale + 8 * Math.sqrt(T2) + 10 * nsGap, 0.001);
    cumWeighted.push(cumWeighted[i] + w * dTheta);
  }

  const total = cumWeighted[N];
  // count-1 intervals: first student at span start, last student at span end.
  const interval = count > 1 ? total / (count - 1) : 0;
  const result = [];
  let si = 0;
  for (let k = 0; k < count; k++) {
    const target = k * interval;
    while (si < N - 1 && cumWeighted[si + 1] < target) si++;
    const frac = cumWeighted[si + 1] > cumWeighted[si]
      ? (target - cumWeighted[si]) / (cumWeighted[si + 1] - cumWeighted[si])
      : 0;
    result.push(startAngle - (si + frac) * dTheta);
  }
  return result;
}

// Shared geometry engine for Arrange Circle and Neaten Circle.
// Computes card sizing, sets canvas data attributes and CSS variables,
// sets teacherCirclePos, and returns the ordered target slot positions
// [{x, y}, ...] for studentList[0..N-1] (clockwise, starting just left of south).
function computeCircleSlots(studentList, canvasW, canvasH) {
  const BASE_W       = 148;
  const count        = studentList.length;
  const compact      = count >= 16;
  const superCompact = count >= 23;
  const southAngle   = (270 * Math.PI) / 180;

  // Mode-specific minimum card widths.
  // Attendance and LSA need extra room for their button/grid content.
  const minW = (attendanceMode || lsaMode) ? 92 : 68;

  // Progressive width reduction: factor 14 keeps full width at ≤14 students,
  // then narrows proportionally so the oval perimeter can hold more cards.
  const rawW = compact
    ? Math.max(minW, Math.min(BASE_W, Math.floor(BASE_W * 17 / count)))
    : BASE_W;

  const scaleFactor = superCompact ? Math.max(0.82, Math.min(0.97, 22 / count)) : 1.0;
  const circleCardW = Math.round(rawW * scaleFactor);

  // --circle-card-h is used only as min-height for regular (non-attendance, non-LSA)
  // cards to keep them from looking square when the width shrinks.
  // Attendance (~82 px) and LSA (~72 px) are naturally taller, so they don't need it.
  const regularMinH = Math.round(Math.max(46, rawW * 0.56) * scaleFactor);

  // Accurate estimated rendered heights per mode at compact padding/font.
  // Used for oval sizing and angular spacing — decoupled from the CSS min-height.
  const spacingCardH = lsaMode ? 72 : (attendanceMode ? 82 : regularMinH);

  const ovalFactor = compact ? 0.44 : 0.36;

  // --- Canvas state ---
  chartCanvas.dataset.compactCircle      = compact      ? 'true' : '';
  chartCanvas.dataset.superCompactCircle = superCompact ? 'true' : '';
  chartCanvas.dataset.circle             = 'true';
  if (compact) {
    chartCanvas.style.setProperty('--circle-card-w', `${circleCardW}px`);
    chartCanvas.style.setProperty('--circle-card-h', `${regularMinH}px`);
  } else {
    chartCanvas.style.removeProperty('--circle-card-w');
    chartCanvas.style.removeProperty('--circle-card-h');
  }
  chartCanvas.style.removeProperty('--circle-card-scale');

  // --- Oval: as large as the canvas allows ---
  const cx = canvasW / 2;
  const cy = canvasH / 2;
  const rx = Math.min(canvasW * ovalFactor, (canvasW - circleCardW) / 2 - 20);
  const ry = Math.min(canvasH * ovalFactor, (canvasH - spacingCardH) / 2 - 20);

  // --- Teacher card pinned at cardinal south ---
  teacherCirclePos = {
    x: cx + rx * Math.cos(southAngle) - TEACHER_CARD_W / 2,
    y: cy - ry * Math.sin(southAngle) - TEACHER_CARD_H / 2,
  };

  // Reserve arc flanking south for teacher + nearest student.
  const teacherHalfGap = (TEACHER_CARD_W / 2 + circleCardW / 2 + 10) / Math.max(rx, 1);
  const studentSpan    = 2 * Math.PI - 2 * teacherHalfGap;
  const studentStart   = southAngle - teacherHalfGap;
  const angles         = widthAwareCircleAngles(rx, ry, count, studentStart, circleCardW, spacingCardH, studentSpan);

  return angles.map(angle => ({
    x: cx + rx * Math.cos(angle) - circleCardW / 2,
    y: cy - ry * Math.sin(angle) - spacingCardH / 2,
  }));
}

async function autoArrangeChart(mode) {
  const scopedStudents = getStudentsInActiveScope().filter(student => usingSampleRoster || !student.isSample);
  if (scopedStudents.length === 0) {
    alert('No students found in the active class roster.');
    return;
  }

  const arrangedStudents = [...scopedStudents].sort((a, b) => {
    const lastCompare = String(a.last_name || '').localeCompare(String(b.last_name || ''));
    if (lastCompare !== 0) return lastCompare;
    return String(a.first_name || '').localeCompare(String(b.first_name || ''));
  });

  const canvasW = CANVAS_W;
  const canvasH = CANVAS_H;
  const cardW = 148;
  const cardH = lsaMode ? 118 : (mode === 'circle' ? 90 : 96);

  if (mode === 'rows') {
    chartCanvas.dataset.compactCircle = '';
    chartCanvas.dataset.superCompactCircle = '';
    chartCanvas.dataset.circle = '';
    chartCanvas.style.removeProperty('--circle-card-w');
    chartCanvas.style.removeProperty('--circle-card-h');
    chartCanvas.style.removeProperty('--circle-card-scale');
    teacherCirclePos = null;
    const colGapX = 16;
    const rowGapY = lsaMode ? 18 : 14;
    const cols = 6;
    const totalGridWidth = cols * cardW + (cols - 1) * colGapX;
    const startX = Math.max(8, (canvasW - totalGridWidth) / 2);

    // Center grid vertically; in LSA mode push it down to leave room above for the prompt card
    // (prompt card: ~22px padding + ~19px title + up to 320px image = ~361px max; 180px reserves a
    //  comfortable default-sized image slot above the top row — user can drag/resize for full expansion)
    const numRows = Math.ceil(arrangedStudents.length / cols);
    const gridH = numRows * cardH + Math.max(0, numRows - 1) * rowGapY;
    const lsaTopReserve = lsaMode ? 180 : 0;
    let topOfGrid = lsaTopReserve + Math.max(0, (canvasH - lsaTopReserve - gridH) / 2);
    topOfGrid = Math.max(lsaTopReserve + 8, Math.min(topOfGrid, canvasH - gridH - 8));

    arrangedStudents.forEach((student, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);  // row 0 = bottom-most
      const layout = getStudentLayout(student.id);
      layout.placed = true;
      layout.x = startX + col * (cardW + colGapX);
      layout.y = topOfGrid + (numRows - 1 - row) * (cardH + rowGapY);
    });

  } else {
    // Clockwise oval with teacher at cardinal south; first student starts just left of south.
    const slots = computeCircleSlots(arrangedStudents, canvasW, canvasH);
    arrangedStudents.forEach((student, i) => {
      const layout = getStudentLayout(student.id);
      layout.placed = true;
      layout.x = slots[i].x;
      layout.y = slots[i].y;
    });
  }

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function neathenRows() {
  const placedStudents = students.filter(student => getStudentLayout(student.id).placed);
  if (placedStudents.length === 0) return;

  chartCanvas.dataset.compactCircle = '';
  chartCanvas.dataset.superCompactCircle = '';
  chartCanvas.dataset.circle = '';
  chartCanvas.style.removeProperty('--circle-card-w');
  chartCanvas.style.removeProperty('--circle-card-h');
  chartCanvas.style.removeProperty('--circle-card-scale');
  teacherCirclePos = null;

  const canvasW = CANVAS_W;
  const canvasH = CANVAS_H;
  const cardW = 148;
  const cardH = lsaMode ? 118 : 96;
  const colGapX = 16;
  const rowGapY = lsaMode ? 18 : 14;
  const cols = 6;
  const totalGridWidth = cols * cardW + (cols - 1) * colGapX;
  const startX = Math.max(8, (canvasW - totalGridWidth) / 2);

  // Use same centered grid logic as autoArrangeChart rows mode
  const slotCount = Math.max(30, placedStudents.length);
  const numRows = Math.ceil(slotCount / cols);
  const gridH = numRows * cardH + Math.max(0, numRows - 1) * rowGapY;
  const lsaTopReserve = lsaMode ? 180 : 0;
  let topOfGrid = lsaTopReserve + Math.max(0, (canvasH - lsaTopReserve - gridH) / 2);
  topOfGrid = Math.max(lsaTopReserve + 8, Math.min(topOfGrid, canvasH - gridH - 8));

  const slots = [];
  for (let index = 0; index < slotCount; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    slots.push({
      x: startX + col * (cardW + colGapX),
      y: topOfGrid + (numRows - 1 - row) * (cardH + rowGapY),
    });
  }

  // Assign each placed student to the nearest available slot.
  const pairs = [];
  placedStudents.forEach((student, studentIndex) => {
    const layout = getStudentLayout(student.id);
    slots.forEach((slot, slotIndex) => {
      const dx = layout.x - slot.x;
      const dy = layout.y - slot.y;
      pairs.push({
        studentIndex,
        slotIndex,
        dist2: dx * dx + dy * dy,
      });
    });
  });

  pairs.sort((a, b) => a.dist2 - b.dist2);

  const usedStudents = new Set();
  const usedSlots = new Set();
  pairs.forEach(pair => {
    if (usedStudents.has(pair.studentIndex) || usedSlots.has(pair.slotIndex)) {
      return;
    }
    usedStudents.add(pair.studentIndex);
    usedSlots.add(pair.slotIndex);
    const student = placedStudents[pair.studentIndex];
    const slot = slots[pair.slotIndex];
    const layout = getStudentLayout(student.id);
    layout.x = slot.x;
    layout.y = slot.y;
  });

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function neathenCircle() {
  const placedStudents = students.filter(student => getStudentLayout(student.id).placed);
  if (placedStudents.length === 0) return;

  const canvasW = CANVAS_W;
  const canvasH = CANVAS_H;

  const slots = computeCircleSlots(placedStudents, canvasW, canvasH);

  // Assign each placed student to the nearest available slot (greedy nearest-neighbour).
  const pairs = [];
  placedStudents.forEach((student, si) => {
    const layout = getStudentLayout(student.id);
    slots.forEach((slot, sloti) => {
      const dx = layout.x - slot.x;
      const dy = layout.y - slot.y;
      pairs.push({ si, sloti, dist2: dx * dx + dy * dy });
    });
  });
  pairs.sort((a, b) => a.dist2 - b.dist2);

  const usedStudents = new Set();
  const usedSlots    = new Set();
  pairs.forEach(({ si, sloti }) => {
    if (usedStudents.has(si) || usedSlots.has(sloti)) return;
    usedStudents.add(si);
    usedSlots.add(sloti);
    const layout = getStudentLayout(placedStudents[si].id);
    layout.x = slots[sloti].x;
    layout.y = slots[sloti].y;
  });

  renderWorkspace();
  await persistActiveSeatingChart();
}

function openStudentModal(id) {
  if (usingSampleRoster) {
    students = [];
    usingSampleRoster = false;
    layoutState.clear();
  }

  const student = id !== null ? students.find(entry => entry.id === id) : null;
  document.getElementById('student-modal-title').textContent = student ? 'Edit Student' : 'Add Student';
  document.getElementById('student-modal-submit').textContent = student ? 'Update' : 'Save';
  document.getElementById('student-id').value = student ? student.id : '';
  document.getElementById('student-first-name').value = student ? student.first_name : '';
  document.getElementById('student-last-name').value = student ? student.last_name : '';
  document.getElementById('student-email').value = student ? student.email || '' : '';
  document.getElementById('student-number').value = student ? student.student_number || '' : '';
  document.getElementById('student-grade').value = student ? student.grade || '' : '';
  document.getElementById('student-teacher').value = student ? student.teacher || '' : '';
  document.getElementById('student-notes').value = student ? student.notes || '' : '';
  document.getElementById('student-is-active').checked = student ? (student.is_active !== 0) : true;
  studentModal.classList.remove('hidden');

  // Ensure keyboard focus lands in the form immediately after opening.
  requestAnimationFrame(() => {
    const firstNameInput = document.getElementById('student-first-name');
    firstNameInput.focus();
    firstNameInput.select();
  });
}

function closeStudentModal() {
  studentModal.classList.add('hidden');
}

function getStudentLayout(studentId) {
  return layoutState.get(String(studentId));
}

function getDisplayName(student) {
  return `${student.first_name} ${student.last_name}`.trim();
}

function getStudentSearchText(student) {
  return `${student.first_name} ${student.last_name} ${student.email || ''} ${student.grade || ''} ${student.teacher || ''}`.toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Capture the maximized shell dimensions as the permanent canvas size.
// The app opens maximized, so this measurement reflects the true full-screen
// shell size for this device. The canvas is then fixed at that size forever.
(function initCanvasSize() {
  const w = chartShell.offsetWidth;
  const h = chartShell.offsetHeight;
  if (w > 100 && h > 100) {
    CANVAS_W = w;
    CANVAS_H = h;
  }
  chartCanvas.style.width  = `${CANVAS_W}px`;
  chartCanvas.style.height = `${CANVAS_H}px`;
})();

initializeWorkspace();
});
