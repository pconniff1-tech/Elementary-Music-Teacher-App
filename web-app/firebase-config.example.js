// web-app/firebase-config.example.js
// ─────────────────────────────────────────────────────────────────────────────
// SETUP INSTRUCTIONS
// 1. Copy this file and rename the copy to "firebase-config.js" (same folder).
// 2. Replace every PLACEHOLDER value below with your actual Firebase project
//    credentials from the Firebase Console → Project Settings → Your apps → Web app.
// 3. firebase-config.js is git-ignored — never commit it.
// ─────────────────────────────────────────────────────────────────────────────

window.FIREBASE_CONFIG = {
  apiKey: 'REPLACE_WITH_YOUR_API_KEY',
  authDomain: 'REPLACE_WITH_YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'REPLACE_WITH_YOUR_PROJECT_ID',
  storageBucket: 'REPLACE_WITH_YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'REPLACE_WITH_YOUR_MESSAGING_SENDER_ID',
  appId: 'REPLACE_WITH_YOUR_APP_ID',
};
