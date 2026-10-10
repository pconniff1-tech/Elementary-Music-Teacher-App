/* ─────────────────────────────────────────────────────────────────────────────
   MATS Web App — app.js
   Student-facing Music Aptitude Test System

   @process Browser — runs as a plain web page (PWA / hosted site), NOT inside Electron.
            There is no IPC, no Node.js, and no contextBridge here.
            All persistence is through Firebase Firestore (cloud) rather than SQLite.

   Architecture:
     - Firebase Auth  → anonymous sign-in (no student account required)
     - Firebase Firestore → stores test sessions and encrypted answers
     - Firebase Storage   → hosts audio files for questions
     - CryptoJS AES-256   → answers are encrypted before being written to Firestore
                            so raw scores are never stored in plaintext

   Dependencies (loaded via <script> tags in index.html):
     - Firebase App / Auth / Firestore / Storage (compat v10)
     - CryptoJS (for AES-256 encryption)
     - window.FIREBASE_CONFIG (from firebase-config.js)
───────────────────────────────────────────────────────────────────────────── */

/* global firebase, CryptoJS */
'use strict';

// ── Question Definitions ───────────────────────────────────────────────────
const QUESTIONS_TONAL = [
  { id: 1, audioFile: 'Audio/Tonal/t01Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 2, audioFile: 'Audio/Tonal/t02Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 3, audioFile: 'Audio/Tonal/t03Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 4, audioFile: 'Audio/Tonal/t04Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 5, audioFile: 'Audio/Tonal/t05Chair.mp3', iconLabel: 'Chair', iconEmoji: '🪑' },
  { id: 6, audioFile: 'Audio/Tonal/t06Hand.mp3', iconLabel: 'Hand', iconEmoji: '✋' },
  { id: 7, audioFile: 'Audio/Tonal/t07Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 8, audioFile: 'Audio/Tonal/t08Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 9, audioFile: 'Audio/Tonal/t09House.mp3', iconLabel: 'House', iconEmoji: '🏠' },
  { id: 10, audioFile: 'Audio/Tonal/t10Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 11, audioFile: 'Audio/Tonal/t11Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 12, audioFile: 'Audio/Tonal/t12Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 13, audioFile: 'Audio/Tonal/t13Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 14, audioFile: 'Audio/Tonal/t14Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 15, audioFile: 'Audio/Tonal/t15Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 16, audioFile: 'Audio/Tonal/t16Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 17, audioFile: 'Audio/Tonal/t17Chair.mp3', iconLabel: 'Chair', iconEmoji: '🪑' },
  { id: 18, audioFile: 'Audio/Tonal/t18Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 19, audioFile: 'Audio/Tonal/t19Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 20, audioFile: 'Audio/Tonal/t20Fork.mp3', iconLabel: 'Fork', iconEmoji: '🍴' },
  { id: 21, audioFile: 'Audio/Tonal/t21Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 22, audioFile: 'Audio/Tonal/t22Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 23, audioFile: 'Audio/Tonal/t23Hand.mp3', iconLabel: 'Hand', iconEmoji: '✋' },
  { id: 24, audioFile: 'Audio/Tonal/t24Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 25, audioFile: 'Audio/Tonal/t25Tree.mp3', iconLabel: 'Tree', iconEmoji: '🌲' },
  { id: 26, audioFile: 'Audio/Tonal/t26Foot.mp3', iconLabel: 'Foot', iconEmoji: '🦶' },
  { id: 27, audioFile: 'Audio/Tonal/t27Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 28, audioFile: 'Audio/Tonal/t28Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 29, audioFile: 'Audio/Tonal/t29Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 30, audioFile: 'Audio/Tonal/t30Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 31, audioFile: 'Audio/Tonal/t31Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 32, audioFile: 'Audio/Tonal/t32Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 33, audioFile: 'Audio/Tonal/t33Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 34, audioFile: 'Audio/Tonal/t34Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 35, audioFile: 'Audio/Tonal/t35House.mp3', iconLabel: 'House', iconEmoji: '🏠' },
  { id: 36, audioFile: 'Audio/Tonal/t36Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 37, audioFile: 'Audio/Tonal/t37Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 38, audioFile: 'Audio/Tonal/t38Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 39, audioFile: 'Audio/Tonal/t39Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 40, audioFile: 'Audio/Tonal/t40Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
];

const QUESTIONS_RHYTHM = [
  { id: 1, audioFile: 'Audio/Rhythm/r01boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 2, audioFile: 'Audio/Rhythm/r02Bed.mp3', iconLabel: 'Bed', iconEmoji: '🛏️' },
  { id: 3, audioFile: 'Audio/Rhythm/r03Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 4, audioFile: 'Audio/Rhythm/r04Tree.mp3', iconLabel: 'Tree', iconEmoji: '🌲' },
  { id: 5, audioFile: 'Audio/Rhythm/r05Hand.mp3', iconLabel: 'Hand', iconEmoji: '🖐️' },
  { id: 6, audioFile: 'Audio/Rhythm/r06Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
  { id: 7, audioFile: 'Audio/Rhythm/r07Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 8, audioFile: 'Audio/Rhythm/r08Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 9, audioFile: 'Audio/Rhythm/r09Truck.mp3', iconLabel: 'Truck', iconEmoji: '🚚' },
  { id: 10, audioFile: 'Audio/Rhythm/r10Lamp.mp3', iconLabel: 'Lamp', iconEmoji: '🪔' },
  { id: 11, audioFile: 'Audio/Rhythm/r11Fork.mp3', iconLabel: 'Fork', iconEmoji: '🍴' },
  { id: 12, audioFile: 'Audio/Rhythm/r12Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 13, audioFile: 'Audio/Rhythm/r13Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 14, audioFile: 'Audio/Rhythm/r14Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 15, audioFile: 'Audio/Rhythm/r15Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 16, audioFile: 'Audio/Rhythm/r16Bed.mp3', iconLabel: 'Bed', iconEmoji: '🛏️' },
  { id: 17, audioFile: 'Audio/Rhythm/r17Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 18, audioFile: 'Audio/Rhythm/r18Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 19, audioFile: 'Audio/Rhythm/r19Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 20, audioFile: 'Audio/Rhythm/r20Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 21, audioFile: 'Audio/Rhythm/r21Car.mp3', iconLabel: 'Car', iconEmoji: '🚗' },
  { id: 22, audioFile: 'Audio/Rhythm/r22Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 23, audioFile: 'Audio/Rhythm/r23Knife.mp3', iconLabel: 'Knife', iconEmoji: '🔪' },
  { id: 24, audioFile: 'Audio/Rhythm/r24Elephant.mp3', iconLabel: 'Elephant', iconEmoji: '🐘' },
  { id: 25, audioFile: 'Audio/Rhythm/r25Tree.mp3', iconLabel: 'Tree', iconEmoji: '🌲' },
  { id: 26, audioFile: 'Audio/Rhythm/r26Hand.mp3', iconLabel: 'Hand', iconEmoji: '🖐️' },
  { id: 27, audioFile: 'Audio/Rhythm/r27Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 28, audioFile: 'Audio/Rhythm/r28Hat.mp3', iconLabel: 'Hat', iconEmoji: '🎩' },
  { id: 29, audioFile: 'Audio/Rhythm/r29Fork.mp3', iconLabel: 'Fork', iconEmoji: '🍴' },
  { id: 30, audioFile: 'Audio/Rhythm/r30Truck.mp3', iconLabel: 'Truck', iconEmoji: '🚚' },
  { id: 31, audioFile: 'Audio/Rhythm/r31Book.mp3', iconLabel: 'Book', iconEmoji: '📚' },
  { id: 32, audioFile: 'Audio/Rhythm/r32Leaf.mp3', iconLabel: 'Leaf', iconEmoji: '🍃' },
  { id: 33, audioFile: 'Audio/Rhythm/r33Pencil.mp3', iconLabel: 'Pencil', iconEmoji: '✏️' },
  { id: 34, audioFile: 'Audio/Rhythm/r34Foot.mp3', iconLabel: 'Foot', iconEmoji: '🦶' },
  { id: 35, audioFile: 'Audio/Rhythm/r35Cup.mp3', iconLabel: 'Cup', iconEmoji: '☕' },
  { id: 36, audioFile: 'Audio/Rhythm/r36Spoon.mp3', iconLabel: 'Spoon', iconEmoji: '🥄' },
  { id: 37, audioFile: 'Audio/Rhythm/r37Lamp.mp3', iconLabel: 'Lamp', iconEmoji: '🪔' },
  { id: 38, audioFile: 'Audio/Rhythm/r38Boat.mp3', iconLabel: 'Boat', iconEmoji: '⛵' },
  { id: 39, audioFile: 'Audio/Rhythm/r39Shoe.mp3', iconLabel: 'Shoe', iconEmoji: '👟' },
  { id: 40, audioFile: 'Audio/Rhythm/r40Apple.mp3', iconLabel: 'Apple', iconEmoji: '🍎' },
];

// ── State ──────────────────────────────────────────────────────────────────
let fbAuth = null;
let fbDb = null;
let fbStorage = null;
let currentUser = null;
let teacherCode = '';
let testType = ''; // 'tonal' | 'rhythm'
let QUESTIONS = []; // set when test type is chosen
let aesKey = null;
let docId = '';
let answers = Array(40).fill(null); // null | 'same' | 'different'
let currentQ = 0; // 0-indexed
let currentAudio = null;
let audioPlaying = false;
let playCount = 0; // plays used for current question
const MAX_PLAYS = 2; // maximum times a student may play audio per question

// ── DOM refs ───────────────────────────────────────────────────────────────
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const loginError = document.getElementById('login-error');
const setupError = document.getElementById('setup-error');
const typeError = document.getElementById('type-error');
const testError = document.getElementById('test-error');
const btnGoogleLogin = document.getElementById('btn-google-login');
const inputTeacherCode = document.getElementById('input-teacher-code');
const btnStartTest = document.getElementById('btn-start-test');
const btnTypeTonal = document.getElementById('btn-type-tonal');
const btnTypeRhythm = document.getElementById('btn-type-rhythm');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const questionEmoji = document.getElementById('question-emoji');
const questionIconLabel = document.getElementById('question-icon-label');
const btnPlayAudio = document.getElementById('btn-play-audio');
const audioBtnIcon = document.getElementById('audio-btn-icon');
const audioStatus = document.getElementById('audio-status');
const btnSame = document.getElementById('btn-same');
const btnDiff = document.getElementById('btn-diff');
const btnNext = document.getElementById('btn-next');

// ── Utility ────────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function showLoading(msg) {
  loadingText.textContent = msg || 'Loading…';
  loadingOverlay.classList.remove('hidden');
}
function hideLoading() {
  loadingOverlay.classList.add('hidden');
}

function setError(el, msg) {
  el.textContent = msg || '';
}

// ── Encryption ────────────────────────────────────────────────────────────
function deriveKey(code) {
  // Return hex string as passphrase — CryptoJS handles IV automatically with string keys.
  return CryptoJS.SHA256(code.toUpperCase().trim()).toString();
}

function aesEncrypt(plaintext, key) {
  return CryptoJS.AES.encrypt(plaintext, key).toString();
}

// ── Firebase init ──────────────────────────────────────────────────────────
function initFirebase() {
  // firebase.initializeApp() is called automatically by /__/firebase/init.js
  // served by Firebase Hosting — no manual config needed.
  fbAuth = firebase.auth();
  fbDb = firebase.firestore();
  fbStorage = firebase.storage();
  return true;
}

// ── Screen: Login ──────────────────────────────────────────────────────────
btnGoogleLogin.addEventListener('click', async () => {
  setError(loginError, '');
  const provider = new firebase.auth.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  try {
    showLoading('Signing in…');
    const result = await fbAuth.signInWithPopup(provider);
    currentUser = result.user;
    hideLoading();
    showScreen('screen-setup');
  } catch (err) {
    hideLoading();
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request'
    ) {
      // Popup was blocked — fall back to redirect flow
      try {
        await fbAuth.signInWithRedirect(provider);
      } catch (redirectErr) {
        setError(loginError, 'Sign-in failed. Please try again. (' + redirectErr.code + ')');
      }
    } else {
      setError(loginError, 'Sign-in failed. Please try again. (' + err.code + ')');
    }
  }
});

// ── Screen: Setup ──────────────────────────────────────────────────────────
inputTeacherCode.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') btnStartTest.click();
});

btnStartTest.addEventListener('click', async () => {
  setError(setupError, '');
  const code = inputTeacherCode.value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!code || code.length < 2) {
    setError(setupError, 'Please enter a valid Teacher Code (letters and numbers only).');
    return;
  }

  teacherCode = code;
  aesKey = deriveKey(teacherCode);

  // Go to test type selection before loading anything from Firestore
  showScreen('screen-type');
});

// ── Screen: Test Type Selection ────────────────────────────────────────────
async function startTestForType(type) {
  setError(typeError, '');
  testType = type;
  QUESTIONS = type === 'tonal' ? QUESTIONS_TONAL : QUESTIONS_RHYTHM;
  docId = currentUser.uid + '_' + teacherCode + '_' + testType;

  showLoading('Checking your test status…');
  try {
    const docSnap = await fbDb.collection('mats_results').doc(docId).get();

    if (docSnap.exists) {
      const data = docSnap.data();

      if (data.isComplete) {
        hideLoading();
        setError(
          typeError,
          'You already completed this test. Ask your teacher if you need to retake it.'
        );
        return;
      }

      // Resume existing attempt
      if (data.answers) {
        try {
          const decrypted = CryptoJS.AES.decrypt(data.answers, aesKey).toString(CryptoJS.enc.Utf8);
          const parsed = JSON.parse(decrypted);
          if (Array.isArray(parsed) && parsed.length === 40) {
            answers = parsed;
          }
        } catch (e) {
          answers = Array(40).fill(null);
        }
      }

      // Start from the first unanswered question
      const firstUnanswered = answers.findIndex((a) => a === null);
      currentQ = firstUnanswered === -1 ? 40 : firstUnanswered;

      // All already answered but not marked complete — finalize now
      if (currentQ >= 40) {
        await finalizeTest();
        hideLoading();
        return;
      }
    } else {
      // Fresh start
      answers = Array(40).fill(null);
      currentQ = 0;
      await fbDb
        .collection('mats_results')
        .doc(docId)
        .set({
          uid: currentUser.uid,
          teacherCode: teacherCode,
          testType: testType,
          studentName: aesEncrypt(currentUser.displayName || '', aesKey),
          studentEmail: aesEncrypt(currentUser.email || '', aesKey),
          answers: aesEncrypt(JSON.stringify(answers), aesKey),
          isComplete: false,
          startedAt: firebase.firestore.FieldValue.serverTimestamp(),
          lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        });
    }

    hideLoading();
    showScreen('screen-test');
    renderQuestion();
  } catch (err) {
    hideLoading();
    setError(typeError, 'Could not connect to the server. Check your internet and try again.');
    console.error('[setup]', err);
  }
}

btnTypeTonal?.addEventListener('click', () => startTestForType('tonal'));
btnTypeRhythm?.addEventListener('click', () => startTestForType('rhythm'));

// ── Screen: Test ───────────────────────────────────────────────────────────
function renderQuestion() {
  if (currentQ >= QUESTIONS.length) return;
  const q = QUESTIONS[currentQ];

  // Progress
  const pct = Math.round((currentQ / QUESTIONS.length) * 100);
  progressBar.style.width = pct + '%';
  progressLabel.textContent = `Question ${currentQ + 1} of ${QUESTIONS.length}`;

  // Icon
  questionEmoji.textContent = q.iconEmoji;
  questionIconLabel.textContent = q.iconLabel;

  // Audio reset
  stopAudio();
  playCount = 0;
  audioStatus.textContent = '';
  audioStatus.className = 'audio-status';
  audioBtnIcon.textContent = '▶';
  btnPlayAudio.classList.remove('playing');
  btnPlayAudio.disabled = false;

  // Answer buttons — clear selection
  btnSame.classList.remove('selected');
  btnDiff.classList.remove('selected');
  btnNext.disabled = true;
  setError(testError, '');

  // If this question was already answered (resume), re-apply selection and allow interaction
  if (answers[currentQ] !== null) {
    if (answers[currentQ] === 'same') {
      btnSame.classList.add('selected');
    } else {
      btnDiff.classList.add('selected');
    }
    btnSame.disabled = false;
    btnDiff.disabled = false;
    btnNext.disabled = false;
  } else {
    // Must listen to audio first
    btnSame.disabled = true;
    btnDiff.disabled = true;
  }
}

// Audio playback
btnPlayAudio.addEventListener('click', async () => {
  if (audioPlaying) {
    stopAudio();
    return;
  }
  if (playCount >= MAX_PLAYS) return;
  await playAudio(QUESTIONS[currentQ]);
});

async function playAudio(question) {
  stopAudio();
  audioBtnIcon.textContent = '…';
  btnPlayAudio.disabled = true;
  audioStatus.textContent = '';

  try {
    const storageRef = fbStorage.ref(question.audioFile);
    const url = await storageRef.getDownloadURL();

    currentAudio = new Audio(url);
    currentAudio.addEventListener('canplaythrough', () => {
      audioBtnIcon.textContent = '■';
      btnPlayAudio.classList.add('playing');
      btnPlayAudio.disabled = false;
      audioPlaying = true;
      audioStatus.textContent = 'Playing…';
      audioStatus.className = 'audio-status';
    });
    currentAudio.addEventListener('ended', () => {
      stopAudio();
      playCount++;
      if (playCount >= MAX_PLAYS) {
        btnPlayAudio.disabled = true;
        audioStatus.textContent = `You've listened ${MAX_PLAYS} times — select Same or Different.`;
      } else {
        const remaining = MAX_PLAYS - playCount;
        audioStatus.textContent = `Ready — you have ${remaining} listen${remaining !== 1 ? 's' : ''} remaining.`;
      }
      btnSame.disabled = false;
      btnDiff.disabled = false;
    });
    currentAudio.addEventListener('error', () => {
      stopAudio();
      showAudioPlaceholder();
    });
    currentAudio.play().catch(() => {
      stopAudio();
      showAudioPlaceholder();
    });
  } catch (err) {
    // File not yet uploaded to Firebase Storage
    console.error('[audio] Failed to load:', question.audioFile, err.code, err.message);
    stopAudio();
    showAudioPlaceholder();
  }
}

function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  audioPlaying = false;
  audioBtnIcon.textContent = '▶';
  btnPlayAudio.classList.remove('playing');
  btnPlayAudio.disabled = false;
}

function showAudioPlaceholder() {
  audioStatus.textContent =
    '🔇 Audio not yet available — this is a placeholder test. Select an answer and continue.';
  audioStatus.className = 'audio-status placeholder-note';
  // Allow answering even without audio (placeholder mode)
  btnSame.disabled = false;
  btnDiff.disabled = false;
}

// Answer selection
btnSame.addEventListener('click', () => {
  answers[currentQ] = 'same';
  btnSame.classList.add('selected');
  btnDiff.classList.remove('selected');
  btnNext.disabled = false;
});

btnDiff.addEventListener('click', () => {
  answers[currentQ] = 'different';
  btnDiff.classList.add('selected');
  btnSame.classList.remove('selected');
  btnNext.disabled = false;
});

// Next button
btnNext.addEventListener('click', async () => {
  if (answers[currentQ] === null) return;

  btnNext.disabled = true;
  setError(testError, '');

  // Save progress to Firestore
  try {
    await fbDb
      .collection('mats_results')
      .doc(docId)
      .update({
        answers: aesEncrypt(JSON.stringify(answers), aesKey),
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.error('[save-progress]', err);
    setError(testError, 'Could not save your answer. Check your internet connection.');
    btnNext.disabled = false;
    return;
  }

  currentQ++;

  if (currentQ >= QUESTIONS.length) {
    showLoading('Finishing up…');
    await finalizeTest();
    hideLoading();
  } else {
    renderQuestion();
  }
});

async function finalizeTest() {
  try {
    await fbDb
      .collection('mats_results')
      .doc(docId)
      .update({
        answers: aesEncrypt(JSON.stringify(answers), aesKey),
        testType: testType,
        isComplete: true,
        completedAt: firebase.firestore.FieldValue.serverTimestamp(),
        lastUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
  } catch (err) {
    console.error('[finalize]', err);
  }
  showScreen('screen-done');
}

// ── Boot ───────────────────────────────────────────────────────────────────
(function boot() {
  if (!initFirebase()) return;

  // Handle Google redirect sign-in (for environments where popup is blocked)
  showLoading('Starting…');
  fbAuth
    .getRedirectResult()
    .then((result) => {
      if (result && result.user) {
        currentUser = result.user;
        hideLoading();
        showScreen('screen-setup');
      } else {
        hideLoading();
        showScreen('screen-login');
      }
    })
    .catch((err) => {
      hideLoading();
      showScreen('screen-login');
      console.error('[redirect-result]', err);
    });
})();
