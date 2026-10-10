'use strict';

// mats-service.js — Electron Main Process
// Handles: Firebase REST auth, Firestore query, AES decryption, scoring, DB import.
// Uses Electron's net module (not Node's https) so TLS verification goes through
// Chromium's network stack — trusting the OS certificate store like a browser does,
// which matters on machines running SSL-inspecting filters (e.g. school content filters).
// No firebase-admin SDK needed — avoids native gRPC module packaging issues.

const { net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Lazy-loaded to keep startup fast
let _CryptoJS = null;
let _answerKey = null;

function getCryptoJS() {
  if (!_CryptoJS) _CryptoJS = require('crypto-js');
  return _CryptoJS;
}
function getAnswerKey() {
  if (!_answerKey) _answerKey = require('./answer-key');
  return _answerKey;
}

// ── Service account helpers ────────────────────────────────────────────────

function getServiceAccountPath(userDataPath) {
  return path.join(userDataPath, 'mats-service-account.json');
}

function loadServiceAccount(userDataPath) {
  const saPath = getServiceAccountPath(userDataPath);
  if (!fs.existsSync(saPath)) {
    const err = new Error('Service account not configured.');
    err.code = 'NO_SERVICE_ACCOUNT';
    throw err;
  }
  let sa;
  try {
    sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
  } catch (e) {
    throw new Error('Service account file could not be parsed: ' + e.message);
  }
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error(
      'Service account JSON is missing required fields (client_email, private_key, project_id).'
    );
  }
  return sa;
}

// ── JWT / OAuth2 ───────────────────────────────────────────────────────────

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJWT(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claim = base64url(
    Buffer.from(
      JSON.stringify({
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: 'https://oauth2.googleapis.com/token',
        scope: 'https://www.googleapis.com/auth/datastore',
        iat: now,
        exp: now + 3600,
      })
    )
  );
  const signingInput = `${header}.${claim}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  const signature = base64url(sign.sign(serviceAccount.private_key));
  return `${signingInput}.${signature}`;
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const bodyStr = typeof body === 'string' ? body : body ? JSON.stringify(body) : '';
    const request = net.request({
      method: options.method || 'GET',
      url: `https://${options.hostname}${options.path}`,
    });
    if (options.headers) {
      Object.entries(options.headers).forEach(([key, value]) => {
        // Chromium's net stack computes Content-Length itself from write()/end() and
        // rejects a manually-set one (esp. as a number) with net::ERR_INVALID_ARGUMENT.
        if (key.toLowerCase() === 'content-length') return;
        request.setHeader(key, String(value));
      });
    }
    request.on('response', (response) => {
      let raw = '';
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => {
        try {
          resolve(JSON.parse(raw));
        } catch (e) {
          reject(
            new Error(`Response parse error (HTTP ${response.statusCode}): ${raw.slice(0, 300)}`)
          );
        }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    if (bodyStr) request.write(bodyStr);
    request.end();
  });
}

async function getAccessToken(serviceAccount) {
  const jwt = makeJWT(serviceAccount);
  const postBody = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`;

  const result = await httpsRequest(
    {
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postBody),
      },
    },
    postBody
  );

  if (!result.access_token) {
    throw new Error(
      `OAuth2 token error: ${result.error_description || result.error || JSON.stringify(result)}`
    );
  }
  return result.access_token;
}

// ── Firestore REST ─────────────────────────────────────────────────────────

async function queryFirestoreByTeacherCode(projectId, accessToken, teacherCode) {
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'mats_results' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'teacherCode' },
          op: 'EQUAL',
          value: { stringValue: teacherCode },
        },
      },
    },
  };
  const bodyStr = JSON.stringify(body);

  const results = await httpsRequest(
    {
      hostname: 'firestore.googleapis.com',
      path: `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents:runQuery`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    },
    bodyStr
  );

  if (!Array.isArray(results)) {
    throw new Error('Unexpected Firestore response: ' + JSON.stringify(results).slice(0, 300));
  }
  return results;
}

// Extract a scalar field value from a Firestore document field map
function extractField(fields, key) {
  if (!fields || !fields[key]) return null;
  const v = fields[key];
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  return null;
}

// Extract the document ID from a Firestore document name path
function extractDocId(docName) {
  if (!docName) return null;
  const parts = String(docName).split('/');
  return parts[parts.length - 1] || null;
}

// ── AES Decryption ─────────────────────────────────────────────────────────

function deriveKey(teacherCode) {
  const CJS = getCryptoJS();
  // Return hex string as passphrase — CryptoJS handles IV automatically with string keys.
  return CJS.SHA256(teacherCode.toUpperCase().trim()).toString();
}

function aesDecrypt(ciphertext, key) {
  const CJS = getCryptoJS();
  try {
    const bytes = CJS.AES.decrypt(ciphertext, key);
    const result = bytes.toString(CJS.enc.Utf8);
    return result || null;
  } catch {
    return null;
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────

function scoreAnswers(answers, testType) {
  const keys = getAnswerKey();
  const key = testType === 'rhythm' ? keys.rhythm : keys.tonal;
  if (!Array.isArray(answers) || answers.length !== 40) return null;
  return answers.reduce((sum, ans, i) => sum + (ans === key[i] ? 1 : 0), 0);
}

// ── Student Matching ───────────────────────────────────────────────────────

function matchStudentId(students, email, name) {
  // 1. Match by email (case-insensitive)
  if (email) {
    const byEmail = students.find(
      (s) => s.email && s.email.trim().toLowerCase() === email.trim().toLowerCase()
    );
    if (byEmail) return byEmail.id;
  }
  // 2. Fallback: match by first + last name
  if (name) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0] || '';
    const last = parts.slice(1).join(' ') || '';
    if (first && last) {
      const byName = students.find(
        (s) =>
          s.first_name.trim().toLowerCase() === first.toLowerCase() &&
          s.last_name.trim().toLowerCase() === last.toLowerCase()
      );
      if (byName) return byName.id;
    }
  }
  return null;
}

// ── Main export ────────────────────────────────────────────────────────────

/**
 * Fetch MATS results for a teacher code from Firestore, decrypt, score, and
 * upsert into the local SQLite imma_results table.
 *
 * @param {object} opts
 * @param {string}   opts.userDataPath  - Electron app.getPath('userData')
 * @param {string}   opts.teacherCode   - e.g. "SMITH24"
 * @param {object}   opts.db            - The db module (with upsertMatsResult, etc.)
 * @param {object[]} opts.students      - All students from db.getStudents()
 * @returns {{ importedCount, unmatchedCount, results }}
 */
async function fetchAndImport({ userDataPath, teacherCode, db, students }) {
  const serviceAccount = loadServiceAccount(userDataPath);
  const accessToken = await getAccessToken(serviceAccount);
  const rawDocs = await queryFirestoreByTeacherCode(
    serviceAccount.project_id,
    accessToken,
    teacherCode
  );

  const aesKey = deriveKey(teacherCode);
  let importedCount = 0;
  let unmatchedCount = 0;
  const results = [];

  for (const item of rawDocs) {
    if (!item.document) continue; // Firestore returns empty items for no-match rows

    const fields = item.document.fields;
    const firestoreDocId = extractDocId(item.document.name);

    // Decrypt PII fields
    const encName = extractField(fields, 'studentName');
    const encEmail = extractField(fields, 'studentEmail');
    const encAnswers = extractField(fields, 'answers');
    const isComplete = extractField(fields, 'isComplete') === true;
    const testType = extractField(fields, 'testType') || 'tonal';

    const studentName = encName ? aesDecrypt(encName, aesKey) : null;
    const studentEmail = encEmail ? aesDecrypt(encEmail, aesKey) : null;

    let parsedAnswers = null;
    let score = null;
    if (encAnswers) {
      const answersJson = aesDecrypt(encAnswers, aesKey);
      if (answersJson) {
        try {
          parsedAnswers = JSON.parse(answersJson);
          score = scoreAnswers(parsedAnswers, testType);
        } catch {
          /* malformed JSON — skip scoring */
        }
      }
    }

    const studentId = matchStudentId(students, studentEmail, studentName);
    if (!studentId) unmatchedCount++;

    db.upsertMatsResult({
      firestore_doc_id: firestoreDocId,
      student_id: studentId,
      student_name: studentName,
      student_email: studentEmail,
      teacher_code: teacherCode,
      test_type: testType,
      answers: parsedAnswers ? JSON.stringify(parsedAnswers) : null,
      score,
      is_complete: isComplete ? 1 : 0,
    });

    results.push({
      firestore_doc_id: firestoreDocId,
      student_id: studentId,
      student_name: studentName,
      student_email: studentEmail,
      test_type: testType,
      score,
      is_complete: isComplete,
    });
    importedCount++;
  }

  return { importedCount, unmatchedCount, results };
}

/**
 * Reset a student's Firestore document so they can retake the test.
 * Sets isComplete=false, clears answers, and deletes the local DB record.
 */
async function resetForRetake({ userDataPath, firestoreDocId, db }) {
  const serviceAccount = loadServiceAccount(userDataPath);
  const accessToken = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;

  // PATCH only isComplete and answers fields
  const body = {
    fields: {
      isComplete: { booleanValue: false },
      answers: { stringValue: '' },
    },
  };
  const bodyStr = JSON.stringify(body);
  const docPath = `/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/mats_results/${encodeURIComponent(firestoreDocId)}`;
  const updateMask = 'updateMask.fieldPaths=isComplete&updateMask.fieldPaths=answers';

  const result = await httpsRequest(
    {
      hostname: 'firestore.googleapis.com',
      path: `${docPath}?${updateMask}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
      },
    },
    bodyStr
  );

  if (result.error) {
    throw new Error(
      'Firestore PATCH error: ' + (result.error.message || JSON.stringify(result.error))
    );
  }

  // Remove local record so it won't show stale data
  db.deleteMatsResult(firestoreDocId);

  return { ok: true };
}

module.exports = {
  fetchAndImport,
  resetForRetake,
  hasServiceAccount: (userDataPath) => fs.existsSync(getServiceAccountPath(userDataPath)),
};
