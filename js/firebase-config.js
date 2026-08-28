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
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAKqWkZXp8O5GKqk1uhvBlaiyzmDVmUWPg",
  authDomain: "spcf-con-attendance-12818.firebaseapp.com",
  projectId: "spcf-con-attendance-12818",
  storageBucket: "spcf-con-attendance-12818.firebasestorage.app",
  messagingSenderId: "406081245182",
  appId: "1:406081245182:web:7cc4fa3ad8d2e5ee37baaf",
  measurementId: "G-BGBH1GW8G7"
};

const app = initializeApp(firebaseConfig);
// Persistent local cache: every scan (check-in AND time-out) is written to the
// device immediately and syncs to the cloud once signal returns. Ordinary
// writes queue offline — only true transactions wouldn't, which is why the
// scanner avoids them. Safe for a packed hall with flaky Wi-Fi.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});
