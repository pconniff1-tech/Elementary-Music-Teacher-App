# Agent Project Brief: Music Aptitude Test System (MATS)

## 1. Project Overview

A dual-platform system consisting of a **Firebase-hosted Web App** for student testing and a **Node.js/Electron Desktop App** for teacher data management. The system prioritizes student data privacy through client-side encryption and Google Workspace integration.

## 2. Technical Stack

### Web App (Student Portal)

- **Hosting:** Firebase Hosting (Web assets: HTML, CSS, JS)
- **Media Storage:** Firebase Storage (40x 10-second .mp3 audio clips)
- **Database:** Cloud Firestore (Encrypted test results)
- **Authentication:** Google Identity Services (Sign-in for Student ID/Email)
- **Encryption:** `crypto-js` (AES-256)

### Desktop App (Teacher Portal)

- This app exists already but need to add the webapp connection funtionality
- **Framework:** Electron (Use existing)
- **Local Database:** `better-sqlite3` (Use existing)
- **Data Fetching:** Firebase Admin SDK (Node.js)
- **Decryption:** `crypto-js` (Matching the web app's logic)

## 3. Web App Workflow & Requirements

### A. Authentication & Setup

- **Google Login:** Student authenticates to capture name and email.
- **Teacher Code:** Student must enter a unique alphanumeric string (e.g., `SMITH24`). This code tags the data for the specific teacher's Electron app to find later.

### B. Test Interface (The "Chromebook" Experience)

- **Visual Anchors:** Each of the 40 questions is identified by a unique picture (e.g., Hat, Tree, Boat) to prevent confusion.
- **Audio Control:**
  1. Student clicks "Play" to stream a 10-second clip from Firebase Storage.
  2. Student clicks one of two buttons: **Same** or **Different**.
  3. Student clicks **Next** to move to the next item.
- **Incremental Progress:** Answers are encrypted and saved to Firestore immediately upon clicking "Next" to ensure no data is lost if a tab is closed.

### C. Completion Logic

- The final screen displays a "Congratulations" message.
- Upon reaching the final screen, the test session is marked `isComplete: true`, locking the student out from re-taking that specific test instance.

## 4. Electron App Workflow & Requirements

### A. Data Ingestion

- **Fetch:** The app queries Firestore for all documents matching the `Teacher Code`.
- **Decrypt:** Encrypted strings are pulled into the Electron Main Process and decrypted using the shared secret key.
- **Store:** The cleaned data (Student Name, Email, Answers) is inserted into the local `better-sqlite3` database for offline analysis and reporting.

## 5. Security & Compliance

- **Encryption-at-Source:** Student PII (Personally Identifiable Information) and test scores are encrypted _before_ they leave the browser.
- **Firebase Rules:** Firestore security rules must be configured so students can only write their own data, while only the Teacher's authenticated Admin SDK can read the full collection.
- **Caching:** Audio files in Firebase Storage should have `Cache-Control` headers set to `public, max-age=86400` to save bandwidth during class-wide testing.

## 6. Suggested File Structure

- `/web-app`: Standard web project for Firebase Hosting.
- `/electron-app`: Node.js/Electron project. (Already exists)
- `/shared`: Common logic for encryption/decryption keys and Question/Icon mapping.
