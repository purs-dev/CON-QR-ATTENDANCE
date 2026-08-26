import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp,
  runTransaction, getCountFromServer, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sfx, confettiBurstAtElement as confettiAt, buzz } from "./app-shell.js";

// ---------- toast (for camera-level errors) ----------
function showToast(message, type = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="toast-body">${message}</div>`;
  stack.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 4000 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ---------- ripple effect on buttons ----------
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  const size = Math.max(rect.width, rect.height);
  ripple.className = 'ripple';
  ripple.style.width = ripple.style.height = size + 'px';
  ripple.style.left = (e.clientX - rect.left - size / 2) + 'px';
  ripple.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.appendChild(ripple);
  setTimeout(() => ripple.remove(), 600);
});

// ---------- flash panel (primary feedback while scanning) ----------
let flashTimer;
function flash(message, type) {
  const el = document.getElementById('scanFlash');
  el.className = `scan-result-flash ${type}`;
  el.textContent = message;
  el.style.display = 'block';
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.style.display = 'none'; }, 2800);
}

// ---------- recent check-ins list ----------
function addRecent(name, time) {
  const list = document.getElementById('recentList');
  if (list.querySelector('.small')) list.innerHTML = '';
  const item = document.createElement('div');
  item.className = 'recent-scan-item';
  item.innerHTML = `<span class="rname">${escapeHtml(name)}</span><span class="rtime">${time}</span>`;
  list.prepend(item);
  [...list.children].slice(8).forEach(el => el.remove());
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// Registrations now have dynamic field keys (whatever the session's fields
// were set to). "name" is the default id for the first field, but if an
// admin renamed/removed it, fall back to the first non-metadata value.
function getDisplayName(data) {
  if (data.name) return data.name;
  const metaKeys = ['registeredAt', 'checkedIn', 'checkedInAt'];
  const key = Object.keys(data).find(k => !metaKeys.includes(k));
  return key ? data[key] : 'Student';
}

// ---------- session helpers (multi-device / multi-level aware) ----------
const sessionNameCache = new Map();
async function getSessionName(sessionId) {
  if (sessionNameCache.has(sessionId)) return sessionNameCache.get(sessionId);
  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId));
    const name = snap.exists() ? snap.data().name : 'Unknown session';
    sessionNameCache.set(sessionId, name);
    return name;
  } catch (err) {
    console.warn(err);
    return 'Unknown session';
  }
}

// Live per-session total (same number on every scanner device)
async function updateSessionChip(sessionId) {
  try {
    const q = query(collection(db, 'sessions', sessionId, 'registrations'), where('checkedIn', '==', true));
    const total = (await getCountFromServer(q)).data().count;
    let chips = document.getElementById('sessionChips');
    if (!chips) {
      chips = document.createElement('div');
      chips.id = 'sessionChips';
      chips.className = 'session-chips';
      const list = document.getElementById('recentList');
      list.parentNode.insertBefore(chips, list);
    }
    let chip = chips.querySelector(`[data-session="${sessionId}"]`);
    if (!chip) {
      chip = document.createElement('span');
      chip.className = 'session-chip';
      chip.dataset.session = sessionId;
      chips.appendChild(chip);
    }
    const name = await getSessionName(sessionId);
    chip.textContent = `${name}: ${total} checked in`;
  } catch (err) {
    console.warn('[scanner] chip update failed:', err);
  }
}

// ---------- core check-in logic (shared by camera scan + manual entry) ----------
// Uses a transaction: if two scanner devices scan the same student at the
// same moment, exactly ONE wins and the other shows "already checked in".
async function checkIn(sessionId, registrationId) {
  try {
    const ref = doc(db, 'sessions', sessionId, 'registrations', registrationId);
    const sessionName = await getSessionName(sessionId);

    let outcome = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists()) { outcome = { status: 'unknown' }; return; }
      const data = snap.data();
      const name = getDisplayName(data);
      if (data.checkedIn) {
        const time = data.checkedInAt ? data.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        outcome = { status: 'already', name, time };
        return;
      }
      tx.update(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
      outcome = { status: 'ok', name };
    });

    if (!outcome || outcome.status === 'unknown') {
      flash(`Unknown code — not found in ${sessionName}.`, 'error');
      sfx.play('error');
      buzz(120);
      return;
    }
    if (outcome.status === 'already') {
      flash(`${outcome.name} already checked in ${outcome.time ? 'at ' + outcome.time : ''} · ${sessionName}`, 'warn');
      sfx.play('warn');
      buzz(80);
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flash(`✓ ${outcome.name} checked in · ${sessionName}`, 'success');
    addRecent(`[${sessionName}] ${outcome.name}`, now);
    sfx.play('success');
    buzz([40, 60, 40]);
    confettiAt(document.getElementById('scanFlash'), { count: 110, power: 9 });
    updateSessionChip(sessionId);
  } catch (err) {
    console.error(err);
    flash('Connection problem — could not record check-in.', 'error');
    sfx.play('error');
    buzz(120);
  }
}

// ---------- scan handling ----------
let lastText = '';
let lastTime = 0;

function onScanSuccess(decodedText) {
  const now = Date.now();
  if (decodedText === lastText && now - lastTime < 4000) return; // debounce repeat scans
  lastText = decodedText;
  lastTime = now;

  const parts = decodedText.split('|');
  if (parts.length !== 2) {
    flash('Not a recognized attendance QR.', 'error');
    sfx.play('error');
    buzz(120);
    return;
  }
  const [sessionId, registrationId] = parts;
  checkIn(sessionId, registrationId);
}

// ---------- camera scanning ----------
let readerEl = document.getElementById('reader');
let html5QrCode = null;
let cameraStarting = false;
let busyRetries = 0;

function freshScanner() {
  try { html5QrCode && html5QrCode.stop(); } catch (_) { /* wasn't running */ }
  try { html5QrCode && html5QrCode.clear(); } catch (_) { /* nothing rendered */ }
  readerEl.innerHTML = '';
  html5QrCode = new Html5Qrcode('reader');
}

function showCameraError(title, hint, showRetry = true) {
  cameraStarting = false;
  readerEl.classList.add('cam-error');
  readerEl.innerHTML = `
    <div class="camera-error">
      <div class="ce-icon">📷</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(hint)}</p>
      ${showRetry ? '<button class="btn btn-primary" id="cameraRetryBtn">Retry Camera</button>' : ''}
    </div>`;
  const retry = document.getElementById('cameraRetryBtn');
  if (retry) retry.addEventListener('click', () => {
    busyRetries = 0;
    startCamera();
  });
  showToast(hint, 'error');
}

function cameraErrorFromException(err) {
  const name = String((err && (err.name || err.message)) || err);

  // "Camera busy" is often transient — the previous getUserMedia hasn't
  // fully released the device yet. Auto-retry twice before giving up.
  if (/NotReadable|TrackStart|InUse/i.test(name) && busyRetries < 2) {
    busyRetries++;
    setTimeout(startCamera, 1200 * busyRetries);
    return;
  }

  if (/NotAllowed|PermissionDenied/i.test(name)) {
    showCameraError('Camera permission denied',
      'Allow camera access for this site: click the camera/padlock icon in the address bar, set Camera to "Allow", then tap Retry.');
  } else if (/NotFound|DevicesNotFound|Overconstrained/i.test(name)) {
    showCameraError('No camera found',
      'No usable camera was detected on this device — use manual check-in below.', false);
  } else if (/NotReadable|TrackStart|InUse/i.test(name)) {
    showCameraError('Camera is busy',
      'Another tab or app is holding the camera. Close the other CON Attendance tab (and apps like Zoom/Teams), then tap Retry. You can also click the camera icon in the address bar to release it.');
  } else {
    showCameraError('Could not start camera',
      'Something went wrong starting the camera. Retry, or use manual check-in below.');
  }
}

async function startCamera() {
  if (cameraStarting) return;
  cameraStarting = true;

  if (!window.isSecureContext) {
    showCameraError('Camera needs a secure connection',
      'Browsers only allow camera access on HTTPS or localhost. Open this page via https://… — not by double-clicking the file or over plain HTTP.',
      false);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError('Camera not supported',
      'This browser does not expose camera access. Try Chrome, Edge, or Safari.', false);
    return;
  }

  readerEl.classList.remove('cam-error');
  freshScanner();

  // Preferred: ONE getUserMedia call with a facing-mode constraint. The old
  // approach (list cameras first, then open) opens and closes the camera
  // twice in a row, which triggers "camera busy" on many Windows machines.
  try {
    await html5QrCode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 250 },
      onScanSuccess,
      () => {} // ignore per-frame "no QR found" callbacks
    );
    busyRetries = 0;
    cameraStarting = false;
    return;
  } catch (err) {
    console.warn('[scanner] facing-mode start failed, trying device list:', err);
  }

  // Fallback: enumerate cameras and open the explicit back/rear one
  // (needed on some multi-camera phones).
  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!cameras || !cameras.length) {
      showCameraError('No camera found',
        'No camera was detected on this device — use manual check-in below.', false);
      return;
    }
    const backCam = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[cameras.length - 1];
    await html5QrCode.start(
      backCam.id,
      { fps: 10, qrbox: 250 },
      onScanSuccess,
      () => {}
    );
    busyRetries = 0;
  } catch (err) {
    console.error(err);
    cameraErrorFromException(err);
  } finally {
    cameraStarting = false;
  }
}

// ---------- manual check-in fallback ----------
let manualSession = document.getElementById('manualSession');
let sessionHint = document.getElementById('sessionHint');

function rebindScannerUI() {
  readerEl = document.getElementById('reader');
  manualSession = document.getElementById('manualSession');
  sessionHint = document.getElementById('sessionHint');

  document.getElementById('manualBtn').addEventListener('click', async () => {
    const sessionId = manualSession.value;
    const studentId = document.getElementById('manualStudentId').value.trim();
    if (!sessionId) { flash('Pick a session first.', 'error'); return; }
    if (!studentId) { flash('Enter a student ID.', 'error'); return; }

    try {
      const regCollection = collection(db, 'sessions', sessionId, 'registrations');
      const q = query(regCollection, where('studentId', '==', studentId), limit(1));
      const snap = await getDocs(q);
      if (snap.empty) {
        flash('No registration found for that ID in this session.', 'error');
        return;
      }
      await checkIn(sessionId, snap.docs[0].id);
      document.getElementById('manualStudentId').value = '';
    } catch (err) {
      console.error(err);
      flash('Connection problem — could not look up that ID.', 'error');
    }
  });
}

// Live-sync the manual check-in dropdown with ALL ACTIVE sessions.
// The old version loaded once at page open — sessions created afterward
// never appeared on other scanner devices, and any transient failure left
// the list silently empty. Now it updates in real time and auto-retries.
let sessionsUnsubscribe = null;
let hasActiveSessions = false;
let cameraStarted = false;

function watchActiveSessions() {
  if (sessionsUnsubscribe) sessionsUnsubscribe();
  const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(50));
  sessionsUnsubscribe = onSnapshot(q, (snap) => {
    const current = manualSession.value;
    const active = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.active === false) return;
      active.push({ id: d.id, name: data.name || 'Untitled session' });
    });
    hasActiveSessions = active.length > 0;

    manualSession.innerHTML = '<option value="">— Select a session —</option>' +
      active.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    if (current && active.some(s => s.id === current)) manualSession.value = current;

    const scanFrame = document.querySelector('.scan-frame');

    if (!hasActiveSessions) {
      if (!scanFrame.querySelector('.no-session-placeholder')) {
        scanFrame.innerHTML = `
          <div class="camera-error no-session-placeholder" style="padding:50px 24px;">
            <div class="ce-icon" style="font-size:48px;">📋</div>
            <h3>No Active Sessions</h3>
            <p>There are no active sessions yet. Ask the admin to create one from the Admin panel.</p>
          </div>`;
      }
      cameraStarted = false;
      return;
    }

    if (hasActiveSessions && !cameraStarted) {
      cameraStarted = true;
      scanFrame.innerHTML = `
        <div id="reader"></div>
        <div id="scanFlash" class="scan-result-flash" style="display:none;"></div>
        <div class="mt-4">
          <h3 class="session-tag mb-2" style="margin-bottom:8px;">Recent Check-ins</h3>
          <div id="recentList"><p class="small text-body-secondary">No scans yet.</p></div>
        </div>
        <div class="manual-panel">
          <p class="small text-body-secondary mb-2">Camera not cooperating? Check a student in manually.</p>
          <div class="mb-2">
            <label class="form-label">Session</label>
            <select class="form-select" id="manualSession"><option value="">— Select a session —</option></select>
            <p id="sessionHint" class="small text-body-secondary" style="display:none; margin:6px 0 0;">No active sessions yet — they appear here automatically once created or reopened in Admin.</p>
          </div>
          <div class="d-flex gap-2">
            <input type="text" class="form-control" id="manualStudentId" placeholder="Student ID">
            <button class="btn btn-primary" id="manualBtn" style="white-space:nowrap;">Check In</button>
          </div>
        </div>`;
      rebindScannerUI();
      startCamera();
    }
  }, (err) => {
    console.error(err);
    showToast('Could not load sessions — check connection. Retrying…', 'error');
    setTimeout(watchActiveSessions, 4000);
  });
}
watchActiveSessions();
