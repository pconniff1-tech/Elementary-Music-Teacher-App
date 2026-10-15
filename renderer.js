/**
 * @file renderer.js
 * @process Renderer — Browser Renderer Process (sandboxed, no direct Node.js access)
 *
 * This file runs entirely inside the Chromium renderer process. It has NO access to
 * Node.js, the file system, or Electron APIs. All communication with the main process
 * happens exclusively through `window.api`, which is the narrow bridge exposed by
 * preload.js via contextBridge.
 *
 * Every `window.api.*` call below is an async IPC invoke (Renderer → Main → response).
 * One-way push notifications from Main arrive via `window.api.onUpdateStatus`.
 *
 * IPC Direction convention:
 *   SEND →  (window.api call — Renderer sends to Main, awaits Promise result)
 *   LISTEN ← (callback registered via window.api.onUpdateStatus — Main pushes unsolicited)
 */

// Display-scale compensation (Windows 125%/150%/etc.) is handled by Main via
// webContents.setZoomFactor — Chromium's native page-zoom is the only
// mechanism that keeps vh/dvh-based layout consistent with the rest of the
// page. Main pushes 'display-scale-changed' after re-applying it; see the
// listener wired near initCanvasSize() below, which re-measures the canvas
// once the new zoom has painted.

const fallbackStudents = [
  {
    id: 'sample-1',
    first_name: 'Mia',
    last_name: 'R.',
    grade: '3rd',
    teacher: 'Ms. Rivera',
    notes: '',
    recorder_color: null,
    isSample: true,
  },
  {
    id: 'sample-2',
    first_name: 'Leo',
    last_name: 'T.',
    grade: '4th',
    teacher: 'Mr. Jones',
    notes: '',
    recorder_color: null,
    isSample: true,
  },
  {
    id: 'sample-3',
    first_name: 'Ava',
    last_name: 'K.',
    grade: '5th',
    teacher: 'Mrs. Chen',
    notes: '',
    recorder_color: null,
    isSample: true,
  },
  {
    id: 'sample-4',
    first_name: 'Noah',
    last_name: 'P.',
    grade: '4th',
    teacher: 'Ms. Patel',
    notes: '',
    recorder_color: null,
    isSample: true,
  },
  {
    id: 'sample-5',
    first_name: 'Ella',
    last_name: 'G.',
    grade: '3rd',
    teacher: 'Mr. Carter',
    notes: '',
    recorder_color: null,
    isSample: true,
  },
];

const recorderColorOptions = [
  'Red',
  'Blue',
  'Yellow',
  'Orange',
  'Fuschia',
  'Green',
  'Black',
  'Purple',
];

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

// Recorder Song Tracker — named pale-color palette (shared by the Recorder Set
// Up modal's color picker and the Recorders grid's song column styling).
const RECORDER_SONG_COLOR_PALETTE = {
  white: '#ffffff',
  yellow: '#fbf6d3',
  orange: '#fce8d2',
  green: '#def4df',
  purple: '#ece2f8',
  blue: '#dee9fa',
  red: '#f8dddd',
  pink: '#fbdcec',
  brown: '#e9ddd0',
  black: '#e5e5e5',
};
const RECORDER_SONG_COLOR_KEYS = Object.keys(RECORDER_SONG_COLOR_PALETTE);

let recorderSongLibrary = []; // [{ academic_year, slot_num, name, color_key, updated_at }]
const recorderSongCompletionsCache = new Map(); // key `${studentId}:${slotNum}` -> boolean
let recorderSetupDraftRows = []; // working copy edited inside the Recorder Set Up modal

let students = [];
let usingSampleRoster = false;
let selectedStudentId = null;
// Multi-select support: set of selected student ids (strings)
let selectedStudentIds = new Set();
// Last clicked index (for Shift-range selection)
let lastSelectedIndex = null;
// Group drag state
let suppressNativeDrag = false;
let groupDragging = false;
let groupDragState = null; // { pointerId, startCanvasX, startCanvasY, items: { id: { initialX, initialY, el, prevZ } } }
let potentialGroupDrag = null;
const GROUP_DRAG_START_THRESHOLD = 6; // pixels
let activeFilter = 'all';
let activeGradebookTab = 'attendance';
let currentAcademicYear = null;
let attendanceMode = false;
let lsaMode = false;
let assessmentMode = false;
let activeAssessmentNumber = 1;
let activeLsaUnit = 1;
let editMode = false;
let manageStudentsVisible = false;
let manageChartToolsVisible = false;
let manageUnitsVisible = false;
let lsaAptitudeView = 'tonal';
let colorDotsHidden = false;
let activeClassTeacher = null;
let seatingCharts = [];
let activeSeatingChartId = null;
let seatingChartsCollapsed = true;
// When true the seating chart list enters drag-reorder mode: pills become
// draggable, select/rename/delete listeners are suspended, a Done button
// appears, and the reorder icon is hidden until Done is clicked.
let seatingChartsReorderMode = false;
let classesCollapsed = true;
// Class list drag-reorder mode and the saved order (array of class keys).
let classesReorderMode = false;
let savedClassOrder = [];
let chartSwitchRenderTimer = null;
// Unified in-memory snapshot for the most-recent chart-altering action
// Shape: { type: 'clear'|'arrange-rows'|'arrange-circle', items: Array }
let lastActionSnapshot = null;
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
const lsaUnitPromptImages = new Map();
const lsaUnitHelperLabels = new Map();
const lsaUnitPromptSizes = new Map();
const lsaUnitLessonFileNames = new Map();
let lessonLibraryTab = 'library';
let lessonLibraryLessons = [];
let lessonLibrarySelectedGrade = '';
let lessonLibraryPickUnit = null; // unit number being replaced, or null for browse mode
let csvParsedRows = []; // all rows including header at [0]
let csvMapping = {}; // { first_name: 3, last_name: 1, ... } (-1 = skip)
let csvImporting = false;
let settingsMenuOpen = false;
let darkBgMode = localStorage.getItem('darkBgMode') === 'true';

const layoutState = new Map();

const studentSearchInput = document.getElementById('student-search');
const rosterList = document.getElementById('roster-list');
const chartCanvas = document.getElementById('chart-canvas');
const chartShell = chartCanvas.closest('.chart-shell') || chartCanvas.parentElement;
// Fixed canvas dimensions captured from the maximized shell at startup.
// All layout calculations use these constants so the canvas size never
// changes when the window is resized — a smaller window just shows a
// viewport into the same fixed canvas space.
let CANVAS_W = 1100;
let CANVAS_H = 720;
const multiGradeGearBtn = document.getElementById('multi-grade-gear-btn');
const multiGradeCloseBtn = document.getElementById('multi-grade-close-btn');
const multiGradeDoneBtn = document.getElementById('multi-grade-done-btn');
const multiGradeModal = document.getElementById('multi-grade-modal');
const multiGradeList = document.getElementById('multi-grade-list');
const aptitudeSettingsModal = document.getElementById('aptitude-settings-modal');
const aptitudeSettingsCloseBtn = document.getElementById('aptitude-settings-close-btn');
const openAptitudeSettingsBtn = document.getElementById('open-aptitude-settings-btn');
const aptitudeSettingsSaveBtn = document.getElementById('aptitude-settings-save-btn');
const aptitudeSettingsCancelBtn = document.getElementById('aptitude-settings-cancel-btn');
const aptitudeSettingsError = document.getElementById('aptitude-settings-error');
const aptitudeViewToggle = document.getElementById('aptitude-view-toggle');
const aptitudeToggleBtn = document.getElementById('aptitude-toggle-btn');

const recorderSetupModal = document.getElementById('recorder-setup-modal');
const recorderSetupCloseBtn = document.getElementById('recorder-setup-close-btn');
const openRecorderSetupBtn = document.getElementById('open-recorder-setup-btn');
const recorderSetupSaveBtn = document.getElementById('recorder-setup-save-btn');
const recorderSetupCancelBtn = document.getElementById('recorder-setup-cancel-btn');
const recorderSetupAddBtn = document.getElementById('recorder-setup-add-btn');
const recorderSetupRowsBody = document.getElementById('recorder-setup-rows');
const recorderSetupError = document.getElementById('recorder-setup-error');

const assessLibGradeSelect = document.getElementById('assess-lib-grade-select');
const assessLibContent = document.getElementById('assess-lib-content');
const assessmentsList = document.getElementById('assessments-list');
const ratingDirectionLabel = document.getElementById('rating-direction-label');
const assessLibDirectionLabel = document.getElementById('assess-lib-direction-label');

const lsaUnitAudioPaths = new Map();

let _penNoteStudentId = null;
let _penNoteUnit = null;
let _penNoteActivity = null;
let _penNoteDrawing = false;
const penNotePopup = document.getElementById('pen-note-popup');
const penNoteCanvas = document.getElementById('pen-note-canvas');
const penNoteClearBtn = document.getElementById('pen-note-clear-btn');
const penNoteDoneBtn = document.getElementById('pen-note-done-btn');
const penNoteCancelBtn = document.getElementById('pen-note-cancel-btn');

const exportSelectedModal = document.getElementById('export-selected-modal');
const exportRubricsBtn = document.getElementById('export-rubrics-btn');
const importRubricsBtn = document.getElementById('import-rubrics-btn');

const checkForUpdatesBtn = document.getElementById('check-for-updates-btn');
const updateStatusLine = document.getElementById('update-status-line');
const updateProgressWrap = document.getElementById('update-progress-wrap');
const updateProgressBar = document.getElementById('update-progress-bar');
const updateConfirmRow = document.getElementById('update-confirm-row');
const updateConfirmText = document.getElementById('update-confirm-text');
const updateConfirmDownloadBtn = document.getElementById('update-confirm-download-btn');
const updateConfirmSkipBtn = document.getElementById('update-confirm-skip-btn');
const openAboutBtn = document.getElementById('open-about-btn');
const aboutModal = document.getElementById('about-modal');
const aboutModalCloseX = document.getElementById('about-modal-close-x');
const aboutModalClose = document.getElementById('about-modal-close');
const aboutAppName = document.getElementById('about-app-name');
const aboutAppVersion = document.getElementById('about-app-version');
const aboutAppArch = document.getElementById('about-app-arch');

const fontSwitcher = document.getElementById('font-switcher');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const darkBgToggleBtn = document.getElementById('dark-bg-toggle-btn');
// Apply persisted dark background state on load
if (darkBgMode) chartShell.classList.add('dark-bg');

const assessmentLibraryDb = new Map();
const assessmentCardSizes = new Map();
const assessmentPlaceholderPositions = new Map();
const aptitudeSettingsDb = new Map();
const immaScoreCache = new Map();
const APTITUDE_GRADES = [1, 2, 3, 4, 5];
const ASSESSMENT_LABELS = {
  1: 'Tonal 1',
  2: 'Tonal 2',
  3: 'Tonal 3',
  4: 'Tonal 4',
  5: 'Rhythm 1',
  6: 'Rhythm 2',
  7: 'Rhythm 3',
  8: 'Rhythm 4',
  9: 'Movement 1',
  10: 'Movement 2',
  11: 'Movement 3',
  12: 'Movement 4',
  13: 'Instrument 1',
  14: 'Instrument 2',
  15: 'Instrument 3',
  16: 'Instrument 4',
};

function normalizeAptitudeGrade(grade) {
  const value = String(grade ?? '').trim();
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5 ? parsed : null;
}

function normalizeAptitudeScore(score) {
  if (score === null || score === undefined || score === '') return null;
  const parsed = Number(score);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function getAptitudeSettingsForGrade(grade) {
  const normalizedGrade = normalizeAptitudeGrade(grade);
  if (!normalizedGrade) return null;
  return aptitudeSettingsDb.get(normalizedGrade) || null;
}

function getAptitudeCategory(grade, score, type) {
  const normalizedGrade = normalizeAptitudeGrade(grade);
  const normalizedScore = normalizeAptitudeScore(score);
  if (!normalizedGrade || normalizedScore === null) return null;
  const settings = getAptitudeSettingsForGrade(normalizedGrade);
  if (!settings) return null;
  const lowRaw = settings[`${type}_low_max`];
  const medRaw = settings[`${type}_med_max`];
  if (
    lowRaw === null ||
    lowRaw === undefined ||
    lowRaw === '' ||
    medRaw === null ||
    medRaw === undefined ||
    medRaw === ''
  ) {
    return null;
  }
  const lowMax = Number(lowRaw);
  const medMax = Number(medRaw);
  if (!Number.isFinite(lowMax) || !Number.isFinite(medMax)) return null;
  if (normalizedScore <= lowMax) return 'low';
  if (normalizedScore <= medMax) return 'medium';
  return 'high';
}

function getAptitudeClassName(grade, score, type, scope) {
  const category = getAptitudeCategory(grade, score, type);
  return category ? `aptitude-${scope}-${category}` : '';
}

function getImmaScoreEntry(studentId, academicYear) {
  return immaScoreCache.get(String(studentId))?.get(academicYear) || null;
}

function getImmaAvailableYears(scopedStudents, currentYear) {
  const years = new Set([currentYear]);

  for (const student of scopedStudents) {
    const yearMap = immaScoreCache.get(String(student.id));
    if (!yearMap) continue;
    for (const year of yearMap.keys()) {
      if (year) years.add(year);
    }
  }

  return Array.from(years)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, 5);
}

function setImmaHistoryVisible(nextVisible) {
  immaHistoryVisible = !!nextVisible;
  try {
    localStorage.setItem('immaHistoryVisible', immaHistoryVisible ? 'true' : 'false');
  } catch (error) {
    console.warn('[imma-history] failed to persist toggle state:', error);
  }
}

function getCachedImmaScore(studentId, academicYear) {
  const studentKey = String(studentId);
  const yearMap = immaScoreCache.get(studentKey);
  if (!yearMap) return null;
  const targetYear = academicYear || currentAcademicYear || getDefaultAcademicYear();
  return yearMap.get(targetYear) || null;
}

async function loadAptitudeSettings() {
  if (!window.api.getAptitudeSettings) return;
  try {
    const rows = await window.api.getAptitudeSettings();
    aptitudeSettingsDb.clear();
    for (const row of rows || []) {
      const gradeLevel = Number(row.grade_level);
      if (!Number.isInteger(gradeLevel) || gradeLevel < 1 || gradeLevel > 5) continue;
      aptitudeSettingsDb.set(gradeLevel, row);
    }
  } catch (error) {
    console.error('[aptitude] failed to load settings:', error);
  }
}

async function refreshImmaScoreCache() {
  if (!window.api.getImmaScoresForClass) return;
  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  const studentIds = scopedStudents.map((student) => student.id);
  if (studentIds.length === 0) {
    immaScoreCache.clear();
    return;
  }

  try {
    const rows = await window.api.getImmaScoresForClass(studentIds);
    immaScoreCache.clear();
    for (const row of rows || []) {
      const studentKey = String(row.student_id);
      if (!immaScoreCache.has(studentKey)) {
        immaScoreCache.set(studentKey, new Map());
      }
      immaScoreCache.get(studentKey).set(row.academic_year, {
        tonal: row.tonal,
        rhythm: row.rhythm,
        updated_at: row.updated_at,
      });
    }
  } catch (error) {
    console.error('[imma-cache] failed to load scores:', error);
  }
}

function syncAptitudeToggleVisibility() {
  if (!aptitudeViewToggle || !aptitudeToggleBtn) return;
  aptitudeViewToggle.classList.toggle('hidden', !lsaMode);
  aptitudeToggleBtn.textContent = `View: ${lsaAptitudeView === 'rhythm' ? 'Rhythm' : 'Tonal'} Aptitude`;
}

// Returns the default (category + number) label for any assess_num.
// Base nums 1-16 use ASSESSMENT_LABELS. Extra nums use 100+ offsets per category.
function getAssessDefaultLabel(num) {
  if (ASSESSMENT_LABELS[num]) return ASSESSMENT_LABELS[num];
  if (num >= 101 && num <= 199) return `Tonal ${num - 96}`;
  if (num >= 201 && num <= 299) return `Rhythm ${num - 196}`;
  if (num >= 301 && num <= 399) return `Movement ${num - 296}`;
  if (num >= 401 && num <= 499) return `Instrument ${num - 396}`;
  return `Assessment ${num}`;
}

// Returns all assess_nums (base + extras) for a given category, sorted ascending.
function getAssessNumsForCategory(category, gradeMap) {
  const baseRanges = {
    tonal: [1, 2, 3, 4],
    rhythm: [5, 6, 7, 8],
    movement: [9, 10, 11, 12],
    instrument: [13, 14, 15, 16],
  };
  const extraOffsets = { tonal: 100, rhythm: 200, movement: 300, instrument: 400 };
  const base = baseRanges[category] || [];
  const lo = (extraOffsets[category] || 0) + 1;
  const hi = (extraOffsets[category] || 0) + 99;
  const extras = gradeMap
    ? Array.from(gradeMap.keys())
        .filter((n) => n >= lo && n <= hi)
        .sort((a, b) => a - b)
    : [];
  return [...base, ...extras];
}

// Returns the next available extra assess_num for a category.
function getNextExtraAssessNum(category, gradeMap) {
  const offsets = { tonal: 100, rhythm: 200, movement: 300, instrument: 400 };
  const base = offsets[category] || 100;
  let n = base + 1;
  while (gradeMap && gradeMap.has(n)) n++;
  return n;
}

function getAssessmentLabelParts(num) {
  const base = getAssessDefaultLabel(num);
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  const entry = gradeMap.get(num) || {};
  const subtitle = entry.name || null;
  return { base, subtitle };
}

// Rubberband selection: overlay + pointer handlers
let rubberbandEl = null;
let rubberbandActive = false;
let rubberbandStartShell = null;
let rubberbandStartCanvas = null;
let rubberbandPriorSelection = null;
let rubberbandTempSelection = null;
let potentialRubber = null;
const RUBBER_START_THRESHOLD = 6; // px before rubberband actually begins

function ensureRubberbandEl() {
  if (rubberbandEl) return;
  rubberbandEl = document.createElement('div');
  rubberbandEl.className = 'rubberband';
  Object.assign(rubberbandEl.style, {
    position: 'absolute',
    pointerEvents: 'none',
    border: '1px dashed rgba(0,0,0,0.6)',
    background: 'rgba(50,100,200,0.06)',
    display: 'none',
    zIndex: '9999',
  });
  chartShell.appendChild(rubberbandEl);
}

function setRubberbandShellRect(left, top, width, height) {
  ensureRubberbandEl();
  rubberbandEl.style.display = width > 0 && height > 0 ? 'block' : 'none';
  rubberbandEl.style.left = `${left}px`;
  rubberbandEl.style.top = `${top}px`;
  rubberbandEl.style.width = `${width}px`;
  rubberbandEl.style.height = `${height}px`;
}

function clearRubberband() {
  if (rubberbandEl) rubberbandEl.style.display = 'none';
  rubberbandActive = false;
  rubberbandStartShell = null;
  rubberbandStartCanvas = null;
  rubberbandPriorSelection = null;
  rubberbandTempSelection = null;
  potentialRubber = null;
}

function applySelectionSetToDOM(selSet) {
  selectedStudentIds = new Set(selSet || []);
  // Update card classes without full re-render
  chartCanvas.querySelectorAll('.chart-student').forEach((card) => {
    const id = String(card.dataset.studentId);
    card.classList.toggle('selected', selectedStudentIds.has(id));
  });
  renderSelectionDetails();
}

function onRubberPointerDown(e) {
  try {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Don't start rubberband when clicking on a card or UI control inside chart
    if (e.target && e.target.closest && e.target.closest('.chart-student')) return;
    if (e.target && e.target.closest && e.target.closest('button, input, select, textarea, a'))
      return;

    // Defer activating the rubberband until the pointer moves past a small threshold.
    const shellRect = chartShell.getBoundingClientRect();
    const shellX = e.clientX - shellRect.left;
    const shellY = e.clientY - shellRect.top;
    const canvasX = (e.clientX - shellRect.left - chartPanX) / chartZoom;
    const canvasY = (e.clientY - shellRect.top - chartPanY) / chartZoom;

    potentialRubber = {
      pointerId: e.pointerId,
      startShell: { x: shellX, y: shellY },
      startCanvas: { x: canvasX, y: canvasY },
      priorSelection: new Set(selectedStudentIds),
    };
    rubberbandTempSelection = new Set(potentialRubber.priorSelection);

    // Listen for moves/up to either start the rubberband or cancel it (treating as a click)
    try {
      chartShell.setPointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.addEventListener('pointermove', onRubberPointerMove);
    chartShell.addEventListener('pointerup', onRubberPointerUp);
    chartShell.addEventListener('pointercancel', onRubberPointerCancel);
  } catch (err) {
    console.error('[rubberband] pointerdown error:', err);
    clearRubberband();
  }
}

function onRubberPointerMove(e) {
  // If the rubberband hasn't been activated yet, check the movement against a threshold
  if (!rubberbandActive) {
    if (!potentialRubber || e.pointerId !== potentialRubber.pointerId) return;
    const shellRect = chartShell.getBoundingClientRect();
    const shellCX = e.clientX - shellRect.left;
    const shellCY = e.clientY - shellRect.top;
    const dx = shellCX - potentialRubber.startShell.x;
    const dy = shellCY - potentialRubber.startShell.y;
    const dist = Math.hypot(dx, dy);
    if (dist < RUBBER_START_THRESHOLD) return;

    // Activate the rubberband now that movement passed the threshold
    rubberbandActive = true;
    rubberbandStartShell = potentialRubber.startShell;
    rubberbandStartCanvas = potentialRubber.startCanvas;
    rubberbandPriorSelection = new Set(potentialRubber.priorSelection || []);
    rubberbandTempSelection = new Set(rubberbandPriorSelection);
    ensureRubberbandEl();
    setRubberbandShellRect(rubberbandStartShell.x, rubberbandStartShell.y, 1, 1);
  }
  const shellRect = chartShell.getBoundingClientRect();
  const shellCX = e.clientX - shellRect.left;
  const shellCY = e.clientY - shellRect.top;

  const leftShell = Math.min(rubberbandStartShell.x, shellCX);
  const topShell = Math.min(rubberbandStartShell.y, shellCY);
  const widthShell = Math.abs(shellCX - rubberbandStartShell.x);
  const heightShell = Math.abs(shellCY - rubberbandStartShell.y);
  setRubberbandShellRect(leftShell, topShell, widthShell, heightShell);

  // compute canvas-local rect
  const canvasCX = (e.clientX - shellRect.left - chartPanX) / chartZoom;
  const canvasCY = (e.clientY - shellRect.top - chartPanY) / chartZoom;
  const minX = Math.min(rubberbandStartCanvas.x, canvasCX);
  const minY = Math.min(rubberbandStartCanvas.y, canvasCY);
  const maxX = Math.max(rubberbandStartCanvas.x, canvasCX);
  const maxY = Math.max(rubberbandStartCanvas.y, canvasCY);

  // Hit-test placed students
  const hit = new Set();
  const defaultW = window.innerWidth <= 720 ? 138 : 148;
  const defaultH = lsaMode ? 118 : mode === 'circle' ? 90 : 96;
  students.forEach((s) => {
    const id = String(s.id);
    const layout = getStudentLayout(id);
    if (!layout || !layout.placed) return;
    const el = chartCanvas.querySelector(`[data-student-id="${id}"]`);
    const w = el ? el.offsetWidth : defaultW;
    const h = el ? el.offsetHeight : defaultH;
    const left = layout.x;
    const top = layout.y;
    const right = left + w;
    const bottom = top + h;
    if (right > minX && left < maxX && bottom > minY && top < maxY) {
      hit.add(id);
    }
  });

  // Compute selection according to modifiers
  const isMeta = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  let next = new Set();
  if (!isMeta && !isShift) {
    next = hit;
  } else if (isShift) {
    next = new Set(rubberbandPriorSelection);
    hit.forEach((id) => next.add(id));
  } else if (isMeta) {
    next = new Set(rubberbandPriorSelection);
    hit.forEach((id) => (next.has(id) ? next.delete(id) : next.add(id)));
  }

  rubberbandTempSelection = next;
  applySelectionSetToDOM(next);
}

function onRubberPointerUp(e) {
  // If the rubberband never actually activated, this was a short click — just clean up.
  if (!rubberbandActive) {
    if (potentialRubber && e.pointerId === potentialRubber.pointerId) {
      try {
        chartShell.releasePointerCapture(e.pointerId);
      } catch (err) {}
      chartShell.removeEventListener('pointermove', onRubberPointerMove);
      chartShell.removeEventListener('pointerup', onRubberPointerUp);
      chartShell.removeEventListener('pointercancel', onRubberPointerCancel);
      potentialRubber = null;
    }
    return;
  }

  try {
    // Commit temp selection
    const final = new Set(rubberbandTempSelection || rubberbandPriorSelection || []);
    selectedStudentIds = new Set(final);
    selectedStudentId = selectedStudentIds.size === 1 ? Array.from(selectedStudentIds)[0] : null;
    lastSelectedIndex = students.findIndex(
      (s) => selectedStudentId && String(s.id) === selectedStudentId
    );
    applySelectionSetToDOM(final);
  } finally {
    try {
      chartShell.releasePointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.removeEventListener('pointermove', onRubberPointerMove);
    chartShell.removeEventListener('pointerup', onRubberPointerUp);
    chartShell.removeEventListener('pointercancel', onRubberPointerCancel);
    clearRubberband();
  }
}

function onRubberPointerCancel(e) {
  // Restore prior selection or cancel pending potential rubber
  if (!rubberbandActive) {
    if (potentialRubber && e.pointerId === potentialRubber.pointerId) {
      selectedStudentIds = new Set(potentialRubber.priorSelection || []);
      applySelectionSetToDOM(selectedStudentIds);
      try {
        chartShell.releasePointerCapture(e.pointerId);
      } catch (err) {}
      chartShell.removeEventListener('pointermove', onRubberPointerMove);
      chartShell.removeEventListener('pointerup', onRubberPointerUp);
      chartShell.removeEventListener('pointercancel', onRubberPointerCancel);
      potentialRubber = null;
    }
    return;
  }

  try {
    selectedStudentIds = new Set(rubberbandPriorSelection || []);
    applySelectionSetToDOM(selectedStudentIds);
  } finally {
    try {
      chartShell.releasePointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.removeEventListener('pointermove', onRubberPointerMove);
    chartShell.removeEventListener('pointerup', onRubberPointerUp);
    chartShell.removeEventListener('pointercancel', onRubberPointerCancel);
    clearRubberband();
  }
}

// Attach pointerdown to chartShell (start rubberband)
if (chartShell) {
  chartShell.addEventListener('pointerdown', onRubberPointerDown);
}

// Robust click detection on the chart shell to reliably deselect when
// the user performs a short, non-moving click on the blank canvas.
// This avoids relying on the `click` event which can be cancelled by
// pointermove or native drag behaviors.
const CLICK_MAX_MOVE_FOR_CLICK = 6; // px
const CLICK_MAX_MS_FOR_CLICK = 250; // ms
let _canvasPtrDown = null;

function onCanvasPointerDownForClick(e) {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  // Ignore clicks that start on a student card or other interactive control
  if (e.target && e.target.closest && e.target.closest('.chart-student')) return;
  if (e.target && e.target.closest && e.target.closest('button, input, select, textarea, a'))
    return;
  _canvasPtrDown = {
    x: e.clientX,
    y: e.clientY,
    t: Date.now(),
    moved: false,
    pointerId: e.pointerId,
    target: e.target,
  };
  try {
    chartShell.setPointerCapture(e.pointerId);
  } catch (err) {}
}

function onCanvasPointerMoveForClick(e) {
  if (!_canvasPtrDown || e.pointerId !== _canvasPtrDown.pointerId) return;
  const dx = e.clientX - _canvasPtrDown.x;
  const dy = e.clientY - _canvasPtrDown.y;
  if (Math.hypot(dx, dy) > CLICK_MAX_MOVE_FOR_CLICK) _canvasPtrDown.moved = true;
}

function onCanvasPointerUpForClick(e) {
  if (!_canvasPtrDown || e.pointerId !== _canvasPtrDown.pointerId) return;
  const dt = Date.now() - _canvasPtrDown.t;
  const moved = _canvasPtrDown.moved;
  const originTarget = _canvasPtrDown.target;
  _canvasPtrDown = null;
  try {
    chartShell.releasePointerCapture(e.pointerId);
  } catch (err) {}

  // If a rubberband or group-drag is active, let those handlers decide
  if (rubberbandActive || groupDragging || potentialGroupDrag) return;

  // If the pointerdown started on a card or another control, ignore
  if (originTarget && originTarget.closest && originTarget.closest('.chart-student')) return;

  // Treat as a click if it didn't move and was quick
  if (!moved && dt < CLICK_MAX_MS_FOR_CLICK) {
    applySelectionSetToDOM(new Set());
  }
}

if (chartShell) {
  chartShell.addEventListener('pointerdown', onCanvasPointerDownForClick);
  chartShell.addEventListener('pointermove', onCanvasPointerMoveForClick);
  chartShell.addEventListener('pointerup', onCanvasPointerUpForClick);
  chartShell.addEventListener('pointercancel', onCanvasPointerUpForClick);
}

// --- Group drag (pointer-based) helpers ---
function onPotentialGroupMove(e) {
  if (!potentialGroupDrag || e.pointerId !== potentialGroupDrag.pointerId) return;
  const dx = e.clientX - potentialGroupDrag.startClientX;
  const dy = e.clientY - potentialGroupDrag.startClientY;
  const dist = Math.hypot(dx, dy);
  if (!groupDragging && dist >= GROUP_DRAG_START_THRESHOLD) {
    // Begin actual group drag
    startGroupDrag(e, potentialGroupDrag.baseId);
  }
  if (groupDragging) {
    onGroupPointerMove(e);
  }
}

function onPotentialGroupUp(e) {
  if (!potentialGroupDrag || e.pointerId !== potentialGroupDrag.pointerId) return;
  try {
    if (!groupDragging) {
      // Did not move enough to start group drag: restore draggable flags
      Array.from(selectedStudentIds).forEach((id) => {
        const el = chartCanvas.querySelector(`[data-student-id="${id}"]`);
        if (el && el.dataset._prevDraggable !== undefined) {
          el.draggable = el.dataset._prevDraggable === '1';
          delete el.dataset._prevDraggable;
        }
      });
    } else {
      // End the group drag
      onGroupPointerUp(e);
    }
  } finally {
    try {
      chartShell.releasePointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.removeEventListener('pointermove', onPotentialGroupMove);
    chartShell.removeEventListener('pointerup', onPotentialGroupUp);
    chartShell.removeEventListener('pointercancel', onPotentialGroupUp);
    potentialGroupDrag = null;
  }
}

function startGroupDrag(e, baseId) {
  if (groupDragging) return;
  groupDragging = true;
  suppressNativeDrag = true;
  const shellRect = chartShell.getBoundingClientRect();
  const startCanvasX = (e.clientX - shellRect.left - chartPanX) / chartZoom;
  const startCanvasY = (e.clientY - shellRect.top - chartPanY) / chartZoom;
  const ids = Array.from(selectedStudentIds);
  groupDragState = {
    pointerId: e.pointerId,
    startCanvasX,
    startCanvasY,
    baseId,
    items: {},
    pendingDx: 0,
    pendingDy: 0,
    rafId: null,
  };
  ids.forEach((id) => {
    const layout = getStudentLayout(id);
    const el = chartCanvas.querySelector(`[data-student-id="${id}"]`);
    if (!layout || !el) return;
    groupDragState.items[id] = {
      initialX: layout.x,
      initialY: layout.y,
      el,
      prevZ: el.style.zIndex || '',
      prevTransition: getComputedStyle(el).transition || '',
      prevTransform: el.style.transform || '',
      prevWillChange: el.style.willChange || '',
    };
    // bring to front for visual clarity
    el.style.zIndex = '10000';
    // prepare for GPU transform updates
    try {
      el.style.willChange = 'transform';
    } catch (err) {}
    // disable CSS transitions while dragging so movement keeps up with pointer
    try {
      el.style.transition = 'none';
    } catch (err) {}
  });
  // Attach move/up handlers for the active pointer
  chartShell.setPointerCapture(e.pointerId);
  chartShell.addEventListener('pointermove', onGroupPointerMove);
  chartShell.addEventListener('pointerup', onGroupPointerUp);
  chartShell.addEventListener('pointercancel', onGroupPointerCancel);
}

function onGroupPointerMove(e) {
  if (!groupDragging || !groupDragState || e.pointerId !== groupDragState.pointerId) return;
  const shellRect = chartShell.getBoundingClientRect();
  const currentCanvasX = (e.clientX - shellRect.left - chartPanX) / chartZoom;
  const currentCanvasY = (e.clientY - shellRect.top - chartPanY) / chartZoom;
  const dx = currentCanvasX - groupDragState.startCanvasX;
  const dy = currentCanvasY - groupDragState.startCanvasY;
  groupDragState.pendingDx = dx;
  groupDragState.pendingDy = dy;
  // Batch DOM writes via rAF
  if (!groupDragState.rafId) {
    groupDragState.rafId = requestAnimationFrame(() => {
      const pdx = groupDragState.pendingDx || 0;
      const pdy = groupDragState.pendingDy || 0;
      Object.keys(groupDragState.items).forEach((id) => {
        const it = groupDragState.items[id];
        if (!it.el) return;
        const prev = it.prevTransform || '';
        it.el.style.transform = `${prev ? prev + ' ' : ''}translate3d(${pdx}px, ${pdy}px, 0)`;
      });
      groupDragState.rafId = null;
    });
  }
}

function onGroupPointerUp(e) {
  if (!groupDragging || !groupDragState || e.pointerId !== groupDragState.pointerId) return;
  try {
    // Cancel any pending RAF
    if (groupDragState.rafId) {
      cancelAnimationFrame(groupDragState.rafId);
      groupDragState.rafId = null;
    }
    const finalDx = groupDragState.pendingDx || 0;
    const finalDy = groupDragState.pendingDy || 0;
    // Commit positions to layoutState and persist
    Object.keys(groupDragState.items).forEach((id) => {
      const it = groupDragState.items[id];
      if (!it.el) return;
      const layout = getStudentLayout(id);
      if (layout) {
        const w = it.el.offsetWidth || (window.innerWidth <= 720 ? 138 : 148);
        const h = it.el.offsetHeight || (lsaMode ? 118 : mode === 'circle' ? 90 : 96);
        const maxX = Math.max(0, CANVAS_W - w - 8);
        const maxY = Math.max(8, CANVAS_H - h - 24);
        const left = it.initialX + finalDx;
        const top = it.initialY + finalDy;
        layout.placed = true;
        layout.x = clamp(left, 8, maxX);
        layout.y = clamp(top, 8, maxY);
        // Apply final absolute positioning and clear transform
        it.el.style.left = `${layout.x}px`;
        it.el.style.top = `${layout.y}px`;
      }
      // restore stacking, transitions and transform
      if (it.el) {
        it.el.style.zIndex = it.prevZ || '';
        try {
          it.el.style.transition = it.prevTransition || '';
        } catch (err) {}
        try {
          it.el.style.transform = it.prevTransform || '';
        } catch (err) {}
        try {
          it.el.style.willChange = it.prevWillChange || '';
        } catch (err) {}
      }
      // restore draggable flag if we toggled it earlier
      if (it.el && it.el.dataset._prevDraggable !== undefined) {
        it.el.draggable = it.el.dataset._prevDraggable === '1';
        delete it.el.dataset._prevDraggable;
      }
    });
  } finally {
    try {
      chartShell.releasePointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.removeEventListener('pointermove', onGroupPointerMove);
    chartShell.removeEventListener('pointerup', onGroupPointerUp);
    chartShell.removeEventListener('pointercancel', onGroupPointerCancel);
    groupDragging = false;
    suppressNativeDrag = false;
    groupDragState = null;
  }
  renderWorkspace();
  persistActiveSeatingChart().catch((err) => console.error('[group-drag] persist failed:', err));
}

function onGroupPointerCancel(e) {
  if (!groupDragging || !groupDragState || e.pointerId !== groupDragState.pointerId) return;
  try {
    // Cancel any pending RAF
    if (groupDragState.rafId) {
      cancelAnimationFrame(groupDragState.rafId);
      groupDragState.rafId = null;
    }
    // restore dragged elements to their initial positions and restore styles
    Object.keys(groupDragState.items).forEach((id) => {
      const it = groupDragState.items[id];
      if (!it.el) return;
      it.el.style.left = `${it.initialX}px`;
      it.el.style.top = `${it.initialY}px`;
      if (it.el) {
        it.el.style.zIndex = it.prevZ || '';
        try {
          it.el.style.transition = it.prevTransition || '';
        } catch (err) {}
        try {
          it.el.style.transform = it.prevTransform || '';
        } catch (err) {}
        try {
          it.el.style.willChange = it.prevWillChange || '';
        } catch (err) {}
      }
      if (it.el && it.el.dataset._prevDraggable !== undefined) {
        it.el.draggable = it.el.dataset._prevDraggable === '1';
        delete it.el.dataset._prevDraggable;
      }
    });
  } finally {
    try {
      chartShell.releasePointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.removeEventListener('pointermove', onGroupPointerMove);
    chartShell.removeEventListener('pointerup', onGroupPointerUp);
    chartShell.removeEventListener('pointercancel', onGroupPointerCancel);
    groupDragging = false;
    suppressNativeDrag = false;
    groupDragState = null;
  }
  renderWorkspace();
}

function getAssessmentLabel(num) {
  const { base, subtitle } = getAssessmentLabelParts(num);
  return subtitle ? `${base} — ${subtitle}` : base;
}

function getAssessmentScaleTexts(num) {
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const entry = assessmentLibraryDb.get(grade)?.get(num) || {};
  return {
    1: entry.scale1 || null,
    2: entry.scale2 || null,
    3: entry.scale3 || null,
    4: entry.scale4 || null,
  };
}

const gradebookTabRhythmBtn = document.getElementById('gradebook-tab-rhythm');
const gradebookTabMovementBtn = document.getElementById('gradebook-tab-movement');
const gradebookTabInstrumentBtn = document.getElementById('gradebook-tab-instrument');
const gradebookTabImmaBtn = document.getElementById('gradebook-tab-imma');

const showInactiveBtn = document.getElementById('show-inactive-btn');

const noteEntryForm = document.getElementById('note-entry-form');
const noteEntryStudentIdInput = document.getElementById('note-entry-student-id');
const noteEntryText = document.getElementById('note-entry-text');
const noteEntryModal = document.getElementById('note-entry-modal');
const noteEntryCancel = document.getElementById('note-entry-cancel');
const noteEntryType = document.getElementById('note-entry-type');
const noteEntryDate = document.getElementById('note-entry-date');
const toggleNoteModeBtn = document.getElementById('toggle-note-mode-btn');

let _noteModalNoteId = null;
let _noteModalStudent = null;
let _noteModalOriginalNoteDate = null;
const viewNotesModal = document.getElementById('view-notes-modal');

let mode = '';
const attendanceCanvas = document.getElementById('attendance-canvas');
const sampleNote = document.getElementById('sample-note');
const selectionCard = document.getElementById('selection-card');
const attendanceToggleBtn = document.getElementById('toggle-attendance-btn');
const lsaToggleBtn = document.getElementById('toggle-lsa-btn');
const assessmentToggleBtn = document.getElementById('toggle-assessment-btn');
const assessmentSubmenu = document.getElementById('assessment-submenu');
const manageStudentsBtn = document.getElementById('manage-students-btn');
const addStudentBtn = document.getElementById('add-student-btn');
const editModeToggleBtn = document.getElementById('toggle-edit-mode-btn');
const backupStudentsBtn = document.getElementById('backup-students-btn');
const mergeDuplicatesBtn = document.getElementById('merge-duplicates-btn');
const chartToolsBtn = document.getElementById('chart-tools-btn');
const chartToolsSubmenu = document.getElementById('chart-tools-submenu');
const manageStudentsSubmenu = document.getElementById('manage-students-submenu');
const attendanceSubmenu = document.getElementById('attendance-submenu');
const lsaSubmenu = document.getElementById('lsa-submenu');
const showUnitsBtn = document.getElementById('show-units-btn');
const clearChartBtn = document.getElementById('clear-chart-btn');
const undoClearChartBtn = document.getElementById('undo-clear-chart-btn');
const arrangeRowsBtn = document.getElementById('arrange-rows-btn');
const arrangeCircleBtn = document.getElementById('arrange-circle-btn');
const neatenRowsBtn = document.getElementById('neaten-rows-btn');
const neatenCircleBtn = document.getElementById('neaten-circle-btn');
const groupsBtn = document.getElementById('groups-btn');
const groupsModal = document.getElementById('groups-modal');
const groupsModalClose = document.getElementById('groups-modal-close');
const groupsCreateBtn = document.getElementById('groups-create-btn');
const neatenGroupsBtn = document.getElementById('neaten-groups-btn');
const groupsDoneBtn = document.getElementById('groups-done-btn');
const groupsTypeSelect = document.getElementById('groups-type');
const groupsCountInput = document.getElementById('groups-count');
const groupsCountLabel = document.getElementById('groups-count-label');
const groupsSortKeyWrap = document.getElementById('groups-sort-key-wrap');
const chartSortLastBtn = document.getElementById('chart-sort-last-btn');
const chartSortFirstBtn = document.getElementById('chart-sort-first-btn');

// Persisted toggle controlling whether Arrange Rows / Arrange Circle sort
// students by last name or first name. Neaten Rows/Circle are unaffected —
// they only snap existing cards to the nearest slot via greedy distance math.
let chartArrangeSortKey = 'last';

function setChartArrangeSortKey(key) {
  chartArrangeSortKey = key === 'first' ? 'first' : 'last';
  window.localStorage.setItem('chartArrangeSortKey', chartArrangeSortKey);
  if (chartSortLastBtn) chartSortLastBtn.classList.toggle('active', chartArrangeSortKey === 'last');
  if (chartSortFirstBtn)
    chartSortFirstBtn.classList.toggle('active', chartArrangeSortKey === 'first');
}

function compareStudentsByName(a, b, sortKey) {
  const primary = sortKey === 'first' ? 'first_name' : 'last_name';
  const secondary = sortKey === 'first' ? 'last_name' : 'first_name';
  const primaryCompare = String(a[primary] || '').localeCompare(String(b[primary] || ''));
  if (primaryCompare !== 0) return primaryCompare;
  return String(a[secondary] || '').localeCompare(String(b[secondary] || ''));
}

// Print modal
const printChartBtn = document.getElementById('print-chart-btn');
const printPreviewModal = document.getElementById('print-preview-modal');
const ppmClose = document.getElementById('ppm-close');
const ppmCancel = document.getElementById('ppm-cancel');
const ppmIncludeChart = document.getElementById('ppm-include-chart');
const ppmChartOptions = document.getElementById('ppm-chart-options');
const ppmRecordersWrap = document.getElementById('ppm-recorders-wrap');
const ppmPreviewArea = document.getElementById('ppm-preview-area');
const ppmSelectAll = document.getElementById('ppm-select-all');
const ppmDeselectAll = document.getElementById('ppm-deselect-all');
const ppmPrintBtn = document.getElementById('ppm-print-btn');
const ppmTabsSection = document.getElementById('ppm-tabs-section');
const ppmBlankCols = document.getElementById('ppm-blank-cols');
const ppmBlankColsWrap = document.getElementById('ppm-blank-cols-wrap');
const printFrame = document.getElementById('print-frame');
const seatingChartLibrary = document.getElementById('seating-chart-library');
const seatingChartList = document.getElementById('seating-chart-list');
const classLibrary = document.getElementById('class-library');
const classList = document.getElementById('class-list');
const globalStudentSearchInput = document.getElementById('global-student-search');
const globalStudentSearchResults = document.getElementById('global-student-search-results');
const unitsLibrary = document.getElementById('units-library');
const unitsList = document.getElementById('units-list');
const seatingChartLibraryBody = document.getElementById('seating-chart-library-body');
const toggleSeatingChartsListBtn = document.getElementById('toggle-seating-charts-list-btn');
// Reorder mode controls: gear icon enters reorder mode, done button exits it.
const seatingChartOrderGearBtn = document.getElementById('seating-chart-order-gear-btn');
const seatingChartOrderDoneBtn = document.getElementById('seating-chart-order-done-btn');
const classOrderGearBtn = document.getElementById('class-order-gear-btn');
const classOrderDoneBtn = document.getElementById('class-order-done-btn');
const toggleClassesListBtn = document.getElementById('toggle-classes-list-btn');
const classLibraryBody = document.getElementById('class-library-body');
const addSeatingChartBtn = document.getElementById('add-seating-chart-btn');
const assessLibCloseBtn = document.getElementById('assess-lib-close-btn');
// Inserted after line 120: DOM references for assessments and academic year display
const showAssessmentsBtn = document.getElementById('show-assessments-btn');
const academicYearDisplay = document.getElementById('academic-year-display');
const assessmentLibraryBtn = document.getElementById('assessment-library-btn');

// Declare and initialize assessmentLibraryModal
const assessmentLibraryModal = document.getElementById('assessment-library-modal');
let penMode = false;
let manageAssessmentsVisible = false;
let exportSelectedStudentsList = [];

let assessLibraryGrade = null;
let assessmentDates = {}; // keyed by assessNum string → 'YYYY-MM-DD'
let activeLsaAudio = null;
let ratingDirection = localStorage.getItem('ratingDirection') || 'asc';
// Declare and initialize noteMode
let noteMode = false; // Default value

// Utility: Returns whether to show inactive students (stub, update as needed)

// ...existing code...
// Utility: Returns whether to show inactive students (stub, update as needed)
function getShowInactiveStudents() {
  // Persisted toggle stored as 'true'/'false' in localStorage under this key.
  try {
    return String(localStorage.getItem('showInactiveStudents')) === 'true';
  } catch (err) {
    return false;
  }
}

// Inserted at line 120: penModeBtn DOM reference for pen mode toggle
const penModeBtn = document.getElementById('pen-mode-btn');
const ratingDirectionBtn = document.getElementById('rating-direction-btn');
const assessLibDirectionBtn = document.getElementById('assess-lib-direction-btn');
// Pen note cache and related state
let penNotesCache = new Map();
// Multi-grade teachers state
let multiGradeTeachers = new Set(JSON.parse(localStorage.getItem('multiGradeTeachers') || '[]'));
// Inserted at line 59: immaTabYear state for IMMA grid
let immaTabYear = null;
let immaHistoryVisible = localStorage.getItem('immaHistoryVisible') === 'true';
// Inserted at line 119: assessmentsLibrary DOM reference for assessment library panel
const assessmentsLibrary = document.getElementById('assessments-library');

const viewSeatingBtn = document.getElementById('view-seating-btn');
const viewGradebookBtn = document.getElementById('view-gradebook-btn');
const seatingView = document.getElementById('seating-view');
const gradebookView = document.getElementById('gradebook-view');
const gradebookRhythmPanel = document.getElementById('gradebook-rhythm-panel');
const gradebookMovementPanel = document.getElementById('gradebook-movement-panel');
const gradebookInstrumentPanel = document.getElementById('gradebook-instrument-panel');
const gradebookImmaPanel = document.getElementById('gradebook-imma-panel');
const gradebookTabAttendanceBtn = document.getElementById('gradebook-tab-attendance');
const gradebookTabLsaBtn = document.getElementById('gradebook-tab-lsa');
const gradebookTabAssessmentBtn = document.getElementById('gradebook-tab-assessment');
const gradebookTabRecordersBtn = document.getElementById('gradebook-tab-recorders');
const gradebookAttendancePanel = document.getElementById('gradebook-attendance-panel');
const gradebookLsaPanel = document.getElementById('gradebook-lsa-panel');
const gradebookAssessmentPanel = document.getElementById('gradebook-assessment-panel');
const gradebookRecordersPanel = document.getElementById('gradebook-recorders-panel');
const gradebookClassSubtitle = document.getElementById('gradebook-class-subtitle');
const currentViewLabel = document.getElementById('current-view-label');
const lsaGridCanvas = document.getElementById('lsa-grid-canvas');
const assessmentGridCanvas = document.getElementById('assessment-grid-canvas');
const recordersGridCanvas = document.getElementById('recorders-grid-canvas');
const rhythmGridCanvas = document.getElementById('rhythm-grid-canvas');
const movementGridCanvas = document.getElementById('movement-grid-canvas');
const instrumentGridCanvas = document.getElementById('instrument-grid-canvas');
const immaGridCanvas = document.getElementById('imma-grid-canvas');
const settingsGearBtn = document.getElementById('settings-gear-btn');
const settingsDropdown = document.getElementById('settings-dropdown');
const resetStudentDataBtn = document.getElementById('reset-student-data-btn');
const resetFactoryBtn = document.getElementById('reset-factory-btn');
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
const csvResolvePanel = document.getElementById('csv-step-panel-resolve');
const csvResolveList = document.getElementById('csv-resolve-list');
const csvResolveBack = document.getElementById('csv-resolve-back');
const csvResolveContinue = document.getElementById('csv-resolve-continue');
let pendingCsvImport = null;

const mergeDuplicatesModal = document.getElementById('merge-duplicates-modal');
const mergeDupPanelList = document.getElementById('merge-dup-panel-list');
const mergeDupGroupListEl = document.getElementById('merge-dup-group-list');
const mergeDupPanelReview = document.getElementById('merge-dup-panel-review');
const mergeDupReviewBack = document.getElementById('merge-dup-review-back');
const mergeDupReviewBody = document.getElementById('merge-dup-review-body');
const mergeDupConfirmBtn = document.getElementById('merge-dup-confirm-btn');
const mergeDupCloseBtn = document.getElementById('merge-dup-close-btn');
let mergeDupGroups = [];
let mergeDupKeepSelections = new Map();
let mergeDupActivePair = null;

addStudentBtn.addEventListener('click', () => openStudentModal(null));
backupStudentsBtn.addEventListener('click', backupStudentsCsv);
manageStudentsBtn.addEventListener('click', toggleManageStudents);
clearChartBtn.addEventListener('click', clearChart);
undoClearChartBtn.addEventListener('click', undoClearChart);
chartToolsBtn.addEventListener('click', toggleChartTools);
showUnitsBtn.addEventListener('click', toggleManageUnits);
lessonLibraryBtn.addEventListener('click', openLessonLibraryModal);
lessonLibraryModal.addEventListener('click', (event) => {
  if (event.target === lessonLibraryModal) closeLessonLibraryModal();
});

// Inserted at line 179: toggleManageUnits for toggling units library panel
function toggleManageUnits() {
  const next = !manageUnitsVisible;
  manageUnitsVisible = next;
  if (next) {
    // Deactivate note mode when opening units panel
    noteMode = false;
  }
  renderWorkspace();
}

// --- Ensure workspace is initialized after DOM is ready ---
document.addEventListener('DOMContentLoaded', () => {
  initializeWorkspace();
  initMatsImportModal();
});
importStudentsCsvBtn.addEventListener('click', openCsvImportModal);
csvImportModal.addEventListener('click', (event) => {
  if (event.target === csvImportModal) closeCsvImportModal();
});
document.getElementById('csv-import-close-btn').addEventListener('click', closeCsvImportModal);
mergeDuplicatesBtn.addEventListener('click', openMergeDuplicatesModal);
mergeDuplicatesModal.addEventListener('click', (event) => {
  if (event.target === mergeDuplicatesModal) closeMergeDuplicatesModal();
});
mergeDupCloseBtn.addEventListener('click', closeMergeDuplicatesModal);
mergeDupReviewBack.addEventListener('click', () => {
  mergeDupActivePair = null;
  showMergeDupListPanel();
});
mergeDupConfirmBtn.addEventListener('click', handleMergeDupConfirm);
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
csvStep2Next.addEventListener('click', () => {
  saveCsvMapping();
  goToCsvStep(3);
});
csvStep3Back.addEventListener('click', () => goToCsvStep(2));
csvStep3Import.addEventListener('click', executeCsvImport);
csvResolveBack.addEventListener('click', () => {
  pendingCsvImport = null;
  csvResolvePanel.classList.add('hidden');
  document.getElementById('csv-step-panel-3').classList.remove('hidden');
});
csvResolveContinue.addEventListener('click', continueCsvImportAfterResolve);
lessonLibCloseBtn.addEventListener('click', closeLessonLibraryModal);
lessonLibAddUnitBtn.addEventListener('click', addLsaUnit);
document.querySelectorAll('.lesson-lib-tab').forEach((btn) => {
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
neatenRowsBtn.addEventListener('click', neatenRows);
neatenCircleBtn.addEventListener('click', neatenCircle);
setChartArrangeSortKey(
  window.localStorage.getItem('chartArrangeSortKey') === 'first' ? 'first' : 'last'
);
if (chartSortLastBtn)
  chartSortLastBtn.addEventListener('click', () => setChartArrangeSortKey('last'));
if (chartSortFirstBtn)
  chartSortFirstBtn.addEventListener('click', () => setChartArrangeSortKey('first'));
if (groupsBtn) groupsBtn.addEventListener('click', openGroupsModal);
if (groupsModal)
  groupsModal.addEventListener('click', (event) => {
    if (event.target === groupsModal) closeGroupsModal();
  });
if (groupsModalClose) groupsModalClose.addEventListener('click', closeGroupsModal);
if (groupsCreateBtn) groupsCreateBtn.addEventListener('click', createGroups);
if (neatenGroupsBtn) neatenGroupsBtn.addEventListener('click', neatenGroups);
if (groupsDoneBtn) groupsDoneBtn.addEventListener('click', closeGroupsModal);
document
  .querySelectorAll('input[name="groups-count-mode"]')
  .forEach((r) => r.addEventListener('change', updateGroupsMode));
document
  .querySelectorAll('input[name="groups-sort"]')
  .forEach((r) => r.addEventListener('change', updateGroupsSortKeyState));
// Enable dragging for the Groups modal header so users can reposition it
if (groupsModal) {
  try {
    const header = groupsModal.querySelector('.groups-header');
    const modalEl = groupsModal.querySelector('.groups-modal');
    if (header && modalEl) {
      header.style.cursor = 'grab';
      header.style.userSelect = 'none';
      header.style.touchAction = 'none';

      let dragState = null;

      function onGroupsPointerMove(ev) {
        if (!dragState) return;
        const pad = 8;
        let left = ev.clientX - dragState.offsetX;
        let top = ev.clientY - dragState.offsetY;
        left = Math.max(pad, Math.min(left, window.innerWidth - modalEl.offsetWidth - pad));
        top = Math.max(pad, Math.min(top, window.innerHeight - modalEl.offsetHeight - pad));
        modalEl.style.left = left + 'px';
        modalEl.style.top = top + 'px';
      }

      function onGroupsPointerUp(ev) {
        if (dragState) {
          try {
            header.releasePointerCapture(ev.pointerId);
          } catch (e) {}
          dragState = null;
        }
        // Persist final position when dragging ends
        try {
          const left = parseInt(modalEl.style.left, 10);
          const top = parseInt(modalEl.style.top, 10);
          if (!Number.isNaN(left) && !Number.isNaN(top)) {
            window.localStorage.setItem('groupsModalPos', JSON.stringify({ left, top }));
          }
        } catch (err) {
          // ignore
        }
        document.removeEventListener('pointermove', onGroupsPointerMove);
        document.removeEventListener('pointerup', onGroupsPointerUp);
      }

      header.addEventListener('pointerdown', (ev) => {
        // don't start drag when clicking the close button inside header
        if (ev.button !== 0) return;
        if (ev.target.closest('button')) return;
        ev.preventDefault();
        const rect = modalEl.getBoundingClientRect();
        modalEl.style.position = 'fixed';
        modalEl.style.transform = 'none';
        modalEl.style.left = rect.left + 'px';
        modalEl.style.top = rect.top + 'px';
        modalEl.style.margin = '0';
        dragState = {
          offsetX: ev.clientX - rect.left,
          offsetY: ev.clientY - rect.top,
        };
        header.setPointerCapture(ev.pointerId);
        document.addEventListener('pointermove', onGroupsPointerMove);
        document.addEventListener('pointerup', onGroupsPointerUp);
      });
    }
  } catch (err) {
    console.error('Groups modal drag init error', err);
  }
}
editModeToggleBtn.addEventListener('click', toggleEditMode);
attendanceToggleBtn.addEventListener('click', toggleAttendanceMode);
document.getElementById('mark-all-present-btn').addEventListener('click', markAllPresent);
document.getElementById('clear-good-news-btn').addEventListener('click', clearGoodNewsChecks);
document.getElementById('clear-color-dots-btn').addEventListener('click', clearColorDots);
document.getElementById('toggle-color-dots-btn').addEventListener('click', () => {
  colorDotsHidden = !colorDotsHidden;
  document.getElementById('toggle-color-dots-btn').querySelector('strong').textContent =
    colorDotsHidden ? 'Show Dot Colors' : 'Hide Dot Colors';
  renderWorkspace();
});
lsaToggleBtn.addEventListener('click', toggleLsaMode);
if (penModeBtn) {
  penModeBtn.addEventListener('click', () => {
    penMode = !penMode;
    if (penMode) noteMode = false;
    renderLsaToggle();
  });
}
assessmentToggleBtn.addEventListener('click', toggleAssessmentMode);
function toggleManageAssessments() {
  if (!assessmentMode) {
    manageAssessmentsVisible = false;
    renderWorkspace();
    return;
  }
  const next = !manageAssessmentsVisible;
  manageAssessmentsVisible = next;
  if (next) noteMode = false;
  renderWorkspace();
}
showAssessmentsBtn.addEventListener('click', toggleManageAssessments);
assessmentLibraryBtn.addEventListener('click', openAssessmentLibrary);
ratingDirectionBtn.addEventListener('click', toggleRatingDirection);
assessLibDirectionBtn.addEventListener('click', toggleRatingDirection);
assessLibCloseBtn.addEventListener('click', closeAssessmentLibrary);
assessmentLibraryModal.addEventListener('click', (event) => {
  if (event.target === assessmentLibraryModal) closeAssessmentLibrary();
});
multiGradeGearBtn.addEventListener('click', openMultiGradeModal);
multiGradeCloseBtn.addEventListener('click', closeMultiGradeModal);
multiGradeDoneBtn.addEventListener('click', closeMultiGradeModal);
multiGradeModal.addEventListener('click', (event) => {
  if (event.target === multiGradeModal) closeMultiGradeModal();
});
assessLibGradeSelect.addEventListener('change', async () => {
  assessLibraryGrade = assessLibGradeSelect.value;
  await loadAssessmentLibraryForGrade(assessLibraryGrade);
  renderAssessLibContent();
});

const assessLibAddSelect = document.getElementById('assess-lib-add-select');
if (assessLibAddSelect) {
  assessLibAddSelect.addEventListener('change', async () => {
    const category = assessLibAddSelect.value;
    assessLibAddSelect.value = '';
    if (category && assessLibraryGrade) {
      await addExtraAssessment(category);
    }
  });
}
// Note mode and notes modal controls
if (toggleNoteModeBtn) toggleNoteModeBtn.addEventListener('click', toggleNoteMode);
if (noteEntryCancel) noteEntryCancel.addEventListener('click', closeNoteEntryModal);
const viewNotesCloseBtn = document.getElementById('view-notes-close');
if (viewNotesCloseBtn) viewNotesCloseBtn.addEventListener('click', closeViewNotesModal);
if (viewNotesModal)
  viewNotesModal.addEventListener('click', (event) => {
    if (event.target === viewNotesModal) closeViewNotesModal();
  });
if (noteEntryModal)
  noteEntryModal.addEventListener('click', (event) => {
    if (event.target === noteEntryModal) closeNoteEntryModal();
  });
if (aptitudeSettingsModal)
  aptitudeSettingsModal.addEventListener('click', (event) => {
    if (event.target === aptitudeSettingsModal) closeAptitudeSettingsModal();
  });
if (recorderSetupModal)
  recorderSetupModal.addEventListener('click', (event) => {
    if (event.target === recorderSetupModal) closeRecorderSetupModal();
  });
toggleSeatingChartsListBtn.addEventListener('click', toggleSeatingChartsList);
toggleClassesListBtn.addEventListener('click', toggleClassesList);
addSeatingChartBtn.addEventListener('click', createAdditionalSeatingChart);
// Reorder icon: enters reorder mode and auto-expands the list if collapsed.
classOrderGearBtn?.addEventListener('click', () => {
  classesReorderMode = true;
  classesCollapsed = false;
  renderWorkspace();
});
classOrderDoneBtn?.addEventListener('click', () => {
  classesReorderMode = false;
  renderWorkspace();
});
seatingChartOrderGearBtn?.addEventListener('click', () => {
  seatingChartsReorderMode = true;
  if (seatingChartsCollapsed) {
    seatingChartsCollapsed = false;
  }
  renderSeatingChartLibrary();
});
// Done button: exits reorder mode and restores normal pill interactions.
seatingChartOrderDoneBtn?.addEventListener('click', () => {
  seatingChartsReorderMode = false;
  renderSeatingChartLibrary();
});
settingsGearBtn.addEventListener('click', toggleSettingsMenu);
resetStudentDataBtn.addEventListener('click', handleResetStudentData);
resetFactoryBtn.addEventListener('click', handleResetFactoryData);
exportRubricsBtn.addEventListener('click', handleExportRubrics);
importRubricsBtn.addEventListener('click', handleImportRubrics);
openAptitudeSettingsBtn?.addEventListener('click', () => {
  setSettingsMenuOpen(false);
  openAptitudeSettingsModal();
});
aptitudeSettingsCancelBtn?.addEventListener('click', closeAptitudeSettingsModal);
aptitudeSettingsCloseBtn?.addEventListener('click', closeAptitudeSettingsModal);
aptitudeSettingsSaveBtn?.addEventListener('click', saveAptitudeSettingsFromModal);
openRecorderSetupBtn?.addEventListener('click', () => {
  setSettingsMenuOpen(false);
  openRecorderSetupModal();
});
recorderSetupCancelBtn?.addEventListener('click', closeRecorderSetupModal);
recorderSetupCloseBtn?.addEventListener('click', closeRecorderSetupModal);
recorderSetupSaveBtn?.addEventListener('click', saveRecorderSetupFromModal);
recorderSetupAddBtn?.addEventListener('click', addRecorderSetupDraftRow);
aptitudeToggleBtn?.addEventListener('click', () => {
  lsaAptitudeView = lsaAptitudeView === 'tonal' ? 'rhythm' : 'tonal';
  syncAptitudeToggleVisibility();
  renderWorkspace();
});
checkForUpdatesBtn.addEventListener('click', () => {
  updateConfirmRow.classList.add('hidden');
  setUpdateStatus('checking', 'Checking for updates…');
  // SEND → 'updater.check'
  window.api.checkForUpdates();
});
let pendingUpdateVersion = null;
updateConfirmDownloadBtn.addEventListener('click', () => {
  updateConfirmRow.classList.add('hidden');
  setUpdateProgress(0);
  setUpdateStatus('checking', `Downloading version ${pendingUpdateVersion}…`);
  // SEND → 'updater.download'
  window.api.downloadUpdate();
});
updateConfirmSkipBtn.addEventListener('click', () => {
  updateConfirmRow.classList.add('hidden');
  updateStatusLine.classList.add('hidden');
  pendingUpdateVersion = null;
  setSettingsMenuOpen(false);
});
function setUpdateStatus(type, text) {
  updateStatusLine.textContent = text;
  updateStatusLine.className = 'update-status-line';
  if (type === 'success') updateStatusLine.classList.add('success');
  if (type === 'error') updateStatusLine.classList.add('error');
  updateStatusLine.classList.remove('hidden');
}
function setUpdateProgress(pct) {
  if (pct === null) {
    updateProgressWrap.classList.add('hidden');
    updateProgressBar.classList.remove('downloading');
    updateProgressBar.style.width = '0%';
  } else {
    updateProgressWrap.classList.remove('hidden');
    updateProgressBar.style.width = `${pct}%`;
    updateProgressBar.classList.toggle('downloading', pct < 100);
  }
}
// LISTEN ← 'update-available' | 'update-not-available' | 'update-download-progress'
//           'update-downloaded' | 'update-error'
// These are one-way pushes from Main; the renderer cannot poll for them — it can only react.
window.api.onUpdateStatus((status, payload) => {
  if (status !== 'available') updateConfirmRow.classList.add('hidden');
  if (status === 'not-available') {
    setUpdateProgress(null);
    setUpdateStatus('success', 'You have the latest version.');
  } else if (status === 'available') {
    pendingUpdateVersion = payload;
    setUpdateProgress(null);
    updateStatusLine.classList.add('hidden');
    updateConfirmText.textContent = `Version ${payload} is available.`;
    updateConfirmRow.classList.remove('hidden');
  } else if (status === 'progress') {
    setUpdateProgress(payload);
    setUpdateStatus('checking', `Downloading… ${payload}%`);
  } else if (status === 'downloaded') {
    setUpdateProgress(100);
    setUpdateStatus('success', 'Update ready — click to restart.');
    checkForUpdatesBtn.textContent = 'Restart to Update';
    // SEND → 'updater.install' (triggers app quit + install in Main)
    checkForUpdatesBtn.addEventListener('click', () => window.api.installUpdate(), { once: true });
  } else if (status === 'error') {
    setUpdateProgress(null);
    setUpdateStatus('error', `Update error: ${payload}`);
  }
});
openAboutBtn.addEventListener('click', () => {
  setSettingsMenuOpen(false);
  openAboutModal();
});
aboutModalCloseX.addEventListener('click', closeAboutModal);
aboutModalClose.addEventListener('click', closeAboutModal);
aboutModal.addEventListener('click', (event) => {
  if (event.target.id === 'about-modal') closeAboutModal();
});
async function openAboutModal() {
  aboutAppName.textContent = '';
  aboutAppVersion.textContent = '';
  aboutAppArch.textContent = '';
  aboutModal.classList.remove('hidden');
  try {
    const info = await window.api.getAppInfo();
    aboutAppName.textContent = info.name;
    aboutAppVersion.textContent = `Version ${info.version}`;
    aboutAppArch.textContent = info.arch === 'arm64' ? 'Build: ARM64' : 'Build: x64';
  } catch (err) {
    console.error('[about] failed to load app info:', err);
    aboutAppVersion.textContent = 'Version unavailable';
  }
}
function closeAboutModal() {
  aboutModal.classList.add('hidden');
  setSettingsMenuOpen(false);
}
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
})();
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
document.addEventListener('click', (event) => {
  if (!settingsMenuOpen) {
    return;
  }
  if (event.target !== settingsGearBtn && !settingsDropdown.contains(event.target)) {
    setSettingsMenuOpen(false);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && settingsMenuOpen) {
    setSettingsMenuOpen(false);
  }
  if (event.ctrlKey && event.key === 'p') {
    event.preventDefault();
    openPrintPreviewModal();
  }
  // Alt+T: toggle text-only style for class list (temporary style experiment)
  if (event.altKey && event.key === 't') {
    event.preventDefault();
    document.getElementById('class-list').classList.toggle('class-list--text');
  }
});
document.getElementById('student-modal-close').addEventListener('click', closeStudentModal);
studentModal.addEventListener('click', (event) => {
  if (event.target.id === 'student-modal') {
    closeStudentModal();
  }
});
studentModal.querySelector('.modal').addEventListener('click', (event) => {
  event.stopPropagation();
});

if (noteEntryForm)
  noteEntryForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const studentId = noteEntryStudentIdInput.value;
    const noteText = noteEntryText.value.trim();
    const noteTypeVal = noteEntryType ? noteEntryType.value || null : null;
    const inputDate = noteEntryDate ? noteEntryDate.value : '';
    if (!studentId || !noteText) return;
    const academicYear = currentAcademicYear || getDefaultAcademicYear();
    if (_noteModalNoteId) {
      // Editing existing note — allow editing date/type if provided, otherwise preserve original
      const noteDateToUse = inputDate || _noteModalOriginalNoteDate || getTodayIsoDate();
      await window.api.updateStudentNote(_noteModalNoteId, noteText, noteTypeVal, noteDateToUse);
    } else {
      // Adding new note: use provided date or today's date
      const noteDateToUse = inputDate || getTodayIsoDate();
      await window.api.addStudentNote(
        studentId,
        noteText,
        noteTypeVal,
        noteDateToUse,
        academicYear
      );
    }
    closeNoteEntryModal();
    // Optionally refresh notes view if open
    if (!viewNotesModal.classList.contains('hidden') && _noteModalStudent) {
      await loadAndRenderStudentNotes(_noteModalStudent.id);
    }
    // Update page icon badges for students displayed in the workspace
    try {
      await updateNoteIconsForDisplayedStudents();
    } catch (err) {
      console.error('[notes] badge update failed:', err);
    }
  });

document.getElementById('student-form').addEventListener('submit', async (event) => {
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
    // SEND → 'db.updateStudent'
    const existingStudent = students.find((s) => s.id === Number(id));
    student.lsa_easy = existingStudent ? existingStudent.lsa_easy || null : null;
    student.lsa_medium = existingStudent ? existingStudent.lsa_medium || null : null;
    student.lsa_difficult = existingStudent ? existingStudent.lsa_difficult || null : null;
    student.lsa_units = existingStudent ? JSON.stringify(existingStudent.lsa_units || {}) : null;
    student.recorder_color = existingStudent ? existingStudent.recorder_color || null : null;
    student.good_news_shared = existingStudent ? (existingStudent.good_news_shared ? 1 : 0) : 0;
    student.is_active = student.is_active === 0 ? 0 : 1;
    student.id = Number(id);
    // SEND → 'db.updateStudent'
    await window.api.updateStudent(student);
  } else {
    student.lsa_units = null;
    student.recorder_color = null;
    student.good_news_shared = 0;
    student.is_active = 1;
    // SEND → 'db.addStudent'
    await window.api.addStudent(student);
  }

  closeStudentModal();
  studentSearchInput.value = '';
  await loadStudents(true);
  await loadLsaScoresForScope(true);
  await loadSeatingCharts(true);
  await loadRecorderSongDataForScope(true);
  if (activeSeatingChartId) {
    await persistActiveSeatingChart();
  }
  renderWorkspace();
});

studentSearchInput.addEventListener('input', () => renderWorkspace());

// --- Global Student Search (sidebar) — searches every student regardless of
// the currently active class, and jumps to whichever class they belong to.
const GLOBAL_STUDENT_SEARCH_RESULT_LIMIT = 20;

function getGlobalSearchMetaLabel(student) {
  if (student.graduated_year) return `Graduated ${student.graduated_year}`;
  return getTeacherLabel(student.teacher);
}

function closeGlobalStudentSearchResults() {
  globalStudentSearchResults.classList.add('hidden');
  globalStudentSearchResults.innerHTML = '';
}

function renderGlobalStudentSearchResults(query) {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    closeGlobalStudentSearchResults();
    return;
  }

  const matches = students
    .filter((student) => !student.isSample)
    .filter((student) => getDisplayName(student).toLowerCase().includes(trimmed))
    .sort(
      (a, b) => a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name)
    )
    .slice(0, GLOBAL_STUDENT_SEARCH_RESULT_LIMIT);

  globalStudentSearchResults.innerHTML = '';

  if (matches.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'global-student-search-empty';
    empty.textContent = 'No matching students';
    globalStudentSearchResults.appendChild(empty);
    globalStudentSearchResults.classList.remove('hidden');
    return;
  }

  matches.forEach((student) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'global-student-search-result-item';
    item.innerHTML = `
      <span class="global-student-search-result-name">${escHtml(getDisplayName(student))}</span>
      <span class="global-student-search-result-meta">${escHtml(getGlobalSearchMetaLabel(student))}</span>
    `;
    item.addEventListener('click', () => selectGlobalStudentSearchResult(student.id));
    globalStudentSearchResults.appendChild(item);
  });

  globalStudentSearchResults.classList.remove('hidden');
}

async function selectGlobalStudentSearchResult(studentId) {
  const student = students.find((entry) => entry.id === studentId);
  closeGlobalStudentSearchResults();
  globalStudentSearchInput.value = '';
  if (!student) return;

  const targetKey = getClassKeyForStudent(student);
  if (activeClassTeacher !== targetKey) {
    await selectClassTeacher(targetKey);
  }
  selectedStudentId = String(studentId);
  selectedStudentIds = new Set([String(studentId)]);
  renderWorkspace();
}

globalStudentSearchInput.addEventListener('input', () => {
  renderGlobalStudentSearchResults(globalStudentSearchInput.value);
});

document.addEventListener('click', (event) => {
  if (
    !globalStudentSearchResults.classList.contains('hidden') &&
    !event.target.closest('#global-student-search-wrap')
  ) {
    closeGlobalStudentSearchResults();
  }
});

globalStudentSearchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    closeGlobalStudentSearchResults();
    globalStudentSearchInput.blur();
  }
});

// Drop zone covers the full chart-shell so dragging works at any zoom level.
// Visual drag-over feedback is applied to chartCanvas (the styled inner element).

function applyChartPan() {
  const t = `translate(${chartPanX}px, ${chartPanY}px) scale(${chartZoom})`;
  chartCanvas.style.transform = chartPanX === 0 && chartPanY === 0 && chartZoom === 1 ? '' : t;
  const atDefault = chartPanX === 0 && chartPanY === 0 && Math.abs(chartZoom - 1) < 0.001;
  zoomResetBtn.classList.toggle('hidden', atDefault);
  zoomResetBtn.textContent = `${Math.round(chartZoom * 100)}%`;
}
chartShell.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'move';
  chartCanvas.classList.add('drag-over');
});
chartShell.addEventListener('dragleave', (event) => {
  if (!chartShell.contains(event.relatedTarget)) {
    chartCanvas.classList.remove('drag-over');
  }
});
chartShell.addEventListener('drop', (event) => {
  event.preventDefault();
  chartCanvas.classList.remove('drag-over');
  const studentId = event.dataTransfer.getData('text/plain');
  if (!studentId) return;
  Promise.resolve(handleChartDrop(studentId, event)).catch((error) => {
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

darkBgToggleBtn.addEventListener('click', () => {
  darkBgMode = !darkBgMode;
  localStorage.setItem('darkBgMode', darkBgMode);
  chartShell.classList.toggle('dark-bg', darkBgMode);
  darkBgToggleBtn.textContent = darkBgMode ? 'Light' : 'Dark';
});
// Initialize button label to match persisted state
darkBgToggleBtn.textContent = darkBgMode ? 'Light' : 'Dark';

(function setupChartPan() {
  const shell = chartCanvas.closest('.chart-shell') || chartCanvas.parentElement;
  if (!shell) return;

  // Prevent the browser context menu on right-click inside the chart area
  shell.addEventListener('contextmenu', (event) => event.preventDefault());

  // Scroll-wheel zoom (centered on cursor)
  shell.addEventListener(
    'wheel',
    (event) => {
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
    },
    { passive: false }
  );

  // Right-click drag (mouse)
  shell.addEventListener('mousedown', (event) => {
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
  shell.addEventListener(
    'touchstart',
    (event) => {
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
    },
    { passive: true }
  );

  shell.addEventListener(
    'touchmove',
    (event) => {
      if (!panTouches || event.touches.length !== 2) return;
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const cx = (event.touches[0].clientX + event.touches[1].clientX) / 2;
      const cy = (event.touches[0].clientY + event.touches[1].clientY) / 2;
      const shellRect = shell.getBoundingClientRect();
      const newZoom = Math.min(
        CHART_ZOOM_MAX,
        Math.max(CHART_ZOOM_MIN, (pinchStartZoom * dist) / pinchStartDist)
      );
      // Keep the pinch midpoint fixed in canvas-local space
      chartPanX =
        cx -
        shellRect.left -
        (panTouches.startCX - shellRect.left - panTouches.startPanX) * newZoom;
      chartPanY =
        cy - shellRect.top - (panTouches.startCY - shellRect.top - panTouches.startPanY) * newZoom;
      chartZoom = newZoom;
      applyChartPan();
    },
    { passive: true }
  );

  shell.addEventListener(
    'touchend',
    () => {
      panTouches = null;
      pinchStartDist = null;
    },
    { passive: true }
  );
  shell.addEventListener(
    'touchcancel',
    () => {
      panTouches = null;
      pinchStartDist = null;
    },
    { passive: true }
  );
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
  await loadAptitudeSettings();
  await loadSavedClassOrder();
  await loadStudents(true);
  await loadLsaScoresForScope(true);
  await loadSeatingCharts(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  await loadAssessmentLibraryForGrade(getActiveClassGrade());
  await loadPenNotesForScope(true);
  await loadRecorderSongLibrary();
  await loadRecorderSongDataForScope(true);
  await refreshImmaScoreCache();
  renderWorkspace();
}

async function loadSavedClassOrder() {
  try {
    const raw = await window.api.getSetting('class_order');
    const parsed = raw ? JSON.parse(raw) : [];
    savedClassOrder = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[class-order] load failed:', err);
    savedClassOrder = [];
  }
}

async function loadRecorderSongLibrary() {
  try {
    recorderSongLibrary = await window.api.getRecorderSongLibrary(
      currentAcademicYear || getDefaultAcademicYear()
    );
  } catch (err) {
    console.error('[renderer] failed to load recorder song library:', err);
    recorderSongLibrary = [];
  }
}

async function loadRecorderSongDataForScope(skipRender = false) {
  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  recorderSongCompletionsCache.clear();
  if (scopedStudents.length === 0) {
    if (!skipRender) renderWorkspace();
    return;
  }
  try {
    const rows = await window.api.getRecorderSongCompletions(
      scopedStudents.map((student) => student.id),
      currentAcademicYear || getDefaultAcademicYear()
    );
    rows.forEach((row) => {
      recorderSongCompletionsCache.set(`${row.student_id}:${row.slot_num}`, Boolean(row.completed));
    });
  } catch (err) {
    console.error('[renderer] failed to load recorder song completions:', err);
  }
  if (!skipRender) renderWorkspace();
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

  Array.from(lsaUnitPlaceholderPositions.keys()).forEach((key) => {
    if (key.startsWith(`${classKey}::unit-`)) {
      lsaUnitPlaceholderPositions.delete(key);
    }
  });

  rows.forEach((row) => {
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
  Array.from(lsaUnitPromptImages.keys()).forEach((key) => {
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
          gradeRows.forEach((row) => {
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
      rows.forEach((row) => {
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

/**
 * Fetches the full student roster from SQLite via IPC, then triggers a full workspace
 * re-render. Falls back to in-memory sample cards when the database is empty so the
 * UI is never blank on first launch.
 */
async function loadStudents(skipRender = false) {
  try {
    // SEND → 'db.getStudents'
    const storedStudents = await window.api.getStudents();
    usingSampleRoster = storedStudents.length === 0;
    students = usingSampleRoster ? fallbackStudents : storedStudents;
    students.forEach((student) => normalizeStudentLsaUnits(student));
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
    students.forEach((student) => normalizeStudentLsaUnits(student));
    activeClassTeacher = null;
    syncLayoutState();
    await loadAttendanceRecordsForScope(true);
    if (!skipRender) {
      renderWorkspace();
    }
  }
}

/**
 * Loads the seating chart list for the active class, then restores the previously
 * active chart. Decoupled from student load so charts can reload independently
 * (e.g. after rename or delete) without re-fetching the full student roster.
 */
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

  if (activeSeatingChartId && !seatingCharts.some((chart) => chart.id === activeSeatingChartId)) {
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

  // Assessment scores, dates, and descriptions are academic-year data. Do not
  // read the older chart-embedded values here: they have no year key.
  try {
    const classKey = getActiveClassKeyForCharts();
    const academicYear = currentAcademicYear || getDefaultAcademicYear();
    const scopedStudentIds = getStudentsInActiveScope()
      .filter((student) => !student.isSample)
      .map((student) => student.id);
    const [allRatings, allDates] = await Promise.all([
      window.api.getAssessmentRatings(scopedStudentIds, academicYear),
      window.api.getAssessmentDatesForClass(classKey, academicYear),
    ]);

    const ratingsByStudent = {};
    for (const row of allRatings) {
      const sid = String(row.student_id);
      if (!ratingsByStudent[sid]) ratingsByStudent[sid] = {};
      ratingsByStudent[sid][row.assess_num] = row.rating;
    }

    for (const studentId of scopedStudentIds) {
      const key = String(studentId);
      const layout = layoutState.get(key);
      if (layout) layout.assessmentRatings = ratingsByStudent[key] || {};
    }

    assessmentDates = {};
    for (const row of allDates) {
      assessmentDates[String(row.assess_num)] = row.assessed_date;
    }
  } catch (e) {
    assessmentDates = {};
    console.error('[assessment] year-scoped load failed:', e);
  }

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

  const itemMap = new Map(items.map((item) => [String(item.student_id), item]));

  students.forEach((student, index) => {
    const studentId = String(student.id);
    const item = itemMap.get(studentId);
    const fallbackLayout = createDefaultLayout(index);
    const layout = layoutState.get(studentId) || fallbackLayout;

    layout.placed = Boolean(item?.placed);
    layout.x = item?.x ?? fallbackLayout.x;
    layout.y = item?.y ?? fallbackLayout.y;
    layout.state = item?.state || 'ready';
    layout.attendance = getAttendanceStatusForDate(student.id, getTodayIsoDate());
    layout.assessmentRatings = item?.assessment_rating
      ? typeof item.assessment_rating === 'string'
        ? JSON.parse(item.assessment_rating)
        : item.assessment_rating
      : {};
    layout.color_dot = item?.color_dot ?? null;
    layoutState.set(studentId, layout);
  });

  // If the saved chart was a circle arrangement, recompute circle sizing and teacher position
  // so cards render at the correct compact size without requiring a manual neaten/arrange.
  if (arrangement === 'circle') {
    const placed = students.filter((s) => getStudentLayout(s.id).placed);
    if (placed.length > 0) {
      computeCircleSlots(placed, CANVAS_W, CANVAS_H);
    }
  }
}

function syncLayoutState() {
  const validIds = new Set(students.map((student) => String(student.id)));

  Array.from(layoutState.keys()).forEach((studentId) => {
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
    [chartCanvas, rosterList].forEach((container) => {
      container.querySelectorAll('.student-name-first').forEach((el) => {
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

function openAptitudeSettingsModal() {
  if (!aptitudeSettingsModal) return;
  if (aptitudeSettingsError) aptitudeSettingsError.textContent = '';

  for (const grade of APTITUDE_GRADES) {
    const row = aptitudeSettingsDb.get(grade) || {};
    aptitudeSettingsModal
      .querySelectorAll(`.aptitude-setting-input[data-grade="${grade}"]`)
      .forEach((input) => {
        const field = input.dataset.field;
        const value = row[field];
        input.value = value === null || value === undefined || value === '' ? '' : String(value);
      });
  }

  aptitudeSettingsModal.classList.remove('hidden');
}

function closeAptitudeSettingsModal() {
  aptitudeSettingsModal?.classList.add('hidden');
  if (aptitudeSettingsError) aptitudeSettingsError.textContent = '';
}

function readAptitudeSettingsModalRows() {
  const rows = [];

  for (const grade of APTITUDE_GRADES) {
    const getValue = (field) =>
      aptitudeSettingsModal
        ?.querySelector(`.aptitude-setting-input[data-grade="${grade}"][data-field="${field}"]`)
        ?.value.trim() || '';

    rows.push({
      grade_level: grade,
      tonal_low_max: getValue('tonal_low_max'),
      tonal_med_max: getValue('tonal_med_max'),
      rhythm_low_max: getValue('rhythm_low_max'),
      rhythm_med_max: getValue('rhythm_med_max'),
    });
  }

  return rows;
}

function validateAptitudeSettingsRows(rows) {
  for (const row of rows) {
    const pairs = [
      ['tonal_low_max', 'tonal_med_max', 'Tonal'],
      ['rhythm_low_max', 'rhythm_med_max', 'Rhythm'],
    ];

    for (const [lowField, medField, label] of pairs) {
      const lowValue = row[lowField];
      const medValue = row[medField];

      if (lowValue === '' && medValue === '') {
        continue;
      }

      if (lowValue === '' || medValue === '') {
        return `${label} settings for Grade ${row.grade_level} need both Low Max and Medium Max, or both left blank.`;
      }

      const lowNumber = Number(lowValue);
      const medNumber = Number(medValue);
      if (!Number.isInteger(lowNumber) || !Number.isInteger(medNumber)) {
        return `${label} settings for Grade ${row.grade_level} must be whole numbers.`;
      }
      if (lowNumber < 0 || lowNumber > 40 || medNumber < 0 || medNumber > 40) {
        return `${label} settings for Grade ${row.grade_level} must be between 0 and 40.`;
      }
      if (lowNumber >= medNumber) {
        return `${label} Low Max must be less than Medium Max for Grade ${row.grade_level}.`;
      }
    }
  }

  return '';
}

async function saveAptitudeSettingsFromModal() {
  const rows = readAptitudeSettingsModalRows().map((row) => ({
    grade_level: row.grade_level,
    tonal_low_max: row.tonal_low_max === '' ? null : Number(row.tonal_low_max),
    tonal_med_max: row.tonal_med_max === '' ? null : Number(row.tonal_med_max),
    rhythm_low_max: row.rhythm_low_max === '' ? null : Number(row.rhythm_low_max),
    rhythm_med_max: row.rhythm_med_max === '' ? null : Number(row.rhythm_med_max),
  }));

  const validationError = validateAptitudeSettingsRows(
    rows.map((row) => ({
      grade_level: row.grade_level,
      tonal_low_max: row.tonal_low_max === null ? '' : String(row.tonal_low_max),
      tonal_med_max: row.tonal_med_max === null ? '' : String(row.tonal_med_max),
      rhythm_low_max: row.rhythm_low_max === null ? '' : String(row.rhythm_low_max),
      rhythm_med_max: row.rhythm_med_max === null ? '' : String(row.rhythm_med_max),
    }))
  );

  if (validationError) {
    if (aptitudeSettingsError) aptitudeSettingsError.textContent = validationError;
    return;
  }

  try {
    await window.api.saveAptitudeSettings(rows);
    await loadAptitudeSettings();
    await refreshImmaScoreCache();
    closeAptitudeSettingsModal();
    renderWorkspace();
  } catch (error) {
    console.error('[aptitude] failed to save settings:', error);
    if (aptitudeSettingsError) aptitudeSettingsError.textContent = error.message || 'Save failed.';
  }
}

// ── Recorder Set Up modal ─────────────────────────────────────────────────────
// Lets the user name the songs tracked on the Recorders tab and pick a
// background color for each. Saving persists the slot list for the current
// academic year; the song columns and their colors on the Recorders grid are
// driven entirely by this library (shared across all 4th grade classes).
const RECORDER_SETUP_TRASH_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

function renderRecorderSetupColorOptions(selectedKey) {
  return RECORDER_SONG_COLOR_KEYS.map((key) => {
    const label = key.charAt(0).toUpperCase() + key.slice(1);
    return `<option value="${escHtml(key)}"${key === selectedKey ? ' selected' : ''}>${escHtml(label)}</option>`;
  }).join('');
}

function renderRecorderSetupRows() {
  if (!recorderSetupRowsBody) return;
  recorderSetupRowsBody.innerHTML = recorderSetupDraftRows
    .map(
      (row, index) => `
      <tr data-slot-num="${row.slot_num}">
        <td>${index + 1}</td>
        <td>
          <input
            class="recorder-song-name-input"
            type="text"
            maxlength="60"
            value="${escHtml(row.name || '')}"
            placeholder="Song name"
          />
        </td>
        <td>
          <select class="recorder-song-color-select" style="background:${RECORDER_SONG_COLOR_PALETTE[row.color_key] || '#fff'};">
            ${renderRecorderSetupColorOptions(row.color_key)}
          </select>
        </td>
        <td>
          <button type="button" class="recorder-setup-row-delete" title="Remove song" aria-label="Remove song">${RECORDER_SETUP_TRASH_ICON}</button>
        </td>
      </tr>
    `
    )
    .join('');

  recorderSetupRowsBody.querySelectorAll('tr').forEach((tr) => {
    const slotNum = Number(tr.dataset.slotNum);
    const row = recorderSetupDraftRows.find((r) => r.slot_num === slotNum);
    if (!row) return;

    tr.querySelector('.recorder-song-name-input').addEventListener('input', (event) => {
      row.name = event.target.value;
    });
    tr.querySelector('.recorder-song-color-select').addEventListener('change', (event) => {
      row.color_key = event.target.value;
      event.target.style.background = RECORDER_SONG_COLOR_PALETTE[row.color_key] || '#fff';
    });
    tr.querySelector('.recorder-setup-row-delete').addEventListener('click', () => {
      recorderSetupDraftRows = recorderSetupDraftRows.filter((r) => r.slot_num !== slotNum);
      renderRecorderSetupRows();
    });
  });
}

function addRecorderSetupDraftRow() {
  const nextSlot = recorderSetupDraftRows.reduce((max, row) => Math.max(max, row.slot_num), 0) + 1;
  const usedColors = new Set(recorderSetupDraftRows.map((row) => row.color_key));
  const nextColor =
    RECORDER_SONG_COLOR_KEYS.find((key) => !usedColors.has(key)) || RECORDER_SONG_COLOR_KEYS[0];
  recorderSetupDraftRows.push({ slot_num: nextSlot, name: '', color_key: nextColor });
  renderRecorderSetupRows();
}

async function openRecorderSetupModal() {
  if (!recorderSetupModal) return;
  if (recorderSetupError) recorderSetupError.textContent = '';
  await loadRecorderSongLibrary();
  recorderSetupDraftRows = recorderSongLibrary.map((row) => ({
    slot_num: row.slot_num,
    name: row.name || '',
    color_key: row.color_key || RECORDER_SONG_COLOR_KEYS[0],
  }));
  renderRecorderSetupRows();
  recorderSetupModal.classList.remove('hidden');
}

function closeRecorderSetupModal() {
  recorderSetupModal?.classList.add('hidden');
  if (recorderSetupError) recorderSetupError.textContent = '';
}

async function saveRecorderSetupFromModal() {
  const academicYear = currentAcademicYear || getDefaultAcademicYear();
  const keptSlots = new Set(recorderSetupDraftRows.map((row) => row.slot_num));
  const removedSlots = recorderSongLibrary
    .map((row) => row.slot_num)
    .filter((slotNum) => !keptSlots.has(slotNum));

  try {
    for (const row of recorderSetupDraftRows) {
      await window.api.upsertRecorderSongLibraryItem(
        academicYear,
        row.slot_num,
        row.name,
        row.color_key
      );
    }
    for (const slotNum of removedSlots) {
      await window.api.deleteRecorderSongLibraryItem(academicYear, slotNum);
    }
    await loadRecorderSongLibrary();
    await loadRecorderSongDataForScope(true);
    closeRecorderSetupModal();
    renderWorkspace();
  } catch (error) {
    console.error('[recorder-setup] failed to save song library:', error);
    if (recorderSetupError) recorderSetupError.textContent = error.message || 'Save failed.';
  }
}

async function refreshAllWorkspaceData() {
  await loadAptitudeSettings();
  await loadStudents(true);
  await loadLsaScoresForScope(true);
  await loadSeatingCharts(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  await loadPenNotesForScope(true);
  await loadRecorderSongLibrary();
  await loadRecorderSongDataForScope(true);
  await refreshImmaScoreCache();
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

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    return false;
  }

  return scopedStudents.every((student) => normalizeGrade(student.grade) === '4');
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

  let classLabel;
  if (usingSampleRoster) {
    classLabel = 'Sample Roster';
  } else if (activeClassTeacher === null) {
    classLabel = 'All Classes';
  } else {
    const { teacher, grade } = parseClassKey(activeClassTeacher);
    const name = getTeacherLabel(teacher);
    classLabel = grade ? `${name} (${grade})` : name;
  }

  gradebookClassSubtitle.textContent = `Class: ${classLabel}`;
}

// Shrinks an element's font-size so its text fits on a single line within
// the element's current width. It first clears any inline font-size to
// compute the CSS base size, then binary-searches down to a minimum.
function fitTextToSingleLine(el, minFontPx = 12) {
  if (!el) return;

  // Ensure single-line behavior
  el.style.whiteSpace = 'nowrap';

  // Temporarily clear inline font-size to get the computed base size
  el.style.fontSize = '';
  const computed = window.getComputedStyle(el);
  const base = parseFloat(computed.fontSize) || minFontPx;

  // Determine available width by measuring parent and sibling widths.
  const parent = el.parentElement;
  let available = el.clientWidth || 0;
  let prevParentWrap = null;
  if (parent) {
    const parentStyle = window.getComputedStyle(parent);
    prevParentWrap = parent.style.flexWrap;
    // Temporarily prevent wrapping so siblings measure as if on one row.
    parent.style.flexWrap = 'nowrap';

    const siblings = Array.from(parent.children).filter((c) => c !== el);
    const gap = parseFloat(parentStyle.gap) || 0;
    let siblingsWidth = 0;
    siblings.forEach((s) => {
      const r = s.getBoundingClientRect();
      siblingsWidth += r.width;
    });
    const gapTotal = siblings.length > 0 ? gap * siblings.length : 0;
    available = Math.max(0, parent.clientWidth - siblingsWidth - gapTotal - 6);
  }

  // Start from base size
  el.style.fontSize = `${base}px`;

  // Quick exit if it already fits within the available width
  if (el.scrollWidth <= available + 1) {
    if (parent && prevParentWrap !== null) parent.style.flexWrap = prevParentWrap;
    return;
  }

  // Binary search for the largest size that fits into available
  let low = minFontPx;
  let high = base;
  while (high - low > 0.5) {
    const mid = (low + high) / 2;
    el.style.fontSize = `${mid}px`;
    if (el.scrollWidth <= available + 1) {
      low = mid;
    } else {
      high = mid;
    }
  }
  el.style.fontSize = `${Math.max(minFontPx, Math.floor(low))}px`;
  if (parent && prevParentWrap !== null) parent.style.flexWrap = prevParentWrap;
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

  scopedStudents.forEach((student) => {
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
      // SEND → 'db.upsertAttendanceRecord'
      await window.api.upsertAttendanceRecord(studentId, isoDate, nextStatus);
    } else {
      // SEND → 'db.deleteAttendanceRecord' (null status means the record should not exist)
      await window.api.deleteAttendanceRecord(studentId, isoDate);
    }
  } catch (error) {
    console.error('[renderer] failed to update attendance by date:', error);
  }
}

function syncTodayAttendanceToLayout() {
  const today = getTodayIsoDate();
  students.forEach((student) => {
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

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    attendanceByDateByStudent = new Map();
    syncTodayAttendanceToLayout();
    if (!skipRender) {
      renderWorkspace();
    }
    return;
  }

  // SEND → 'db.getAttendanceRecords' — fetches all date/status pairs for the visible class;
  // the full history is loaded so gradebook and attendance mode both render correctly.
  const records = await window.api.getAttendanceRecords(
    scopedStudents.map((student) => student.id)
  );
  // Attendance dates aren't year-scoped in the DB (they're raw calendar dates),
  // so old academic years' records must be filtered out here to keep last
  // year's attendance from bleeding into the current year's view.
  const range = getAcademicYearDateRange(currentAcademicYear || getDefaultAcademicYear());
  const scopedRecords = range
    ? records.filter(
        (record) => record.attendance_date >= range.start && record.attendance_date <= range.end
      )
    : records;
  const nextMap = new Map();
  scopedRecords.forEach((record) => {
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

async function loadPenNotesForScope(skipRender = false) {
  const scopedStudents = getStudentsInActiveScope().filter((s) => !s.isSample);
  penNotesCache.clear();
  if (scopedStudents.length === 0) {
    if (!skipRender) renderWorkspace();
    return;
  }
  try {
    const rows = await window.api.getPenNotesForStudentsYear(
      scopedStudents.map((s) => s.id),
      currentAcademicYear || getDefaultAcademicYear()
    );
    rows.forEach((row) => {
      if (row.note_data) {
        penNotesCache.set(`${row.student_id}|${row.unit_number}|${row.column_type}`, row.note_data);
      }
    });
  } catch (err) {
    console.error('[renderer] failed to load pen notes:', err);
  }
  if (!skipRender) renderWorkspace();
}

async function loadLsaScoresForScope(skipRender = false) {
  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  scopedStudents.forEach((student) => {
    student.lsa_units = {};
    student.lsa_easy = null;
    student.lsa_medium = null;
    student.lsa_difficult = null;
  });
  if (scopedStudents.length === 0) {
    if (!skipRender) renderWorkspace();
    return;
  }
  try {
    const rows = await window.api.getLsaScores(
      scopedStudents.map((student) => student.id),
      currentAcademicYear || getDefaultAcademicYear()
    );
    const studentsById = new Map(scopedStudents.map((student) => [String(student.id), student]));
    rows.forEach((row) => {
      const student = studentsById.get(String(row.student_id));
      if (!student) return;
      const unitKey = String(row.unit_number);
      student.lsa_units[unitKey] = {
        easy: row.easy || null,
        medium: row.medium || null,
        difficult: row.difficult || null,
      };
      if (row.unit_number === 1) {
        student.lsa_easy = row.easy || null;
        student.lsa_medium = row.medium || null;
        student.lsa_difficult = row.difficult || null;
      }
    });
  } catch (err) {
    console.error('[renderer] failed to load LSA scores:', err);
  }
  if (!skipRender) renderWorkspace();
}

function getPenNote(studentId, unitNumber, columnType) {
  return penNotesCache.get(`${studentId}|${unitNumber}|${columnType}`) || null;
}

// ---- Pen Note Popup ----

function openPenNotePopup(studentId, unitNumber, activity, anchorEl, fallbackRect) {
  _penNoteStudentId = studentId;
  _penNoteUnit = unitNumber;
  _penNoteActivity = activity;

  // Populate canvas with existing note or blank
  const ctx = penNoteCanvas.getContext('2d');
  ctx.clearRect(0, 0, penNoteCanvas.width, penNoteCanvas.height);
  const existing = getPenNote(studentId, unitNumber, activity);
  if (existing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = existing;
  }

  // Position popup near anchorEl or fallbackRect
  penNotePopup.classList.remove('hidden');
  const popupW = 254; // canvas 240 + padding
  const popupH = 130;
  let rect = anchorEl ? anchorEl.getBoundingClientRect() : fallbackRect;
  if (!rect) rect = { right: 200, top: 100, left: 160, bottom: 120 };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.right + 6;
  let top = rect.top;
  if (left + popupW > vw - 8) left = rect.left - popupW - 6;
  if (left < 8) left = 8;
  if (top + popupH > vh - 8) top = vh - popupH - 8;
  if (top < 8) top = 8;
  penNotePopup.style.left = `${left}px`;
  penNotePopup.style.top = `${top}px`;
}

function closePenNotePopup() {
  penNotePopup.classList.add('hidden');
  _penNoteStudentId = null;
  _penNoteUnit = null;
  _penNoteActivity = null;
}

async function savePenNoteFromPopup() {
  if (_penNoteStudentId === null) return;
  const ctx = penNoteCanvas.getContext('2d');
  // Check if canvas has actual content (not all transparent)
  const imageData = ctx.getImageData(0, 0, penNoteCanvas.width, penNoteCanvas.height);
  const hasContent = imageData.data.some((v, i) => i % 4 === 3 && v > 0);
  const noteData = hasContent ? penNoteCanvas.toDataURL('image/png') : null;
  const key = `${_penNoteStudentId}|${_penNoteUnit}|${_penNoteActivity}`;
  if (noteData) {
    penNotesCache.set(key, noteData);
  } else {
    penNotesCache.delete(key);
  }
  try {
    await window.api.savePenNoteYear(
      _penNoteStudentId,
      _penNoteUnit,
      _penNoteActivity,
      noteData,
      currentAcademicYear || getDefaultAcademicYear()
    );
  } catch (err) {
    console.error('[renderer] failed to save pen note:', err);
  }
  closePenNotePopup();
  renderWorkspace();
}

// Pen note canvas drawing setup
(function setupPenNoteCanvas() {
  const ctx = penNoteCanvas.getContext('2d');
  ctx.strokeStyle = '#1a1a2e';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  penNoteCanvas.addEventListener('pointerdown', (e) => {
    if (_penNoteStudentId === null) return;
    _penNoteDrawing = true;
    penNoteCanvas.setPointerCapture(e.pointerId);
    const { x, y } = getCanvasPos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    // Vary line width by pressure for stylus
    ctx.lineWidth = e.pointerType === 'pen' ? Math.max(1, e.pressure * 4) : 2;
  });

  penNoteCanvas.addEventListener('pointermove', (e) => {
    if (!_penNoteDrawing) return;
    const { x, y } = getCanvasPos(e);
    ctx.lineWidth = e.pointerType === 'pen' ? Math.max(1, e.pressure * 4) : 2;
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
  });

  penNoteCanvas.addEventListener('pointerup', () => {
    _penNoteDrawing = false;
  });
  penNoteCanvas.addEventListener('pointercancel', () => {
    _penNoteDrawing = false;
  });

  function getCanvasPos(e) {
    const rect = penNoteCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (penNoteCanvas.width / rect.width),
      y: (e.clientY - rect.top) * (penNoteCanvas.height / rect.height),
    };
  }
})();

penNoteClearBtn.addEventListener('click', () => {
  const ctx = penNoteCanvas.getContext('2d');
  ctx.clearRect(0, 0, penNoteCanvas.width, penNoteCanvas.height);
});

penNoteDoneBtn.addEventListener('click', savePenNoteFromPopup);
penNoteCancelBtn.addEventListener('click', closePenNotePopup);

// Close popup when clicking outside it
document.addEventListener(
  'pointerdown',
  (e) => {
    if (!penNotePopup.classList.contains('hidden') && !penNotePopup.contains(e.target)) {
      closePenNotePopup();
    }
  },
  true
);

// ── Attendance date editor ─────────────────────────────────────────────────
let _attDateEditTarget = null;

const _attDateInput = document.getElementById('att-date-edit-input');

function openAttDateEditPopup(dateKey, thEl) {
  if (!_attDateInput) return;
  _attDateEditTarget = dateKey;
  _attDateInput.value = dateKey;
  // Position the hidden input under the header so the calendar appears nearby.
  // Must set position first, then defer showPicker() so the browser has one
  // frame to apply the style — otherwise the picker opens at the stale position
  // on the very first click (position:fixed defaults to 0,0).
  const rect = thEl.getBoundingClientRect();
  _attDateInput.style.top = `${rect.bottom}px`;
  _attDateInput.style.left = `${rect.left}px`;
  requestAnimationFrame(() => _attDateInput.showPicker());
}

// Save when a new date is chosen
_attDateInput.addEventListener('change', async () => {
  const newDate = _attDateInput.value;
  const oldDate = _attDateEditTarget;
  _attDateEditTarget = null;
  if (!newDate || !oldDate || newDate === oldDate) return;
  try {
    await window.api.renameAttendanceDate(oldDate, newDate);
    attendanceByDateByStudent.forEach((studentMap) => {
      if (studentMap.has(oldDate)) {
        const status = studentMap.get(oldDate);
        studentMap.delete(oldDate);
        studentMap.set(newDate, status);
      }
    });
    renderAttendanceGrid();
  } catch (err) {
    console.error('[renderer] failed to rename attendance date:', err);
  }
});

// ── Assessment date editor ─────────────────────────────────────────────────
let _assessDateEditTarget = null;
const _assessDateInput = document.getElementById('assess-date-edit-input');

function openAssessDateEditPopup(assessNum, spanEl) {
  if (!_assessDateInput) return;
  _assessDateEditTarget = assessNum;
  _assessDateInput.value = assessmentDates[String(assessNum)] || '';
  const rect = spanEl.getBoundingClientRect();
  _assessDateInput.style.top = `${rect.bottom}px`;
  _assessDateInput.style.left = `${rect.left}px`;
  requestAnimationFrame(() => _assessDateInput.showPicker());
}

_assessDateInput &&
  _assessDateInput.addEventListener('change', async () => {
    const date = _assessDateInput.value;
    const assessNum = _assessDateEditTarget;
    _assessDateEditTarget = null;
    if (!assessNum || !activeSeatingChartId) return;
    assessmentDates[String(assessNum)] = date || undefined;
    try {
      await window.api.setAssessmentDateForClass(
        getActiveClassKeyForCharts(),
        currentAcademicYear || getDefaultAcademicYear(),
        assessNum,
        date || null
      );
    } catch (e) {
      console.error('[assessment-dates] save failed:', e);
    }
    // Re-render whichever gradebook tab is visible to update the span label
    renderAssessmentGrid();
    renderRhythmGrid();
    renderMovementGrid();
  });

function renderAttendanceGrid() {
  if (!attendanceCanvas) {
    return;
  }

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    attendanceCanvas.style.setProperty('--att-col0-width', '52px');
    attendanceCanvas.style.setProperty('--att-col1-width', '132px');
    attendanceCanvas.style.setProperty('--att-col2-width', '132px');
    attendanceCanvas.innerHTML =
      '<div class="attendance-empty">Select a class with students to view attendance history.</div>';
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  attendanceCanvas.style.setProperty('--att-col0-width', '52px');
  attendanceCanvas.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  attendanceCanvas.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);

  const dateSet = new Set([getTodayIsoDate()]);
  scopedStudents.forEach((student) => {
    const studentMap = attendanceByDateByStudent.get(String(student.id));
    if (!studentMap) return;
    Array.from(studentMap.keys()).forEach((dateKey) => dateSet.add(dateKey));
  });

  const dateColumns = Array.from(dateSet).sort((a, b) => a.localeCompare(b));
  const headerCells = dateColumns
    .map((dateKey) => {
      const isDisabled = activeClassTeacher === null;
      const cls = 'att-date-header' + (isDisabled ? ' att-date-header-disabled' : '');
      const title = isDisabled
        ? 'Date editing disabled in All Classes view'
        : 'Click to change date';
      return `<th class="${cls}" data-date-key="${escHtml(dateKey)}"${isDisabled ? ' tabindex="-1"' : ''} title="${escHtml(title)}">${escHtml(formatDateHeader(dateKey))}</th>`;
    })
    .join('');

  const rows = [...scopedStudents]
    .sort((a, b) => {
      const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
      if (last !== 0) return last;
      return String(a.first_name || '').localeCompare(String(b.first_name || ''));
    })
    .map((student, index) => {
      const dateCells = dateColumns
        .map((dateKey) => {
          const status = getAttendanceStatusForDate(student.id, dateKey);
          const label =
            status === 'present'
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

  attendanceCanvas.querySelectorAll('.attendance-editable').forEach((cell) => {
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

  if (activeClassTeacher !== null) {
    attendanceCanvas.querySelectorAll('.att-date-header').forEach((th) => {
      th.addEventListener('click', () => openAttDateEditPopup(th.dataset.dateKey, th));
    });
  }
}

function renderLsaGrid() {
  if (!lsaGridCanvas) {
    return;
  }

  const canEdit = lsaMode;

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    lsaGridCanvas.style.setProperty('--att-col0-width', '52px');
    lsaGridCanvas.style.setProperty('--att-col1-width', '132px');
    lsaGridCanvas.style.setProperty('--att-col2-width', '132px');
    lsaGridCanvas.innerHTML =
      '<div class="attendance-empty">Select a class with students to view LSA records.</div>';
    return;
  }

  // Determine which (unit, activity) pairs have any pen notes
  const activities = ['easy', 'medium', 'difficult'];
  const noteColSet = new Set(); // keys like "3|medium"
  scopedStudents.forEach((student) => {
    for (let u = 1; u <= totalLsaUnits; u++) {
      activities.forEach((act) => {
        if (getPenNote(student.id, u, act)) noteColSet.add(`${u}|${act}`);
      });
    }
  });

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  const aptitudeColWidth = 28;
  const lsaValueColumnWidth = 34;
  const noteColWidth = 46;
  const aptitudeYear = currentAcademicYear || getDefaultAcademicYear();

  // Count extra note columns per unit
  const noteColsPerUnit = Array.from({ length: totalLsaUnits }, (_, i) => {
    const u = i + 1;
    return activities.filter((act) => noteColSet.has(`${u}|${act}`)).length;
  });

  const lsaTableWidth =
    52 +
    nameColumnWidths.first +
    nameColumnWidths.last +
    aptitudeColWidth * 2 +
    totalLsaUnits * 3 * lsaValueColumnWidth +
    noteColsPerUnit.reduce((s, c) => s + c, 0) * noteColWidth;

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

  const sortedStudents = [...scopedStudents].sort((a, b) => {
    const last = String(a.last_name || '').localeCompare(String(b.last_name || ''));
    if (last !== 0) return last;
    return String(a.first_name || '').localeCompare(String(b.first_name || ''));
  });

  const rows = sortedStudents
    .map((student, index) => {
      const unitCells = Array.from({ length: totalLsaUnits }, (_, unitOffset) => {
        const unitNumber = unitOffset + 1;
        const cells = activities
          .map((activity, aIdx) => {
            const isLastActivity = aIdx === activities.length - 1;
            const score = getStudentUnitScore(student, unitNumber, activity);
            const isEditable = canEdit && unitNumber === activeLsaUnit;
            const hasNoteCol = noteColSet.has(`${unitNumber}|${activity}`);
            const scoreIsGroupEnd = isLastActivity && !hasNoteCol ? ' lsa-group-end' : '';
            const scoreCell = `<td class="attendance-cell lsa-cell ${isEditable ? 'lsa-editable' : 'readonly'}${scoreClass(score)}${scoreIsGroupEnd}" data-student-id="${escHtml(String(student.id))}" data-lsa-unit="${unitNumber}" data-lsa-activity="${activity}" title="${isEditable ? 'Click to cycle: Empty → │ → + → Clear' : 'Select this unit in Show Units to edit'}">${scoreMarkup(score)}</td>`;
            if (hasNoteCol) {
              const noteData = getPenNote(student.id, unitNumber, activity);
              const noteIsGroupEnd = isLastActivity ? ' lsa-group-end' : '';
              const noteCell = noteData
                ? `<td class="pen-note-cell${noteIsGroupEnd}"><img src="${noteData}" alt="note"></td>`
                : `<td class="pen-note-cell${noteIsGroupEnd}"></td>`;
              return scoreCell + noteCell;
            }
            return scoreCell;
          })
          .join('');
        return cells;
      }).join('');
      const aptitudeScore = getCachedImmaScore(student.id, aptitudeYear) || {};
      const tonalAptitudeClass = getAptitudeClassName(
        student.grade,
        aptitudeScore.tonal,
        'tonal',
        'cell'
      );
      const rhythmAptitudeClass = getAptitudeClassName(
        student.grade,
        aptitudeScore.rhythm,
        'rhythm',
        'cell'
      );

      return `
      <tr>
        <td>${index + 1}</td>
        <td>${escHtml(student.first_name || '')}</td>
        <td>${escHtml(student.last_name || '')}</td>
        <td class="attendance-cell lsa-cell lsa-aptitude-cell ${tonalAptitudeClass}"></td>
        <td class="attendance-cell lsa-cell lsa-aptitude-cell ${rhythmAptitudeClass}"></td>
        ${unitCells}
      </tr>
    `;
    })
    .join('');

  const classKey = getActiveClassKeyForCharts();

  // Build group header row — colspan varies per unit depending on note columns
  const lsaGroupHeaders = Array.from({ length: totalLsaUnits }, (_, i) => {
    const unitNumber = i + 1;
    const unitKey = `${classKey}::unit-${unitNumber}`;
    const rawFileName = lsaUnitLessonFileNames.get(unitKey) || '';
    const label = rawFileName ? rawFileName.replace(/\.[^/.]+$/, '') : `LSA ${unitNumber}`;
    const colspan = 3 + noteColsPerUnit[i];
    return `<th colspan="${colspan}" class="lsa-group-end">${escHtml(label)}</th>`;
  }).join('');

  // Build sub-header row — E/M/D with optional ✏ columns interleaved
  const lsaSubHeaders = Array.from({ length: totalLsaUnits }, (_, i) => {
    const unitNumber = i + 1;
    return activities
      .map((act, aIdx) => {
        const actLabel = act === 'easy' ? 'E' : act === 'medium' ? 'M' : 'D';
        const isLastActivity = aIdx === activities.length - 1;
        const hasNoteCol = noteColSet.has(`${unitNumber}|${act}`);
        const scoreGroupEnd = isLastActivity && !hasNoteCol ? ' lsa-group-end' : '';
        const noteHeader = hasNoteCol
          ? `<th class="pen-note-th${isLastActivity ? ' lsa-group-end' : ''}">&#9998;</th>`
          : '';
        return `<th${scoreGroupEnd ? ` class="${scoreGroupEnd.trim()}"` : ''}>${actLabel}</th>${noteHeader}`;
      })
      .join('');
  }).join('');

  // Build colgroup
  const fixedCols = `
    <col style="width:var(--att-col0-width, 52px); min-width:var(--att-col0-width, 52px); max-width:var(--att-col0-width, 52px);">
    <col style="width:var(--att-col1-width, 132px); min-width:var(--att-col1-width, 132px); max-width:var(--att-col1-width, 132px);">
    <col style="width:var(--att-col2-width, 132px); min-width:var(--att-col2-width, 132px); max-width:var(--att-col2-width, 132px);">
    <col style="width:${aptitudeColWidth}px; min-width:${aptitudeColWidth}px; max-width:${aptitudeColWidth}px;">
    <col style="width:${aptitudeColWidth}px; min-width:${aptitudeColWidth}px; max-width:${aptitudeColWidth}px;">
  `;
  const valueCols = Array.from({ length: totalLsaUnits }, (_, i) => {
    const unitNumber = i + 1;
    return activities
      .map((act) => {
        const mainCol = `<col style="width:${lsaValueColumnWidth}px; min-width:${lsaValueColumnWidth}px; max-width:${lsaValueColumnWidth}px;">`;
        const noteCol = noteColSet.has(`${unitNumber}|${act}`)
          ? `<col style="width:${noteColWidth}px; min-width:${noteColWidth}px; max-width:${noteColWidth}px;">`
          : '';
        return mainCol + noteCol;
      })
      .join('');
  }).join('');

  lsaGridCanvas.innerHTML = `
    <table class="attendance-grid lsa-grid" style="width:${lsaTableWidth}px; min-width:${lsaTableWidth}px; max-width:${lsaTableWidth}px;">
      <colgroup>
        ${fixedCols}
        ${valueCols}
      </colgroup>
      <thead>
        <tr>
          <th rowspan="2"></th>
          <th rowspan="2">First</th>
          <th rowspan="2">Last</th>
          <th rowspan="2" title="Tonal Aptitude">T</th>
          <th rowspan="2" title="Rhythm Aptitude">R</th>
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

  lsaGridCanvas.querySelectorAll('.lsa-editable').forEach((cell) => {
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

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    canvasEl.style.setProperty('--att-col0-width', '52px');
    canvasEl.style.setProperty('--att-col1-width', '132px');
    canvasEl.style.setProperty('--att-col2-width', '132px');
    canvasEl.innerHTML = `<div class="attendance-empty">${escHtml(emptyMsg)}</div>`;
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  const ratingColWidth = 60;
  const tableWidth =
    52 + nameColumnWidths.first + nameColumnWidths.last + assessNums.length * ratingColWidth;

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
      const cells = assessNums
        .map((n) => {
          const r = ratings[n] ?? null;
          const cls = r ? ` ${getRatingClass(r)}` : '';
          return `<td class="attendance-cell assess-grid-cell assess-grid-editable${cls}" data-student-id="${escHtml(String(student.id))}" data-assess-num="${n}" title="Click to cycle: Empty \u2192 1 \u2192 2 \u2192 3 \u2192 4 \u2192 Clear">${r ? escHtml(ratingLabel[r]) : ''}</td>`;
        })
        .join('');
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

  const ratingCols = assessNums
    .map(
      () =>
        `<col style="width:${ratingColWidth}px; min-width:${ratingColWidth}px; max-width:${ratingColWidth}px;">`
    )
    .join('');

  const headerCells = assessNums
    .map((n) => {
      const { base, subtitle } = getAssessmentLabelParts(n);
      const subSpan = subtitle ? `<span class="assess-th-sub">${escHtml(subtitle)}</span>` : '';
      const dateVal = assessmentDates[String(n)] || '';
      const dateLabel = dateVal ? dateVal.slice(5) : '── ──';
      return `<th title="${escHtml(getAssessmentLabel(n))}">
      <span class="assess-th-base">${escHtml(base)}</span>${subSpan}
      <span class="assess-date-input" data-assess-num="${n}" title="Click to set date for ${escHtml(base)}">${escHtml(dateLabel)}</span>
    </th>`;
    })
    .join('');

  const savedScrollLeft = canvasEl.scrollLeft;
  const savedScrollTop = canvasEl.scrollTop;
  canvasEl.innerHTML = `
    <table class="attendance-grid assessment-grid" style="width:${tableWidth}px; min-width:${tableWidth}px; max-width:${tableWidth}px;">
      <colgroup>
        <col style="width:var(--att-col0-width, 52px); min-width:var(--att-col0-width, 52px); max-width:var(--att-col0-width, 52px);">
        <col style="width:var(--att-col1-width, 132px); min-width:var(--att-col1-width, 132px); max-width:var(--att-col1-width, 132px);">
        <col style="width:var(--att-col0-width, 52px); min-width:var(--att-col0-width, 52px); max-width:var(--att-col0-width, 52px);">
        <col style="width:var(--att-col1-width, 132px); min-width:var(--att-col1-width, 132px); max-width:var(--att-col1-width, 132px);">
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

  canvasEl.querySelectorAll('.assess-grid-editable').forEach((cell) => {
    cell.addEventListener('click', async () => {
      const studentId = Number(cell.dataset.studentId);
      const assessNum = Number(cell.dataset.assessNum);
      if (!studentId || !assessNum) return;
      await cycleAssessmentRating(studentId, assessNum);
    });
  });

  canvasEl.querySelectorAll('.assess-date-input').forEach((span) => {
    span.addEventListener('click', (e) => {
      openAssessDateEditPopup(Number(span.dataset.assessNum), span);
      e.stopPropagation();
    });
  });
}

function renderAssessmentGrid() {
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  renderAssessGroupGrid(
    getAssessNumsForCategory('tonal', gradeMap),
    assessmentGridCanvas,
    'Select a class with students to view tonal assessment records.'
  );
}

function renderRhythmGrid() {
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  renderAssessGroupGrid(
    getAssessNumsForCategory('rhythm', gradeMap),
    rhythmGridCanvas,
    'Select a class with students to view rhythm assessment records.'
  );
}

function renderMovementGrid() {
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  renderAssessGroupGrid(
    getAssessNumsForCategory('movement', gradeMap),
    movementGridCanvas,
    'Select a class with students to view movement assessment records.'
  );
}

function renderInstrumentGrid() {
  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  renderAssessGroupGrid(
    getAssessNumsForCategory('instrument', gradeMap),
    instrumentGridCanvas,
    'Select a class with students to view instrument assessment records.'
  );
}

async function cycleAssessmentRating(studentId, assessNum) {
  const layout = getStudentLayout(studentId);
  if (!layout) return;
  if (!layout.assessmentRatings) layout.assessmentRatings = {};
  const current = layout.assessmentRatings[assessNum] ?? null;
  const next = current === null ? 1 : current === 4 ? null : current + 1;
  layout.assessmentRatings[assessNum] = next;

  // Auto-set today's date the first time a score is recorded for this column
  const key = String(assessNum);
  if (next !== null && !assessmentDates[key] && activeSeatingChartId) {
    const today = new Date().toISOString().slice(0, 10);
    assessmentDates[key] = today;
    try {
      await window.api.setAssessmentDateForClass(
        getActiveClassKeyForCharts(),
        currentAcademicYear || getDefaultAcademicYear(),
        assessNum,
        today
      );
    } catch (e) {
      console.error('[assessment-dates] auto-set failed:', e);
    }
  }

  renderWorkspace();
  try {
    await window.api.upsertAssessmentRating(
      studentId,
      currentAcademicYear || getDefaultAcademicYear(),
      assessNum,
      next
    );
  } catch (e) {
    console.error('[assessment] year-scoped rating save failed:', e);
  }
  await persistActiveSeatingChart();
}

function renderRecordersGrid() {
  if (!recordersGridCanvas) {
    return;
  }

  const scopedStudents = getStudentsInActiveScope().filter((student) => !student.isSample);
  if (scopedStudents.length === 0) {
    recordersGridCanvas.style.setProperty('--att-col0-width', '52px');
    recordersGridCanvas.style.setProperty('--att-col1-width', '132px');
    recordersGridCanvas.style.setProperty('--att-col2-width', '132px');
    recordersGridCanvas.innerHTML =
      '<div class="attendance-empty">Select a 4th grade class to use the Recorders grid.</div>';
    return;
  }

  const nameColumnWidths = getAttendanceNameColumnWidths(scopedStudents);
  recordersGridCanvas.style.setProperty('--att-col0-width', '52px');
  recordersGridCanvas.style.setProperty('--att-col1-width', `${nameColumnWidths.first}px`);
  recordersGridCanvas.style.setProperty('--att-col2-width', `${nameColumnWidths.last}px`);

  const songColumns = [...recorderSongLibrary].sort((a, b) => a.slot_num - b.slot_num);

  const songHeaderCells = songColumns
    .map((song) => {
      const bg = RECORDER_SONG_COLOR_PALETTE[song.color_key] || '';
      const style = bg ? ` style="background:${bg};"` : '';
      const label = song.name ? escHtml(song.name) : `Song ${song.slot_num}`;
      return `<th class="recorder-song-header-cell"${style}>${label}</th>`;
    })
    .join('');

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
      const options = [
        '<option value="">Select</option>',
        ...recorderColorOptions.map((color) => {
          const bg = recorderColorLightBackgrounds[color] || '';
          const style = bg ? ` style="background:${bg};"` : '';
          return `<option value="${escHtml(color)}"${selectedColor === color ? ' selected' : ''}${style}>${escHtml(color)}</option>`;
        }),
      ].join('');

      const songCells = songColumns
        .map((song) => {
          const bg = RECORDER_SONG_COLOR_PALETTE[song.color_key] || '';
          const completed = recorderSongCompletionsCache.get(`${student.id}:${song.slot_num}`);
          return `
            <td
              class="recorder-song-cell"
              style="${bg ? `background:${bg};` : ''}"
              data-student-id="${escHtml(String(student.id))}"
              data-slot-num="${song.slot_num}"
            >${completed ? '&#10003;' : ''}</td>
          `;
        })
        .join('');

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
          ${songCells}
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
          ${songHeaderCells}
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;

  recordersGridCanvas.querySelectorAll('.recorder-color-select').forEach((select) => {
    select.addEventListener('change', async () => {
      const studentId = Number(select.dataset.studentId);
      if (!studentId) {
        return;
      }
      await setRecorderColor(studentId, select.value);
    });
  });

  recordersGridCanvas.querySelectorAll('.recorder-song-cell').forEach((cell) => {
    cell.addEventListener('click', async () => {
      const studentId = Number(cell.dataset.studentId);
      const slotNum = Number(cell.dataset.slotNum);
      if (!studentId || !slotNum) return;
      await toggleRecorderSongCompletion(studentId, slotNum);
    });
  });
}

async function toggleRecorderSongCompletion(studentId, slotNum) {
  const academicYear = currentAcademicYear || getDefaultAcademicYear();
  const cacheKey = `${studentId}:${slotNum}`;
  const previous = Boolean(recorderSongCompletionsCache.get(cacheKey));
  const next = !previous;

  // Optimistic update so the checkmark toggles instantly.
  recorderSongCompletionsCache.set(cacheKey, next);
  renderRecordersGrid();

  try {
    await window.api.upsertRecorderSongCompletion(studentId, academicYear, slotNum, next);
  } catch (error) {
    console.error('[recorder-song] failed to save completion:', error);
    recorderSongCompletionsCache.set(cacheKey, previous);
    renderRecordersGrid();
  }
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
    options.push(
      `<option value="${label}"${label === selectedYear ? ' selected' : ''}>${label}</option>`
    );
  }
  return options.join('');
}

// Academic years run Aug 1 → Jul 31; derives that range from a "YYYY-YY" label
// (e.g. "2025-26") so attendance dates can be scoped without a DB migration.
function getAcademicYearDateRange(yearLabel) {
  const startYear = parseInt(String(yearLabel || '').slice(0, 4), 10);
  if (!Number.isFinite(startYear)) return null;
  return { start: `${startYear}-08-01`, end: `${startYear + 1}-07-31` };
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

  const scopedStudents = getStudentsInActiveScope().filter((s) => !s.isSample);

  if (scopedStudents.length === 0) {
    immaGridCanvas.innerHTML =
      '<div class="imma-empty">No students in the current class selection.</div>';
    return;
  }

  const year = immaTabYear || currentAcademicYear || getDefaultAcademicYear();
  const activeYear = immaHistoryVisible ? year : currentAcademicYear || getDefaultAcademicYear();
  const displayYears = immaHistoryVisible
    ? getImmaAvailableYears(scopedStudents, currentAcademicYear || getDefaultAcademicYear())
    : [currentAcademicYear || getDefaultAcademicYear()];

  let html = `
    <div class="imma-toolbar">
      ${immaHistoryVisible ? '<label for="imma-year-select" class="imma-year-label">Edit Year:</label>' : ''}
      ${
        immaHistoryVisible
          ? `<select id="imma-year-select" class="imma-year-select">
        ${displayYears
          .map(
            (displayYear) =>
              `<option value="${escHtml(displayYear)}"${displayYear === activeYear ? ' selected' : ''}>${escHtml(displayYear)}</option>`
          )
          .join('')}
      </select>`
          : ''
      }
      <button id="imma-history-toggle-btn" class="imma-history-toggle-btn" type="button">
        ${immaHistoryVisible ? 'Hide Previous Years' : 'Show Previous Years'}
      </button>
      <button id="btn-mats-import-open" class="imma-mats-btn" type="button">MATS Import…</button>
    </div>
    <table class="imma-table">
      <thead>
        <tr>
          <th class="imma-th-name" rowspan="2">Student</th>
          ${displayYears
            .map(
              (displayYear) => `
                <th
                  class="${displayYear === activeYear ? 'imma-active-year-group' : 'imma-history-year-group'}"
                  colspan="2"
                >
                  <span class="imma-history-year-label">${escHtml(displayYear)}</span>
                </th>`
            )
            .join('')}
        </tr>
        <tr>
          ${displayYears
            .map(
              () => `
                <th class="imma-th-score">Tonal <span style="font-weight:normal;font-size:0.75em">(0–40)</span></th>
                <th class="imma-th-score">Rhythm <span style="font-weight:normal;font-size:0.75em">(0–40)</span></th>`
            )
            .join('')}
        </tr>
      </thead>
      <tbody>
  `;

  for (const student of scopedStudents) {
    const currentScore = getImmaScoreEntry(student.id, activeYear) || {};

    html += `
      <tr data-student-id="${student.id}">
        <td class="imma-td-name">${escHtml(getDisplayName(student))}</td>
        ${displayYears
          .map((displayYear) => {
            const score = getImmaScoreEntry(student.id, displayYear) || {};
            const isActiveYear = displayYear === activeYear;
            const tonalCellClass = getAptitudeClassName(
              student.grade,
              score.tonal,
              'tonal',
              'cell'
            );
            const rhythmCellClass = getAptitudeClassName(
              student.grade,
              score.rhythm,
              'rhythm',
              'cell'
            );

            if (isActiveYear) {
              return `
                <td class="imma-td-score">
                  <input type="number" class="imma-score-input imma-active-score-input ${tonalCellClass}" data-field="tonal" min="0" max="40"
                    value="${currentScore.tonal != null ? currentScore.tonal : ''}"
                    placeholder="—" />
                </td>
                <td class="imma-td-score">
                  <input type="number" class="imma-score-input imma-active-score-input ${rhythmCellClass}" data-field="rhythm" min="0" max="40"
                    value="${currentScore.rhythm != null ? currentScore.rhythm : ''}"
                    placeholder="—" />
                </td>`;
            }

            const tonalText = score.tonal != null ? escHtml(String(score.tonal)) : '—';
            const rhythmText = score.rhythm != null ? escHtml(String(score.rhythm)) : '—';
            return `
              <td class="imma-td-score imma-history-score ${tonalCellClass}${score.tonal == null ? ' imma-history-missing' : ''}">
                ${tonalText}
              </td>
              <td class="imma-td-score imma-history-score ${rhythmCellClass}${score.rhythm == null ? ' imma-history-missing' : ''}">
                ${rhythmText}
              </td>`;
          })
          .join('')}
      </tr>
    `;
  }

  html += '</tbody></table>';
  immaGridCanvas.innerHTML = html;

  // Wire MATS Import button
  const matsImportBtn = document.getElementById('btn-mats-import-open');
  if (matsImportBtn) {
    matsImportBtn.addEventListener('click', openMatsImportModal);
  }

  const yearSelectEl = document.getElementById('imma-year-select');
  if (yearSelectEl) {
    yearSelectEl.addEventListener('change', () => {
      immaTabYear = yearSelectEl.value;
      renderImmaGrid();
    });
  }

  const historyToggleBtn = document.getElementById('imma-history-toggle-btn');
  if (historyToggleBtn) {
    historyToggleBtn.addEventListener('click', () => {
      setImmaHistoryVisible(!immaHistoryVisible);
      renderImmaGrid();
    });
  }

  const isPastYear = activeYear < (currentAcademicYear || getDefaultAcademicYear());

  immaGridCanvas.querySelectorAll('.imma-score-input').forEach((input) => {
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
      const tonal =
        tonalInput && tonalInput.value.trim() !== ''
          ? Math.round(clamp(Number(tonalInput.value), 0, 40))
          : null;
      const rhythm =
        rhythmInput && rhythmInput.value.trim() !== ''
          ? Math.round(clamp(Number(rhythmInput.value), 0, 40))
          : null;

      try {
        await window.api.upsertImmaScore(studentId, activeYear, tonal, rhythm);
        await refreshImmaScoreCache();
        renderWorkspace();
      } catch (err) {
        console.error('[imma-grid] failed to save score:', err);
      }
    });
  });
}

// ── MATS Import Modal ───────────────────────────────────────────────────────

async function mergeMatsResultsIntoImmaScores(results) {
  const targetYear = currentAcademicYear || getDefaultAcademicYear();
  const mergedScores = new Map();

  for (const result of results || []) {
    const studentId = Number(result?.student_id);
    if (!Number.isFinite(studentId)) continue;

    const testType = result.test_type === 'rhythm' ? 'rhythm' : 'tonal';
    const existing = mergedScores.get(studentId) || getImmaScoreEntry(studentId, targetYear) || {};
    const nextScore = {
      tonal: existing.tonal ?? null,
      rhythm: existing.rhythm ?? null,
    };
    nextScore[testType] = result.score ?? null;
    mergedScores.set(studentId, nextScore);
  }

  for (const [studentId, score] of mergedScores.entries()) {
    await window.api.upsertImmaScore(studentId, targetYear, score.tonal, score.rhythm);
  }

  await refreshImmaScoreCache();
  return targetYear;
}

async function openMatsImportModal() {
  const modal = document.getElementById('mats-import-modal');
  const overlay = document.getElementById('mats-import-modal-overlay');
  if (!modal || !overlay) return;

  // Reset UI
  document.getElementById('mats-import-error').textContent = '';
  document.getElementById('mats-import-success').textContent = '';
  document.getElementById('mats-import-code-input').value = '';
  document.getElementById('mats-import-unmatched').innerHTML = '';
  document.getElementById('mats-sa-status').textContent = '';

  overlay.classList.remove('hidden');
  modal.classList.remove('hidden');

  // Check if service account is set up
  try {
    const hasSA = await window.api.matsHasServiceAccount();
    const saStatus = document.getElementById('mats-sa-status');
    if (hasSA) {
      saStatus.textContent = '✓ Service account configured.';
      saStatus.style.color = '#2e7d32';
    } else {
      saStatus.textContent = 'No service account configured. Click "Set Up Service Account" first.';
      saStatus.style.color = '#a0522d';
    }
  } catch (e) {
    console.error('[mats-modal] check SA:', e);
  }
}

function closeMatsImportModal() {
  document.getElementById('mats-import-modal')?.classList.add('hidden');
  document.getElementById('mats-import-modal-overlay')?.classList.add('hidden');
}

// Wire up modal buttons (called once on page load)
function initMatsImportModal() {
  const overlay = document.getElementById('mats-import-modal-overlay');
  const btnClose = document.getElementById('mats-import-close');
  const btnSetupSA = document.getElementById('mats-setup-sa-btn');
  const btnFetch = document.getElementById('mats-fetch-btn');

  overlay?.addEventListener('click', closeMatsImportModal);
  document
    .getElementById('mats-import-modal')
    ?.addEventListener('click', (e) => e.stopPropagation());
  btnClose?.addEventListener('click', closeMatsImportModal);

  btnSetupSA?.addEventListener('click', async () => {
    const saStatus = document.getElementById('mats-sa-status');
    try {
      const result = await window.api.matsSetupServiceAccount();
      if (!result.canceled) {
        saStatus.textContent = '✓ Service account saved.';
        saStatus.style.color = '#2e7d32';
      }
    } catch (e) {
      saStatus.textContent = 'Error saving service account: ' + e.message;
      saStatus.style.color = '#c62828';
    }
  });

  btnFetch?.addEventListener('click', async () => {
    const codeInput = document.getElementById('mats-import-code-input');
    const errEl = document.getElementById('mats-import-error');
    const succEl = document.getElementById('mats-import-success');
    const unmEl = document.getElementById('mats-import-unmatched');
    const code = codeInput?.value.trim().toUpperCase() || '';

    errEl.textContent = '';
    succEl.textContent = '';
    unmEl.innerHTML = '';

    if (!code || code.length < 2) {
      errEl.textContent = 'Please enter a valid Teacher Code.';
      return;
    }

    btnFetch.disabled = true;
    btnFetch.textContent = 'Fetching…';

    try {
      const result = await window.api.matsFetchAndImport(code);
      const importedYear = await mergeMatsResultsIntoImmaScores(result.results || []);
      immaTabYear = importedYear;
      succEl.textContent =
        `Imported ${result.importedCount} result${result.importedCount !== 1 ? 's' : ''}. ` +
        (result.unmatchedCount > 0
          ? `${result.unmatchedCount} could not be matched to a student.`
          : 'All matched.') +
        ` Copied into ${importedYear}.`;

      // Build results table with Reset for Retake buttons
      if (result.results && result.results.length > 0) {
        let tableHtml = `<table class="mats-results-table">
          <thead><tr>
            <th>Name</th><th>Email</th><th>Type</th><th>Score</th><th>Complete</th><th></th>
          </tr></thead><tbody>`;
        for (const r of result.results) {
          const name = escHtml(r.student_name || '(no name)');
          const email = escHtml(r.student_email || '(no email)');
          const type = escHtml(r.test_type || '—');
          const score = r.score != null ? r.score : '—';
          const comp = r.is_complete ? '✓' : '—';
          const docId = escHtml(r.firestore_doc_id || '');
          tableHtml += `<tr>
            <td>${name}</td>
            <td>${email}</td>
            <td>${type}</td>
            <td>${score}</td>
            <td>${comp}</td>
            <td>${docId ? `<button class="mats-retake-btn" data-doc-id="${docId}" type="button">Reset for Retake</button>` : ''}</td>
          </tr>`;
        }
        tableHtml += '</tbody></table>';
        unmEl.innerHTML = tableHtml;

        // Wire retake buttons
        unmEl.querySelectorAll('.mats-retake-btn').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const docId = btn.dataset.docId;
            const confirmed = window.confirm(
              `Reset this student so they can retake the test?\n\nThis will clear their answers and score in Firebase.`
            );
            if (!confirmed) return;
            btn.disabled = true;
            btn.textContent = 'Resetting…';
            try {
              await window.api.matsResetForRetake(docId);
              btn.textContent = '✓ Reset';
              btn.closest('tr').querySelector('td:nth-child(4)').textContent = '—';
              btn.closest('tr').querySelector('td:nth-child(3)').textContent = '—';
              renderImmaGrid();
            } catch (e) {
              btn.disabled = false;
              btn.textContent = 'Reset for Retake';
              alert('Reset failed: ' + e.message);
            }
          });
        });
      }

      // Refresh the workspace so the IMMA tab, LSA grid, and seating chart bands all use the
      // newly imported canonical scores immediately.
      renderWorkspace();
    } catch (err) {
      if (err.code === 'NO_SERVICE_ACCOUNT' || /service account/i.test(err.message)) {
        errEl.textContent = 'Service account not configured. Click "Set Up Service Account" first.';
      } else {
        errEl.textContent = 'Fetch failed: ' + err.message;
      }
      console.error('[mats-fetch]', err);
    } finally {
      btnFetch.disabled = false;
      btnFetch.textContent = 'Fetch & Import';
    }
  });

  // Manual reset by doc ID
  const btnResetById = document.getElementById('mats-reset-docid-btn');
  const resetDocIdInput = document.getElementById('mats-reset-docid-input');
  const resetDocIdStatus = document.getElementById('mats-reset-docid-status');

  btnResetById?.addEventListener('click', async () => {
    const docId = resetDocIdInput?.value.trim() || '';
    resetDocIdStatus.textContent = '';
    resetDocIdStatus.style.color = '';
    if (!docId) {
      resetDocIdStatus.textContent = 'Please enter a Doc ID.';
      resetDocIdStatus.style.color = '#c62828';
      return;
    }
    const confirmed = window.confirm(
      `Reset doc "${docId}" so the student can retake the test?\n\nThis will clear their answers and score in Firebase.`
    );
    if (!confirmed) return;
    btnResetById.disabled = true;
    btnResetById.textContent = 'Resetting…';
    try {
      await window.api.matsResetForRetake(docId);
      resetDocIdStatus.textContent = '✓ Reset successfully. The student can now retake the test.';
      resetDocIdStatus.style.color = '#2e7d32';
      resetDocIdInput.value = '';
      renderImmaGrid();
    } catch (e) {
      resetDocIdStatus.textContent = 'Reset failed: ' + e.message;
      resetDocIdStatus.style.color = '#c62828';
    } finally {
      btnResetById.disabled = false;
      btnResetById.textContent = 'Reset This Student for Retake';
    }
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

// Sentinel class_key for the graduated-students bucket — deliberately not a
// real `teacher||grade` pair so it can never collide with a real class.
const GRADUATED_CLASS_KEY = '__GRADUATED__';

// Mirrors the grouping logic in getTeacherClasses so any caller (search,
// class list) resolves the exact same class_key for a given student.
function getClassKeyForStudent(student) {
  if (student.graduated_year) return GRADUATED_CLASS_KEY;
  const teacher = normalizeTeacher(student.teacher);
  const isMultiGrade = !teacher || multiGradeTeachers.has(teacher);
  const grade = isMultiGrade ? '' : normalizeGrade(student.grade) || '';
  return `${teacher}||${grade}`;
}

function getTeacherClasses() {
  const classesMap = new Map();
  let graduatedCount = 0;

  students
    .filter((student) => !student.isSample)
    .forEach((student) => {
      // Graduated students are shown in their own bucket, never mixed into a
      // teacher's roster (they'd otherwise land in "Unassigned Teacher" and
      // inflate that count).
      if (student.graduated_year) {
        graduatedCount++;
        return;
      }
      const teacher = normalizeTeacher(student.teacher);
      // Unassigned teacher and multi-grade teachers always merge all grades into one class
      const isMultiGrade = !teacher || multiGradeTeachers.has(teacher);
      const grade = isMultiGrade ? '' : normalizeGrade(student.grade) || '';
      const key = getClassKeyForStudent(student);
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

  // Classes in the saved order come first; any new classes fall back to the
  // default grade/name sort after them.
  const result = Array.from(classesMap.values()).sort((a, b) => {
    const ai = savedClassOrder.indexOf(a.key);
    const bi = savedClassOrder.indexOf(b.key);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    const gr = gradeRank(a.grade) - gradeRank(b.grade);
    if (gr !== 0) return gr;
    return a.label.localeCompare(b.label);
  });

  if (graduatedCount > 0) {
    result.push({
      key: GRADUATED_CLASS_KEY,
      teacher: '',
      grade: '',
      isMultiGrade: false,
      label: 'Graduated Students',
      count: graduatedCount,
    });
  }

  return result;
}

function parseClassKey(key) {
  if (key === null || key === undefined) return { teacher: null, grade: null };
  const parts = String(key).split('||');
  const teacher = normalizeTeacher(parts[0] || '');
  const grade = parts.length > 1 ? (parts[1] === '' ? '' : normalizeGrade(parts[1]) || '') : '';
  return { teacher, grade };
}

function normalizeGrade(grade) {
  if (!grade) return null;
  const s = String(grade).trim().toLowerCase();
  if (['k', 'kindergarten', 'kinder', 'pre-k', 'prek'].includes(s)) return 'K';
  if (
    s === 'y5' ||
    s === 'young5s' ||
    s.replace(/[^a-z0-9]/g, '') === 'young5s' ||
    s.includes('young five') ||
    s.includes('young 5')
  )
    return 'Y5';
  // word ordinals: "first", "fourth grade", etc.
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

// Pointer-based drag reorder for class pills, same behavior as the seating
// chart list. Persists the full key order in the settings table.
function attachClassReorderDrag(button, classKey, classes) {
  button.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const rect = button.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;

    const ghost = button.cloneNode(true);
    ghost.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      opacity: 0.72;
      pointer-events: none;
      z-index: 9999;
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
      cursor: grabbing;
    `;
    document.body.appendChild(ghost);
    document.body.classList.add('chart-reorder-dragging');
    button.classList.add('chart-row-dragging');

    let currentTarget = null;
    let lastClientY = e.clientY;
    let scrollFrame = null;

    const updateDropTarget = () => {
      let hit = null;
      classList
        .querySelectorAll('.class-pill.reorder-mode:not(.chart-row-dragging)')
        .forEach((p) => {
          const r = p.getBoundingClientRect();
          if (lastClientY >= r.top && lastClientY <= r.bottom) hit = p;
        });
      if (hit !== currentTarget) {
        if (currentTarget) currentTarget.classList.remove('chart-row-drag-over');
        currentTarget = hit;
        if (currentTarget) currentTarget.classList.add('chart-row-drag-over');
      }
    };

    // Scrolls the list while the cursor sits near (or beyond) its top/bottom edge,
    // so touchpad users can reach off-screen classes without a scroll wheel.
    const EDGE_ZONE = 40;
    const MAX_SPEED = 14;
    const autoScroll = () => {
      const r = classList.getBoundingClientRect();
      let delta = 0;
      if (lastClientY < r.top + EDGE_ZONE) {
        delta = -MAX_SPEED * Math.min(1, (r.top + EDGE_ZONE - lastClientY) / EDGE_ZONE);
      } else if (lastClientY > r.bottom - EDGE_ZONE) {
        delta = MAX_SPEED * Math.min(1, (lastClientY - (r.bottom - EDGE_ZONE)) / EDGE_ZONE);
      }
      if (delta !== 0) {
        classList.scrollTop += delta;
        updateDropTarget();
      }
      scrollFrame = requestAnimationFrame(autoScroll);
    };
    scrollFrame = requestAnimationFrame(autoScroll);

    const onMove = (ev) => {
      lastClientY = ev.clientY;
      ghost.style.left = `${ev.clientX - offsetX}px`;
      ghost.style.top = `${ev.clientY - offsetY}px`;
      updateDropTarget();
    };

    const onUp = async () => {
      cancelAnimationFrame(scrollFrame);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      ghost.remove();
      document.body.classList.remove('chart-reorder-dragging');
      button.classList.remove('chart-row-dragging');
      classList
        .querySelectorAll('.class-pill')
        .forEach((p) => p.classList.remove('chart-row-drag-over'));

      if (currentTarget && currentTarget !== button) {
        const keys = classes.map((c) => c.key).filter((k) => k !== GRADUATED_CLASS_KEY);
        const srcIdx = keys.indexOf(classKey);
        const dstIdx = keys.indexOf(currentTarget.dataset.classKey);
        if (srcIdx !== -1 && dstIdx !== -1) {
          const [moved] = keys.splice(srcIdx, 1);
          keys.splice(dstIdx, 0, moved);
          savedClassOrder = keys;
          try {
            await window.api.setSetting('class_order', JSON.stringify(keys));
          } catch (err) {
            console.error('[class-order] persist failed:', err);
          }
          const prevScroll = classList.scrollTop;
          renderClassLibrary();
          classList.scrollTop = prevScroll;
        }
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function renderClassLibrary() {
  // Always show the class library, even with sample roster
  classLibrary.classList.remove('hidden');
  toggleClassesListBtn.setAttribute('aria-expanded', String(!classesCollapsed));
  classLibraryBody.classList.toggle('hidden', classesCollapsed);
  classLibrary.classList.toggle('collapsed', classesCollapsed);
  if (classOrderGearBtn) {
    classOrderGearBtn.classList.toggle('hidden', classesReorderMode || classesCollapsed);
  }
  if (classOrderDoneBtn) {
    classOrderDoneBtn.classList.toggle('hidden', !classesReorderMode || classesCollapsed);
  }

  const classes = getTeacherClasses();
  if (activeClassTeacher !== null && !classes.some((entry) => entry.key === activeClassTeacher)) {
    activeClassTeacher = null;
  }

  classList.innerHTML = '';

  if (classes.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent =
      'No classes yet. Add students with teacher names to create class filters.';
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
    if (classesReorderMode) return;
    Promise.resolve(selectClassTeacher(null))
      .then(() => {
        renderWorkspace();
      })
      .catch((error) => {
        console.error('[renderer] failed to switch class context:', error);
      });
  });
  classList.appendChild(allClassesButton);

  classes.forEach((entry) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'class-pill';
    if (entry.key === activeClassTeacher) {
      button.classList.add('active');
    }
    button.textContent = `${entry.isMultiGrade ? 'Multi-Grade \u2014 ' : entry.grade ? `${entry.grade} \u2014 ` : ''}${entry.label} (${entry.count})`;
    button.dataset.classKey = entry.key;
    if (classesReorderMode && entry.key !== GRADUATED_CLASS_KEY) {
      button.classList.add('reorder-mode');
      attachClassReorderDrag(button, entry.key, classes);
      classList.appendChild(button);
      return;
    }
    if (classesReorderMode) {
      classList.appendChild(button);
      return;
    }
    button.addEventListener('click', () => {
      Promise.resolve(selectClassTeacher(entry.key))
        .then(() => {
          renderWorkspace();
        })
        .catch((error) => {
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

  // Gear/done button visibility: gear shows only when expanded and not in
  // reorder mode; Done shows only while reorder mode is active and expanded.
  if (seatingChartOrderGearBtn) {
    seatingChartOrderGearBtn.classList.toggle(
      'hidden',
      seatingChartsReorderMode || seatingChartsCollapsed
    );
  }
  if (seatingChartOrderDoneBtn) {
    seatingChartOrderDoneBtn.classList.toggle(
      'hidden',
      !seatingChartsReorderMode || seatingChartsCollapsed
    );
  }

  if (!shouldShowLibrary) {
    return;
  }

  // Don't wipe the list while a chart name is being edited inline.
  if (seatingChartList.querySelector('.chart-name-edit')) return;

  seatingChartList.innerHTML = '';

  if (!hasClassContext) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent = "Select a class first to view and manage that class's seating charts.";
    seatingChartList.appendChild(emptyState);
    return;
  }

  if (seatingCharts.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'chart-library-empty';
    emptyState.textContent =
      'Drag a student to the canvas, or click Arrange Circle or Arrange Rows in Chart Tools, to create your first seating chart.';
    seatingChartList.appendChild(emptyState);
    return;
  }

  let chartDragSrcId = null;

  seatingCharts.forEach((chart) => {
    const row = document.createElement('div');
    row.className = 'chart-row';
    row.dataset.chartId = String(chart.id);
    if (chart.id === activeSeatingChartId) {
      row.classList.add('active');
    }
    if (seatingChartsReorderMode) {
      row.classList.add('reorder-mode');
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

    if (!seatingChartsReorderMode) {
      // Normal mode: clicking a pill selects it, and rename/delete buttons work.
      row.querySelector('.chart-row-main').addEventListener('click', () => {
        // Immediately update active state so the button colour changes before the async load/animation
        document
          .querySelectorAll('#seating-chart-list .chart-row')
          .forEach((r) => r.classList.remove('active'));
        row.classList.add('active');
        selectSeatingChart(chart.id);
      });

      const renameBtn = row.querySelector('[data-chart-action="rename"]');
      if (renameBtn) {
        renameBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          activateChartNameEdit(row, chart.id, chart.name);
        });
      }

      const deleteBtn = row.querySelector('[data-chart-action="delete"]');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', (event) => {
          event.stopPropagation();
          deleteSeatingChart(chart.id);
        });
      }
    }

    // Pointer-based drag reorder (mousedown/mousemove/mouseup instead of
    // HTML5 drag-and-drop so we have full control over the cursor appearance).
    // A floating ghost clone follows the cursor; the source pill fades;
    // the hovered target pill gets an accent outline as a drop indicator.
    if (seatingChartsReorderMode) {
      row.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.chart-row-actions')) return;
        e.preventDefault();

        chartDragSrcId = chart.id;
        const rowRect = row.getBoundingClientRect();
        const offsetX = e.clientX - rowRect.left;
        const offsetY = e.clientY - rowRect.top;

        // Build floating ghost clone
        const ghost = row.cloneNode(true);
        ghost.style.cssText = `
          position: fixed;
          left: ${rowRect.left}px;
          top: ${rowRect.top}px;
          width: ${rowRect.width}px;
          opacity: 0.72;
          pointer-events: none;
          z-index: 9999;
          box-shadow: 0 6px 20px rgba(0,0,0,0.18);
          border-radius: var(--radius-btn);
          background: rgba(216, 208, 192, 0.95);
          cursor: grabbing;
        `;
        document.body.appendChild(ghost);

        // Force grabbing cursor everywhere
        document.body.classList.add('chart-reorder-dragging');

        row.classList.add('chart-row-dragging');

        let currentTarget = null;

        const onMove = (ev) => {
          ghost.style.left = `${ev.clientX - offsetX}px`;
          ghost.style.top = `${ev.clientY - offsetY}px`;

          // Find which row the cursor centre is over (skip the dragged row)
          const midY = ev.clientY;
          let hit = null;
          seatingChartList.querySelectorAll('.chart-row:not(.chart-row-dragging)').forEach((r) => {
            const rect = r.getBoundingClientRect();
            if (midY >= rect.top && midY <= rect.bottom) hit = r;
          });

          if (hit !== currentTarget) {
            if (currentTarget) currentTarget.classList.remove('chart-row-drag-over');
            currentTarget = hit;
            if (currentTarget) currentTarget.classList.add('chart-row-drag-over');
          }
        };

        const onUp = async () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          ghost.remove();
          document.body.classList.remove('chart-reorder-dragging');
          row.classList.remove('chart-row-dragging');
          seatingChartList
            .querySelectorAll('.chart-row')
            .forEach((r) => r.classList.remove('chart-row-drag-over'));

          if (currentTarget && currentTarget !== row) {
            const targetId = Number(currentTarget.dataset.chartId);
            const srcIdx = seatingCharts.findIndex((c) => c.id === chartDragSrcId);
            const dstIdx = seatingCharts.findIndex((c) => c.id === targetId);
            if (srcIdx !== -1 && dstIdx !== -1) {
              const [moved] = seatingCharts.splice(srcIdx, 1);
              seatingCharts.splice(dstIdx, 0, moved);
              const classKey = getActiveClassKeyForCharts();
              try {
                await window.api.reorderSeatingCharts(
                  classKey,
                  seatingCharts.map((c) => c.id)
                );
              } catch (err) {
                console.error('[chart-reorder] persist failed:', err);
              }
              renderSeatingChartLibrary();
            }
          }
          chartDragSrcId = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
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
  const rosterStudents = baseStudents.filter((student) => {
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

  rosterStudents.forEach((student) => {
    const card = createStudentCard(student, false);
    rosterList.appendChild(card);
  });
}

function renderChart() {
  chartCanvas.innerHTML = '';

  // Remove any inactive students from the layout before rendering
  students.forEach((student) => {
    if (student.is_active === 0) {
      const layout = getStudentLayout(student.id);
      if (layout.placed) {
        layout.placed = false;
        layout.x = 0;
        layout.y = 0;
      }
    }
  });

  const placedStudents = students.filter((student) => {
    const layout = getStudentLayout(student.id);
    return activeFilter !== 'roster' && layout.placed && student.is_active !== 0;
  });

  placedStudents.forEach((student) => {
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
    const promptTitle = lessonFileName
      ? `LSA ${activeLsaUnit} - ${lessonFileName}`
      : `LSA ${activeLsaUnit} Prompt`;
    const audioBtn = audioUrl
      ? `<button class="lsa-audio-play-btn" type="button" title="Play audio pattern" aria-label="Play audio pattern">&#9654;</button>`
      : '';

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
        playBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        playBtn.addEventListener('click', (e) => {
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

    placeholder.addEventListener('pointerdown', (event) => {
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

      const onMove = (moveEvent) => {
        const next = clampLsaPlaceholderPosition(
          (moveEvent.clientX - canvasRect.left) / chartZoom - offsetX,
          (moveEvent.clientY - canvasRect.top) / chartZoom - offsetY,
          placeholder
        );
        placeholder.style.left = `${next.x}px`;
        placeholder.style.top = `${next.y}px`;
        lsaUnitPlaceholderPositions.set(placeholderKey, next);
      };

      const onUp = (upEvent) => {
        placeholder.releasePointerCapture(upEvent.pointerId);
        placeholder.removeEventListener('pointermove', onMove);
        placeholder.removeEventListener('pointerup', onUp);
        placeholder.removeEventListener('pointercancel', onUp);

        const finalPos = lsaUnitPlaceholderPositions.get(placeholderKey);
        if (finalPos && window.api.upsertLsaUnitPlaceholder) {
          window.api
            .upsertLsaUnitPlaceholder(
              getActiveClassKeyForCharts(),
              activeLsaUnit,
              finalPos.x,
              finalPos.y
            )
            .catch((error) =>
              console.error('[renderer] failed to persist LSA placeholder position:', error)
            );
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
    const hasSubtitle = !!assessmentLibraryDb.get(grade)?.get(activeAssessmentNumber)?.name;
    const cardTitle = hasSubtitle ? label : `${label} \u2014 Rating Scale`;
    const posKey = activeAssessmentNumber;
    const savedSize = assessmentCardSizes.get(posKey) || {};
    const savedWidth = savedSize.width || 220;
    const savedHeight = savedSize.height || null;
    const savedScale = savedSize.scale || 1;
    // Always display descriptions in their entered order (position 1 = best text, position 4 = worst text).
    // Only the number label shown changes based on direction, so the text never moves.
    const posLabel = (pos) => (ratingDirection === 'desc' ? 5 - pos : pos);
    const posClass = (pos) => ['', 'assess-r1', 'assess-r2', 'assess-r3', 'assess-r4'][pos] || '';
    const scaleRows = [1, 2, 3, 4]
      .map((pos) => {
        const text = scales[pos];
        const colorClass = posClass(pos);
        const num = posLabel(pos);
        return text
          ? `<div class="assessment-scale-row ${colorClass}"><span class="assessment-scale-num">${num}</span><span class="assessment-scale-text">${escHtml(text)}</span></div>`
          : `<div class="assessment-scale-row assessment-scale-empty ${colorClass}"><span class="assessment-scale-num">${num}</span><span class="assessment-scale-text">\u2014</span></div>`;
      })
      .join('');
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

    assessCard.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (event.target.classList.contains('lsa-resize-handle')) return;
      event.preventDefault();
      event.stopPropagation();
      const canvasRect = chartCanvas.getBoundingClientRect();
      const cardRect = assessCard.getBoundingClientRect();
      const offsetX = (event.clientX - cardRect.left) / chartZoom;
      const offsetY = (event.clientY - cardRect.top) / chartZoom;
      assessCard.setPointerCapture(event.pointerId);
      const onMove = (moveEvent) => {
        const next = clampLsaPlaceholderPosition(
          (moveEvent.clientX - canvasRect.left) / chartZoom - offsetX,
          (moveEvent.clientY - canvasRect.top) / chartZoom - offsetY,
          assessCard
        );
        assessCard.style.left = `${next.x}px`;
        assessCard.style.top = `${next.y}px`;
        assessmentPlaceholderPositions.set(posKey, next);
      };
      const onUp = (upEvent) => {
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
    assessmentCardSizes.set(posKey, {
      ...(assessmentCardSizes.get(posKey) || {}),
      width: initialMinW,
    });
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

  card.querySelectorAll('.lsa-resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
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
      const onMove = (moveEvent) => {
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
      const onUp = (upEvent) => {
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
  const maxX = Math.max(0, CANVAS_W - cardWidth - 8);
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

  placeholder.querySelectorAll('.lsa-resize-handle').forEach((handle) => {
    handle.addEventListener('pointerdown', (event) => {
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

      const onMove = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        let nextWidth = startWidth;

        if (mode === 'e') {
          nextWidth = startWidth + dx;
        } else if (mode === 's') {
          nextWidth = startWidth + dy * ratio;
        } else {
          nextWidth = startWidth + (dx + dy * ratio) / 2;
        }

        applyWidth(nextWidth);
      };

      const onUp = (upEvent) => {
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

  // Build a set of student IDs that already have a card on the canvas.
  const existingIds = new Set(existingCards.map((c) => c.dataset.studentId));

  let hasVisualChange = false;

  existingCards.forEach((card) => {
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

  // Inject cards for students that are placed in the new layout but had no
  // card on the canvas (they weren't placed in the previous chart). Adding
  // them now at opacity:0 then fading to 1 via rAF means they appear during
  // the slide animation instead of popping in after it settles.
  if (activeFilter !== 'roster') {
    const scopedStudents = getStudentsInActiveScope();
    scopedStudents.forEach((student) => {
      const layout = getStudentLayout(student.id);
      if (!layout?.placed) return;
      if (student.is_active === 0) return;
      const sid = String(student.id);
      if (existingIds.has(sid)) return; // already handled above

      hasVisualChange = true;
      const card = createStudentCard(student, true);
      card.style.left = `${layout.x}px`;
      card.style.top = `${layout.y}px`;
      card.style.opacity = '0';
      chartCanvas.appendChild(card);

      // Trigger the CSS opacity transition on the next frame so the
      // browser registers the initial opacity:0 before animating to 1.
      requestAnimationFrame(() => {
        card.style.opacity = '1';
      });
    });
  }

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
  const inactiveBadge = student.graduated_year
    ? '<span class="inactive-badge">Graduated</span>'
    : isInactive
      ? '<span class="inactive-badge">Inactive</span>'
      : '';
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
  const editButtonMarkup =
    !editMode || student.isSample
      ? ''
      : '<button class="student-edit-btn" type="button" aria-label="Edit student" title="Edit student">&#9998;</button>';
  const colorDot = layout.color_dot ?? null;
  const colorDotMarkup =
    student.isSample || colorDotsHidden
      ? ''
      : `<button class="color-dot-btn${colorDot ? ` color-dot-${colorDot}` : ''}" data-color-dot="true" type="button" aria-label="Color tag" title="Color tag"></button>`;
  card.className = isPlaced ? 'chart-student' : 'roster-card';
  card.dataset.studentId = studentId;
  card.dataset.attendance = layout.attendance || 'none';
  card.draggable = true;
  card.tabIndex = 0;

  if (isInactive) {
    card.classList.add('inactive-student');
  }

  if (selectedStudentIds.has(studentId)) {
    card.classList.add('selected');
  }

  if (noteMode) {
    card.classList.add('note-mode-card');
    const noteNameMarkup = `
      <span class="student-name-wrap">
        <strong class="student-name-first">${firstName}</strong>
        <span class="student-name-last">${lastName}</span>
        ${inactiveBadge}
      </span>
    `;
    card.innerHTML = `
      ${editButtonMarkup}
      ${colorDotMarkup}
      <div class="student-topline single">
        ${noteNameMarkup}
      </div>
      ${rosterMetaMarkup}
      <div class="note-mode-btn-row" style="display:flex;justify-content:center;align-items:center;gap:4px;">
        <button class="note-pencil-btn" title="Add/Edit Note" aria-label="Add/Edit Note" type="button" style="background:none;border:none;cursor:pointer;padding:0 8px;vertical-align:middle;color:#000;display:flex;align-items:center;justify-content:center;">
          <svg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true' focusable='false'><path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'/><path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'/></svg>
        </button>
        <button class="note-page-btn" title="View All Notes" aria-label="View All Notes" type="button" style="background:none;border:none;cursor:pointer;padding:0 8px;vertical-align:middle;color:#000;display:flex;align-items:center;justify-content:center;">
          <svg width="20" height="20" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
            <rect x="4" y="3" width="12" height="14" rx="2" fill="none" stroke="#000"/>
            <rect x="6" y="6" width="8" height="1.5" rx="0.75" fill="#000"/>
            <rect x="6" y="9" width="8" height="1.5" rx="0.75" fill="#000"/>
            <rect x="6" y="12" width="5" height="1.5" rx="0.75" fill="#000"/>
          </svg>
        </button>
      </div>
    `;
    // Add event listeners for the new buttons
    card.querySelector('.note-pencil-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openNoteEntryModal(student, null);
    });
    card.querySelector('.note-page-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      openViewNotesModal(student);
    });
  } else if (lsaMode) {
    if (isPlaced) card.classList.add('lsa-card');
    if (isPlaced) {
      const aptitudeYear = currentAcademicYear || getDefaultAcademicYear();
      const aptitudeScore = getCachedImmaScore(student.id, aptitudeYear) || {};
      const aptitudeBandClass = getAptitudeClassName(
        student.grade,
        aptitudeScore[lsaAptitudeView],
        lsaAptitudeView,
        'band'
      );
      if (aptitudeBandClass) card.classList.add(aptitudeBandClass);
    }
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
    const penDot = (activity) => {
      const n = getPenNote(student.id, activeLsaUnit, activity);
      return n ? '<span class="pen-note-dot"></span>' : '';
    };
    const lsaBtnClass = (score, activity) => {
      const hasNote = !!getPenNote(student.id, activeLsaUnit, activity);
      return `lsa-btn${score === 'eval' && hasNote ? ' has-pen-note' : ''}`;
    };
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
          <button class="${lsaBtnClass(unitEasy, 'easy')}" data-activity="easy" data-score="${unitEasy || 'none'}" type="button">${lsaCardMarkup(unitEasy)}</button>
          ${penDot('easy')}
        </div>
        <div class="lsa-col">
          <span class="lsa-col-label">M</span>
          <button class="${lsaBtnClass(unitMedium, 'medium')}" data-activity="medium" data-score="${unitMedium || 'none'}" type="button">${lsaCardMarkup(unitMedium)}</button>
          ${penDot('medium')}
        </div>
        <div class="lsa-col">
          <span class="lsa-col-label">D</span>
          <button class="${lsaBtnClass(unitDifficult, 'difficult')}" data-activity="difficult" data-score="${unitDifficult || 'none'}" type="button">${lsaCardMarkup(unitDifficult)}</button>
          ${penDot('difficult')}
        </div>
      </div>
    `;
  } else if (attendanceMode) {
    card.classList.add('attendance-card');
    const hasSharedGoodNews = Number(student.good_news_shared || 0) === 1;
    const todayAttendance = getAttendanceStatusForDate(student.id, getTodayIsoDate());
    const goodNewsMarkup = student.isSample
      ? ''
      : `<button class="good-news-btn ${hasSharedGoodNews ? 'active' : ''}" data-good-news="true" type="button" aria-label="Shared good news" title="Shared good news">&#10003;</button>`;
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

  card.addEventListener('click', (e) => {
    // Multi-select: Ctrl/Cmd toggles, Shift selects range
    const isMeta = e.ctrlKey || e.metaKey;
    const isShift = e.shiftKey;
    if (isMeta || isShift) {
      const idx = students.findIndex((s) => String(s.id) === studentId);
      if (isShift && lastSelectedIndex != null && lastSelectedIndex !== -1 && idx !== -1) {
        const start = Math.min(lastSelectedIndex, idx);
        const end = Math.max(lastSelectedIndex, idx);
        selectedStudentIds.clear();
        for (let i = start; i <= end; i++) selectedStudentIds.add(String(students[i].id));
        selectedStudentId =
          selectedStudentIds.size === 1 ? Array.from(selectedStudentIds)[0] : null;
      } else {
        if (selectedStudentIds.has(studentId)) selectedStudentIds.delete(studentId);
        else selectedStudentIds.add(studentId);
        selectedStudentId =
          selectedStudentIds.size === 1 ? Array.from(selectedStudentIds)[0] : null;
        lastSelectedIndex = idx;
      }
      renderWorkspace();
    } else {
      selectStudent(studentId);
    }
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectStudent(studentId);
    }
  });

  // Potential group drag start (mouse/pen) — wait for movement threshold
  card.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Route all placed card drags through pointer system (single or group — no browser ghost/lift)
    if (!isPlaced) return;
    // If the pointer is on a button or other interactive element, let it through normally
    if (e.target.closest('button, a, input, select, textarea, [role="button"]')) return;
    // If this card isn't selected, select it now so pointer drag takes over immediately (no ghost)
    if (!selectedStudentIds.has(studentId)) {
      selectedStudentIds.clear();
      selectedStudentIds.add(studentId);
      selectedStudentId = String(studentId);
      lastSelectedIndex = students.findIndex((s) => String(s.id) === studentId);
      applySelectionSetToDOM(selectedStudentIds);
    }
    potentialGroupDrag = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      baseId: studentId,
    };
    // Temporarily disable native dragging for selected cards
    Array.from(selectedStudentIds).forEach((id) => {
      const el = chartCanvas.querySelector(`[data-student-id="${id}"]`);
      if (!el) return;
      el.dataset._prevDraggable = el.draggable ? '1' : '0';
      el.draggable = false;
    });
    try {
      chartShell.setPointerCapture(e.pointerId);
    } catch (err) {}
    chartShell.addEventListener('pointermove', onPotentialGroupMove);
    chartShell.addEventListener('pointerup', onPotentialGroupUp);
    chartShell.addEventListener('pointercancel', onPotentialGroupUp);
  });

  card.addEventListener('dragstart', (event) => {
    // If a pointer-based group drag is active/suppressed, prevent native drag
    if (suppressNativeDrag) {
      event.preventDefault();
      return;
    }
    // Avoid full rerender during dragstart; rebuilding the card tree can cancel the drag gesture.
    // If this card wasn't part of a multi-selection, make it the single selection now.
    if (!selectedStudentIds.has(studentId)) {
      selectedStudentIds.clear();
      selectedStudentIds.add(studentId);
      selectedStudentId = String(studentId);
      lastSelectedIndex = students.findIndex((s) => String(s.id) === studentId);
    }
    renderSelectionDetails();

    event.dataTransfer.effectAllowed = 'move';

    // pickup offset for the base (dragged) card
    const basePickup = {
      x: clamp(
        typeof event.offsetX === 'number' ? event.offsetX : card.offsetWidth / 2,
        0,
        card.offsetWidth
      ),
      y: clamp(
        typeof event.offsetY === 'number' ? event.offsetY : card.offsetHeight / 2,
        0,
        card.offsetHeight
      ),
    };

    const selIds = Array.from(selectedStudentIds);
    if (selIds.length > 1 && selectedStudentIds.has(studentId)) {
      // Serialize group payload: ids + offsets relative to the dragged (base) card
      const baseLayout = getStudentLayout(studentId);
      const offsets = {};
      selIds.forEach((id) => {
        const l = getStudentLayout(id);
        offsets[id] = { dx: l.x - baseLayout.x, dy: l.y - baseLayout.y };
      });
      const payload = {
        group: true,
        ids: selIds,
        baseId: studentId,
        pickupOffset: basePickup,
        offsets,
      };
      event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    } else {
      // Single-card drag
      event.dataTransfer.setData('text/plain', studentId);
    }

    dragPickupOffset = basePickup;

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
    editBtn.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });

    editBtn.addEventListener('dragstart', (event) => {
      event.preventDefault();
    });

    editBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openStudentModal(student.id);
    });
  }

  if (lsaMode) {
    card.querySelectorAll('.lsa-btn').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      button.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });

      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const activity = button.dataset.activity;
        if (penMode) {
          const currentScore = button.dataset.score;
          if (currentScore === 'eval') {
            // Already at plus — open popup to review/edit note
            openPenNotePopup(student.id, activeLsaUnit, activity, button, null);
            return;
          }
          // Cycle; if it reaches eval, open popup
          const buttonRect = button.getBoundingClientRect();
          await cycleLsaScore(studentId, activity, activeLsaUnit);
          const updatedStudent = students.find((s) => String(s.id) === String(studentId));
          if (updatedStudent) {
            const newScore = getStudentUnitScore(updatedStudent, activeLsaUnit, activity);
            if (newScore === 'eval') {
              openPenNotePopup(student.id, activeLsaUnit, activity, null, buttonRect);
            }
          }
          return;
        }
        cycleLsaScore(studentId, activity, activeLsaUnit);
      });
    });
  } else if (attendanceMode) {
    const goodNewsBtn = card.querySelector('.good-news-btn');
    if (goodNewsBtn) {
      goodNewsBtn.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      goodNewsBtn.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });

      goodNewsBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleGoodNewsShared(studentId);
      });
    }

    card.querySelectorAll('.attendance-btn').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });

      button.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAttendance(studentId, button.dataset.attendance);
      });
    });
  } else if (assessmentMode) {
    card.querySelectorAll('.assess-btn').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.stopPropagation();
      });
      button.addEventListener('dragstart', (event) => {
        event.preventDefault();
      });
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setAssessmentRating(studentId, Number(button.dataset.rating));
      });
    });
  }

  const colorDotBtn = card.querySelector('.color-dot-btn');
  if (colorDotBtn) {
    colorDotBtn.addEventListener('mousedown', (event) => {
      event.stopPropagation();
    });
    colorDotBtn.addEventListener('dragstart', (event) => {
      event.preventDefault();
    });
    colorDotBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      cycleColorDot(studentId);
    });
    colorDotBtn.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      event.stopPropagation();
      openColorDotRing(studentId, colorDotBtn);
    });
  }

  return card;
}

function renderSelectionDetails() {
  if (!selectedStudentIds || selectedStudentIds.size === 0) {
    selectionCard.innerHTML = `
      <div class="detail-name">No student selected</div>
      <div class="detail-copy">Click a roster card or a placed seat to inspect it here.</div>
    `;
    return;
  }

  if (selectedStudentIds.size === 1) {
    const sid = Array.from(selectedStudentIds)[0];
    const student = students.find((entry) => String(entry.id) === sid);
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
    if (!student.isSample) loadImmaHistoryForDetailCard(student.id);
    return;
  }

  // Multiple selected — show a compact summary
  const ids = Array.from(selectedStudentIds);
  const names = ids.slice(0, 12).map((id) => {
    const s = students.find((st) => String(st.id) === String(id));
    return s ? escHtml(getDisplayName(s)) : String(id);
  });
  selectionCard.innerHTML = `
    <div class="detail-name">${ids.length} students selected</div>
    <div class="detail-copy">${names.join(', ')}${ids.length > 12 ? ', …' : ''}</div>
  `;
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
          ${scores
            .map(
              (s) => `<tr>
            <td>${escHtml(s.academic_year)}</td>
            <td>${s.tonal != null ? s.tonal : '—'}</td>
            <td>${s.rhythm != null ? s.rhythm : '—'}</td>
          </tr>`
            )
            .join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('[imma-history] failed to load:', err);
  }
}

function getStudentsInActiveScope() {
  const showInactive = getShowInactiveStudents();

  // Graduated students live in their own bucket, exempt from the show/hide
  // inactive toggle (that toggle is only for students who may leave and
  // return within/across school years).
  if (activeClassTeacher === GRADUATED_CLASS_KEY) {
    return students.filter((student) => Boolean(student.graduated_year));
  }

  if (usingSampleRoster || activeClassTeacher === null) {
    return students.filter(
      (student) => !student.graduated_year && (showInactive || student.is_active !== 0)
    );
  }

  const { teacher, grade } = parseClassKey(activeClassTeacher);
  return students.filter((student) => {
    if (student.graduated_year) return false;
    if (!showInactive && student.is_active === 0) return false;
    if (normalizeTeacher(student.teacher) !== teacher) return false;
    if (grade) return (normalizeGrade(student.grade) || '') === grade;
    return true;
  });
}

function renderCounts() {
  const scopedStudents = getStudentsInActiveScope();
  const placedCount = scopedStudents.filter(
    (student) => getStudentLayout(student.id).placed
  ).length;
  document.getElementById('student-count').textContent = String(scopedStudents.length);
  document.getElementById('seated-count').textContent = String(placedCount);
  document.getElementById('roster-count').textContent = String(scopedStudents.length - placedCount);

  const teacherLabel = document.getElementById('chart-teacher-label');
  if (teacherLabel) {
    if (!usingSampleRoster && activeClassTeacher !== null) {
      const { teacher, grade } = parseClassKey(activeClassTeacher);
      const name = getTeacherLabel(teacher);
      teacherLabel.textContent = grade ? `${name} (${grade})` : name;
    } else {
      teacherLabel.textContent = '';
    }
    // Ensure the teacher-label text always fits on one line by shrinking font as needed
    fitTextToSingleLine(teacherLabel, 12);
  }
}

// Re-fit the chart teacher label when the window resizes (debounced lightly).
let _teacherLabelResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(_teacherLabelResizeTimer);
  _teacherLabelResizeTimer = setTimeout(() => {
    const el = document.getElementById('chart-teacher-label');
    if (el) fitTextToSingleLine(el, 12);
  }, 120);
});

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

function selectStudent(studentId) {
  selectedStudentId = String(studentId);
  // Keep the Set of selected IDs in sync for single selection calls.
  selectedStudentIds.clear();
  selectedStudentIds.add(selectedStudentId);
  lastSelectedIndex = students.findIndex((s) => String(s.id) === selectedStudentId);
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
  const next = current === rating ? null : rating;
  layout.assessmentRatings[activeAssessmentNumber] = next;

  // Auto-set today's date the first time a score is recorded for this column
  const key = String(activeAssessmentNumber);
  if (next !== null && !assessmentDates[key] && activeSeatingChartId) {
    const today = new Date().toISOString().slice(0, 10);
    assessmentDates[key] = today;
    try {
      await window.api.setAssessmentDateForClass(
        getActiveClassKeyForCharts(),
        currentAcademicYear || getDefaultAcademicYear(),
        activeAssessmentNumber,
        today
      );
    } catch (e) {
      console.error('[assessment-dates] auto-set failed:', e);
    }
  }

  selectedStudentId = String(studentId);
  renderWorkspace();
  try {
    await window.api.upsertAssessmentRating(
      studentId,
      currentAcademicYear || getDefaultAcademicYear(),
      activeAssessmentNumber,
      next
    );
  } catch (e) {
    console.error('[assessment] year-scoped rating save failed:', e);
  }
  await persistActiveSeatingChart();
}

function toggleAttendanceMode() {
  const nextMode = !attendanceMode;
  attendanceMode = nextMode;
  if (nextMode) {
    lsaMode = false;
    assessmentMode = false;
    // Ensure note mode is deactivated when switching to attendance
    noteMode = false;
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
    // Deactivate note mode when entering LSA
    noteMode = false;
  } else {
    manageUnitsVisible = false;
    penMode = false;
    closePenNotePopup();
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
    // Deactivate note mode when entering Assessment
    noteMode = false;
  } else {
    manageAssessmentsVisible = false;
  }
  renderWorkspace();
}

function switchView(viewName) {
  if (!['seating', 'gradebook'].includes(viewName)) return;

  // Update pill active states
  viewSeatingBtn.classList.toggle('active', viewName === 'seating');
  viewGradebookBtn.classList.toggle('active', viewName === 'gradebook');

  // Update view label text
  const labelTexts = {
    seating: 'Seating Chart View',
    gradebook: 'Gradebook View',
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
  if (
    ![
      'attendance',
      'lsa',
      'assessment',
      'rhythm',
      'movement',
      'instrument',
      'recorders',
      'imma',
    ].includes(tabName)
  ) {
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
  const student = students.find((s) => String(s.id) === String(studentId));
  if (!student || student.isSample) return;

  if (!['easy', 'medium', 'difficult'].includes(activity)) {
    return;
  }

  const current = getStudentUnitScore(student, unitNumber, activity);
  const next = current === null ? 'teacher' : current === 'teacher' ? 'eval' : null;
  setStudentUnitScore(student, unitNumber, activity, next);

  try {
    const unitScores = student.lsa_units?.[String(unitNumber)] || {};
    await window.api.upsertLsaScore(
      studentId,
      currentAcademicYear || getDefaultAcademicYear(),
      unitNumber,
      unitScores.easy || null,
      unitScores.medium || null,
      unitScores.difficult || null
    );
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
  const student = students.find((entry) => String(entry.id) === String(studentId));
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
  if (penModeBtn) penModeBtn.classList.toggle('active', penMode);
}

function renderAssessmentToggle() {
  assessmentToggleBtn.classList.toggle('active', assessmentMode);
  assessmentSubmenu.classList.toggle('open', assessmentMode);
  showAssessmentsBtn.classList.toggle('active', manageAssessmentsVisible);
  const dirLabel =
    ratingDirection === 'asc' ? '1 is Best in Rating Scales' : '4 is Best in Rating Scales';
  ratingDirectionLabel.textContent = dirLabel;
  assessLibDirectionLabel.textContent = dirLabel;
  ratingDirectionBtn.classList.toggle('active', ratingDirection === 'desc');
  assessLibDirectionBtn.classList.toggle('active', ratingDirection === 'desc');
}

function renderNoteModeToggle() {
  if (toggleNoteModeBtn) toggleNoteModeBtn.classList.toggle('active', noteMode);
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
  const hasUndo = Boolean(lastActionSnapshot);
  undoClearChartBtn.classList.toggle('hidden', !manageChartToolsVisible || !hasUndo);
  if (hasUndo) {
    try {
      const labelEl = undoClearChartBtn.querySelector('strong');
      if (labelEl) {
        let label = 'Undo';
        if (lastActionSnapshot.type === 'clear') label = 'Undo Clear Chart';
        else if (lastActionSnapshot.type === 'arrange-rows') label = 'Undo Arrange Rows';
        else if (lastActionSnapshot.type === 'arrange-circle') label = 'Undo Arrange Circle';
        else if (lastActionSnapshot.type === 'neaten-rows') label = 'Undo Neaten Rows';
        else if (lastActionSnapshot.type === 'neaten-circle') label = 'Undo Neaten Circle';
        labelEl.textContent = label;
      }
    } catch (err) {
      // ignore DOM update errors
    }
  }
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
      importBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6V3L8 7l4 4V8a4 4 0 0 1 3.87 3h2.02A6.01 6.01 0 0 0 12 6zm-4.89 5H5.09A6.01 6.01 0 0 0 12 18v3l4-4-4-4v3a4 4 0 0 1-3.89-5z"></path></svg>`;
      importBtn.addEventListener('click', (event) => {
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
  syncAptitudeToggleVisibility();
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
  renderNoteModeToggle();
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
  submenus.forEach((submenu) => {
    // Remove any previous 'first-visible' classes
    submenu
      .querySelectorAll('button.first-visible')
      .forEach((btn) => btn.classList.remove('first-visible'));
    // Find first visible button
    const firstVisible = Array.from(submenu.children).find(
      (el) => el.tagName === 'BUTTON' && !el.classList.contains('hidden')
    );
    if (firstVisible) {
      firstVisible.classList.add('first-visible');
    }
    // Remove 'first-visible' from hidden buttons just in case
    submenu
      .querySelectorAll('button.hidden.first-visible')
      .forEach((btn) => btn.classList.remove('first-visible'));
  });

  // Update note icon badges for students with notes (non-blocking)
  setTimeout(() => {
    updateNoteIconsForDisplayedStudents().catch((err) =>
      console.error('[notes] updateNoteIcons failed:', err)
    );
  }, 0);
}

// Returns the CSS class that should color a cell for a given rating number,
// accounting for ratingDirection ('asc' = 1 best, 'desc' = 4 best).
function getRatingClass(rating) {
  const ORDER_ASC = { 1: 'assess-r1', 2: 'assess-r2', 3: 'assess-r3', 4: 'assess-r4' };
  const ORDER_DESC = { 1: 'assess-r4', 2: 'assess-r3', 3: 'assess-r2', 4: 'assess-r1' };
  return (ratingDirection === 'desc' ? ORDER_DESC : ORDER_ASC)[rating] || '';
}

// Returns [1,2,3,4] or [4,3,2,1] for display order on the scale card — read
// directly via `ratingDirection` comparisons throughout the rendering code.

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
    stopHandler = (e) => {
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

  audio.play().catch((err) => console.error('[lsa-audio] play failed:', err));
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
    const rows = await window.api.getAssessmentLibrary(
      grade,
      currentAcademicYear || getDefaultAcademicYear()
    );
    const gradeMap = new Map();
    rows.forEach((row) =>
      gradeMap.set(row.assess_num, {
        name: row.name,
        scale1: row.scale1,
        scale2: row.scale2,
        scale3: row.scale3,
        scale4: row.scale4,
      })
    );
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
        .filter((s) => !s.isSample)
        .map((s) => normalizeTeacher(s.teacher))
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));

  if (allTeachers.length === 0) {
    multiGradeList.innerHTML =
      '<div class="multi-grade-empty">No teachers found. Add students with teacher names first.</div>';
    return;
  }

  multiGradeList.innerHTML = '';
  allTeachers.forEach((teacher) => {
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
    assessLibContent.innerHTML =
      '<div class="assess-lib-placeholder">Select a grade to view and edit assessments.</div>';
    return;
  }
  const gradeMap = assessmentLibraryDb.get(assessLibraryGrade) || new Map();
  assessLibContent.innerHTML = '';

  const categories = [
    { key: 'tonal', label: 'Tonal' },
    { key: 'rhythm', label: 'Rhythm' },
    { key: 'movement', label: 'Movement' },
    { key: 'instrument', label: 'Instrument' },
  ];

  const trashIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

  categories.forEach((cat) => {
    const nums = getAssessNumsForCategory(cat.key, gradeMap);

    const catHeader = document.createElement('div');
    catHeader.className = 'assess-lib-category-header';
    catHeader.textContent = cat.label;
    assessLibContent.appendChild(catHeader);

    nums.forEach((i) => {
      const entry = gradeMap.get(i) || {};
      const defaultLabel = getAssessDefaultLabel(i);
      const isExtra = i >= 101;
      const item = document.createElement('div');
      item.className = 'assess-lib-item';
      item.innerHTML = `
        <div class="assess-lib-item-header">
          <span class="assess-lib-num">${escHtml(defaultLabel)}</span>
          <span class="assess-lib-label-sep">\u2014</span>
          <input class="assess-lib-name-input" type="text" placeholder="Add a subtitle\u2026"
            value="${escHtml(entry.name || '')}" data-assess-num="${i}" data-field="name" />
          ${isExtra ? `<button class="assess-lib-delete-btn" data-assess-num="${i}" type="button" title="Delete this assessment" aria-label="Delete">${trashIcon}</button>` : ''}
        </div>
        <div class="assess-lib-scale-grid">
          ${[1, 2, 3, 4]
            .map((pos) => {
              const ratingNum = ratingDirection === 'desc' ? 5 - pos : pos;
              const colorClass =
                ['', 'assess-r1', 'assess-r2', 'assess-r3', 'assess-r4'][pos] || '';
              return `
            <div class="assess-lib-scale-item ${colorClass}">
              <label>Rating ${ratingNum}</label>
              <textarea data-assess-num="${i}" data-field="scale${pos}" placeholder="Describe rating ${ratingNum}…">${escHtml(entry[`scale${pos}`] || '')}</textarea>
            </div>`;
            })
            .join('')}
        </div>
      `;
      item.querySelectorAll('input, textarea').forEach((el) => {
        el.addEventListener('change', () => saveAssessLibItem(i, item));
      });
      if (isExtra) {
        const deleteBtn = item.querySelector('.assess-lib-delete-btn');
        if (deleteBtn) {
          deleteBtn.addEventListener('click', () => deleteExtraAssessment(assessLibraryGrade, i));
        }
      }
      assessLibContent.appendChild(item);
    });
  });
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
    await window.api.upsertAssessmentLibraryItem(
      grade,
      currentAcademicYear || getDefaultAcademicYear(),
      num,
      name,
      scale1,
      scale2,
      scale3,
      scale4
    );
    const gradeMap = assessmentLibraryDb.get(grade) || new Map();
    gradeMap.set(num, {
      name: name || null,
      scale1: scale1 || null,
      scale2: scale2 || null,
      scale3: scale3 || null,
      scale4: scale4 || null,
    });
    assessmentLibraryDb.set(grade, gradeMap);
    renderWorkspace();
  } catch (err) {
    console.error('[renderer] failed to save assessment library item:', err);
  }
}

async function addExtraAssessment(category) {
  const grade = assessLibraryGrade;
  if (!grade || !category) return;
  if (!assessmentLibraryDb.has(grade)) assessmentLibraryDb.set(grade, new Map());
  const gradeMap = assessmentLibraryDb.get(grade);
  const num = getNextExtraAssessNum(category, gradeMap);
  try {
    await window.api.upsertAssessmentLibraryItem(
      grade,
      currentAcademicYear || getDefaultAcademicYear(),
      num,
      null,
      null,
      null,
      null,
      null
    );
    gradeMap.set(num, { name: null, scale1: null, scale2: null, scale3: null, scale4: null });
    renderAssessLibContent();
    renderWorkspace();
    // Scroll the new item into view and focus its subtitle input
    setTimeout(() => {
      const newItem = assessLibContent.querySelector(
        `[data-assess-num="${num}"][data-field="name"]`
      );
      if (newItem) {
        newItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
        newItem.focus();
      }
    }, 60);
  } catch (err) {
    console.error('[renderer] failed to add extra assessment:', err);
  }
}

async function deleteExtraAssessment(grade, assessNum) {
  if (!grade || !assessNum || assessNum < 101) return;
  if (!window.api.deleteAssessmentLibraryItem) return;
  try {
    await window.api.deleteAssessmentLibraryItem(
      grade,
      currentAcademicYear || getDefaultAcademicYear(),
      assessNum
    );
    const gradeMap = assessmentLibraryDb.get(grade);
    if (gradeMap) gradeMap.delete(assessNum);
    renderAssessLibContent();
    renderWorkspace();
  } catch (err) {
    console.error('[renderer] failed to delete extra assessment:', err);
  }
}

// Note Mode: modal helpers and renderers
function toggleNoteMode() {
  const next = !noteMode;
  noteMode = next;
  if (next) {
    lsaMode = false;
    assessmentMode = false;
    attendanceMode = false;
    manageAssessmentsVisible = false;
    manageUnitsVisible = false;
  }
  renderWorkspace();
}

function openNoteEntryModal(student, note) {
  _noteModalStudent = student;
  _noteModalNoteId = note ? note.id : null;
  _noteModalOriginalNoteDate = note ? note.note_date || note.noteDate || null : null;
  if (noteEntryStudentIdInput) noteEntryStudentIdInput.value = student.id;
  if (noteEntryText) noteEntryText.value = note ? note.note_text || '' : '';
  if (noteEntryType) noteEntryType.value = note ? note.note_type || '' : '';
  if (noteEntryDate)
    noteEntryDate.value = note ? note.note_date || getTodayIsoDate() : getTodayIsoDate();
  const titleEl = document.getElementById('note-entry-modal-title');
  if (titleEl) titleEl.textContent = _noteModalNoteId ? 'Edit Note' : 'Add Note';
  if (noteEntryModal) noteEntryModal.classList.remove('hidden');
  setTimeout(() => noteEntryText?.focus(), 50);
}

function closeNoteEntryModal() {
  if (noteEntryModal) noteEntryModal.classList.add('hidden');
  _noteModalNoteId = null;
  _noteModalStudent = null;
  _noteModalOriginalNoteDate = null;
  if (noteEntryStudentIdInput) noteEntryStudentIdInput.value = '';
  if (noteEntryText) noteEntryText.value = '';
  if (noteEntryType) noteEntryType.value = '';
  if (noteEntryDate) noteEntryDate.value = '';
}

async function loadAndRenderStudentNotes(studentId) {
  const listEl = document.getElementById('view-notes-list');
  if (!listEl) return;
  listEl.innerHTML = '<div class="assess-lib-placeholder">Loading notes…</div>';
  try {
    const year = currentAcademicYear || getDefaultAcademicYear();
    const notes = await window.api.getStudentNotes(Number(studentId), year);
    if (!notes || notes.length === 0) {
      listEl.innerHTML =
        '<div class="assess-lib-placeholder">No notes for this student in the selected year.</div>';
    } else {
      listEl.innerHTML = '';
      notes.forEach((n) => {
        const isFollowUp = !!n.parent_note_id;
        const item = document.createElement('div');
        item.className = 'assess-lib-item' + (isFollowUp ? ' note-followup' : '');
        if (isFollowUp) {
          item.style.cssText =
            'margin-left:28px;border-left:3px solid var(--accent,#5b8dd9);padding-left:10px;';
        }
        const date = n.note_date || (n.updated_at ? n.updated_at.split(' ')[0] : '');
        item.innerHTML = `
          <div class="assess-lib-item-display" style="display:flex;flex-direction:column;">
            <div class="assess-lib-item-header" style="display:flex;align-items:flex-start;gap:10px;">
              <span class="assess-lib-num">${isFollowUp ? '&#8627;&nbsp;' : ''}${formatDateHeader(date)}</span>
              <span class="assess-lib-label-sep">\u2014</span>
              <div class="note-text-display" style="flex:1">${escHtml(n.note_text || '')}</div>
              <div class="assess-lib-controls" style="display:flex;gap:6px;margin-left:8px;flex-shrink:0;align-items:center">
                ${!isFollowUp ? `<button class="action-btn sub-action-btn view-note-followup" data-note-id="${n.id}" type="button" title="Add a follow-up note">Follow-up</button>` : ''}
                <button class="note-icon-btn view-note-edit" data-note-id="${n.id}" type="button" title="Edit note" aria-label="Edit note" style="background:none;border:none;cursor:pointer;padding:3px;color:var(--ink,#333);opacity:0.7" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'/><path d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'/></svg></button>
                <button class="note-icon-btn view-note-delete" data-note-id="${n.id}" type="button" title="Delete note" aria-label="Delete note" style="background:none;border:none;cursor:pointer;padding:3px;color:#c0392b;opacity:0.7" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.7"><svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><polyline points='3 6 5 6 21 6'/><path d='M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6'/><path d='M10 11v6'/><path d='M14 11v6'/><path d='M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2'/></svg></button>
              </div>
            </div>
            <div class="assess-lib-item-meta" style="font-size:0.82rem;color:var(--ink-light);margin-top:6px">${escHtml(n.note_type || '')}</div>
          </div>
          <div class="assess-lib-item-edit" style="display:none;margin-top:8px;">
            <textarea class="note-edit-text" rows="3" style="width:100%"></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
              <select class="note-edit-type">
                <option value="">Select type…</option>
                <option value="affirmation">Affirmation</option>
                <option value="general">General</option>
                <option value="behavior-t1">Behavior (Tier 1)</option>
                <option value="incident-minor">Incident - Minor</option>
                <option value="incident-major">Incident - Major</option>
                <option value="home-contact">Home Contact Log</option>
              </select>
              <input type="date" class="note-edit-date" />
              <button class="btn-primary note-edit-save">Save</button>
              <button class="btn-cancel note-edit-cancel">Cancel</button>
            </div>
          </div>
          <div class="note-followup-form" style="display:none;margin-top:8px;margin-left:28px;border-left:3px solid var(--accent,#5b8dd9);padding-left:10px;">
            <textarea class="followup-text" rows="2" style="width:100%" placeholder="Follow-up note…"></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-top:6px">
              <select class="followup-type">
                <option value="">Select type…</option>
                <option value="affirmation">Affirmation</option>
                <option value="general">General</option>
                <option value="behavior-t1">Behavior (Tier 1)</option>
                <option value="incident-minor">Incident - Minor</option>
                <option value="incident-major">Incident - Major</option>
                <option value="home-contact">Home Contact Log</option>
              </select>
              <input type="date" class="followup-date" />
              <button class="btn-primary followup-save">Add Follow-up</button>
              <button class="btn-cancel followup-cancel">Cancel</button>
            </div>
          </div>
        `;
        listEl.appendChild(item);

        const displayDiv = item.querySelector('.assess-lib-item-display');
        const editDiv = item.querySelector('.assess-lib-item-edit');
        const textarea = item.querySelector('.note-edit-text');
        const typeSelect = item.querySelector('.note-edit-type');
        const dateInput = item.querySelector('.note-edit-date');
        const editBtn = item.querySelector('.view-note-edit');
        const deleteBtn = item.querySelector('.view-note-delete');
        const saveBtn = item.querySelector('.note-edit-save');
        const cancelBtn = item.querySelector('.note-edit-cancel');

        if (textarea) textarea.value = n.note_text || '';
        if (typeSelect) typeSelect.value = n.note_type || '';
        if (dateInput) dateInput.value = n.note_date || getTodayIsoDate();

        if (editBtn) {
          editBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            displayDiv.style.display = 'none';
            editDiv.style.display = 'block';
            textarea.focus();
          });
        }

        if (cancelBtn) {
          cancelBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            editDiv.style.display = 'none';
            displayDiv.style.display = 'block';
          });
        }

        if (saveBtn) {
          saveBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const newText = textarea.value.trim();
            if (!newText) {
              alert('Note cannot be empty.');
              return;
            }
            const newType = typeSelect.value || null;
            const newDate = dateInput.value || getTodayIsoDate();
            try {
              await window.api.updateStudentNote(n.id, newText, newType, newDate);
              await loadAndRenderStudentNotes(studentId);
              try {
                await updateNoteIconsForDisplayedStudents();
              } catch (err) {
                console.error('[notes] badge update failed after inline save:', err);
              }
            } catch (err) {
              console.error('[notes] failed to save note:', err);
              alert('Failed to save note.');
            }
          });
        }

        // Keyboard shortcuts for inline edit: Enter (save), Escape (cancel). Shift+Enter inserts newline.
        if (textarea) {
          textarea.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
              ev.stopPropagation();
              if (cancelBtn) cancelBtn.click();
            } else if (ev.key === 'Enter' && !ev.shiftKey) {
              ev.preventDefault();
              if (saveBtn) saveBtn.click();
            }
          });
        }

        if (deleteBtn) {
          deleteBtn.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            if (!confirm('Delete this note?')) return;
            try {
              const ok = await window.api.deleteStudentNote(n.id);
              if (!ok) {
                console.error('[notes] delete returned false for id', n.id);
                alert('Failed to delete note: no rows affected.');
                return;
              }
              await loadAndRenderStudentNotes(studentId);
              try {
                await updateNoteIconsForDisplayedStudents();
              } catch (err) {
                console.error('[notes] badge update failed after delete:', err);
              }
            } catch (err) {
              console.error('[notes] failed to delete note:', err);
              alert('Failed to delete note: ' + (err && err.message ? err.message : String(err)));
            }
          });
        }

        // Follow-up button — only present on root notes (no parent)
        const followUpBtn = item.querySelector('.view-note-followup');
        const followUpForm = item.querySelector('.note-followup-form');
        if (followUpBtn && followUpForm) {
          const fuText = followUpForm.querySelector('.followup-text');
          const fuType = followUpForm.querySelector('.followup-type');
          const fuDate = followUpForm.querySelector('.followup-date');
          const fuSave = followUpForm.querySelector('.followup-save');
          const fuCancel = followUpForm.querySelector('.followup-cancel');

          // Pre-fill form defaults matching the parent note's type
          if (fuType) fuType.value = n.note_type || '';
          if (fuDate) fuDate.value = getTodayIsoDate();

          followUpBtn.addEventListener('click', (ev) => {
            ev.stopPropagation();
            // Close inline edit if open
            editDiv.style.display = 'none';
            displayDiv.style.display = 'flex';
            followUpForm.style.display = followUpForm.style.display === 'none' ? 'block' : 'none';
            if (followUpForm.style.display === 'block' && fuText) fuText.focus();
          });

          if (fuCancel) {
            fuCancel.addEventListener('click', (ev) => {
              ev.stopPropagation();
              followUpForm.style.display = 'none';
              if (fuText) fuText.value = '';
            });
          }

          if (fuSave) {
            fuSave.addEventListener('click', async (ev) => {
              ev.stopPropagation();
              const text = fuText && fuText.value.trim();
              if (!text) {
                alert('Follow-up note cannot be empty.');
                return;
              }
              const type = fuType && fuType.value ? fuType.value : null;
              const date = fuDate && fuDate.value ? fuDate.value : getTodayIsoDate();
              const academicYear = currentAcademicYear || getDefaultAcademicYear();
              try {
                await window.api.addFollowUpNote(n.id, studentId, text, type, date, academicYear);
                await loadAndRenderStudentNotes(studentId);
                try {
                  await updateNoteIconsForDisplayedStudents();
                } catch (e) {
                  /* badge update optional */
                }
              } catch (err) {
                console.error('[notes] failed to save follow-up:', err);
                alert('Failed to save follow-up note.');
              }
            });
          }

          if (fuText) {
            fuText.addEventListener('keydown', (ev) => {
              if (ev.key === 'Escape') {
                ev.stopPropagation();
                if (fuCancel) fuCancel.click();
              } else if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                if (fuSave) fuSave.click();
              }
            });
          }
        }
      });
    }
    // Quick add row (with type select and date picker)
    const quickRow = document.createElement('div');
    quickRow.className = 'assess-lib-item';
    quickRow.innerHTML = `
      <div style="display:flex;gap:8px;align-items:flex-start">
        <textarea class="assess-lib-name-input view-notes-quick-textarea" id="view-notes-quick-input" placeholder="Add a quick note…" rows="1"></textarea>
        <select id="view-notes-quick-type" class="assess-lib-grade-select" style="min-width:160px">
          <option value="">Type…</option>
          <option value="affirmation">Affirmation</option>
          <option value="general">General</option>
          <option value="behavior-t1">Behavior (Tier 1)</option>
          <option value="incident-minor">Incident - Minor</option>
          <option value="incident-major">Incident - Major</option>
          <option value="home-contact">Home Contact Log</option>
        </select>
        <input type="date" id="view-notes-quick-date" value="${getTodayIsoDate()}" />
        <button id="view-notes-add-btn" class="btn-primary">Add</button>
      </div>
    `;
    listEl.appendChild(quickRow);
    document.getElementById('view-notes-add-btn').addEventListener('click', async () => {
      const input = document.getElementById('view-notes-quick-input');
      const typeSel = document.getElementById('view-notes-quick-type');
      const dateInput = document.getElementById('view-notes-quick-date');
      const text = input && input.value.trim();
      if (!text) return;
      const noteDate = dateInput && dateInput.value ? dateInput.value : getTodayIsoDate();
      const noteType = typeSel && typeSel.value ? typeSel.value : null;
      const academicYear = currentAcademicYear || getDefaultAcademicYear();
      await window.api.addStudentNote(studentId, text, noteType, noteDate, academicYear);
      input.value = '';
      input.rows = 1;
      if (typeSel) typeSel.value = '';
      if (dateInput) dateInput.value = getTodayIsoDate();
      await loadAndRenderStudentNotes(studentId);
      try {
        await updateNoteIconsForDisplayedStudents();
      } catch (err) {
        console.error('[notes] badge update failed after quick-add:', err);
      }
    });

    // Quick-add keyboard: Enter to add, Escape to clear inputs
    const quickInputEl = document.getElementById('view-notes-quick-input');
    if (quickInputEl) {
      // Expand on focus, collapse on blur if empty
      quickInputEl.addEventListener('focus', () => {
        quickInputEl.rows = 4;
      });
      quickInputEl.addEventListener('blur', () => {
        if (!quickInputEl.value.trim()) quickInputEl.rows = 1;
      });
      quickInputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          quickInputEl.value = '';
          quickInputEl.rows = 1;
          const typeSel = document.getElementById('view-notes-quick-type');
          const dateInput = document.getElementById('view-notes-quick-date');
          if (typeSel) typeSel.value = '';
          if (dateInput) dateInput.value = getTodayIsoDate();
          quickInputEl.blur();
        } else if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          const addBtn = document.getElementById('view-notes-add-btn');
          if (addBtn) addBtn.click();
        }
      });
    }
  } catch (err) {
    console.error('[notes] failed to load notes:', err);
    listEl.innerHTML = '<div class="assess-lib-placeholder">Failed to load notes.</div>';
  }
}

function openViewNotesModal(student) {
  _noteModalStudent = student;
  const titleEl = document.getElementById('view-notes-modal-title');
  if (titleEl)
    titleEl.textContent =
      `All Notes for ${student.first_name || ''} ${student.last_name || ''}`.trim();
  if (viewNotesModal) viewNotesModal.classList.remove('hidden');
  loadAndRenderStudentNotes(student.id);
}

function closeViewNotesModal() {
  if (viewNotesModal) viewNotesModal.classList.add('hidden');
  const listEl = document.getElementById('view-notes-list');
  if (listEl) listEl.innerHTML = '';
  _noteModalStudent = null;
}

// End Note Mode helpers

// Update note icon badges for displayed students: toggles `.has-notes` on each `.note-page-btn`.
async function updateNoteIconsForDisplayedStudents() {
  try {
    const buttons = Array.from(document.querySelectorAll('.note-page-btn'));
    if (buttons.length === 0) return;
    const year = currentAcademicYear || getDefaultAcademicYear();
    const btnsByStudent = {};
    buttons.forEach((btn) => {
      const card = btn.closest('[data-student-id]');
      if (!card) return;
      const sid = String(card.dataset.studentId || '').trim();
      if (!sid) return;
      if (!btnsByStudent[sid]) btnsByStudent[sid] = [];
      btnsByStudent[sid].push(btn);
    });

    await Promise.all(
      Object.keys(btnsByStudent).map(async (sid) => {
        try {
          const notes = await window.api.getStudentNotes(Number(sid), year);
          const has = Array.isArray(notes) && notes.length > 0;
          btnsByStudent[sid].forEach((b) => b.classList.toggle('has-notes', has));
        } catch (err) {
          console.error('[notes] failed to load notes for student', sid, err);
        }
      })
    );
  } catch (err) {
    console.error('[notes] updateNoteIconsForDisplayedStudents top-level error:', err);
  }
}

function renderAssessmentLibrary() {
  const shouldShow = assessmentMode && manageAssessmentsVisible;
  assessmentsLibrary.classList.toggle('hidden', !shouldShow);

  if (!shouldShow) return;

  const grade = getActiveClassGrade() || assessLibraryGrade || 'multi';
  const gradeMap = assessmentLibraryDb.get(grade) || new Map();
  const allNums = [
    ...getAssessNumsForCategory('tonal', gradeMap),
    ...getAssessNumsForCategory('rhythm', gradeMap),
    ...getAssessNumsForCategory('movement', gradeMap),
    ...getAssessNumsForCategory('instrument', gradeMap),
  ];

  assessmentsList.innerHTML = '';
  allNums.forEach((i) => {
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
  });
}

async function openLessonLibraryForUnit(unitNumber) {
  lessonLibraryPickUnit = unitNumber;
  lessonLibraryModal.classList.remove('hidden');
  switchLessonLibTab('library');
  document.querySelector('.lesson-lib-header h3').textContent =
    `Select Image for LSA ${unitNumber}`;
  try {
    lessonLibraryLessons = (await window.api.getLsaLessons()) || [];
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
    await window.api.upsertLsaUnitAsset(
      classKey,
      unitNumber,
      lesson.image_url,
      null,
      lesson.audio_url || null
    );
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
  lessonLibraryModal.classList.remove('hidden');
  try {
    lessonLibraryLessons = (await window.api.getLsaLessons()) || [];
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
  lessonLibraryPickUnit = null;
  document.querySelector('.lesson-lib-header h3').textContent = 'Lesson Library';
  lessonLibraryModal.classList.add('hidden');
}

// Groups modal handlers
function openGroupsModal() {
  if (!groupsModal) return;
  // show modal first so dimensions are available, then apply saved position if present
  groupsModal.classList.remove('hidden');
  const modalEl = groupsModal.querySelector('.groups-modal');
  if (modalEl) {
    const stored = window.localStorage.getItem('groupsModalPos');
    if (stored) {
      try {
        const pos = JSON.parse(stored);
        const pad = 8;
        const maxLeft = Math.max(pad, window.innerWidth - modalEl.offsetWidth - pad);
        const maxTop = Math.max(pad, window.innerHeight - modalEl.offsetHeight - pad);
        let left = Math.round(Number(pos.left) || 0);
        let top = Math.round(Number(pos.top) || 0);
        if (!Number.isFinite(left) || left < pad || left > maxLeft)
          left = Math.round((window.innerWidth - modalEl.offsetWidth) / 2);
        if (!Number.isFinite(top) || top < pad || top > maxTop)
          top = Math.round(window.innerHeight * 0.12);
        modalEl.style.position = 'fixed';
        modalEl.style.left = left + 'px';
        modalEl.style.top = top + 'px';
        modalEl.style.transform = 'none';
        modalEl.style.margin = '0';
      } catch (err) {
        // invalid stored value — fall back to CSS-centered
        modalEl.style.position = '';
        modalEl.style.left = '';
        modalEl.style.top = '';
        modalEl.style.transform = '';
        modalEl.style.margin = '';
      }
    } else {
      // default CSS centering
      modalEl.style.position = '';
      modalEl.style.left = '';
      modalEl.style.top = '';
      modalEl.style.transform = '';
      modalEl.style.margin = '';
    }
  }
  updateGroupsMode();
  updateGroupsSortKeyState();
}

function closeGroupsModal() {
  if (!groupsModal) return;
  // persist current inline position (if any) so reopening restores it
  const modalEl = groupsModal.querySelector('.groups-modal');
  if (modalEl && modalEl.style && modalEl.style.left && modalEl.style.top) {
    try {
      const left = parseInt(modalEl.style.left, 10);
      const top = parseInt(modalEl.style.top, 10);
      if (!Number.isNaN(left) && !Number.isNaN(top)) {
        window.localStorage.setItem('groupsModalPos', JSON.stringify({ left, top }));
      }
    } catch (err) {
      // ignore
    }
  }
  groupsModal.classList.add('hidden');
}

function updateGroupsMode() {
  const mode = document.querySelector('input[name="groups-count-mode"]:checked')?.value || 'count';
  if (groupsCountLabel)
    groupsCountLabel.textContent = mode === 'count' ? 'Number of Groups' : 'Group Size';
  if (groupsCountInput) {
    groupsCountInput.min = 1;
    groupsCountInput.value = Math.max(1, Number(groupsCountInput.value) || 3);
  }
}

function updateGroupsSortKeyState() {
  const sortMode = document.querySelector('input[name="groups-sort"]:checked')?.value || 'alpha';
  if (!groupsSortKeyWrap) return;
  const disabled = sortMode !== 'alpha';
  groupsSortKeyWrap.classList.toggle('disabled-group', disabled);
  groupsSortKeyWrap.querySelectorAll('input[name="groups-sort-key"]').forEach((input) => {
    input.disabled = disabled;
  });
}

async function createGroups() {
  const scopedStudents = getStudentsInActiveScope().filter(
    (student) => (usingSampleRoster || !student.isSample) && student.is_active !== 0
  );
  if (scopedStudents.length === 0) {
    alert('No students found in the active class roster.');
    return;
  }

  const countMode =
    document.querySelector('input[name="groups-count-mode"]:checked')?.value || 'count';
  const countValue = Number(groupsCountInput?.value) || 3;
  const type = groupsTypeSelect?.value || 'squads';
  const sortMode = document.querySelector('input[name="groups-sort"]:checked')?.value || 'alpha';
  const sortKey = document.querySelector('input[name="groups-sort-key"]:checked')?.value || 'last';

  const arrangedStudents = [...scopedStudents];
  if (sortMode === 'alpha') {
    arrangedStudents.sort((a, b) => compareStudentsByName(a, b, sortKey));
  } else {
    // Fisher-Yates shuffle
    for (let i = arrangedStudents.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arrangedStudents[i], arrangedStudents[j]] = [arrangedStudents[j], arrangedStudents[i]];
    }
  }

  console.log('[groups] createGroups called', {
    type,
    countMode,
    countValue,
    sortMode,
    total: arrangedStudents.length,
  });
  const slots = computeGroupSlots(arrangedStudents, CANVAS_W, CANVAS_H, {
    type,
    countMode,
    countValue,
  });
  console.log('[groups] slots generated', { count: slots.length, sample: slots.slice(0, 8) });
  arrangedStudents.forEach((student, index) => {
    const layout = getStudentLayout(student.id);
    layout.placed = true;
    const slot = slots[index] || { x: layout.x || 32, y: layout.y || 32 };
    layout.x = slot.x;
    layout.y = slot.y;
  });

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function neatenGroups() {
  const placedStudents = getStudentsInActiveScope().filter(
    (student) => getStudentLayout(student.id).placed && student.is_active !== 0
  );
  if (placedStudents.length === 0) return;

  const countMode =
    document.querySelector('input[name="groups-count-mode"]:checked')?.value || 'count';
  const countValue = Number(groupsCountInput?.value) || 3;
  const type = groupsTypeSelect?.value || 'squads';

  const slots = computeGroupSlots(placedStudents, CANVAS_W, CANVAS_H, {
    type,
    countMode,
    countValue,
  });

  // Snapshot current positions before any writes so distances are computed from
  // where cards actually are, not from wherever a previous iteration placed them.
  const snapPositions = new Map(
    placedStudents.map((student) => {
      const layout = getStudentLayout(student.id);
      return [String(student.id), { x: layout.x, y: layout.y }];
    })
  );

  // Greedy nearest-slot assignment keyed by student ID (not array index) so
  // the alphabetical sort order of placedStudents cannot influence the result.
  const pairs = [];
  placedStudents.forEach((student) => {
    const pos = snapPositions.get(String(student.id));
    slots.forEach((slot, sloti) => {
      const dx = pos.x - slot.x;
      const dy = pos.y - slot.y;
      pairs.push({ studentId: String(student.id), sloti, dist2: dx * dx + dy * dy });
    });
  });

  pairs.sort((a, b) => a.dist2 - b.dist2);

  const usedStudents = new Set();
  const usedSlots = new Set();
  pairs.forEach((pair) => {
    if (usedStudents.has(pair.studentId) || usedSlots.has(pair.sloti)) return;
    usedStudents.add(pair.studentId);
    usedSlots.add(pair.sloti);
    const layout = getStudentLayout(pair.studentId);
    layout.x = slots[pair.sloti].x;
    layout.y = slots[pair.sloti].y;
  });

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function switchLessonLibTab(tab) {
  lessonLibraryTab = tab;
  document.querySelectorAll('.lesson-lib-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  document.getElementById('lesson-lib-panel-library').classList.toggle('active', tab === 'library');
  document
    .getElementById('lesson-lib-panel-assignments')
    .classList.toggle('active', tab === 'assignments');
  if (tab === 'assignments' && lessonLibrarySelectedGrade) {
    await renderGradeAssignmentsTable(lessonLibrarySelectedGrade).catch(console.error);
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
  lessonLibraryLessons.forEach((lesson) => {
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
      deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;
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
            lessonLibraryLessons = lessonLibraryLessons.map((l) =>
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
    lessonLibraryLessons = [...lessonLibraryLessons, ...result.imported].sort((a, b) =>
      (a.file_name || '').localeCompare(b.file_name || '', undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    );
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
    lessonLibraryLessons = lessonLibraryLessons.map((l) => (l.id === lessonId ? result.lesson : l));
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
    lessonLibraryLessons = lessonLibraryLessons.filter((l) => l.id !== lessonId);
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
  gradeMap.forEach((row) => {
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
    lessonLibraryLessons.forEach((lesson) => {
      const opt = document.createElement('option');
      opt.value = String(lesson.id);
      opt.textContent = lesson.file_name;
      if (assignment && assignment.lesson_id === lesson.id) opt.selected = true;
      select.appendChild(opt);
    });

    const previewTd = document.createElement('td');
    previewTd.className = 'lesson-lib-assign-preview-cell';

    // Show initial preview for currently assigned lesson
    updateAssignmentRowPreview(previewTd, assignment || null);

    select.addEventListener('change', async () => {
      const lessonId = select.value === '' ? null : Number(select.value);
      try {
        if (lessonId === null) {
          await window.api.clearLsaGradeUnitSlot(gradeLevel, i);
          updateAssignmentRowPreview(previewTd, null);
        } else {
          const saved = await window.api.upsertLsaGradeUnitMap(gradeLevel, i, lessonId);
          updateAssignmentRowPreview(
            previewTd,
            saved || { image_url: lessonLibraryLessons.find((l) => l.id === lessonId)?.image_url }
          );
        }
        await loadLsaUnitPromptImages(false);
        renderWorkspace();
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
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'student_number', label: 'Student ID #', required: false },
  { key: 'grade', label: 'Grade', required: false },
  { key: 'teacher', label: 'Teacher', required: false },
  { key: 'email', label: 'Email', required: false },
  { key: 'notes', label: 'Notes', required: false },
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
            if (normalized[i + 1] === '"') {
              field += '"';
              i += 2;
            } else {
              i++;
              break;
            }
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
      if (i < normalized.length && normalized[i] === ',') {
        i++;
      } else {
        break;
      }
    }
    if (i < normalized.length && normalized[i] === '\n') i++;
    if (!(row.length === 1 && row[0] === '')) rows.push(row);
  }
  return rows;
}

function autoDetectCsvMapping(headers) {
  const mapping = {};
  const normalized = headers.map((h) =>
    h
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]/g, '')
  );
  const matchers = {
    first_name: ['firstname', 'first', 'fname', 'givenname', 'preferredname', 'studentfirstname'],
    last_name: ['lastname', 'last', 'lname', 'surname', 'familyname', 'studentlastname'],
    student_number: [
      'studentnumber',
      'studentid',
      'studentnum',
      'idnumber',
      'id',
      'localid',
      'sis',
    ],
    grade: ['grade', 'gradelevel', 'gradelvl', 'level'],
    teacher: ['teacher', 'teachername', 'instructor', 'classroom', 'homeroom'],
    email: ['email', 'emailaddress', 'mail', 'studentemail'],
    notes: ['notes', 'note', 'comments', 'comment', 'remarks'],
    recorder_color: ['recordercolor', 'recorder', 'color', 'colour'],
  };
  CSV_IMPORT_FIELDS.forEach((field) => {
    const candidates = matchers[field.key] || [];
    const idx = normalized.findIndex((h) => candidates.includes(h));
    mapping[field.key] = idx >= 0 ? idx : -1;
  });
  return mapping;
}

function openCsvImportModal() {
  // Reset state
  csvParsedRows = [];
  csvMapping = {};
  csvImporting = false;
  pendingCsvImport = null;
  csvResolvePanel.classList.add('hidden');
  csvFileInput.value = '';
  csvFileNameDisplay.textContent = '';
  csvStep1Next.disabled = true;
  csvImportResult.classList.add('hidden');
  csvImportResult.className = 'csv-import-result hidden';
  csvStep3Import.textContent = 'Import Students';
  csvStep3Import.disabled = false;
  csvStep3Back.disabled = false;
  goToCsvStep(1, true);
  csvImportModal.classList.remove('hidden');
}

function closeCsvImportModal() {
  csvImportModal.classList.add('hidden');
  csvImporting = false;
  pendingCsvImport = null;
}

// --- Merge Duplicate Students ---
const MERGE_FIELD_LABELS = {
  first_name: 'First Name',
  last_name: 'Last Name',
  email: 'Email',
  grade: 'Grade',
  teacher: 'Teacher',
  notes: 'Notes',
  lsa_easy: 'LSA Easy',
  lsa_medium: 'LSA Medium',
  lsa_difficult: 'LSA Difficult',
  recorder_color: 'Recorder Color',
  student_number: 'Student Number',
  color_dot: 'Color Dot',
  imma_t: 'IMMA Tonal',
  imma_r: 'IMMA Rhythm',
  graduated_year: 'Graduated Year',
};

const MERGE_TABLE_ROW_FORMATTERS = {
  seating_chart_items: (row) =>
    `${row.placed ? 'Placed' : 'Unplaced'}${row.attendance ? `, attendance: ${row.attendance}` : ''}`,
  attendance_records: (row) => `Status: ${row.status ?? '\u2014'}`,
  imma_scores: (row) => `Tonal ${row.tonal ?? '\u2014'}, Rhythm ${row.rhythm ?? '\u2014'}`,
  assessment_ratings: (row) => `Rating: ${row.rating ?? '\u2014'}`,
  lsa_scores: (row) =>
    `Easy ${row.easy ?? '\u2014'}, Medium ${row.medium ?? '\u2014'}, Difficult ${row.difficult ?? '\u2014'}`,
  lsa_pen_notes: () => 'Handwritten note present',
};

function formatMergeFieldValue(value) {
  if (value === null || value === undefined || value === '') return '(blank)';
  return String(value);
}

async function openMergeDuplicatesModal() {
  mergeDupGroups = await window.api.getDuplicateStudentGroups();
  mergeDupKeepSelections = new Map();
  mergeDupGroups.forEach((group, index) => {
    mergeDupKeepSelections.set(index, String(group.students[0].id));
  });
  mergeDupActivePair = null;
  showMergeDupListPanel();
  renderMergeDupGroupList();
  mergeDuplicatesModal.classList.remove('hidden');
}

function closeMergeDuplicatesModal() {
  mergeDuplicatesModal.classList.add('hidden');
  mergeDupGroups = [];
  mergeDupKeepSelections = new Map();
  mergeDupActivePair = null;
}

function showMergeDupListPanel() {
  mergeDupPanelList.classList.remove('hidden');
  mergeDupPanelReview.classList.add('hidden');
}

function showMergeDupReviewPanel() {
  mergeDupPanelList.classList.add('hidden');
  mergeDupPanelReview.classList.remove('hidden');
}

function renderMergeDupGroupList() {
  mergeDupGroupListEl.innerHTML = '';

  if (mergeDupGroups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'merge-dup-empty';
    empty.textContent =
      'No duplicate students found \u2014 every first/last name combination is unique.';
    mergeDupGroupListEl.appendChild(empty);
    return;
  }

  mergeDupGroups.forEach((group, groupIndex) => {
    const wrap = document.createElement('div');
    wrap.className = 'merge-dup-group';
    const keepId = mergeDupKeepSelections.get(groupIndex);

    const title = document.createElement('div');
    title.className = 'merge-dup-group-title';
    title.textContent = `${getDisplayName(group.students[0])} (${group.students.length} records)`;
    wrap.appendChild(title);

    group.students.forEach((student) => {
      const row = document.createElement('div');
      row.className = 'merge-dup-member';

      const left = document.createElement('div');
      left.className = 'merge-dup-member-left';

      const label = document.createElement('label');
      label.className = 'merge-dup-member-label';
      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = `merge-dup-keep-${groupIndex}`;
      radio.value = String(student.id);
      radio.checked = String(student.id) === keepId;
      radio.addEventListener('change', () => {
        mergeDupKeepSelections.set(groupIndex, String(student.id));
        renderMergeDupGroupList();
      });
      label.appendChild(radio);
      label.appendChild(document.createTextNode(' Keep this one'));

      const meta = document.createElement('div');
      meta.className = 'merge-dup-member-meta';
      meta.textContent = `${student.grade || 'Ungraded'} \u00b7 ${getTeacherLabel(student.teacher)}${
        student.student_number ? ` \u00b7 #${student.student_number}` : ''
      }${student.is_active === 0 ? ' \u00b7 Inactive' : ''}`;

      left.appendChild(label);
      left.appendChild(meta);
      row.appendChild(left);

      if (String(student.id) !== keepId) {
        const reviewBtn = document.createElement('button');
        reviewBtn.type = 'button';
        reviewBtn.className = 'btn-cancel merge-dup-review-btn';
        reviewBtn.textContent = 'Review & Merge';
        reviewBtn.addEventListener('click', () => openMergeDupReview(Number(keepId), student.id));
        row.appendChild(reviewBtn);
      }

      wrap.appendChild(row);
    });

    mergeDupGroupListEl.appendChild(wrap);
  });
}

async function openMergeDupReview(keepId, duplicateId) {
  try {
    const preview = await window.api.getStudentMergePreview(keepId, duplicateId);
    mergeDupActivePair = { keepId, duplicateId, preview };
    renderMergeDupReviewBody();
    showMergeDupReviewPanel();
  } catch (error) {
    console.error('[merge-duplicates] failed to load preview:', error);
    alert('Could not load a comparison for these two students. Please try again.');
  }
}

function renderMergeDupReviewBody() {
  const {
    keep,
    duplicate,
    profileConflicts,
    profileAutoFill,
    tableConflicts,
    tableAutoMoveCounts,
  } = mergeDupActivePair.preview;
  const parts = [];

  parts.push(
    `<div class="merge-dup-section-title">Merging ${escHtml(getDisplayName(duplicate))} into ${escHtml(getDisplayName(keep))}</div>`
  );

  if (profileAutoFill.length > 0) {
    parts.push('<div class="merge-dup-section-title">Blank fields filled in automatically</div>');
    parts.push('<ul class="merge-dup-autofill-list">');
    profileAutoFill.forEach((entry) => {
      parts.push(
        `<li>${escHtml(MERGE_FIELD_LABELS[entry.field] || entry.field)}: ${escHtml(formatMergeFieldValue(entry.value))}</li>`
      );
    });
    parts.push('</ul>');
  }

  if (profileConflicts.length > 0) {
    parts.push(
      '<div class="merge-dup-section-title">Conflicting profile fields \u2014 choose which to keep</div>'
    );
    profileConflicts.forEach((conflict) => {
      const name = `profile__${conflict.field}`;
      parts.push(`
        <div class="merge-conflict-row">
          <div class="merge-conflict-row-label">${escHtml(MERGE_FIELD_LABELS[conflict.field] || conflict.field)}</div>
          <div class="merge-conflict-options">
            <label class="merge-conflict-option">
              <input type="radio" name="${name}" value="keep" checked>
              ${escHtml(getDisplayName(keep))}: ${escHtml(formatMergeFieldValue(conflict.keepValue))}
            </label>
            <label class="merge-conflict-option">
              <input type="radio" name="${name}" value="duplicate">
              ${escHtml(getDisplayName(duplicate))}: ${escHtml(formatMergeFieldValue(conflict.duplicateValue))}
            </label>
          </div>
        </div>
      `);
    });
  }

  const totalAutoMove = Object.values(tableAutoMoveCounts).reduce((sum, n) => sum + n, 0);
  if (totalAutoMove > 0) {
    parts.push(
      `<div class="merge-dup-automove-note">${totalAutoMove} additional record${totalAutoMove !== 1 ? 's' : ''} (attendance, scores, seating placements, etc.) will move over automatically \u2014 no conflicts.</div>`
    );
  }

  if (tableConflicts.length > 0) {
    parts.push(
      '<div class="merge-dup-section-title">Conflicting records \u2014 choose which to keep</div>'
    );
    tableConflicts.forEach((conflict, index) => {
      const name = `table__${conflict.table}__${index}`;
      const formatter = MERGE_TABLE_ROW_FORMATTERS[conflict.table] || (() => '');
      parts.push(`
        <div class="merge-conflict-row">
          <div class="merge-conflict-row-label">${escHtml(conflict.label)}</div>
          <div class="merge-conflict-options">
            <label class="merge-conflict-option">
              <input type="radio" name="${name}" value="keep" checked>
              ${escHtml(getDisplayName(keep))}: ${escHtml(formatter(conflict.keepRow))}
            </label>
            <label class="merge-conflict-option">
              <input type="radio" name="${name}" value="duplicate">
              ${escHtml(getDisplayName(duplicate))}: ${escHtml(formatter(conflict.duplicateRow))}
            </label>
          </div>
        </div>
      `);
    });
  }

  if (
    profileConflicts.length === 0 &&
    profileAutoFill.length === 0 &&
    tableConflicts.length === 0 &&
    totalAutoMove === 0
  ) {
    parts.push(
      '<p class="merge-dup-empty">No data differences found between these two records.</p>'
    );
  }

  mergeDupReviewBody.innerHTML = parts.join('');
}

function collectMergeDupResolutions() {
  const resolutions = { profile: {}, tables: {} };
  const { profileConflicts, tableConflicts } = mergeDupActivePair.preview;

  profileConflicts.forEach((conflict) => {
    const checked = mergeDupReviewBody.querySelector(
      `input[name="profile__${conflict.field}"]:checked`
    );
    resolutions.profile[conflict.field] = checked ? checked.value : 'keep';
  });

  tableConflicts.forEach((conflict, index) => {
    const checked = mergeDupReviewBody.querySelector(
      `input[name="table__${conflict.table}__${index}"]:checked`
    );
    if (!resolutions.tables[conflict.table]) resolutions.tables[conflict.table] = {};
    resolutions.tables[conflict.table][conflict.key] = checked ? checked.value : 'keep';
  });

  return resolutions;
}

async function handleMergeDupConfirm() {
  if (!mergeDupActivePair) return;
  const { keepId, duplicateId } = mergeDupActivePair;
  const resolutions = collectMergeDupResolutions();

  mergeDupConfirmBtn.disabled = true;
  mergeDupConfirmBtn.textContent = 'Merging\u2026';
  try {
    await window.api.mergeStudents(keepId, duplicateId, resolutions);
    mergeDupActivePair = null;
    await loadStudents(true);
    await loadSeatingCharts(true);
    mergeDupGroups = await window.api.getDuplicateStudentGroups();
    mergeDupKeepSelections = new Map();
    mergeDupGroups.forEach((group, index) => {
      mergeDupKeepSelections.set(index, String(group.students[0].id));
    });
    showMergeDupListPanel();
    renderMergeDupGroupList();
    renderWorkspace();
  } catch (error) {
    console.error('[merge-duplicates] merge failed:', error);
    alert('Could not merge these students. Please try again.');
  } finally {
    mergeDupConfirmBtn.disabled = false;
    mergeDupConfirmBtn.textContent = 'Merge Students';
  }
}

function goToCsvStep(step, skipRender) {
  [1, 2, 3].forEach((n) => {
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
  CSV_IMPORT_FIELDS.forEach((field) => {
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
      previewTd.textContent = idx >= 0 && firstDataRow[idx] !== undefined ? firstDataRow[idx] : '';
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
  csvMapTbody.querySelectorAll('select[data-field-key]').forEach((select) => {
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
  if (
    lower === 'y5' ||
    lower.replace(/[^a-z0-9]/g, '') === 'young5s' ||
    lower.includes('young five') ||
    lower.includes('young 5')
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
  CSV_IMPORT_FIELDS.forEach((field) => {
    const idx = csvMapping[field.key];
    const raw = idx >= 0 && rawRow[idx] !== undefined ? String(rawRow[idx]).trim() : '';
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
    const dataRows = csvParsedRows.slice(1);
    const validRows = dataRows.filter((row) => {
      const mapped = buildMappedRow(row);
      return mapped.first_name && mapped.last_name;
    });
    const skippedCount = dataRows.length - validRows.length;
    let countText = `${validRows.length} student${validRows.length !== 1 ? 's' : ''} will be synced for ${year}`;
    if (skippedCount > 0)
      countText += ` · ${skippedCount} row${skippedCount !== 1 ? 's' : ''} skipped (missing name)`;
    countEl.textContent = countText;
  }

  const mappedFields = CSV_IMPORT_FIELDS.filter((f) => (csvMapping[f.key] ?? -1) >= 0);
  const dataRows = csvParsedRows.slice(1);
  const validRows = dataRows.filter((row) => {
    const mapped = buildMappedRow(row);
    return mapped.first_name && mapped.last_name;
  });
  const thead = document.getElementById('csv-preview-thead');
  const tbody = document.getElementById('csv-preview-tbody');
  thead.innerHTML = `<tr>${mappedFields.map((f) => `<th>${escHtml(f.label)}${f.required ? ' <span class="csv-map-required">*</span>' : ''}</th>`).join('')}</tr>`;
  tbody.innerHTML = '';

  const previewRows = validRows.slice(0, 6);
  previewRows.forEach((row) => {
    const mapped = buildMappedRow(row);
    const tr = document.createElement('tr');
    mappedFields.forEach((field) => {
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
    moreTd.style.cssText =
      'font-size:0.78rem;color:var(--ink-light);padding:6px 10px;font-style:italic;';
    moreTd.textContent = `…and ${validRows.length - 6} more`;
    moreRow.appendChild(moreTd);
    tbody.appendChild(moreRow);
  }

  csvStep3Import.disabled = validRows.length === 0;
}

async function executeCsvImport() {
  if (csvStep3Import.textContent === 'Done') {
    closeCsvImportModal();
    return;
  }
  if (csvImporting) return;
  saveCsvMapping();

  // Hard block: never allow syncing to a year that doesn't match the calendar year.
  const year = currentAcademicYear || getDefaultAcademicYear();
  if (year !== getDefaultAcademicYear()) {
    showCsvImportResult(
      'Sync blocked: selected year does not match the current school year.',
      false
    );
    return;
  }

  const dataRows = csvParsedRows.slice(1);
  const validRows = dataRows.filter((row) => {
    const mapped = buildMappedRow(row);
    return mapped.first_name && mapped.last_name;
  });

  if (validRows.length === 0) {
    showCsvImportResult(
      'No valid rows to import. Ensure First Name and Last Name columns are mapped.',
      false
    );
    return;
  }

  const csvStudents = validRows.map((row) => buildMappedRow(row));
  const syncYear = currentAcademicYear || getDefaultAcademicYear();
  const teacherColumnMapped = (csvMapping['teacher'] ?? -1) >= 0;
  const skipped = dataRows.length - validRows.length;

  csvStep3Import.disabled = true;
  csvStep3Import.textContent = 'Checking for matches…';
  let flagged = [];
  try {
    flagged = await window.api.previewCsvSync(csvStudents);
  } catch (err) {
    console.error('[csv-import] preview failed:', err);
    flagged = [];
  }
  csvStep3Import.textContent = 'Sync Students';
  csvStep3Import.disabled = false;

  if (flagged.length === 0) {
    await finishCsvImport(csvStudents, syncYear, teacherColumnMapped, {}, skipped);
    return;
  }

  pendingCsvImport = { csvStudents, syncYear, teacherColumnMapped, skipped };
  renderCsvResolveList(flagged);
  document.getElementById('csv-step-panel-3').classList.add('hidden');
  csvResolvePanel.classList.remove('hidden');
}

function renderCsvResolveList(flaggedRows) {
  csvResolveList.innerHTML = '';
  flaggedRows.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'csv-resolve-row';

    const tagLabel = item.matchType === 'ambiguous' ? 'Duplicate name' : 'Possible match';
    const info = document.createElement('div');
    info.className = 'csv-resolve-row-info';
    info.innerHTML = `<strong>${escHtml(item.row.first_name || '')} ${escHtml(item.row.last_name || '')}</strong> — Grade ${escHtml(item.row.grade || '—')} — ${escHtml(item.row.teacher || 'No teacher')}<span class="csv-resolve-row-tag ${item.matchType}">${tagLabel}</span>`;

    const select = document.createElement('select');
    select.className = 'csv-resolve-select';
    select.dataset.rowIndex = String(item.rowIndex);

    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = 'Add as new student';
    select.appendChild(newOpt);

    item.candidates.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = String(c.id);
      const status = c.graduatedYear ? 'Graduated' : c.isActive ? 'Active' : 'Inactive';
      opt.textContent = `Merge into: ${c.firstName} ${c.lastName} — Grade ${c.grade || '—'} — ${c.teacher || 'No teacher'} (${status})`;
      select.appendChild(opt);
    });
    // A single close-spelling suggestion is pre-selected; ambiguous ties (same
    // exact name, multiple candidates) default to "Add as new" to force a
    // deliberate choice rather than guessing which one to merge into.
    select.value =
      item.matchType === 'near_miss' && item.candidates.length === 1
        ? String(item.candidates[0].id)
        : 'new';

    row.appendChild(info);
    row.appendChild(select);
    csvResolveList.appendChild(row);
  });
}

async function continueCsvImportAfterResolve() {
  if (!pendingCsvImport) return;
  const manualMatches = {};
  csvResolveList.querySelectorAll('.csv-resolve-select').forEach((select) => {
    manualMatches[select.dataset.rowIndex] = select.value;
  });
  const { csvStudents, syncYear, teacherColumnMapped, skipped } = pendingCsvImport;
  pendingCsvImport = null;
  csvResolvePanel.classList.add('hidden');
  document.getElementById('csv-step-panel-3').classList.remove('hidden');
  await finishCsvImport(csvStudents, syncYear, teacherColumnMapped, manualMatches, skipped);
}

async function finishCsvImport(csvStudents, syncYear, teacherColumnMapped, manualMatches, skipped) {
  csvImporting = true;
  csvStep3Import.disabled = true;
  csvStep3Import.textContent = 'Importing…';
  csvStep3Back.disabled = true;

  let result = null;
  try {
    result = await window.api.syncStudentsFromCsv(
      csvStudents,
      syncYear,
      teacherColumnMapped,
      manualMatches
    );
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
    await loadLsaScoresForScope(true);
    await loadRecorderSongLibrary();
    await loadRecorderSongDataForScope(true);
    renderWorkspace();
  } catch (err) {
    console.error('[csv-import] failed to reload students:', err);
  }

  // Wipe any prior-year seating chart data so a reused (or retired) teacher/
  // grade combo never mixes old and new roster placements. Not scoped to
  // classes present in this CSV — a class whose entire roster moved away
  // still needs its stale chart cleared.
  let clearResult = { clearedClasses: 0 };
  try {
    clearResult = await window.api.clearStaleSeatingChartsForYear(syncYear);
    if (clearResult.clearedClasses > 0) {
      await refreshSeatingChartsList(true);
    }
  } catch (err) {
    console.error('[csv-import] failed to clear stale seating charts:', err);
  }

  const {
    updated = 0,
    created = 0,
    reactivated = 0,
    deactivated = 0,
    graduated = 0,
    unGraduated = 0,
  } = result || {};
  const parts = [];
  if (created > 0) parts.push(`${created} added`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (reactivated > 0) parts.push(`${reactivated} reactivated`);
  if (deactivated > 0) parts.push(`${deactivated} marked inactive`);
  if (graduated > 0) parts.push(`${graduated} graduated`);
  if (unGraduated > 0) parts.push(`${unGraduated} un-graduated`);
  if (skipped > 0) parts.push(`${skipped} skipped (missing name)`);
  if (clearResult.clearedClasses > 0)
    parts.push(`${clearResult.clearedClasses} class seating chart(s) reset for the new year`);
  const message = parts.length > 0 ? parts.join(', ') + '.' : 'No changes made.';

  showCsvImportResult(message, true);
  csvStep3Import.textContent = 'Done';
  csvStep3Import.disabled = false;
  csvStep3Back.disabled = true;
}

function showCsvImportResult(message, isSuccess) {
  csvImportResult.textContent = message;
  csvImportResult.className = `csv-import-result ${isSuccess ? 'success' : 'error'}`;
}

function getCurrentChartSnapshot() {
  return students
    .filter((student) => !student.isSample)
    .map((student, index) => {
      const layout = getStudentLayout(student.id) || createDefaultLayout(index);
      return {
        student_id: student.id,
        placed: Boolean(layout.placed),
        x: layout.x,
        y: layout.y,
        state: layout.state || 'ready',
        attendance: null,
        assessment_rating:
          Object.keys(layout.assessmentRatings || {}).length > 0
            ? JSON.stringify(layout.assessmentRatings)
            : null,
        color_dot: layout.color_dot ?? null,
      };
    });
}

function captureChartCanvasState() {
  return {
    circle: chartCanvas.dataset.circle || '',
    compactCircle: chartCanvas.dataset.compactCircle || '',
    superCompactCircle: chartCanvas.dataset.superCompactCircle || '',
    circleCardW: chartCanvas.style.getPropertyValue('--circle-card-w') || '',
    circleCardH: chartCanvas.style.getPropertyValue('--circle-card-h') || '',
    circleCardScale: chartCanvas.style.getPropertyValue('--circle-card-scale') || '',
    teacherCirclePos: teacherCirclePos ? { ...teacherCirclePos } : null,
  };
}

// Centralized chart-action snapshot helper so clear/arrange/neaten all capture
// the same undo payload shape before they mutate student positions or card sizing.
function captureUndoSnapshot(type) {
  lastActionSnapshot = {
    type,
    items: getCurrentChartSnapshot().map((item) => ({ ...item })),
    canvasState: captureChartCanvasState(),
  };
}

function restoreChartCanvasState(state) {
  if (!state) return;
  chartCanvas.dataset.circle = state.circle || '';
  chartCanvas.dataset.compactCircle = state.compactCircle || '';
  chartCanvas.dataset.superCompactCircle = state.superCompactCircle || '';

  if (state.circleCardW) chartCanvas.style.setProperty('--circle-card-w', state.circleCardW);
  else chartCanvas.style.removeProperty('--circle-card-w');

  if (state.circleCardH) chartCanvas.style.setProperty('--circle-card-h', state.circleCardH);
  else chartCanvas.style.removeProperty('--circle-card-h');

  if (state.circleCardScale)
    chartCanvas.style.setProperty('--circle-card-scale', state.circleCardScale);
  else chartCanvas.style.removeProperty('--circle-card-scale');

  teacherCirclePos = state.teacherCirclePos ? { ...state.teacherCirclePos } : null;
}

function getNextSeatingChartName() {
  let nextNumber = seatingCharts.length + 1;
  let candidate = `Seating Chart ${nextNumber}`;

  while (seatingCharts.some((chart) => chart.name === candidate)) {
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

  if (activeSeatingChartId && !seatingCharts.some((chart) => chart.id === activeSeatingChartId)) {
    activeSeatingChartId = null;
  }

  if (!skipRender) {
    renderWorkspace();
  }
}

async function persistActiveSeatingChart() {
  if (usingSampleRoster || !hasSelectedClassContext()) {
    return;
  }

  const realStudents = students.filter((student) => !student.isSample);
  if (realStudents.length === 0) {
    return;
  }

  const hasPlacedStudents = realStudents.some((student) => getStudentLayout(student.id)?.placed);
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
      academicYear: currentAcademicYear || getDefaultAcademicYear(),
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
      academicYear: currentAcademicYear || getDefaultAcademicYear(),
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

  input.addEventListener('keydown', (event) => {
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

async function deleteSeatingChart(chartId) {
  const chart = seatingCharts.find((entry) => entry.id === chartId);
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
  const next = !editMode;
  editMode = next;
  if (next) noteMode = false;
  renderWorkspace();
}

function toggleManageStudents() {
  const next = !manageStudentsVisible;
  manageStudentsVisible = next;
  if (next) noteMode = false;
  renderWorkspace();
}

function toggleChartTools() {
  const next = !manageChartToolsVisible;
  manageChartToolsVisible = next;
  if (next) noteMode = false;
  renderWorkspace();
}

async function selectClassTeacher(teacherKey) {
  const nextTeacher =
    teacherKey === null ? null : activeClassTeacher === teacherKey ? null : teacherKey;
  console.log('[selectClassTeacher] teacherKey:', teacherKey, 'nextTeacher:', nextTeacher);
  activeClassTeacher = nextTeacher;
  activeSeatingChartId = null;
  chartPanX = 0;
  chartPanY = 0;
  chartZoom = 1;
  applyChartPan();

  // No need to manually update showInactiveStudents here; renderWorkspace will always use the latest state

  await loadSeatingCharts(true);
  await loadLsaScoresForScope(true);
  await loadAttendanceRecordsForScope(true);
  await loadLsaUnitPlaceholderPositions(true);
  await loadLsaUnitPromptImages(true);
  await loadPenNotesForScope(true);
  await loadRecorderSongDataForScope(true);
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
  await refreshImmaScoreCache();
  renderWorkspace();
}

function toggleSeatingChartsList() {
  seatingChartsCollapsed = !seatingChartsCollapsed;
  if (seatingChartsCollapsed) seatingChartsReorderMode = false;
  renderWorkspace();
}

function toggleClassesList() {
  classesCollapsed = !classesCollapsed;
  if (classesCollapsed) classesReorderMode = false;
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
    alert(
      `Exported ${result.count} rubric${result.count !== 1 ? 's' : ''} to:\n${result.filePath}`
    );
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
  const selectedIds = new Set(exportSelectedStudentsList.map((s) => s.id));

  const allStudents = [...students].sort((a, b) => {
    const la = (a.last_name || '').toLowerCase();
    const lb = (b.last_name || '').toLowerCase();
    if (la !== lb) return la < lb ? -1 : 1;
    const fa = (a.first_name || '').toLowerCase();
    const fb = (b.first_name || '').toLowerCase();
    return fa < fb ? -1 : fa > fb ? 1 : 0;
  });

  const filtered = query
    ? allStudents.filter((s) => {
        const searchable =
          `${s.first_name} ${s.last_name} ${s.grade || ''} ${s.teacher || ''}`.toLowerCase();
        return searchable.includes(query);
      })
    : allStudents;

  const allList = document.getElementById('export-select-all-list');
  allList.innerHTML = filtered
    .map((s) => {
      const isChosen = selectedIds.has(s.id);
      const metaParts = [s.grade, s.teacher].filter(Boolean);
      const nameClass =
        s.is_active === 0 ? 'export-select-name inactive-student' : 'export-select-name';
      return `<div class="export-select-item${isChosen ? ' already-selected' : ''}" data-id="${s.id}" role="button" tabindex="0">
      <span class="${nameClass}">${s.last_name || ''}, ${s.first_name || ''}</span>
      ${metaParts.length ? `<span class="export-select-meta">${metaParts.join(' · ')}</span>` : ''}
      ${isChosen ? '<span class="export-select-check">✓</span>' : ''}
    </div>`;
    })
    .join('');

  const chosenList = document.getElementById('export-select-chosen-list');
  chosenList.innerHTML = exportSelectedStudentsList
    .map(
      (s) =>
        `<div class="export-chosen-item" data-id="${s.id}">
      <span class="export-chosen-name">${s.last_name || ''}, ${s.first_name || ''}</span>
      <button class="export-chosen-remove" data-remove-id="${s.id}" type="button" aria-label="Remove ${s.first_name}">✕</button>
    </div>`
    )
    .join('');

  const count = exportSelectedStudentsList.length;
  document.getElementById('export-selected-count').textContent =
    `${count} student${count !== 1 ? 's' : ''} selected`;
  document.getElementById('export-selected-btn').disabled = count === 0;
}

exportSelectedModal.addEventListener('click', (event) => {
  // Add student from left list
  const item = event.target.closest('.export-select-item');
  if (item) {
    const id = Number(item.dataset.id);
    if (!exportSelectedStudentsList.some((s) => s.id === id)) {
      const student = students.find((s) => s.id === id);
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
    exportSelectedStudentsList = exportSelectedStudentsList.filter((s) => s.id !== removeId);
    renderExportSelectedModal();
    return;
  }
  // Export button
  if (event.target.closest('#export-selected-btn')) {
    exportSelectedToCsv();
  }
});

document
  .getElementById('export-selected-students-btn')
  .addEventListener('click', openExportSelectedModal);
document
  .getElementById('export-selected-modal-close')
  .addEventListener('click', closeExportSelectedModal);
document
  .getElementById('export-selected-cancel-btn')
  .addEventListener('click', closeExportSelectedModal);

document
  .getElementById('export-select-search')
  .addEventListener('input', renderExportSelectedModal);

async function exportSelectedToCsv() {
  if (exportSelectedStudentsList.length === 0) return;
  try {
    const ids = exportSelectedStudentsList.map((s) => s.id);
    const result = await window.api.exportSelectedStudentsCsv(ids);
    if (result && !result.canceled) {
      console.log(`[export-selected] saved ${result.count} students to ${result.filePath}`);
      closeExportSelectedModal();
      alert(
        `Exported ${result.count} student${result.count !== 1 ? 's' : ''} to:\n${result.filePath}`
      );
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

  document.addEventListener('mouseover', (event) => {
    const el = event.target.closest('[data-tooltip]');
    if (el && el !== activeTarget) show(el, event);
  });
  document.addEventListener('mousemove', (event) => {
    if (activeTarget) position(event);
  });
  document.addEventListener('mouseout', (event) => {
    if (activeTarget && !activeTarget.contains(event.relatedTarget)) hide();
  });
})();

async function markAllPresent() {
  const scopedStudents = getStudentsInActiveScope();
  const today = getTodayIsoDate();
  const updates = [];

  scopedStudents.forEach((student) => {
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
  const student = students.find((entry) => String(entry.id) === String(studentId));
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
  const student = students.find((entry) => String(entry.id) === String(studentId));
  if (!student || student.isSample) return;
  const layout0 = getStudentLayout(student.id);
  const current = layout0?.color_dot ?? null;
  const idx = COLOR_DOT_CYCLE.indexOf(current);
  const next = COLOR_DOT_CYCLE[(idx + 1) % COLOR_DOT_CYCLE.length];

  // If this student is part of a multi-selection, apply to all selected students
  const isMultiSelect = selectedStudentIds.size > 1 && selectedStudentIds.has(String(studentId));
  const targets = isMultiSelect
    ? students.filter((s) => !s.isSample && selectedStudentIds.has(String(s.id)))
    : [student];

  const previousColors = targets.map((s) => getStudentLayout(s.id)?.color_dot ?? null);
  targets.forEach((s) => {
    const l = getStudentLayout(s.id);
    if (l) l.color_dot = next;
  });
  try {
    await persistActiveSeatingChart();
    renderWorkspace();
  } catch (error) {
    targets.forEach((s, i) => {
      const l = getStudentLayout(s.id);
      if (l) l.color_dot = previousColors[i];
    });
    console.error('[renderer] failed to save color dot:', error);
    renderWorkspace();
  }
}

// --- Color dot ring picker ---
const _ringColors = [null, 'red', 'orange', 'yellow', 'green', 'blue', 'purple'];
let _ringBackdrop = null;

function openColorDotRing(studentId, anchorEl) {
  const ring = document.getElementById('color-dot-ring');
  if (!ring) return;

  // Remove any previous backdrop
  if (_ringBackdrop) {
    _ringBackdrop.remove();
    _ringBackdrop = null;
  }

  const rect = anchorEl.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = 38; // px from center to each ring dot center

  ring.innerHTML = '';
  ring.style.left = `${cx}px`;
  ring.style.top = `${cy}px`;
  ring.style.width = '0';
  ring.style.height = '0';

  // Spread 7 dots evenly in a full circle, starting at top (−90°)
  _ringColors.forEach((color, i) => {
    const angleDeg = -90 + (360 / _ringColors.length) * i;
    const angleRad = (angleDeg * Math.PI) / 180;
    const x = Math.round(radius * Math.cos(angleRad));
    const y = Math.round(radius * Math.sin(angleRad));
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'color-ring-dot';
    dot.dataset.ringColor = color || 'none';
    dot.title = color ? color.charAt(0).toUpperCase() + color.slice(1) : 'No color';
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.addEventListener('mousedown', (ev) => ev.stopPropagation());
    dot.addEventListener('click', async (ev) => {
      ev.stopPropagation();
      closeColorDotRing();
      const student = students.find((s) => String(s.id) === String(studentId));
      if (!student || student.isSample) return;

      // If this student is part of a multi-selection, apply to all selected students
      const isMultiSelect =
        selectedStudentIds.size > 1 && selectedStudentIds.has(String(studentId));
      const targets = isMultiSelect
        ? students.filter((s) => !s.isSample && selectedStudentIds.has(String(s.id)))
        : [student];

      const previousColors = targets.map((s) => getStudentLayout(s.id)?.color_dot ?? null);
      targets.forEach((s) => {
        const l = getStudentLayout(s.id);
        if (l) l.color_dot = color;
      });
      try {
        await persistActiveSeatingChart();
        renderWorkspace();
      } catch (err) {
        targets.forEach((s, i) => {
          const l = getStudentLayout(s.id);
          if (l) l.color_dot = previousColors[i];
        });
        console.error('[renderer] failed to save color dot from ring:', err);
        renderWorkspace();
      }
    });
    ring.appendChild(dot);
  });

  ring.classList.add('visible');

  // Backdrop captures outside clicks
  _ringBackdrop = document.createElement('div');
  _ringBackdrop.className = 'color-ring-backdrop';
  _ringBackdrop.addEventListener('click', closeColorDotRing);
  _ringBackdrop.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    closeColorDotRing();
  });
  document.body.appendChild(_ringBackdrop);

  // Escape key closes
  ring._escHandler = (ev) => {
    if (ev.key === 'Escape') closeColorDotRing();
  };
  document.addEventListener('keydown', ring._escHandler);
}

function closeColorDotRing() {
  const ring = document.getElementById('color-dot-ring');
  if (ring) {
    ring.classList.remove('visible');
    if (ring._escHandler) {
      document.removeEventListener('keydown', ring._escHandler);
      ring._escHandler = null;
    }
  }
  if (_ringBackdrop) {
    _ringBackdrop.remove();
    _ringBackdrop = null;
  }
}

async function clearGoodNewsChecks() {
  const scopedStudents = getStudentsInActiveScope();
  const targetStudents = scopedStudents.filter(
    (student) => !student.isSample && Number(student.good_news_shared || 0) === 1
  );
  if (targetStudents.length === 0) {
    alert('There are no good news checks to clear.');
    return;
  }

  const confirmed = window.confirm(
    `Clear good news checks for ${targetStudents.length} ${targetStudents.length === 1 ? 'student' : 'students'}?`
  );
  if (!confirmed) {
    return;
  }

  const previousById = new Map(
    targetStudents.map((student) => [student.id, student.good_news_shared ? 1 : 0])
  );
  targetStudents.forEach((student) => {
    student.good_news_shared = 0;
  });

  try {
    await Promise.all(
      targetStudents.map((student) =>
        window.api.updateStudent(
          buildStudentUpdatePayload(student, {
            good_news_shared: 0,
          })
        )
      )
    );
    renderWorkspace();
  } catch (error) {
    targetStudents.forEach((student) => {
      student.good_news_shared = previousById.get(student.id) || 0;
    });
    console.error('[renderer] failed to clear good news checks:', error);
    alert('Could not clear good news checks. Please try again.');
    renderWorkspace();
  }
}

async function clearColorDots() {
  const scopedStudents = getStudentsInActiveScope();
  const targetStudents = scopedStudents.filter(
    (student) => !student.isSample && (getStudentLayout(student.id)?.color_dot ?? null)
  );
  if (targetStudents.length === 0) {
    alert('There are no color dots to clear.');
    return;
  }

  const confirmed = window.confirm(
    `Clear color dots for ${targetStudents.length} ${targetStudents.length === 1 ? 'student' : 'students'}?`
  );
  if (!confirmed) return;

  const previousById = new Map(
    targetStudents.map((student) => [student.id, getStudentLayout(student.id)?.color_dot ?? null])
  );
  targetStudents.forEach((student) => {
    const l = getStudentLayout(student.id);
    if (l) l.color_dot = null;
  });

  try {
    await persistActiveSeatingChart();
    renderWorkspace();
  } catch (error) {
    targetStudents.forEach((student) => {
      const l = getStudentLayout(student.id);
      if (l) l.color_dot = previousById.get(student.id);
    });
    console.error('[renderer] failed to clear color dots:', error);
    alert('Could not clear color dots. Please try again.');
    renderWorkspace();
  }
}

function setupDropZone(element, onDrop) {
  element.addEventListener('dragover', (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    element.classList.add('drag-over');
  });

  element.addEventListener('dragleave', (event) => {
    if (!element.contains(event.relatedTarget)) {
      element.classList.remove('drag-over');
    }
  });

  element.addEventListener('drop', (event) => {
    event.preventDefault();
    element.classList.remove('drag-over');
    const studentId = event.dataTransfer.getData('text/plain');
    if (!studentId) {
      return;
    }
    Promise.resolve(onDrop(studentId, event)).catch((error) => {
      console.error('[renderer] drop handler failed:', error);
    });
  });
}

async function handleChartDrop(studentId, event) {
  const cardWidth = window.innerWidth <= 720 ? 138 : 148;
  const cardHeight = lsaMode ? 118 : mode === 'circle' ? 90 : 96;
  const topPadding = 8;
  const bottomReserved = 24;
  // offsetWidth/offsetHeight are the canvas's logical CSS dimensions, unaffected by CSS transform
  const intrinsicW = CANVAS_W;
  const intrinsicH = CANVAS_H;
  const maxX = Math.max(0, intrinsicW - cardWidth - 8);
  const maxY = Math.max(topPadding, intrinsicH - cardHeight - bottomReserved);
  // Allow group payloads to contain a pickupOffset for the base card
  let pickupOffsetX = dragPickupOffset?.x ?? cardWidth / 2;
  let pickupOffsetY = dragPickupOffset?.y ?? cardHeight / 2;

  // The dataTransfer payload may contain a serialized group object.
  let parsed = null;
  try {
    parsed = JSON.parse(String(studentId));
  } catch (err) {
    parsed = null;
  }

  const shellBounds = chartShell.getBoundingClientRect();

  if (parsed && parsed.group && Array.isArray(parsed.ids)) {
    // Group drop: compute base drop position using payload pickupOffset
    const payload = parsed;
    pickupOffsetX = (payload.pickupOffset && payload.pickupOffset.x) ?? pickupOffsetX;
    pickupOffsetY = (payload.pickupOffset && payload.pickupOffset.y) ?? pickupOffsetY;
    const baseX = clamp(
      (event.clientX - shellBounds.left - chartPanX) / chartZoom - pickupOffsetX,
      8,
      maxX
    );
    const baseY = clamp(
      (event.clientY - shellBounds.top - chartPanY) / chartZoom - pickupOffsetY,
      topPadding,
      maxY
    );

    payload.ids.forEach((id) => {
      const off = (payload.offsets && payload.offsets[id]) || { dx: 0, dy: 0 };
      const layout = getStudentLayout(id);
      layout.placed = true;
      layout.x = clamp(baseX + Number(off.dx || 0), 8, maxX);
      layout.y = clamp(baseY + Number(off.dy || 0), topPadding, maxY);
    });

    // keep selection set and primary id consistent
    selectedStudentIds = new Set(parsed.ids.map(String));
    selectedStudentId = selectedStudentIds.size === 1 ? Array.from(selectedStudentIds)[0] : null;
    dragPickupOffset = null;
    renderWorkspace();
    await persistActiveSeatingChart();
    return;
  }

  // Single-item drop (fallback)
  const x = clamp(
    (event.clientX - shellBounds.left - chartPanX) / chartZoom - pickupOffsetX,
    8,
    maxX
  );
  const y = clamp(
    (event.clientY - shellBounds.top - chartPanY) / chartZoom - pickupOffsetY,
    topPadding,
    maxY
  );

  const layout = getStudentLayout(studentId);
  layout.placed = true;
  layout.x = x;
  layout.y = y;
  selectedStudentId = studentId;
  // Ensure single selection reflects this interaction
  selectedStudentIds.clear();
  selectedStudentIds.add(String(studentId));
  lastSelectedIndex = students.findIndex((s) => String(s.id) === String(studentId));
  dragPickupOffset = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function handleRosterDrop(studentId) {
  // dataTransfer may contain a serialized group payload
  let parsed = null;
  try {
    parsed = JSON.parse(String(studentId));
  } catch (err) {
    parsed = null;
  }

  if (parsed && parsed.group && Array.isArray(parsed.ids)) {
    parsed.ids.forEach((id) => {
      const layout = getStudentLayout(id);
      layout.placed = false;
    });
    // reflect selection
    selectedStudentIds = new Set(parsed.ids.map(String));
    selectedStudentId = selectedStudentIds.size === 1 ? Array.from(selectedStudentIds)[0] : null;
    dragPickupOffset = null;
    renderWorkspace();
    await persistActiveSeatingChart();
    return;
  }

  const layout = getStudentLayout(studentId);
  layout.placed = false;
  selectedStudentId = studentId;
  selectedStudentIds.clear();
  selectedStudentIds.add(String(studentId));
  dragPickupOffset = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function clearChart() {
  const placedCount = students.filter((student) => getStudentLayout(student.id).placed).length;
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

  captureUndoSnapshot('clear');

  layoutState.forEach((layout) => {
    layout.placed = false;
  });

  selectedStudentId = null;
  renderWorkspace();
  await persistActiveSeatingChart();
}

async function undoClearChart() {
  if (!lastActionSnapshot) {
    alert('Nothing to undo yet.');
    return;
  }

  const hasCurrentPlacedStudents = students.some((student) => getStudentLayout(student.id).placed);
  if (hasCurrentPlacedStudents) {
    let confirmMsg = 'Undo will replace current seating positions. Continue?';
    if (lastActionSnapshot.type === 'clear') {
      confirmMsg = 'Undo Clear will replace current seating positions. Continue?';
    } else if (lastActionSnapshot.type === 'arrange-rows') {
      confirmMsg = 'Undo Arrange Rows will replace current seating positions. Continue?';
    } else if (lastActionSnapshot.type === 'arrange-circle') {
      confirmMsg = 'Undo Arrange Circle will replace current seating positions. Continue?';
    } else if (lastActionSnapshot.type === 'neaten-rows') {
      confirmMsg = 'Undo Neaten Rows will replace current seating positions. Continue?';
    } else if (lastActionSnapshot.type === 'neaten-circle') {
      confirmMsg = 'Undo Neaten Circle will replace current seating positions. Continue?';
    }

    const overwriteConfirmed = window.confirm(confirmMsg);
    if (!overwriteConfirmed) {
      return;
    }
  }

  // Restore the saved layout snapshot and any circle sizing state captured with it.
  applySeatingChartItems(
    lastActionSnapshot.items.map((item) => ({ ...item })),
    lastActionSnapshot.canvasState && lastActionSnapshot.canvasState.circle === 'true'
      ? 'circle'
      : ''
  );
  restoreChartCanvasState(lastActionSnapshot.canvasState);
  lastActionSnapshot = null;
  renderWorkspace();
  await persistActiveSeatingChart();
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
    const frac =
      cumWeighted[si + 1] > cumWeighted[si]
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
  const BASE_W = 148;
  const count = studentList.length;
  const compact = count >= 16;
  const superCompact = count >= 23;
  const southAngle = (270 * Math.PI) / 180;

  // Mode-specific minimum card widths.
  // Attendance and LSA need extra room for their button/grid content.
  const minW = attendanceMode || lsaMode ? 92 : 68;

  // Progressive width reduction: factor 14 keeps full width at ≤14 students,
  // then narrows proportionally so the oval perimeter can hold more cards.
  const rawW = compact
    ? Math.max(minW, Math.min(BASE_W, Math.floor((BASE_W * 17) / count)))
    : BASE_W;

  const scaleFactor = superCompact ? Math.max(0.82, Math.min(0.97, 22 / count)) : 1.0;
  const circleCardW = Math.round(rawW * scaleFactor);

  // --circle-card-h is used only as min-height for regular (non-attendance, non-LSA)
  // cards to keep them from looking square when the width shrinks.
  // Attendance (~82 px) and LSA (~72 px) are naturally taller, so they don't need it.
  const regularMinH = Math.round(Math.max(46, rawW * 0.56) * scaleFactor);

  // Accurate estimated rendered heights per mode at compact padding/font.
  // Used for oval sizing and angular spacing — decoupled from the CSS min-height.
  const spacingCardH = lsaMode ? 72 : attendanceMode ? 82 : regularMinH;

  const ovalFactor = compact ? 0.44 : 0.36;

  // --- Canvas state ---
  chartCanvas.dataset.compactCircle = compact ? 'true' : '';
  chartCanvas.dataset.superCompactCircle = superCompact ? 'true' : '';
  chartCanvas.dataset.circle = 'true';
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
  const studentSpan = 2 * Math.PI - 2 * teacherHalfGap;
  const studentStart = southAngle - teacherHalfGap;
  const angles = widthAwareCircleAngles(
    rx,
    ry,
    count,
    studentStart,
    circleCardW,
    spacingCardH,
    studentSpan
  );

  return angles.map((angle) => ({
    x: cx + rx * Math.cos(angle) - circleCardW / 2,
    y: cy - ry * Math.sin(angle) - spacingCardH / 2,
  }));
}

// Compute group layout slots for different grouping modes.
// Options: { type: 'squads'|'stations'|'selfspace', countMode: 'count'|'size', countValue: number }
function computeGroupSlots(studentList, canvasW, canvasH, options = {}) {
  const type = options.type || 'squads';
  const countMode = options.countMode || 'count';
  const countValue = Number(options.countValue) || 3;
  const total = studentList.length || 0;

  const BASE_W = 148;
  const cardW = BASE_W;
  const cardH = lsaMode ? 118 : 96;
  const rowGapY = lsaMode ? 18 : 14;
  const margin = 8;

  let groupCount;
  if (countMode === 'size') {
    groupCount = Math.max(1, Math.ceil(total / Math.max(1, Math.floor(countValue))));
  } else {
    groupCount = Math.max(1, Math.floor(countValue) || 1);
  }
  groupCount = Math.min(groupCount, Math.max(1, total));

  const slots = [];
  if (total === 0) return slots;

  if (type === 'selfspace') {
    // SELF-SPACE: choose a tight grid using effective sizes that account for
    // Attendance/LSA expanded card heights. Aim for an edge gap of ~4-5px.
    const BASE_W2 = 148;
    const rawW2 = BASE_W2;
    const regularMinH2 = Math.round(Math.max(46, rawW2 * 0.56));
    const spacingCardH2 = lsaMode ? 72 : attendanceMode ? 82 : regularMinH2;

    const effW = cardW;
    const effH = Math.max(cardH, spacingCardH2);

    const availW = Math.max(100, canvasW - margin * 2);
    const availH = Math.max(100, canvasH - margin * 2 - (lsaMode ? 180 : 0));

    let best = { cols: 1, scale: 0 };
    const MIN_EDGE_GAP = 2; // target inter-card gap in px (prefer tighter grids)
    const maxColsSearch = Math.min(total, 120);
    for (let colsCandidate = 1; colsCandidate <= maxColsSearch; colsCandidate++) {
      const rowsCandidate = Math.ceil(total / colsCandidate);
      const reqW = colsCandidate * effW + (colsCandidate - 1) * MIN_EDGE_GAP;
      const reqH = rowsCandidate * effH + (rowsCandidate - 1) * MIN_EDGE_GAP;
      const scaleW = availW / Math.max(1, reqW);
      const scaleH = availH / Math.max(1, reqH);
      const scaleCandidate = Math.min(1, scaleW, scaleH);
      // Prefer larger scale; on ties prefer the wider grid (more columns)
      if (
        scaleCandidate > best.scale ||
        (Math.abs(scaleCandidate - best.scale) < 1e-6 && colsCandidate > best.cols)
      ) {
        best = { cols: colsCandidate, rows: rowsCandidate, scale: scaleCandidate };
      }
    }

    const scale = Math.max(0.25, best.scale);
    const cols = Math.max(1, Math.min(total, best.cols));
    const rows = Math.ceil(total / cols);
    const cellW = Math.max(32, Math.round(effW * scale));
    const cellH = Math.max(28, Math.round(effH * scale));
    const gapX = Math.max(2, Math.round(MIN_EDGE_GAP * scale));
    const gapY = Math.max(2, Math.round(MIN_EDGE_GAP * scale));

    const gridW = cols * cellW + Math.max(0, cols - 1) * gapX;
    const gridH = rows * cellH + Math.max(0, rows - 1) * gapY;
    const startX = Math.max(margin, Math.round((canvasW - gridW) / 2));
    const lsaTopReserve = lsaMode ? 180 : 0;
    const topOfGrid =
      lsaTopReserve + Math.max(0, Math.round((canvasH - lsaTopReserve - gridH) / 2));

    for (let i = 0; i < total; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      slots.push({
        x: startX + col * (cellW + gapX),
        y: topOfGrid + row * (cellH + gapY),
        w: cellW,
        h: cellH,
      });
    }

    return slots;
  }

  // For squads and stations we need to partition into groups
  const base = Math.floor(total / groupCount);
  let rem = total % groupCount;
  const groupSizes = new Array(groupCount).fill(0).map(() => (rem > 0 ? (rem--, base + 1) : base));
  // Trim trailing zero-size groups
  while (groupSizes.length > 0 && groupSizes[groupSizes.length - 1] === 0) groupSizes.pop();

  if (type === 'squads') {
    // Card width: scale down only if a single column wouldn't fit
    let w = cardW;
    if (w + margin * 2 > canvasW) {
      w = Math.max(68, canvasW - margin * 2);
    }

    // Divide the available canvas width into equal segments, one per column.
    // This makes the inter-column spacing grow naturally as there are fewer columns.
    const availableW = canvasW - margin * 2;
    const numCols = groupSizes.length;
    const segmentW = availableW / Math.max(1, numCols);

    const lsaTopReserve = lsaMode ? 180 : 0;

    // Compute a shared bottom edge from the tallest column so all columns are bottom-aligned
    const tallestColH = Math.max(
      ...groupSizes.map((s) => s * cardH + Math.max(0, s - 1) * rowGapY)
    );
    const bottomY =
      lsaTopReserve +
      Math.max(0, Math.round((canvasH - lsaTopReserve - tallestColH) / 2)) +
      tallestColH;

    for (let gi = 0, index = 0; gi < numCols; gi++) {
      const size = groupSizes[gi];
      // Center card within its equal-width segment
      const colX = Math.round(margin + gi * segmentW + (segmentW - w) / 2);
      const colH = size * cardH + Math.max(0, size - 1) * rowGapY;
      const topOfColumn = bottomY - colH;
      for (let k = 0; k < size; k++, index++) {
        slots.push({ x: colX, y: topOfColumn + (size - 1 - k) * (cardH + rowGapY), w, h: cardH });
      }
    }

    return slots;
  }

  // Stations: compact 2-D clusters arranged on an oval; grid-of-clusters fallback
  if (type === 'stations') {
    // Intra-cluster gaps — tight, nearly touching
    const intraGapX = 2;
    const intraGapY = 2;
    const interClusterGap = 24; // px between cluster bounding boxes
    const clusterPad = 10; // extra clearance used only during oval overlap check

    const groups = [];
    let gOffset = 0;
    for (let gi = 0; gi < groupSizes.length; gi++) {
      groups.push(studentList.slice(gOffset, gOffset + groupSizes[gi]));
      gOffset += groupSizes[gi];
    }

    // Build compact cluster: center-relative card positions + bounding box.
    // For odd n where (n-1) forms a complete rectangle, place 1 card centered
    // above the (n-1) block → T shape for n=3, pear for n=5, etc.
    function buildCluster(n) {
      const cellW = cardW + intraGapX;
      const cellH = cardH + intraGapY;
      const positions = [];

      const baseCols = Math.ceil(Math.sqrt(n > 1 && n % 2 === 1 ? n - 1 : n));
      const useTopCard = n > 1 && n % 2 === 1 && (n - 1) % baseCols === 0;

      if (useTopCard) {
        // 1 centered card on top + (n-1) card rectangular block below
        const baseRows = (n - 1) / baseCols;
        const totalRows = baseRows + 1;
        // top card
        positions.push({ x: 0, y: -((totalRows - 1) / 2) * cellH });
        // base block
        for (let i = 0; i < n - 1; i++) {
          const c = i % baseCols;
          const r = Math.floor(i / baseCols);
          positions.push({
            x: (c - (baseCols - 1) / 2) * cellW,
            y: (r + 1 - (totalRows - 1) / 2) * cellH,
          });
        }
      } else {
        // Standard grid (even n, or odd n without a clean base rectangle)
        // n=2 is a special case: stack vertically so the narrow footprint fits
        // around the oval/rectangle perimeter more easily than side-by-side.
        const cols = n === 2 ? 1 : Math.ceil(Math.sqrt(n));
        const rows = Math.ceil(n / cols);
        for (let i = 0; i < n; i++) {
          const c = i % cols;
          const r = Math.floor(i / cols);
          positions.push({
            x: (c - (cols - 1) / 2) * cellW,
            y: (r - (rows - 1) / 2) * cellH,
          });
        }
      }

      const minX = Math.min(...positions.map((p) => p.x)) - cardW / 2;
      const maxX = Math.max(...positions.map((p) => p.x)) + cardW / 2;
      const minY = Math.min(...positions.map((p) => p.y)) - cardH / 2;
      const maxY = Math.max(...positions.map((p) => p.y)) + cardH / 2;
      return { positions, footprintW: maxX - minX, footprintH: maxY - minY };
    }

    const clusterDefs = groups.map((g) => buildCluster(g.length));
    const maxClusterW = Math.max(...clusterDefs.map((c) => c.footprintW));
    const maxClusterH = Math.max(...clusterDefs.map((c) => c.footprintH));

    // Helper: emit final slots from cluster centers
    function emitStationSlots(centers) {
      for (let gi = 0; gi < groups.length; gi++) {
        const { positions } = clusterDefs[gi];
        const { cx, cy } = centers[gi];
        for (const p of positions) {
          slots.push({
            x: Math.round(cx + p.x - cardW / 2),
            y: Math.round(cy + p.y - cardH / 2),
            w: cardW,
            h: cardH,
          });
        }
      }
    }

    // --- Attempt 1: oval arrangement ---
    if (groups.length >= 2) {
      const ovalRx = Math.min(canvasW * 0.42, (canvasW - maxClusterW) / 2 - 16);
      const ovalRy = Math.min(canvasH * 0.42, (canvasH - maxClusterH) / 2 - 16);
      if (ovalRx > 0 && ovalRy > 0) {
        // Use (n-1)/n * 2π so widthAwareCircleAngles' count-1 intervals give
        // exactly 2π/n spacing — first and last clusters don't collide.
        const stationsSpan = (2 * Math.PI * (groups.length - 1)) / groups.length;
        const angles = widthAwareCircleAngles(
          ovalRx,
          ovalRy,
          groups.length,
          (270 * Math.PI) / 180 - 0.05,
          maxClusterW + clusterPad * 2,
          maxClusterH + clusterPad * 2,
          stationsSpan
        );
        const centers = angles.map((a) => ({
          cx: canvasW / 2 + ovalRx * Math.cos(a),
          cy: canvasH / 2 - ovalRy * Math.sin(a),
        }));
        // Check inter-cluster overlap (with padding)
        let anyOverlap = false;
        for (let i = 0; i < centers.length && !anyOverlap; i++) {
          const ai = {
            x: centers[i].cx - clusterDefs[i].footprintW / 2 - clusterPad,
            y: centers[i].cy - clusterDefs[i].footprintH / 2 - clusterPad,
            w: clusterDefs[i].footprintW + clusterPad * 2,
            h: clusterDefs[i].footprintH + clusterPad * 2,
          };
          for (let j = i + 1; j < centers.length; j++) {
            const bj = {
              x: centers[j].cx - clusterDefs[j].footprintW / 2 - clusterPad,
              y: centers[j].cy - clusterDefs[j].footprintH / 2 - clusterPad,
              w: clusterDefs[j].footprintW + clusterPad * 2,
              h: clusterDefs[j].footprintH + clusterPad * 2,
            };
            if (
              ai.x < bj.x + bj.w &&
              ai.x + ai.w > bj.x &&
              ai.y < bj.y + bj.h &&
              ai.y + ai.h > bj.y
            ) {
              anyOverlap = true;
              break;
            }
          }
        }
        if (!anyOverlap) {
          emitStationSlots(centers);
          return slots;
        }
      }
    }

    // --- Attempt 2: rectangle perimeter arrangement ---
    // The rect perimeter is ~27% longer than an equal oval circumference,
    // so clusters that couldn't fit on the oval often fit here.
    if (groups.length >= 2) {
      const rectRx = Math.min(canvasW * 0.42, (canvasW - maxClusterW) / 2 - 16);
      const rectRy = Math.min(canvasH * 0.42, (canvasH - maxClusterH) / 2 - 16);
      if (rectRx > 0 && rectRy > 0) {
        const perimeter = 4 * (rectRx + rectRy);
        const spacing = perimeter / groups.length;
        // Start offset puts cluster 0 at the midpoint of the top edge (matching oval's 270° start)
        const startOffset = rectRx;
        const cx0 = canvasW / 2;
        const cy0 = canvasH / 2;
        // Walk clockwise: top→right, right→bottom, bottom→left, left→top
        function rectPerimPoint(d) {
          // Normalise d into [0, perimeter)
          d = ((d % perimeter) + perimeter) % perimeter;
          // Corners of the rectangle (relative to center):
          // TL = (-rectRx, -rectRy), TR = (rectRx, -rectRy)
          // BR = (rectRx,  rectRy),  BL = (-rectRx, rectRy)
          // Side lengths: top=2*rectRx, right=2*rectRy, bottom=2*rectRx, left=2*rectRy
          // Our d=0 starts at top-center going clockwise, which is rectRx along the top edge from TL corner
          // Reframe: distance from TL corner going clockwise = d + 0 (TL is at d = -startOffset from our origin,
          // but easier to track as segment offsets)
          const sTop = 2 * rectRx;
          const sRight = 2 * rectRy;
          const sBottom = 2 * rectRx;
          // const sLeft = 2 * rectRy; // not needed explicitly
          if (d < sTop) {
            // Top edge: y = -rectRy, x goes from -rectRx+d
            return { rx: -rectRx + d, ry: -rectRy };
          } else if (d < sTop + sRight) {
            // Right edge: x = rectRx, y goes from -rectRy downward
            return { rx: rectRx, ry: -rectRy + (d - sTop) };
          } else if (d < sTop + sRight + sBottom) {
            // Bottom edge: y = rectRy, x goes from rectRx leftward
            return { rx: rectRx - (d - sTop - sRight), ry: rectRy };
          } else {
            // Left edge: x = -rectRx, y goes from rectRy upward
            return { rx: -rectRx, ry: rectRy - (d - sTop - sRight - sBottom) };
          }
        }
        // d=0 at top-center means we start TL-corner offset = startOffset along top edge
        const rectCenters = groups.map((_, gi) => {
          const d = (startOffset + gi * spacing) % perimeter;
          const { rx, ry } = rectPerimPoint(d);
          return { cx: cx0 + rx, cy: cy0 + ry };
        });
        // Overlap check (same logic as oval)
        let anyOverlap = false;
        for (let i = 0; i < rectCenters.length && !anyOverlap; i++) {
          const ai = {
            x: rectCenters[i].cx - clusterDefs[i].footprintW / 2 - clusterPad,
            y: rectCenters[i].cy - clusterDefs[i].footprintH / 2 - clusterPad,
            w: clusterDefs[i].footprintW + clusterPad * 2,
            h: clusterDefs[i].footprintH + clusterPad * 2,
          };
          for (let j = i + 1; j < rectCenters.length; j++) {
            const bj = {
              x: rectCenters[j].cx - clusterDefs[j].footprintW / 2 - clusterPad,
              y: rectCenters[j].cy - clusterDefs[j].footprintH / 2 - clusterPad,
              w: clusterDefs[j].footprintW + clusterPad * 2,
              h: clusterDefs[j].footprintH + clusterPad * 2,
            };
            if (
              ai.x < bj.x + bj.w &&
              ai.x + ai.w > bj.x &&
              ai.y < bj.y + bj.h &&
              ai.y + ai.h > bj.y
            ) {
              anyOverlap = true;
              break;
            }
          }
        }
        if (!anyOverlap) {
          emitStationSlots(rectCenters);
          return slots;
        }
      }
    }

    // --- Fallback: grid-of-cluster-blocks (visually distinct from squads) ---
    const nClusters = groups.length;
    const lsaTopReserve = lsaMode ? 180 : 0;
    // Find the column count that best fills the canvas while fitting all clusters
    let bestCols = 1;
    let bestScore = -1;
    for (let c = 1; c <= nClusters; c++) {
      const r = Math.ceil(nClusters / c);
      const totalW = c * maxClusterW + (c - 1) * interClusterGap;
      const totalH = r * maxClusterH + (r - 1) * interClusterGap;
      if (totalW + margin * 2 <= canvasW && totalH + lsaTopReserve + margin * 2 <= canvasH) {
        // Prefer aspect ratio closest to canvas
        const fillRatio =
          (totalW / (canvasW - margin * 2)) * (totalH / (canvasH - lsaTopReserve - margin * 2));
        if (fillRatio > bestScore) {
          bestScore = fillRatio;
          bestCols = c;
        }
      }
    }
    // If nothing fits cleanly (very many groups), force single row and let canvas scroll
    if (bestScore < 0)
      bestCols = Math.min(
        nClusters,
        Math.max(1, Math.floor((canvasW - margin * 2) / (maxClusterW + interClusterGap)))
      );

    const bestRows = Math.ceil(nClusters / bestCols);
    const gridTotalW = bestCols * maxClusterW + (bestCols - 1) * interClusterGap;
    const gridTotalH = bestRows * maxClusterH + (bestRows - 1) * interClusterGap;
    const gridStartX = Math.max(margin, Math.round((canvasW - gridTotalW) / 2));
    const gridStartY =
      lsaTopReserve + Math.max(margin, Math.round((canvasH - lsaTopReserve - gridTotalH) / 2));

    const centers = groups.map((_, gi) => {
      const col = gi % bestCols;
      const row = Math.floor(gi / bestCols);
      return {
        cx: gridStartX + col * (maxClusterW + interClusterGap) + maxClusterW / 2,
        cy: gridStartY + row * (maxClusterH + interClusterGap) + maxClusterH / 2,
      };
    });
    emitStationSlots(centers);
    return slots;
  }

  return slots;
}

async function autoArrangeChart(mode) {
  // Always exclude inactive students regardless of the "Show Inactive" display
  // toggle — arrangement should only place active class members.
  const scopedStudents = getStudentsInActiveScope().filter(
    (student) => (usingSampleRoster || !student.isSample) && student.is_active !== 0
  );
  if (scopedStudents.length === 0) {
    alert('No students found in the active class roster.');
    return;
  }

  const arrangedStudents = [...scopedStudents].sort((a, b) =>
    compareStudentsByName(a, b, chartArrangeSortKey)
  );

  // Save snapshot for unified undo (capture state before arranging)
  lastActionSnapshot = {
    type: mode === 'circle' ? 'arrange-circle' : 'arrange-rows',
    items: getCurrentChartSnapshot().map((item) => ({ ...item })),
    canvasState: captureChartCanvasState(),
  };

  const canvasW = CANVAS_W;
  const canvasH = CANVAS_H;
  const cardW = 148;
  const cardH = lsaMode ? 118 : mode === 'circle' ? 90 : 96;
  const colGapX = 16;
  const rowGapY = lsaMode ? 18 : 14;
  const cols = 6;
  const totalGridWidth = cols * cardW + (cols - 1) * colGapX;
  const startX = Math.max(8, (canvasW - totalGridWidth) / 2);

  // Center grid vertically; in LSA mode push it down to leave room above for the prompt card
  // (prompt card: ~22px padding + ~19px title + up to 320px image = ~361px max; 180px reserves a
  //  comfortable default-sized image slot above the top row — user can drag/resize for full expansion)
  // Always produce at least 5 rows so a 5-row room layout is always available.
  const numRows = Math.max(5, Math.ceil(arrangedStudents.length / cols));
  const gridH = numRows * cardH + Math.max(0, numRows - 1) * rowGapY;
  const lsaTopReserve = lsaMode ? 180 : 0;
  let topOfGrid = lsaTopReserve + Math.max(0, (canvasH - lsaTopReserve - gridH) / 2);
  topOfGrid = Math.max(lsaTopReserve + 8, Math.min(topOfGrid, canvasH - gridH - 8));

  if (mode === 'circle') {
    const slots = computeCircleSlots(arrangedStudents, canvasW, canvasH);
    arrangedStudents.forEach((student, index) => {
      const layout = getStudentLayout(student.id);
      layout.placed = true;
      layout.x = slots[index].x;
      layout.y = slots[index].y;
    });
  } else {
    // Switching to rows: clear any circle-mode CSS vars/data attributes so
    // cards return to full size (compact circle shrinks them via CSS variables).
    chartCanvas.dataset.compactCircle = '';
    chartCanvas.dataset.superCompactCircle = '';
    chartCanvas.dataset.circle = '';
    chartCanvas.style.removeProperty('--circle-card-w');
    chartCanvas.style.removeProperty('--circle-card-h');
    chartCanvas.style.removeProperty('--circle-card-scale');
    teacherCirclePos = null;

    arrangedStudents.forEach((student, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols); // row 0 = bottom-most
      const layout = getStudentLayout(student.id);
      layout.placed = true;
      layout.x = startX + col * (cardW + colGapX);
      layout.y = topOfGrid + (numRows - 1 - row) * (cardH + rowGapY);
    });
  }

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function neatenRows() {
  const placedStudents = getStudentsInActiveScope().filter(
    (student) => getStudentLayout(student.id).placed && student.is_active !== 0
  );
  if (placedStudents.length === 0) return;

  captureUndoSnapshot('neaten-rows');

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

  // Use same centered grid logic as autoArrangeChart rows mode.
  // Always at least 5 rows so the full room layout is available, and generate
  // a COMPLETE rectangular grid (numRows × cols) so every column position in
  // every row exists as a snap target. Partial top rows previously caused
  // misassignment when students were manually moved to empty column slots.
  const slotCount = placedStudents.length;
  const numRows = Math.max(5, Math.ceil(slotCount / cols));
  const fullSlotCount = numRows * cols;
  const gridH = numRows * cardH + Math.max(0, numRows - 1) * rowGapY;
  const lsaTopReserve = lsaMode ? 180 : 0;
  let topOfGrid = lsaTopReserve + Math.max(0, (canvasH - lsaTopReserve - gridH) / 2);
  topOfGrid = Math.max(lsaTopReserve + 8, Math.min(topOfGrid, canvasH - gridH - 8));

  const slots = [];
  for (let index = 0; index < fullSlotCount; index += 1) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    slots.push({
      x: startX + col * (cardW + colGapX),
      y: topOfGrid + (numRows - 1 - row) * (cardH + rowGapY),
    });
  }

  // Snapshot current positions before any writes so distances are computed from
  // where cards actually are, not from wherever a previous iteration placed them.
  const snapPositions = new Map(
    placedStudents.map((student) => {
      const layout = getStudentLayout(student.id);
      return [String(student.id), { x: layout.x, y: layout.y }];
    })
  );

  console.log(
    '[neatenRows] snapshot (first 6):',
    Array.from(snapPositions.entries())
      .slice(0, 6)
      .map(([id, p]) => `id=${id} (${Math.round(p.x)},${Math.round(p.y)})`)
      .join('  ')
  );
  console.log(
    '[neatenRows] slots (first 6):',
    slots
      .slice(0, 6)
      .map((s, i) => `slot${i}:(${Math.round(s.x)},${Math.round(s.y)})`)
      .join('  ')
  );

  // Round-by-round greedy: in each iteration find the globally nearest unassigned
  // (student, slot) pair and commit it. This eliminates any dependency on sort
  // stability or student-array ordering.
  const remaining = placedStudents.map((s) => ({
    id: String(s.id),
    pos: snapPositions.get(String(s.id)),
    assigned: false,
  }));
  const takenSlots = new Array(slots.length).fill(false);

  for (let round = 0; round < remaining.length; round++) {
    let minDist = Infinity;
    let bestSi = -1;
    let bestSli = -1;

    for (let si = 0; si < remaining.length; si++) {
      if (remaining[si].assigned) continue;
      const pos = remaining[si].pos;
      for (let sli = 0; sli < slots.length; sli++) {
        if (takenSlots[sli]) continue;
        const dx = pos.x - slots[sli].x;
        const dy = pos.y - slots[sli].y;
        const d = dx * dx + dy * dy;
        if (d < minDist) {
          minDist = d;
          bestSi = si;
          bestSli = sli;
        }
      }
    }

    if (bestSi >= 0 && bestSli >= 0) {
      remaining[bestSi].assigned = true;
      takenSlots[bestSli] = true;
      const layout = getStudentLayout(remaining[bestSi].id);
      layout.x = slots[bestSli].x;
      layout.y = slots[bestSli].y;
    }
  }

  renderWorkspace();
  await persistActiveSeatingChart();
}

async function neatenCircle() {
  const placedStudents = getStudentsInActiveScope().filter(
    (student) => getStudentLayout(student.id).placed && student.is_active !== 0
  );
  if (placedStudents.length === 0) return;

  captureUndoSnapshot('neaten-circle');

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
  const usedSlots = new Set();
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

  const student = id !== null ? students.find((entry) => entry.id === id) : null;
  document.getElementById('student-modal-title').textContent = student
    ? 'Edit Student'
    : 'Add Student';
  document.getElementById('student-modal-submit').textContent = student ? 'Update' : 'Save';
  document.getElementById('student-id').value = student ? student.id : '';
  document.getElementById('student-first-name').value = student ? student.first_name : '';
  document.getElementById('student-last-name').value = student ? student.last_name : '';
  document.getElementById('student-email').value = student ? student.email || '' : '';
  document.getElementById('student-number').value = student ? student.student_number || '' : '';
  document.getElementById('student-grade').value = student ? student.grade || '' : '';
  document.getElementById('student-teacher').value = student ? student.teacher || '' : '';
  document.getElementById('student-notes').value = student ? student.notes || '' : '';
  document.getElementById('student-is-active').checked = student ? student.is_active !== 0 : true;
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
function initCanvasSize() {
  const w = chartShell.offsetWidth;
  const h = chartShell.offsetHeight;
  if (w > 100 && h > 100) {
    CANVAS_W = w;
    CANVAS_H = h;
  }
  chartCanvas.style.width = `${CANVAS_W}px`;
  chartCanvas.style.height = `${CANVAS_H}px`;
}
// Deferred two frames so the window's maximize layout (and any display-scale
// zoom compensation) has fully settled before the canvas size is locked in.
requestAnimationFrame(() => requestAnimationFrame(initCanvasSize));
window.api.onDisplayScaleChanged(() => {
  requestAnimationFrame(() => requestAnimationFrame(initCanvasSize));
});

initializeWorkspace();

// ─────────────────────────────────────────────────────────────────────────────
// PRINT FEATURE
// ─────────────────────────────────────────────────────────────────────────────

// Module-level state for the print preview modal
let allPrintPages = []; // [{ printPage: HTMLElement, label: string }]
let selectedPageIndices = new Set();
let previewRefreshTimer = null;

function getPrintClassName() {
  if (usingSampleRoster) return 'Sample Roster';
  if (activeClassTeacher === null) return 'All Classes';
  const { teacher, grade } = parseClassKey(activeClassTeacher);
  const name = getTeacherLabel(teacher);
  return grade ? `${name} (${grade})` : name;
}

function buildPrintHeader(tabLabel) {
  const className = getPrintClassName();
  const dateStr = new Date().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const header = document.createElement('div');
  header.className = 'print-header';
  header.innerHTML = `${className}${tabLabel ? ' \u2014 ' + tabLabel : ''}<span class="print-date">${dateStr}</span>`;
  return header;
}

function buildSeatingChartPrintContent(namesOnly) {
  const page = document.createElement('div');
  page.className = 'print-page';
  page.appendChild(buildPrintHeader('Seating Chart'));

  const canvas = document.getElementById('chart-canvas');
  if (!canvas) return page;

  const canvasW = parseInt(canvas.style.width) || CANVAS_W || 1100;
  const canvasH = parseInt(canvas.style.height) || CANVAS_H || 720;

  const wrap = document.createElement('div');
  wrap.className = 'print-chart-wrap';
  wrap.style.width = canvasW + 'px';
  wrap.style.height = canvasH + 'px';

  if (namesOnly) {
    const cards = canvas.querySelectorAll('.chart-student');
    cards.forEach((card) => {
      const firstName = card.querySelector('.student-name-first')?.textContent?.trim() || '';
      const lastName = card.querySelector('.student-name-last')?.textContent?.trim() || '';
      const printCard = document.createElement('div');
      printCard.className = 'print-chart-card';
      printCard.style.left = card.style.left || '0px';
      printCard.style.top = card.style.top || '0px';
      printCard.textContent = lastName ? `${firstName} ${lastName}` : firstName;
      wrap.appendChild(printCard);
    });
  } else {
    const clone = canvas.cloneNode(true);
    clone.style.transform = 'none';
    clone.style.position = 'relative';
    clone.style.left = '0';
    clone.style.top = '0';
    clone.querySelectorAll('.student-edit-btn, .color-dot-btn').forEach((el) => {
      el.style.pointerEvents = 'none';
    });
    wrap.appendChild(clone);
  }

  // Scale to fit landscape letter page (995px content width after 8mm margins on letter paper).
  // Use zoom (not transform) so the layout box shrinks too — prevents a trailing blank page.
  const scale = Math.min(1, Math.min(995 / canvasW, 700 / canvasH));
  wrap.style.zoom = scale.toFixed(3);

  page.appendChild(wrap);
  return page;
}

// Splits a source table into pages that fit within the available page width.
// Returns an array of { table: HTMLTableElement, contentWidth: number }.
//
// Two strategies:
//   1. colspan-group tables (e.g. LSA): first header row has colspan cells after
//      rowspan fixed-cols. We pack whole unit groups so the two-row header stays intact.
//   2. simple tables (attendance, assessment): single header row, split by column.
function splitTableColumns(sourceTable, orientation) {
  const availableWidth = orientation === 'landscape' ? 995 : 755;

  // ── off-screen measurement ───────────────────────────────────────────────
  const measurer = document.createElement('div');
  measurer.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
  document.body.appendChild(measurer);
  const mClone = sourceTable.cloneNode(true);
  // Remove the table's explicit inline width so cells measure at their <col>-defined widths
  // rather than being stretched to the full multi-unit screen width.
  mClone.style.width = '';
  mClone.style.minWidth = '';
  mClone.style.maxWidth = '';
  measurer.appendChild(mClone);

  const mThead = mClone.querySelector('thead');
  const mHeaderRows = mThead ? [...mThead.querySelectorAll('tr')] : [];

  if (mHeaderRows.length === 0) {
    document.body.removeChild(measurer);
    const clone = sourceTable.cloneNode(true);
    clone.querySelectorAll('th, td').forEach((c) => {
      c.style.position = 'static';
    });
    return [{ table: clone, contentWidth: availableWidth }];
  }

  const firstRowCells = [...mHeaderRows[0].querySelectorAll('th')];
  // Fixed columns = first-row cells with rowspan > 1 (row#, First, Last in LSA)
  const fixedCount =
    firstRowCells.filter((th) => parseInt(th.getAttribute('rowspan') || '1') > 1).length ||
    Math.min(3, firstRowCells.length);

  const nonFixedCells = firstRowCells.slice(fixedCount);
  const hasColspanGroups =
    mHeaderRows.length >= 2 &&
    nonFixedCells.some((th) => parseInt(th.getAttribute('colspan') || '1') > 1);

  // ── path A: colspan-group header (LSA style) ────────────────────────────
  if (hasColspanGroups) {
    // Measure fixed-column total width
    const fixedWidth = firstRowCells
      .slice(0, fixedCount)
      .reduce((sum, th) => sum + Math.max(th.offsetWidth, 40), 0);

    // Leaf widths come from the sub-header row (last header row)
    const leafHeaders = [...mHeaderRows[mHeaderRows.length - 1].querySelectorAll('th')];
    const leafWidths = leafHeaders.map((th) => Math.max(th.offsetWidth, 30));

    // Build group descriptors: one entry per colspan cell in row 1
    let leafCursor = 0;
    const groups = nonFixedCells.map((th, gi) => {
      const colspan = parseInt(th.getAttribute('colspan') || '1');
      const leafIndices = Array.from({ length: colspan }, (_, i) => leafCursor + i);
      const groupWidth = leafIndices.reduce((s, li) => s + (leafWidths[li] || 30), 0);
      leafCursor += colspan;
      return { groupIndex: gi, colspan, leafIndices, groupWidth };
    });

    document.body.removeChild(measurer);

    // Pack whole groups into page buckets
    const pageGroups = [];
    let curPage = [],
      curWidth = fixedWidth;
    for (const grp of groups) {
      if (curPage.length > 0 && curWidth + grp.groupWidth > availableWidth) {
        pageGroups.push({ grps: [...curPage], contentWidth: curWidth });
        curPage = [grp];
        curWidth = fixedWidth + grp.groupWidth;
      } else {
        curPage.push(grp);
        curWidth += grp.groupWidth;
      }
    }
    if (curPage.length > 0) pageGroups.push({ grps: curPage, contentWidth: curWidth });

    if (pageGroups.length <= 1) {
      const clone = sourceTable.cloneNode(true);
      clone.querySelectorAll('th, td').forEach((c) => {
        c.style.position = 'static';
      });
      clone.style.width = '';
      clone.style.minWidth = '';
      clone.style.maxWidth = '';
      return [{ table: clone, contentWidth: curWidth }];
    }

    return pageGroups.map(({ grps: pageGrp, contentWidth }) => {
      const keepLeafSet = new Set(pageGrp.flatMap((g) => g.leafIndices));
      const keepGroupSet = new Set(pageGrp.map((g) => g.groupIndex));

      const clone = sourceTable.cloneNode(true);
      const cloneHeadRows = [...(clone.querySelector('thead')?.querySelectorAll('tr') || [])];

      // Row 1: remove non-fixed group-header cells not on this page
      let gIdx = 0;
      [...(cloneHeadRows[0]?.querySelectorAll('th') || [])].forEach((th) => {
        const isFixed = parseInt(th.getAttribute('rowspan') || '1') > 1;
        if (isFixed) {
          th.style.position = 'static';
          return;
        }
        if (!keepGroupSet.has(gIdx)) th.parentNode.removeChild(th);
        else th.style.position = 'static';
        gIdx++;
      });

      // Last header row (sub-headers): remove leaf cells not on this page
      if (cloneHeadRows.length >= 2) {
        [...cloneHeadRows[cloneHeadRows.length - 1].querySelectorAll('th')].forEach((th, i) => {
          if (!keepLeafSet.has(i)) th.parentNode.removeChild(th);
          else th.style.position = 'static';
        });
      }

      // Data rows: keep fixed cells + leaf cells on this page
      clone.querySelectorAll('tbody tr').forEach((row) => {
        [...row.querySelectorAll('td')].forEach((td, i) => {
          td.style.position = 'static';
          if (i >= fixedCount && !keepLeafSet.has(i - fixedCount)) td.parentNode.removeChild(td);
        });
      });

      // Remove <col> elements for dropped leaf columns so the table auto-sizes correctly.
      const cg = clone.querySelector('colgroup');
      if (cg) {
        [...cg.querySelectorAll('col')].forEach((col, i) => {
          if (i >= fixedCount && !keepLeafSet.has(i - fixedCount)) col.parentNode.removeChild(col);
        });
      }
      // Clear inline table width so it renders at the remaining columns' natural width.
      clone.style.width = '';
      clone.style.minWidth = '';
      clone.style.maxWidth = '';

      return { table: clone, contentWidth };
    });
  }

  // ── path B: simple single-row header ────────────────────────────────────
  const colWidths = firstRowCells.map((th) => Math.max(th.offsetWidth, 40));
  const fixedWidth = colWidths.slice(0, fixedCount).reduce((a, b) => a + b, 0);
  const totalCols = colWidths.length;
  document.body.removeChild(measurer);

  if (totalCols <= fixedCount) {
    const clone = sourceTable.cloneNode(true);
    clone.querySelectorAll('th, td').forEach((c) => {
      c.style.position = 'static';
    });
    clone.style.width = '';
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
    return [{ table: clone, contentWidth: fixedWidth }];
  }

  const pageColGroups = [];
  let colGroup = [],
    usedWidth = fixedWidth;
  for (let i = fixedCount; i < totalCols; i++) {
    if (colGroup.length > 0 && usedWidth + colWidths[i] > availableWidth) {
      pageColGroups.push({ cols: [...colGroup], contentWidth: usedWidth });
      colGroup = [i];
      usedWidth = fixedWidth + colWidths[i];
    } else {
      colGroup.push(i);
      usedWidth += colWidths[i];
    }
  }
  if (colGroup.length > 0) pageColGroups.push({ cols: colGroup, contentWidth: usedWidth });

  if (pageColGroups.length <= 1) {
    const clone = sourceTable.cloneNode(true);
    clone.querySelectorAll('th, td').forEach((c) => {
      c.style.position = 'static';
    });
    clone.style.width = '';
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
    return [{ table: clone, contentWidth: usedWidth }];
  }

  return pageColGroups.map(({ cols: dataCols, contentWidth }) => {
    const keepCols = new Set([...Array.from({ length: fixedCount }, (_, i) => i), ...dataCols]);
    const clone = sourceTable.cloneNode(true);
    clone.querySelectorAll('tr').forEach((row) => {
      [...row.querySelectorAll('th, td')].forEach((cell, idx) => {
        cell.style.position = 'static';
        if (!keepCols.has(idx)) cell.parentNode.removeChild(cell);
      });
    });
    // Remove <col> elements for dropped columns.
    const cg2 = clone.querySelector('colgroup');
    if (cg2) {
      [...cg2.querySelectorAll('col')].forEach((col, i) => {
        if (!keepCols.has(i)) col.parentNode.removeChild(col);
      });
    }
    clone.style.width = '';
    clone.style.minWidth = '';
    clone.style.maxWidth = '';
    return { table: clone, contentWidth };
  });
}

// Returns an ARRAY of .print-page elements (one per column group).
function buildGradebookTabPrintContent(panelId, tabLabel, orientation = 'portrait') {
  const sourceWrap = document.getElementById(panelId);
  const sourceTable = sourceWrap ? sourceWrap.querySelector('table') : null;

  if (!sourceTable) {
    const page = document.createElement('div');
    page.className = 'print-page';
    page.appendChild(buildPrintHeader(tabLabel));
    const empty = document.createElement('div');
    empty.className = 'print-table-wrap';
    empty.textContent = '(No data)';
    page.appendChild(empty);
    return [page];
  }

  const pageWidth = orientation === 'landscape' ? 995 : 755;
  // Printable height = paper height minus @page margins (2×8mm) minus print header (~40px).
  // Landscape letter: 8.5" × 96dpi = 816px − 61px margins − 40px header ≈ 715px.
  // Portrait  letter: 11"  × 96dpi = 1056px − 61px margins − 40px header ≈ 955px.
  const printableH = orientation === 'landscape' ? 715 : 955;

  const results = splitTableColumns(sourceTable, orientation);
  const pageCount = results.length;

  // ── Width zoom: based on the widest (fullest) column page ────────────────
  const maxContentWidth = Math.max(...results.map((r) => r.contentWidth));
  const widthZoomRaw =
    maxContentWidth > 0 && maxContentWidth < pageWidth
      ? Math.min(1.5, pageWidth / maxContentWidth)
      : 1.0;

  // ── Height zoom (landscape only): measure the table's natural rendered height
  //    and shrink to fit if it overflows one page. All column-split pages share
  //    the same row count so one measurement covers them all. ─────────────────
  let heightZoomRaw = 1.0;
  if (orientation === 'landscape' && results.length > 0) {
    const measurer = document.createElement('div');
    measurer.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;';
    document.body.appendChild(measurer);
    const testClone = results[0].table.cloneNode(true);
    measurer.appendChild(testClone);
    const tableH = testClone.offsetHeight;
    document.body.removeChild(measurer);
    if (tableH > printableH) {
      heightZoomRaw = printableH / tableH; // < 1, shrinks to fit page height
    }
  }

  // Apply the more constraining of the two zoom factors (consistent across all pages).
  const finalZoom = Math.min(widthZoomRaw, heightZoomRaw);
  const sharedZoom = finalZoom !== 1.0 ? finalZoom.toFixed(3) : null;

  return results.map(({ table }, idx) => {
    const page = document.createElement('div');
    page.className = 'print-page';
    const headerLabel = pageCount > 1 ? `${tabLabel} (${idx + 1}/${pageCount})` : tabLabel;
    page.appendChild(buildPrintHeader(headerLabel));

    const tableWrap = document.createElement('div');
    tableWrap.className = 'print-table-wrap';

    if (sharedZoom) tableWrap.style.zoom = sharedZoom;

    tableWrap.appendChild(table);
    page.appendChild(tableWrap);
    return page;
  });
}

// ── Print Preview Modal ───────────────────────────────────────────────────────

function openPrintPreviewModal() {
  if (!printPreviewModal) return;
  // Pre-check chart if seating view is currently visible
  if (ppmIncludeChart) {
    ppmIncludeChart.checked = !seatingView.classList.contains('hidden');
    updatePpmChartOptions();
  }
  // Hide Recorders tab for non-4th grade
  if (ppmRecordersWrap) {
    ppmRecordersWrap.style.display = isFourthGradeClassSelected() ? '' : 'none';
  }
  printPreviewModal.classList.remove('hidden');
  renderPreview();
}

function closePrintPreviewModal() {
  if (!printPreviewModal) return;
  printPreviewModal.classList.add('hidden');
  clearTimeout(previewRefreshTimer);
}

// Returns 'landscape' or 'portrait'. Chart inclusion forces landscape.
function getPreviewOrientation() {
  if (ppmIncludeChart && ppmIncludeChart.checked) return 'landscape';
  return document.querySelector('input[name="ppm-orientation"]:checked')?.value || 'portrait';
}

function updatePpmChartOptions() {
  if (!ppmChartOptions || !ppmIncludeChart) return;
  const chartOn = ppmIncludeChart.checked;
  ppmChartOptions.classList.toggle('disabled', !chartOn);
  const landscapeNote = document.getElementById('ppm-landscape-note');
  if (landscapeNote) landscapeNote.classList.toggle('hidden', !chartOn);
  // Mutual exclusion: chart and gradebook tabs cannot be selected together
  const conflictNote = document.getElementById('ppm-chart-conflict-note');
  if (ppmTabsSection) ppmTabsSection.classList.toggle('disabled', chartOn);
  if (conflictNote) conflictNote.classList.toggle('hidden', !chartOn);
  if (chartOn) {
    document.querySelectorAll('.ppm-tab-check').forEach((cb) => {
      cb.checked = false;
    });
  }
}

// Builds a blank class list print page: # | Name | (blank cols)
function buildBlankClassListPrintContent(colCount, orientation) {
  const page = document.createElement('div');
  page.className = 'print-page';
  page.appendChild(buildPrintHeader('Blank Class List'));

  const classStudents = getStudentsInActiveScope()
    .filter((s) => !s.isSample)
    .sort((a, b) => {
      const la = (a.last_name || '').toLowerCase();
      const lb = (b.last_name || '').toLowerCase();
      if (la !== lb) return la < lb ? -1 : 1;
      return (a.first_name || '').toLowerCase() < (b.first_name || '').toLowerCase() ? -1 : 1;
    });

  const pageWidth = orientation === 'landscape' ? 995 : 755;
  const numColW = 28;
  const nameColW = 160;
  const blankColW = Math.round(numColW * 1.5); // fixed: 1.5× the number column
  const totalW = numColW + nameColW + blankColW * colCount;
  const widthZoom = totalW > 0 ? Math.min(1.5, pageWidth / totalW) : 1.0;
  const zoom = widthZoom !== 1.0 ? widthZoom.toFixed(3) : null;

  const tableWrap = document.createElement('div');
  tableWrap.className = 'print-table-wrap';
  if (zoom) tableWrap.style.zoom = zoom;

  // Inline base styles so the table renders in the preview thumbnail
  // (the @media print sheet isn't active outside of window.print())
  const CELL_STYLE =
    'border:1px solid #ccc;padding:3px 7px;white-space:nowrap;font-size:9pt;font-family:Roboto,Arial,sans-serif;';
  const TH_STYLE = CELL_STYLE + 'background:#e8e2d5;font-weight:600;';

  const table = document.createElement('table');
  table.style.cssText =
    'border-collapse:collapse;font-size:9pt;font-family:Roboto,Arial,sans-serif;width:auto;';

  const colgroup = document.createElement('colgroup');
  [numColW, nameColW, ...Array(colCount).fill(blankColW)].forEach((w) => {
    const c = document.createElement('col');
    c.style.width = w + 'px';
    colgroup.appendChild(c);
  });
  table.appendChild(colgroup);

  const thead = document.createElement('thead');
  const hRow = document.createElement('tr');
  ['#', 'Name', ...Array(colCount).fill('')].forEach((text) => {
    const th = document.createElement('th');
    th.textContent = text;
    th.style.cssText = TH_STYLE;
    hRow.appendChild(th);
  });
  thead.appendChild(hRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  classStudents.forEach((s, idx) => {
    const tr = document.createElement('tr');
    const numTd = document.createElement('td');
    numTd.textContent = idx + 1;
    numTd.style.cssText = CELL_STYLE + 'text-align:center;';
    tr.appendChild(numTd);
    const nameTd = document.createElement('td');
    const ln = s.last_name || '',
      fn = s.first_name || '';
    nameTd.textContent = ln && fn ? `${ln}, ${fn}` : ln || fn;
    nameTd.style.cssText = CELL_STYLE;
    tr.appendChild(nameTd);
    for (let i = 0; i < colCount; i++) {
      const td = document.createElement('td');
      td.style.cssText = CELL_STYLE;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  tableWrap.appendChild(table);
  page.appendChild(tableWrap);
  return page;
}

// Builds and returns an array of { printPage, label } using existing build fns.
function buildAllPrintPages() {
  const orientation = getPreviewOrientation();
  const pages = [];

  // Seating Chart
  if (ppmIncludeChart && ppmIncludeChart.checked) {
    const mode = document.querySelector('input[name="ppm-chart-mode"]:checked')?.value || 'names';
    const page = buildSeatingChartPrintContent(mode === 'names');
    pages.push({ printPage: page, label: 'Seating Chart' });
  }

  // Gradebook tabs
  const tabPanelMap = {
    attendance: { id: 'attendance-canvas', label: 'Attendance' },
    lsa: { id: 'lsa-grid-canvas', label: 'LSA Record' },
    assessment: { id: 'assessment-grid-canvas', label: 'Tonal Assessments' },
    rhythm: { id: 'rhythm-grid-canvas', label: 'Rhythm Assessments' },
    movement: { id: 'movement-grid-canvas', label: 'Movement Assessments' },
    instrument: { id: 'instrument-grid-canvas', label: 'Instrument Assessments' },
    recorders: { id: 'recorders-grid-canvas', label: 'Recorders' },
    imma: { id: 'imma-grid-canvas', label: 'IMMA Scores' },
  };

  document.querySelectorAll('.ppm-tab-check:checked').forEach((cb) => {
    const entry = tabPanelMap[cb.value];
    if (entry) {
      buildGradebookTabPrintContent(entry.id, entry.label, orientation).forEach((p) =>
        pages.push({
          printPage: p,
          label: p.querySelector('.print-header')?.textContent?.trim() || entry.label,
        })
      );
    }
  });

  // Blank class list (handled separately — not in tabPanelMap)
  const blankListCheck = document.querySelector('.ppm-tab-check[value="blank-list"]');
  if (blankListCheck && blankListCheck.checked) {
    const colCount = Math.max(1, Math.min(30, parseInt(ppmBlankCols?.value || '5', 10)));
    pages.push({
      printPage: buildBlankClassListPrintContent(colCount, orientation),
      label: 'Blank Class List',
    });
  }

  return pages;
}

// Thumbnail size constants: content area (px) and display container (px)
const PPM_THUMB = {
  landscape: { contentW: 995, contentH: 768, displayW: 442, displayH: 341 },
  portrait: { contentW: 755, contentH: 977, displayW: 336, displayH: 435 },
};

function renderPreview() {
  if (!ppmPreviewArea) return;
  ppmPreviewArea.innerHTML = '';

  allPrintPages = buildAllPrintPages();

  if (allPrintPages.length === 0) {
    ppmPreviewArea.innerHTML = '<div class="ppm-preview-empty">Select items to preview.</div>';
    selectedPageIndices = new Set();
    updatePreviewFooter();
    return;
  }

  // Select all pages by default
  selectedPageIndices = new Set(allPrintPages.map((_, i) => i));

  const orientation = getPreviewOrientation();
  const t = PPM_THUMB[orientation] || PPM_THUMB.portrait;
  const scale = t.displayW / t.contentW;

  allPrintPages.forEach(({ printPage, label }, idx) => {
    const wrap = document.createElement('div');
    wrap.className = 'ppm-thumb-wrap';

    const thumb = document.createElement('div');
    thumb.className = 'ppm-thumb selected';

    const inner = document.createElement('div');
    inner.className = 'ppm-thumb-inner';
    inner.style.width = t.displayW + 'px';
    inner.style.height = t.displayH + 'px';

    // Clone the print page and scale it to fit the thumbnail
    const clone = printPage.cloneNode(true);
    clone.style.cssText = `
      width: ${t.contentW}px;
      min-height: ${t.contentH}px;
      transform: scale(${scale.toFixed(4)});
      transform-origin: top left;
      display: block;
      overflow: hidden;
      pointer-events: none;
    `;
    inner.appendChild(clone);
    thumb.appendChild(inner);

    const lbl = document.createElement('div');
    lbl.className = 'ppm-thumb-label';
    lbl.textContent = label;

    wrap.appendChild(thumb);
    wrap.appendChild(lbl);

    wrap.addEventListener('click', () => {
      if (selectedPageIndices.has(idx)) {
        selectedPageIndices.delete(idx);
        thumb.classList.remove('selected');
      } else {
        selectedPageIndices.add(idx);
        thumb.classList.add('selected');
      }
      updatePreviewFooter();
    });

    ppmPreviewArea.appendChild(wrap);
  });

  updatePreviewFooter();
}

function schedulePreviewRefresh() {
  clearTimeout(previewRefreshTimer);
  previewRefreshTimer = setTimeout(renderPreview, 300);
}

function updatePreviewFooter() {
  if (!ppmPrintBtn) return;
  const total = allPrintPages.length;
  const selected = selectedPageIndices.size;
  ppmPrintBtn.textContent =
    selected === total
      ? `Print ${selected} ${selected === 1 ? 'page' : 'pages'}`
      : `Print ${selected} of ${total} ${total === 1 ? 'page' : 'pages'}`;
  ppmPrintBtn.disabled = selected === 0;
}

function executePrintSelected() {
  if (selectedPageIndices.size === 0) {
    alert('Select at least one page to print.');
    return;
  }

  const orientation = getPreviewOrientation();
  closePrintPreviewModal();

  printFrame.innerHTML = '';

  const pageStyle = document.createElement('style');
  pageStyle.textContent = `@page { size: ${orientation}; margin: 8mm; }`;
  printFrame.appendChild(pageStyle);

  // Add only the selected pages (cloned from allPrintPages so modal DOM is unaffected)
  const sorted = [...selectedPageIndices].sort((a, b) => a - b);
  sorted.forEach((pageIdx, i) => {
    const clone = allPrintPages[pageIdx].printPage.cloneNode(true);
    if (i === sorted.length - 1) {
      clone.style.pageBreakAfter = 'avoid';
      clone.style.breakAfter = 'avoid';
    }
    printFrame.appendChild(clone);
  });

  window.print();

  window.addEventListener(
    'afterprint',
    () => {
      printFrame.innerHTML = '';
    },
    { once: true }
  );
}

// ── Event listeners ───────────────────────────────────────────────────────────

if (printChartBtn) printChartBtn.addEventListener('click', openPrintPreviewModal);
if (ppmClose) ppmClose.addEventListener('click', closePrintPreviewModal);
if (ppmCancel) ppmCancel.addEventListener('click', closePrintPreviewModal);
if (printPreviewModal) {
  printPreviewModal.addEventListener('click', (e) => {
    if (e.target === printPreviewModal) closePrintPreviewModal();
  });
}
if (ppmIncludeChart) {
  ppmIncludeChart.addEventListener('change', () => {
    updatePpmChartOptions();
    schedulePreviewRefresh();
  });
}
document
  .querySelectorAll('input[name="ppm-chart-mode"]')
  .forEach((r) => r.addEventListener('change', schedulePreviewRefresh));
document.querySelectorAll('.ppm-tab-check').forEach((cb) =>
  cb.addEventListener('change', () => {
    // Show/hide blank columns input when blank-list is toggled
    if (cb.value === 'blank-list' && ppmBlankColsWrap) {
      ppmBlankColsWrap.classList.toggle('hidden', !cb.checked);
    }
    // Mutual exclusion: checking any tab clears the chart selection
    if (cb.checked && ppmIncludeChart && ppmIncludeChart.checked) {
      ppmIncludeChart.checked = false;
      updatePpmChartOptions();
    }
    schedulePreviewRefresh();
  })
);
if (ppmBlankCols) ppmBlankCols.addEventListener('input', schedulePreviewRefresh);
document
  .querySelectorAll('input[name="ppm-orientation"]')
  .forEach((r) => r.addEventListener('change', schedulePreviewRefresh));
if (ppmSelectAll) {
  ppmSelectAll.addEventListener('click', () => {
    selectedPageIndices = new Set(allPrintPages.map((_, i) => i));
    ppmPreviewArea.querySelectorAll('.ppm-thumb').forEach((t) => t.classList.add('selected'));
    updatePreviewFooter();
  });
}
if (ppmDeselectAll) {
  ppmDeselectAll.addEventListener('click', () => {
    selectedPageIndices.clear();
    ppmPreviewArea.querySelectorAll('.ppm-thumb').forEach((t) => t.classList.remove('selected'));
    updatePreviewFooter();
  });
}
if (ppmPrintBtn) ppmPrintBtn.addEventListener('click', executePrintSelected);
