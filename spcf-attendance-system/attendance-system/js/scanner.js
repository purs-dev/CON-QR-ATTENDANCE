import { db } from "./firebase-config.js";
import {
  doc, getDoc, updateDoc, collection, query, where, getDocs, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

// ---------- core check-in logic (shared by camera scan + manual entry) ----------
async function checkIn(sessionId, registrationId) {
  try {
    const ref = doc(db, 'sessions', sessionId, 'registrations', registrationId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      flash('Unknown code — not found in this session.', 'error');
      return;
    }

    const data = snap.data();
    if (data.checkedIn) {
      const time = data.checkedInAt ? data.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
      flash(`${data.name} already checked in ${time ? 'at ' + time : ''}`, 'warn');
      return;
    }

    await updateDoc(ref, { checkedIn: true, checkedInAt: serverTimestamp() });
    const now = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    flash(`✓ ${data.name} checked in`, 'success');
    addRecent(data.name, now);
  } catch (err) {
    console.error(err);
    flash('Connection problem — could not record check-in.', 'error');
  }
}

// ---------- camera scanning ----------
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
    return;
  }
  const [sessionId, registrationId] = parts;
  checkIn(sessionId, registrationId);
}

const html5QrCode = new Html5Qrcode('reader');
Html5Qrcode.getCameras().then(cameras => {
  if (!cameras || !cameras.length) {
    showToast('No camera found — use manual check-in below.', 'error');
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
    showToast('Could not start camera — check browser permissions.', 'error');
  });
}).catch(err => {
  console.error(err);
  showToast('Camera access unavailable. Use manual check-in below.', 'error');
});

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
