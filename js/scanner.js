import { db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, setDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp,
  getCountFromServer, onSnapshot
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

// Turns a Firestore error into an honest message: the #1 field complaint is a
// device still running the old cached app (points at the dead old project →
// writes are denied), the #2 is weak signal in a packed hall.
function scannerError(action, err) {
  const code = (err && err.code) || '';
  const msg = String((err && err.message) || '');
  if (code === 'permission-denied') {
    return `Can't ${action} — this device is running an outdated app copy. Fully close and reopen the page, then scan again.`;
  }
  if (code === 'unavailable' || code === 'deadline-exceeded' || /network|failed to fetch|offline/i.test(msg)) {
    return `Can't ${action} — no internet connection right now. Reconnect and retry.`;
  }
  return `Connection problem — could not ${action}. (${code || 'error'})`;
}

// Registrations now have dynamic field keys (whatever the session's fields
// were set to). "name" is the default id for the first field, but if an
// admin renamed/removed it, fall back to the first non-metadata value.
function getDisplayName(data) {
  if (data.name) return data.name;
  const metaKeys = ['registeredAt', 'checkedIn', 'checkedInAt', 'checkedOut', 'checkedOutAt'];
  const key = Object.keys(data).find(k => !metaKeys.includes(k));
  return key ? data[key] : 'Student';
}

// ---------- session helpers (multi-device / multi-level aware) ----------
// Rich cache: name + optional time-out pairing (linkTo = the time-in session
// this one is the time-out gate for).
const sessionCache = new Map();
async function getSession(sessionId) {
  if (!sessionId || sessionCache.has(sessionId)) return sessionCache.get(sessionId) || null;
  let out = null;
  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId));
    if (snap.exists()) {
      const d = snap.data();
      let partnerName = '';
      if (d.linkTo) {
        const pSnap = await getDoc(doc(db, 'sessions', d.linkTo));
        partnerName = pSnap.exists() ? (pSnap.data().name || '') : '';
      }
      out = { id: sessionId, name: d.name || 'Unknown session', linkTo: d.linkTo || null, withTimeOut: !!d.withTimeOut, partnerName };
    }
  } catch (err) { console.warn(err); }
  sessionCache.set(sessionId, out);
  return out;
}
async function getSessionName(sessionId) {
  const s = await getSession(sessionId);
  return s ? s.name : 'Unknown session';
}

// Live per-session totals — ALWAYS visible for every active session, so a
// single glance shows 1st/2nd/3rd/4th-year counts together. Clicking a chip
// picks that session in the manual-check-in dropdown.
async function refreshSessionChips(activeSessions) {
  const chips = document.getElementById('sessionChips');
  if (!chips) return;

  const wantedIds = new Set(activeSessions.map(s => s.id));
  [...chips.querySelectorAll('.session-chip')].forEach(el => {
    if (!wantedIds.has(el.dataset.session)) el.remove();
  });

  const jobs = activeSessions.map(async (s) => {
    try {
      const sess = await getSession(s.id);
      let label;
      if (sess && sess.withTimeOut) {
        const qIn = query(collection(db, 'sessions', s.id, 'registrations'), where('checkedIn', '==', true));
        const qOut = query(collection(db, 'sessions', s.id, 'registrations'), where('checkedOut', '==', true));
        const cIn = (await getCountFromServer(qIn)).data().count;
        const cOut = (await getCountFromServer(qOut)).data().count;
        label = `${cIn} ✓ · ${cOut} out`;
      } else if (sess && sess.linkTo) {
        const q = query(collection(db, 'sessions', s.id, 'registrations'), where('checkedOut', '==', true));
        label = (await getCountFromServer(q)).data().count + ' out';
      } else {
        const q = query(collection(db, 'sessions', s.id, 'registrations'), where('checkedIn', '==', true));
        label = (await getCountFromServer(q)).data().count + ' ✓';
      }
      let chip = chips.querySelector(`[data-session="${s.id}"]`);
      if (!chip) {
        chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'session-chip';
        chip.dataset.session = s.id;
        chip.addEventListener('click', () => {
          const sel = document.getElementById('manualSession');
          if (sel && sel.querySelector(`option[value="${s.id}"]`)) { sel.value = s.id; }
        });
        chips.appendChild(chip);
      }
      chip.textContent = `${s.name}: ${label}`;
    } catch (err) {
      console.warn('[scanner] chip update failed:', err);
    }
  });
  await Promise.all(jobs);
}

// ---------- core check-in logic (shared by camera scan + manual entry) ----------
// Plain read + update (NOT a transaction): ordinary writes queue in Firestore's
// offline cache, so a scan still records during weak signal and syncs the
// moment the connection returns. Duplicate scans are caught by the checkedIn
// marker + the debounce.
async function checkIn(sessionId, registrationId) {
  try {
    const ref = doc(db, 'sessions', sessionId, 'registrations', registrationId);
    const sessionName = await getSessionName(sessionId);

    let outcome = null;
    const snap = await getDoc(ref);
    if (!snap.exists()) { outcome = { status: 'unknown' }; }
    else {
      const data = snap.data();
      const name = getDisplayName(data);
      if (data.checkedIn) {
        const time = data.checkedInAt ? data.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
        outcome = { status: 'already', name, time };
      } else {
        await updateDoc(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
        outcome = { status: 'ok', name };
      }
    }

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
    refreshSessionChips([{ id: sessionId, name: sessionName }]);
  } catch (err) {
    console.error(err);
    flash(scannerError('record check-in', err), 'error');
    sfx.play('error');
    buzz(120);
  }
}

// ---------- scan handling ----------
let lastText = '';
let lastTime = 0;
let gateSessionId = ''; // camera gate: locked to one paired (time-out) session

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
  const [qrSessionId, registrationId] = parts;
  routeScan(qrSessionId, registrationId);
}

// Chooses between normal time-in and the paired time-out flow.
async function routeScan(qrSessionId, registrationId) {
  // 1) A gate is locked on the scanner → honour it.
  if (gateSessionId) {
    const g = await getSession(gateSessionId);
    if (g && g.linkTo) {
      if (qrSessionId !== g.linkTo) {
        flash(`${g.name} is the time-out gate for ${g.partnerName || 'that session'} — scan that year's QR.`, 'error');
        sfx.play('error');
        buzz(120);
        return;
      }
      await doTimeOutFromCon(g, registrationId);
      return;
    }
    if (g && g.withTimeOut) {
      if (qrSessionId !== g.id) {
        flash(`${g.name} uses the same QR for time-in and time-out — scan its QR.`, 'error');
        sfx.play('error');
        buzz(120);
        return;
      }
      await checkInOrOut(g.id, registrationId);
      return;
    }
    if (g) { await checkIn(g.id, registrationId); return; }
    flash('Unknown gate session.', 'error');
    return;
  }

  // 2) Auto mode: a session that has BOTH time-in and time-out (withTimeOut) —
  //    first scan = check-in, second scan = same QR = time-out.
  const qrSess = await getSession(qrSessionId);
  if (qrSess && qrSess.withTimeOut) {
    await checkInOrOut(qrSessionId, registrationId);
    return;
  }

  // 3) Auto mode: a QR minted by a paired (time-out) session routes to time-out.
  if (qrSess && qrSess.linkTo) {
    await doTimeOutFromOutReg(qrSess, registrationId);
    return;
  }

  // 4) Normal time-in.
  await checkIn(qrSessionId, registrationId);
}

// ---------- combined time-in / time-out (ONE session, ONE QR) ----------
// The QR the student got from the single form does double duty: the first scan
// checks them in, the second scan (same QR) checks them out. Time-out is only
// possible AFTER a time-in — duplicates are blocked.
async function checkInOrOut(sessionId, registrationId) {
  try {
    const ref = doc(db, 'sessions', sessionId, 'registrations', registrationId);
    const sessionName = await getSessionName(sessionId);

    const snap = await getDoc(ref);
    if (!snap.exists()) {
      flash(`Unknown code — not found in ${sessionName}.`, 'error');
      sfx.play('error'); buzz(120);
      return;
    }
    const data = snap.data();
    const name = getDisplayName(data);
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!data.checkedIn) {
      // First scan → time-in.
      await updateDoc(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
      flash(`✓ ${name} checked in · ${sessionName}`, 'success');
      addRecent(`[${sessionName}] ${name}`, now);
      sfx.play('success'); buzz([40, 60, 40]);
      confettiAt(document.getElementById('scanFlash'), { count: 110, power: 9 });
    } else if (!data.checkedOut) {
      // Second scan → time-out.
      await updateDoc(ref, { checkedOut: true, checkedOutAt: serverTimestamp() });
      flash(`✓ ${name} timed out · ${sessionName}`, 'success');
      addRecent(`[${sessionName}] ${name} timed out`, now);
      sfx.play('success'); buzz([40, 60, 40]);
      confettiAt(document.getElementById('scanFlash'), { count: 110, power: 9 });
    } else {
      const t = data.checkedOutAt ? data.checkedOutAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      flash(`${name} already timed out${t ? ' at ' + t : ''} · ${sessionName}`, 'warn');
      sfx.play('warn'); buzz(80);
    }
    refreshSessionChips([{ id: sessionId, name: sessionName }]);
  } catch (err) {
    console.error(err);
    flash(scannerError('record check-in / time-out', err), 'error');
    sfx.play('error'); buzz(120);
  }
}

// ---------- time-out flow (paired sessions) ----------
// Rule: ONLY students who time-IN for the linked session can time out here.
// The time-out record is created on the fly from their time-in record —
// no duplicate manual registration needed.
const OUT_META_KEYS = ['registeredAt', 'checkedIn', 'checkedInAt', 'checkedOut', 'checkedOutAt'];

async function partnerRegByStudentId(partnerSessionId, studentId) {
  if (!partnerSessionId || !studentId) return null;
  const c = collection(db, 'sessions', partnerSessionId, 'registrations');
  const q = query(c, where('studentId', '==', studentId), limit(1));
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0];
}

async function recordTimeOut(outSession, partnerDocRef) {
  try {
    let outcome = null;
    const pSnap = await getDoc(partnerDocRef);
    if (!pSnap.exists()) { outcome = { status: 'unknown' }; }
    else {
      const pData = pSnap.data();
      const name = getDisplayName(pData);
      if (!pData.checkedIn) { outcome = { status: 'notIntimed', name }; }
      else {
        const studentId = pData.studentId || '';
        // Deterministic record ID = the student number (sanitized), so two gates
        // or a re-scan can never create an extra record.
        const docId = (String(studentId).replace(/[^A-Za-z0-9._-]/g, '-')) || ('nout_' + Date.now());
        const outRef = doc(db, 'sessions', outSession.id, 'registrations', docId);
        const outSnap = await getDoc(outRef);
        if (outSnap.exists() && outSnap.data().checkedOut) {
          const od = outSnap.data();
          const t = od.checkedOutAt ? od.checkedOutAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          outcome = { status: 'already', name, time: t || 'already' };
        } else {
          // Copy the student's identity fields over, minus check-in metadata.
          const identity = {};
          for (const k of Object.keys(pData)) {
            if (!OUT_META_KEYS.includes(k)) identity[k] = pData[k];
          }
          await setDoc(outRef, {
            ...identity,
            checkedIn: false, checkedInAt: null,
            checkedOut: true, checkedOutAt: serverTimestamp(),
            registeredAt: serverTimestamp()
          });
          outcome = { status: 'ok', name };
        }
      }
    }

    if (!outcome || outcome.status === 'unknown') {
      flash(`Unknown code — not found in ${outSession.partnerName || 'the paired session'}.`, 'error');
      sfx.play('error'); buzz(120);
      return;
    }
    if (outcome.status === 'notIntimed') {
      flash(`${outcome.name} hasn't timed in for ${outSession.partnerName || 'the paired session'} — cannot time out.`, 'error');
      sfx.play('error'); buzz(120);
      return;
    }
    if (outcome.status === 'already') {
      flash(`${outcome.name} already timed out${outcome.time && outcome.time !== 'already' ? ' at ' + outcome.time : ''} · ${outSession.name}`, 'warn');
      sfx.play('warn'); buzz(80);
      return;
    }

    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flash(`✓ ${outcome.name} timed out · ${outSession.name}`, 'success');
    addRecent(`[${outSession.name}] ${outcome.name}`, now);
    sfx.play('success');
    buzz([40, 60, 40]);
    confettiAt(document.getElementById('scanFlash'), { count: 110, power: 9 });
    refreshSessionChips([{ id: outSession.id, name: outSession.name }]);
  } catch (err) {
    console.error(err);
    flash(scannerError('record time-out', err), 'error');
    sfx.play('error');
    buzz(120);
  }
}

// Gate scan: the QR was minted by the linked time-in session, so its
// registration ID IS the partner record.
async function doTimeOutFromCon(outSession, conRegId) {
  const partnerRef = doc(db, 'sessions', outSession.linkTo, 'registrations', conRegId);
  await recordTimeOut(outSession, partnerRef);
}

// Auto mode with an OUT-session QR: resolve the partner record by studentId.
async function doTimeOutFromOutReg(outSession, outRegId) {
  try {
    const outRef = doc(db, 'sessions', outSession.id, 'registrations', outRegId);
    const outSnap = await getDoc(outRef);
    if (!outSnap.exists()) { flash('Unknown code.', 'error'); return; }
    const pReg = await partnerRegByStudentId(outSession.linkTo, outSnap.data().studentId || '');
    if (!pReg) {
      flash(`No time-in found for ${getDisplayName(outSnap.data())} in ${outSession.partnerName || 'the paired session'}.`, 'error');
      sfx.play('error'); buzz(120);
      return;
    }
    await recordTimeOut(outSession, pReg.ref);
  } catch (err) {
    console.error(err);
    flash(scannerError('record time-out', err), 'error');
  }
}

// Manual entry for a paired (time-out) session.
async function doTimeOutManual(outSession, term) {
  const found = await findRegistrationByStudentId(outSession.id, term);
  if (found && found.picker) { showPicker(found.picker, outSession.id); return; }

  if (found && found.doc) {
    const pReg = await partnerRegByStudentId(outSession.linkTo, found.doc.data().studentId || '');
    if (!pReg) {
      flash(`No time-in found for ${getDisplayName(found.doc.data())} in ${outSession.partnerName || 'the paired session'}.`, 'error');
      sfx.play('error'); buzz(120);
      return;
    }
    await recordTimeOut(outSession, pReg.ref);
    return;
  }

  // No OUT record yet — look the student up by ID in the time-in session.
  const pReg = await partnerRegByStudentId(outSession.linkTo, term);
  if (!pReg) {
    flash(`No time-in record for "${term}" in ${outSession.partnerName || 'the paired session'} — they must time in first.`, 'error');
    sfx.play('error'); buzz(120);
    return;
  }
  await recordTimeOut(outSession, pReg.ref);
}

// ---------- camera scanning ----------
let readerEl = document.getElementById('reader');
let html5QrCode = null;
let cameraStarting = false;
let busyRetries = 0;
let switchingCamera = false;

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

// Flip between rear and front cameras (auto-detected by the QR library).
async function switchCamera() {
  const btn = document.getElementById('switchCamBtn');
  if (switchingCamera || !html5QrCode || !html5QrCode.switchCamera) return;
  switchingCamera = true;
  if (btn) btn.disabled = true;
  try {
    await html5QrCode.switchCamera();
    sfx.play('pop');
  } catch (err) {
    console.warn('[scanner] switchCamera failed:', err);
    showToast('Could not switch camera.', 'warn');
  } finally {
    switchingCamera = false;
    if (btn) btn.disabled = false;
  }
}

function setupCameraSwitchButton() {
  const btn = document.getElementById('switchCamBtn');
  if (btn) btn.addEventListener('click', switchCamera);
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

// ----- manual search: match the session's REAL fields for ID or name -----
// 1) ID search across identifier-like fields (exact match).
// 2) Name search across name-like fields (prefix match) — if more than one
//    student matches, they're shown as tappable picks on the scanner.
const sessionFieldsCache = new Map();
async function getSessionFields(sessionId) {
  if (sessionFieldsCache.has(sessionId)) return sessionFieldsCache.get(sessionId);
  try {
    const sSnap = await getDoc(doc(db, 'sessions', sessionId));
    const fields = (sSnap.exists() && sSnap.data().fields) ? sSnap.data().fields : [];
    sessionFieldsCache.set(sessionId, fields);
    return fields;
  } catch (err) { return []; }
}

function fieldScores(fields) {
  return fields.map(f => {
    const id = String(f.id || '');
    const label = String(f.label || '');
    let score = 0;
    if (id === 'studentId') score += 4;
    if (/student/i.test(id) || /student/i.test(label)) score += 3;
    if (/\bid|id number|student no|id no|student number/i.test(`${id} ${label}`)) score += 2;
    if (/name/i.test(id) || /name/i.test(label)) score += 3;
    if (/^[a-z0-9]+$/i.test(id)) score += 1;
    return { f, score };
  });
}

async function findRegistrationByStudentId(sessionId, term) {
  const regCollection = collection(db, 'sessions', sessionId, 'registrations');

  // 1st pass: the default field id — fast, avoids extra reads.
  const fastSnap = await getDocs(query(regCollection, where('studentId', '==', term), limit(1)));
  if (!fastSnap.empty) return { doc: fastSnap.docs[0], picker: null };

  const fields = await getSessionFields(sessionId);
  if (!fields.length) return null;

  // ID fields first (exact), then any remaining field (exact).
  const ids = fieldScores(fields).sort((a, b) => b.score - a.score).map(x => x.f.id);
  for (const fieldId of ids) {
    if (!fieldId) continue;
    const snap = await getDocs(query(regCollection, where(fieldId, '==', term), limit(1)));
    if (!snap.empty) return { doc: snap.docs[0], picker: null };
  }

  // Name search (prefix) across name-like fields → return candidates.
  const nameFields = fields.filter(f => /name/i.test(String(f.id || '')) || /name/i.test(String(f.label || '')) ||
                                        !ids.includes(f.id));  // any non-ID field is tried by name too
  const candidates = [];
  for (const fieldId of nameFields.map(f => f.id)) {
    if (!fieldId || candidates.length >= 5) break;
    const snap = await getDocs(query(regCollection, where(fieldId, '>=', term), where(fieldId, '<=', term + '\uf8ff'), limit(5)));
    snap.forEach(d => { if (!candidates.some(x => x.id === d.id)) candidates.push(d); });
  }
  if (candidates.length === 1) return { doc: candidates[0], picker: null };
  if (candidates.length > 1) return { doc: null, picker: candidates };
  return null;
}

function showPicker(candidates, sessionId) {
  const wrap = document.getElementById('searchResults');
  if (!wrap) return;
  const fields = null;
  wrap.innerHTML = `
    <div class="pick-head">Multiple students match — tap the right one:</div>
    ${candidates.map((d, i) => {
      const data = d.data();
      const name = getDisplayName(data);
      const idVal = data.studentId || '';
      return `<button type="button" class="pick-row" data-i="${i}"><b>${escapeHtml(name)}</b>${idVal ? `<span>${escapeHtml(idVal)}</span>` : ''}</button>`;
    }).join('')}`;
  wrap.style.display = 'block';
  wrap.querySelectorAll('.pick-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      wrap.style.display = 'none';
      const idx = Number(btn.dataset.i);
      const match = candidates[idx];
      if (match) {
        const sSnap = await getSession(sessionId);
        if (sSnap && sSnap.linkTo) {
          const pReg = await partnerRegByStudentId(sSnap.linkTo, match.data().studentId || '');
          if (pReg) await recordTimeOut(sSnap, pReg.ref);
          else flash(`No time-in found for ${getDisplayName(match.data())} in ${sSnap.partnerName || 'the paired session'}.`, 'error');
        } else if (sSnap && sSnap.withTimeOut) {
          await checkInOrOut(sessionId, match.id);
        } else {
          await checkIn(sessionId, match.id);
        }
        document.getElementById('manualStudentId').value = '';
      }
    });
  });
}

function rebindScannerUI() {
  readerEl = document.getElementById('reader');
  manualSession = document.getElementById('manualSession');
  sessionHint = document.getElementById('sessionHint');
  setupCameraSwitchButton();

  const gateSelect = document.getElementById('gateSelect');
  if (gateSelect) {
    gateSelect.addEventListener('change', () => {
      gateSessionId = gateSelect.value;
      updateGateHint();
    });
  }

  document.getElementById('manualBtn').addEventListener('click', async () => {
    const sessionId = manualSession.value;
    const term = document.getElementById('manualStudentId').value.trim();
    const resultsWrap = document.getElementById('searchResults');
    if (resultsWrap) resultsWrap.style.display = 'none';
    if (!sessionId) { flash('Pick a session first.', 'error'); return; }
    if (!term) { flash('Enter a student ID or name.', 'error'); return; }

    try {
      const session = await getSession(sessionId);
      // Paired (time-out) session → enforce "must have timed in first".
      if (session && session.linkTo) {
        await doTimeOutManual(session, term);
        document.getElementById('manualStudentId').value = '';
        return;
      }
      const found = await findRegistrationByStudentId(sessionId, term);
      if (!found) {
        flash('No registration found for that ID or name.', 'error');
        return;
      }
      if (found.picker) { showPicker(found.picker, sessionId); return; }
      if (session && session.withTimeOut) await checkInOrOut(sessionId, found.doc.id);
      else await checkIn(sessionId, found.doc.id);
      document.getElementById('manualStudentId').value = '';
    } catch (err) {
      console.error(err);
      flash(scannerError('look up that ID', err), 'error');
    }
  });
}

async function updateGateHint() {
  const hint = document.getElementById('gateHint');
  if (!hint) return;
  if (!gateSessionId) { hint.style.display = 'none'; return; }
  const g = await getSession(gateSessionId);
  hint.style.display = 'block';
  if (g && g.linkTo) {
    hint.textContent = `Time-out gate: scans check students OUT of ${g.name}, but only if they timed in for ${g.partnerName || 'the paired session'} first.`;
  } else {
    hint.textContent = '';
    hint.style.display = 'none';
  }
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
    const active = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.active === false) return;
      if (data.archived === true) return; // archived sessions are hidden, not deleted
      active.push({ id: d.id, name: data.name || 'Untitled session' });
    });
    hasActiveSessions = active.length > 0;

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
        <div id="sessionChips" class="session-chips" style="display:none;"></div>
        <div class="scan-toolbar d-flex gap-2 align-items-center mb-2">
          <button type="button" id="switchCamBtn" class="switch-cam-btn" title="Switch camera (front / back)" aria-label="Switch camera">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>
      </button>
        </div>
        <div class="gate-bar mb-2" id="gateBar" style="display:none;">
          <label class="form-label small mb-1" for="gateSelect">Scanner mode</label>
          <select class="form-select" id="gateSelect"></select>
          <p id="gateHint" class="small" style="display:none; margin:6px 0 0;"></p>
        </div>
        <div id="reader"></div>
        <div id="scanFlash" class="scan-result-flash" style="display:none;"></div>
        <div class="mt-4">
          <h3 class="session-tag mb-2" style="margin-bottom:8px;">Recent Scans</h3>
          <div id="recentList"><p class="small text-body-secondary">No scans yet.</p></div>
        </div>
        <div class="manual-panel">
          <p class="small text-body-secondary mb-2">Camera not cooperating? Check a student in manually — ID or name.</p>
          <div class="mb-2">
            <label class="form-label">Session</label>
            <select class="form-select" id="manualSession"><option value="">— Select a session —</option></select>
            <p id="sessionHint" class="small text-body-secondary" style="display:none; margin:6px 0 0;">No active sessions yet — they appear here automatically once created or reopened in Admin.</p>
          </div>
          <div class="d-flex gap-2">
            <input type="text" class="form-control" id="manualStudentId" placeholder="Student ID or name">
            <button class="btn btn-primary" id="manualBtn" style="white-space:nowrap;">Check In</button>
          </div>
          <div id="searchResults" class="search-results" style="display:none; margin-top:10px;"></div>
        </div>`;
      rebindScannerUI();
      startCamera();
    }

    // ALWAYS (re)fill the dropdown with the current active list —
    // must run AFTER any rebuild so the fresh <select> actually gets options.
    const current = manualSession.value;
    manualSession.innerHTML = '<option value="">— Select a session —</option>' +
      active.map(s => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
    if (current && active.some(s => s.id === current)) manualSession.value = current;

    // Camera gate: only paired (time-out) sessions appear as gate options.
    const gateEl = document.getElementById('gateSelect');
    const gateBarEl = document.getElementById('gateBar');
    if (gateEl) {
      const prevGate = gateSessionId;
      let gateOpts = '<option value="">Normal mode — decode from QR</option>';
      let outCount = 0;
      snap.forEach(d => {
        const data = d.data();
        if (data.active === false || data.archived === true) return;
        if (!data.linkTo) return;
        outCount++;
        gateOpts += `<option value="${escapeHtml(d.id)}">TIME-OUT · ${escapeHtml(data.name || 'Untitled')}</option>`;
      });
      gateEl.innerHTML = gateOpts;
      if (gateBarEl) gateBarEl.style.display = outCount ? 'block' : 'none';
      if (prevGate && gateEl.querySelector(`option[value="${prevGate}"]`)) gateEl.value = prevGate;
      else gateSessionId = '';
      updateGateHint();
    }

    // Refresh the live per-session totals chips (always visible for ALL sessions).
    const chipsWrap = document.getElementById('sessionChips');
    if (chipsWrap) {
      chipsWrap.style.display = active.length ? 'flex' : 'none';
      refreshSessionChips(active);
    }
  }, (err) => {
    console.error(err);
    showToast('Could not load sessions — check connection. Retrying…', 'error');
    setTimeout(watchActiveSessions, 4000);
  });
}
watchActiveSessions();
