# CON Attendance System — Setup Guide

## What this is now

Three pages sharing one Firebase database:

- **`index.html`** (you) — create a session, get a QR that links to registration, watch check-ins live.
- **`register.html`** (students) — they scan your QR, fill in Name / Section / Student ID, and get back their own personal check-in QR.
- **`scanner.html`** (you, on a second device) — opens the camera, reads each student's QR, and logs them into the session with a timestamp.

Everything is written in plain HTML/CSS/JS — no build step, no `npm install`. Bootstrap 5 and Firebase are both loaded straight from CDNs in the `<head>` of each page.

---

## 1. Create a Firebase project (~5 min)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `spcf-con-attendance`), and finish the wizard (you can skip Google Analytics).
3. Once inside the project, in the left sidebar go to **Build → Firestore Database → Create database**.
   - Choose a region close to you (e.g. `asia-southeast1`).
   - Start in **test mode** for now — we'll lock it down properly in step 4.

## 2. Register a web app and get your config

1. In the project, click the **gear icon → Project settings**.
2. Scroll to **Your apps**, click the **`</>`** (web) icon.
3. Give it a nickname (e.g. "attendance web") and click **Register app**. You don't need Firebase Hosting yet.
4. It will show you a `firebaseConfig` object like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "spcf-con-attendance.firebaseapp.com",
  projectId: "spcf-con-attendance",
  storageBucket: "spcf-con-attendance.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

5. Open **`js/firebase-config.js`** in this project and paste your real values in place of the `PASTE_YOUR_...` placeholders. That's the only file you need to edit to connect everything.

## 3. Lock down Firestore (important)

Test mode leaves your database wide open. Since students never log in, we can't do *real* admin-vs-student separation without adding a login system — but we can still shape what any visitor is allowed to write. In Firebase: **Build → Firestore Database → Rules**, replace the contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /sessions/{sessionId} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(['name','createdAt','active']);
      allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['active']);
      allow delete: if false;

      match /registrations/{regId} {
        allow read: if true;
        allow create: if request.resource.data.keys().hasAll(['name','section','studentId','registeredAt','checkedIn'])
                      && request.resource.data.checkedIn == false;
        allow update: if request.resource.data.diff(resource.data).affectedKeys().hasOnly(['checkedIn','checkedInAt']);
        allow delete: if false;
      }
    }
  }
}
```

This still lets anyone with the link create a session or register — but it stops people from overwriting other students' names, forging a "checked in" status on submission, or deleting records. **If you want real admin-only session creation later, the next step is adding Firebase Authentication** (email/password login just for you) and restricting `sessions` writes to your signed-in account — happy to help with that when you're ready.

## 4. Run it

Because the pages use JavaScript modules (`import`) and the scanner needs camera access, you **can't just double-click `index.html`**. Browsers block modules and cameras on `file://` pages. You need it served over `http://` or `https://`. Easiest options:

- **Firebase Hosting** (free, and it's already your Firebase project):
  ```
  npm install -g firebase-tools
  firebase login
  firebase init hosting   # point it at this folder, single-page app: No
  firebase deploy
  ```
- **Netlify / GitHub Pages** — drag-and-drop this folder in, or push it to a repo. Both serve over HTTPS automatically, which the camera requires on a phone.
- **Testing locally first**: `cd` into this folder and run `python3 -m http.server 8000`, then open `http://localhost:8000`. `localhost` is allowed to use the camera even without HTTPS.

## 5. The daily flow

1. Open `index.html`, unlock with the passcode (`SPCF-CON2026` — change this in `js/admin.js` if you want a different one; it's a soft gate, not real security).
2. Type the event name, **Create Session & Get QR** — display or project that QR, or **Copy Registration Link** and post it wherever's convenient.
3. Students scan it → fill the form → get their personal QR.
4. On your scanning device, open `scanner.html` and point the camera at each student's QR as they arrive. Each scan writes a timestamp instantly.
5. Back on `index.html → Live Feed`, pick the session and watch the table update in real time as people check in.

---

## How Bootstrap is wired in

You asked to add Bootstrap and understand how — here's the actual mechanism used throughout `css/style.css`:

1. **Load order matters.** Every page loads Bootstrap's CSS first, then `style.css` second:
   ```html
   <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
   <link rel="stylesheet" href="css/style.css">
   ```
   Whatever loads later wins ties, so your custom rules can override Bootstrap's defaults.

2. **Retheme with Bootstrap's own CSS variables instead of fighting its specificity.** Bootstrap 5.3 exposes its whole design system as `--bs-*` custom properties. Instead of writing `.btn-primary { background: red !important; }`, `style.css` does this at the top:
   ```css
   :root{
     --bs-primary: #0B3D2E;
     --bs-body-bg: #0A1F18;
     --bs-border-radius: 10px;
     --bs-font-sans-serif: 'Inter', sans-serif;
   }
   ```
   Bootstrap's components read those variables internally, so the whole framework picks up your palette without you rewriting its CSS.

3. **Per-component variables for finer control.** Buttons go further — each `.btn-primary` sets its *own* scoped variables:
   ```css
   .btn-primary{
     --bs-btn-bg: var(--forest);
     --bs-btn-hover-bg: var(--pine-light);
     --bs-btn-color: var(--cream);
   }
   ```
   This is the pattern to reuse any time you want to reskin another Bootstrap component (`.card`, `.table`, `.form-control`, `.nav-pills`) — check Bootstrap's docs for that component's variable names, set them once, and your own CSS underneath handles the rest.

4. **What's actually Bootstrap now:** the grid (`container`, `row`, `col-lg-*`), the form controls and validation states (`form-control`, `is-invalid`, `invalid-feedback`), buttons, the tab system (`nav-pills`, `tab-pane`), the toast notifications, the table, and the loading spinner on the registration page. The marquee, the tilted gold-shadow cards, and the QR "badge" are still bespoke CSS — those are your visual signature, so Bootstrap doesn't touch them.

To add more Bootstrap components later (an accordion, a modal, a progress bar), grab the markup from [getbootstrap.com/docs/5.3](https://getbootstrap.com/docs/5.3/), drop it in, and if it doesn't match your palette, override its `--bs-*` variables the same way.

---

## Known limits

- The admin passcode is a client-side convenience, not authentication — anyone who reads the JS can find it. Firestore rules are what actually protect the data.
- No duplicate-device protection: a student could screenshot their QR and hand it to a friend. Fine for most classroom settings; if you need stronger identity checks, Firebase Auth + a login step would be the next addition.
- Offline handling is minimal — if the scanner loses signal mid-scan, it'll show a "connection problem" flash rather than queue the scan for later.
