import { db } from "./firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- cursor ring ----------
const cursor = document.querySelector('.cursor-ring');
document.addEventListener('mousemove', (e) => {
  cursor.style.left = e.clientX + 'px';
  cursor.style.top = e.clientY + 'px';
});
document.querySelectorAll('button, input, a, select').forEach(el => {
  el.addEventListener('mouseenter', () => cursor.classList.add('grow'));
  el.addEventListener('mouseleave', () => cursor.classList.remove('grow'));
});

// ---------- toast helper (Bootstrap Toast component) ----------
function showToast(message, type = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="toast-body">${message}</div>`;
  stack.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3000 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

// ---------- passcode gate ----------
// NOTE: this is a soft, client-side gate only — it keeps casual visitors out
// of the setup screen, it is NOT real security. Firestore rules (see
// README.md) are what actually control who can write data.
const ADMIN_KEY = 'SPCF-CON2026';
const lockCard = document.getElementById('lockCard');
const qrProtected = document.getElementById('qrProtected');

document.getElementById('unlockBtn').addEventListener('click', () => {
  const input = document.getElementById('passcodeInput').value;
  if (input === ADMIN_KEY) {
    sessionStorage.setItem('authorized', 'true');
    lockCard.style.display = 'none';
    qrProtected.style.display = 'block';
    renderHistory();
  } else {
    document.getElementById('lockError').style.display = 'block';
  }
});
if (sessionStorage.getItem('authorized') === 'true') {
  lockCard.style.display = 'none';
  qrProtected.style.display = 'block';
}
document.getElementById('relockBtn').addEventListener('click', () => {
  sessionStorage.removeItem('authorized');
  location.reload();
});

// ---------- helpers ----------
const baseDir = location.href.substring(0, location.href.lastIndexOf('/') + 1);
function registrationLink(sessionId) {
  return `${baseDir}register.html?session=${sessionId}`;
}
function scannerLink() {
  return `${baseDir}scanner.html`;
}

let currentSessionId = null;
let currentSessionName = null;

// ---------- create session ----------
document.getElementById('createSessionBtn').addEventListener('click', async () => {
  const name = document.getElementById('eventName').value.trim();
  if (!name) { showToast('Enter an event name first.', 'warn'); return; }

  const btn = document.getElementById('createSessionBtn');
  btn.disabled = true; btn.textContent = 'Creating…';

  try {
    const docRef = await addDoc(collection(db, 'sessions'), {
      name, createdAt: serverTimestamp(), active: true
    });
    currentSessionId = docRef.id;
    currentSessionName = name;
    displaySessionQR(docRef.id, name);
    saveToHistory(docRef.id, name);
    renderHistory();
    showToast(`Session "${name}" created.`);
  } catch (err) {
    console.error(err);
    showToast('Could not create session — check your Firebase config.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Create Session & Get QR';
  }
});

function displaySessionQR(sessionId, name) {
  currentSessionId = sessionId;
  currentSessionName = name;

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  const link = registrationLink(sessionId);
  new QRCode(qrDiv, {
    text: link, width: 240, height: 240,
    colorDark: '#0B3D2E', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
  });
  qrDiv.classList.add('pop');

  document.getElementById('badgeEventName').textContent = name;
  document.getElementById('downloadBtn').disabled = false;
  document.getElementById('copyLinkBtn').disabled = false;

  const scannerBtn = document.getElementById('openScannerBtn');
  scannerBtn.href = scannerLink();
  scannerBtn.style.pointerEvents = 'auto';
  scannerBtn.style.opacity = '1';

  const note = document.getElementById('sessionCreatedNote');
  note.style.display = 'block';
  document.getElementById('activeSessionLabel').textContent = name;

  document.getElementById('downloadBtn').onclick = () => {
    const canvas = qrDiv.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${name.replace(/\s+/g, '_')}_registration_qr.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
  document.getElementById('copyLinkBtn').onclick = () => {
    navigator.clipboard.writeText(link).then(() => showToast('Registration link copied.'));
  };
  document.getElementById('closeSessionBtn').onclick = async () => {
    await updateDoc(doc(db, 'sessions', sessionId), { active: false });
    showToast('Registration closed for this session.', 'warn');
    note.style.display = 'none';
  };
}

// ---------- local history (per-device convenience list, not shared data) ----------
function saveToHistory(id, name) {
  const list = JSON.parse(localStorage.getItem('con_sessions') || '[]');
  list.unshift({ id, name, createdAt: Date.now() });
  localStorage.setItem('con_sessions', JSON.stringify(list.slice(0, 10)));
}
function renderHistory() {
  const list = JSON.parse(localStorage.getItem('con_sessions') || '[]');
  const container = document.getElementById('historyList');
  if (!list.length) {
    container.innerHTML = '<p class="small text-body-secondary mb-0">No sessions yet.</p>';
    return;
  }
  container.innerHTML = list.map(s => `
    <div class="history-item">
      <span class="hname">${s.name}</span>
      <div class="hactions">
        <button data-id="${s.id}" data-name="${s.name}" class="load-btn">QR</button>
      </div>
    </div>
  `).join('');
  container.querySelectorAll('.load-btn').forEach(b => {
    b.addEventListener('click', () => displaySessionQR(b.dataset.id, b.dataset.name));
  });
}
renderHistory();

// ---------- live feed ----------
const picker = document.getElementById('sessionPicker');
let unsubscribeLive = null;

async function loadSessionOptions() {
  const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(20));
  const snap = await getDocs(q);
  const current = picker.value;
  picker.innerHTML = '<option value="">— Select a session —</option>';
  snap.forEach(d => {
    const opt = document.createElement('option');
    opt.value = d.id;
    opt.textContent = d.data().name;
    picker.appendChild(opt);
  });
  if (current) picker.value = current;
  else if (currentSessionId) picker.value = currentSessionId;
}
document.querySelector('[data-bs-target="#panel-live"]').addEventListener('shown.bs.tab', loadSessionOptions);
loadSessionOptions();

picker.addEventListener('change', () => {
  if (unsubscribeLive) unsubscribeLive();
  const sessionId = picker.value;
  const table = document.getElementById('responseTable');
  const empty = document.getElementById('emptyState');
  const body = document.getElementById('tableBody');

  if (!sessionId) {
    table.style.display = 'none'; empty.style.display = 'block';
    document.getElementById('registeredCount').textContent = '0';
    document.getElementById('checkedInCount').textContent = '0';
    document.getElementById('liveDot').classList.remove('live');
    return;
  }

  const q = query(collection(db, 'sessions', sessionId, 'registrations'), orderBy('registeredAt', 'desc'));
  unsubscribeLive = onSnapshot(q, (snap) => {
    if (snap.empty) {
      table.style.display = 'none'; empty.style.display = 'block';
      document.getElementById('registeredCount').textContent = '0';
      document.getElementById('checkedInCount').textContent = '0';
      return;
    }
    table.style.display = 'table'; empty.style.display = 'none';
    let checkedIn = 0;
    body.innerHTML = snap.docs.map(d => {
      const r = d.data();
      if (r.checkedIn) checkedIn++;
      const time = r.checkedInAt ? r.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
      return `<tr>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.section)}</td>
        <td>${escapeHtml(r.studentId)}</td>
        <td>${r.checkedIn ? '<span class="status-pill in">Checked In</span>' : '<span class="status-pill out">Not Yet</span>'}</td>
        <td>${time}</td>
      </tr>`;
    }).join('');
    document.getElementById('registeredCount').textContent = snap.size;
    document.getElementById('checkedInCount').textContent = checkedIn;
    document.getElementById('liveDot').classList.add('live');
  }, (err) => {
    console.error(err);
    showToast('Live feed lost connection — check your Firestore rules.', 'error');
  });
});

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
