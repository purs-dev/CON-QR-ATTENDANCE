import { db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp
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

// ---------- core check-in logic (shared by camera scan + manual entry) ----------
async function checkIn(sessionId, registrationId) {
  try {
    const ref = doc(db, 'sessions', sessionId, 'registrations', registrationId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      flash('Unknown code — not found in this session.', 'error');
      sfx.play('error');
      buzz(120);
      return;
    }

    const data = snap.data();
    const name = getDisplayName(data);

    if (data.checkedIn) {
      const time = data.checkedInAt ? data.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      flash(`${name} already checked in ${time ? 'at ' + time : ''}`, 'warn');
      sfx.play('warn');
      buzz(80);
      return;
    }

    await updateDoc(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flash(`✓ ${name} checked in`, 'success');
    addRecent(name, now);
    sfx.play('success');
    buzz([40, 60, 40]);
    confettiAt(document.getElementById('scanFlash'), { count: 110, power: 9 });
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
const readerEl = document.getElementById('reader');
const html5QrCode = new Html5Qrcode('reader');

function showCameraError(title, hint, showRetry = true) {
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
    readerEl.classList.remove('cam-error');
    readerEl.innerHTML = '';
    startCamera();
  });
  showToast(hint, 'error');
}

function cameraErrorFromException(err) {
  const name = String((err && (err.name || err.message)) || err);
  if (/NotAllowed|PermissionDenied/i.test(name)) {
    showCameraError('Camera permission denied',
      'Allow camera access for this site (check the padlock / permissions in the address bar), then tap Retry.');
  } else if (/NotFound|DevicesNotFound|Overconstrained/i.test(name)) {
    showCameraError('No camera found',
      'No usable camera was detected on this device — use manual check-in below.', false);
  } else if (/NotReadable|TrackStart|InUse/i.test(name)) {
    showCameraError('Camera is busy',
      'Another app or browser tab is using the camera. Close it, then tap Retry.');
  } else {
    showCameraError('Could not start camera',
      'Something went wrong starting the camera. Retry, or use manual check-in below.');
  }
}

function startCamera() {
  if (!window.isSecureContext) {
    showCameraError('Camera needs a secure connection',
      'Browsers only allow camera access on HTTPS or localhost. Open this page via https://… or http://localhost — not by double-clicking the file or via a plain-HTTP network address.',
      false);
    return;
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showCameraError('Camera not supported',
      'This browser does not expose camera access. Try Chrome, Edge, or Safari.', false);
    return;
  }

  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras || !cameras.length) {
      showCameraError('No camera found',
        'No camera was detected on this device — use manual check-in below.', false);
      return;
    }
    const backCam = cameras.find(c => /back|rear|environment/i.test(c.label)) || cameras[cameras.length - 1];
    html5QrCode.start(
      backCam.id,
      { fps: 10, qrbox: 250 },
      onScanSuccess,
      () => {} // ignore per-frame "no QR found" callbacks
    ).catch(err => {
      console.error(err);
      cameraErrorFromException(err);
    });
  }).catch(err => {
    console.error(err);
    cameraErrorFromException(err);
  });
}
startCamera();

// ---------- manual check-in fallback ----------
const manualSession = document.getElementById('manualSession');

async function loadManualSessions() {
  const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(20));
  const snap = await getDocs(q);
  manualSession.innerHTML = '<option value="">— Select a session —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().name;
    manualSession.appendChild(opt);
  });
}
loadManualSessions();

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
