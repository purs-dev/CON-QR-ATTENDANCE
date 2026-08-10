// =====================================================================
// FIREBASE CONFIG — paste your own project's values below.
//
// How to get them (see README.md for full walkthrough):
//   1. https://console.firebase.google.com -> Add project
//   2. Build > Firestore Database > Create database (test mode is fine to start)
//   3. Project settings (gear icon) > General > "Your apps" > Web (</>) icon
//   4. Register the app, copy the firebaseConfig object it shows you
// =====================================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
