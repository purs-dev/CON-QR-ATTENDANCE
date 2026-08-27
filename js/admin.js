import { db } from "./firebase-config.js";
import {
  collection, addDoc, doc, updateDoc, deleteDoc, getDoc, getDocs, writeBatch,
  onSnapshot, query, where, orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sfx, confettiBurstAtElement as confettiAt, countUp, confirmDialog } from "./app-shell.js";

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

// ---------- ripple effect on any .btn ----------
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

// ---------- badge 3D tilt ----------
function attachTilt(el) {
  if (!el) return;
  document.addEventListener('mousemove', (e) => {
    const rect = el.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = (e.clientX - (rect.left + rect.width / 2)) / 18;
    const y = (e.clientY - (rect.top + rect.height / 2)) / 18;
    el.style.transform = `perspective(1000px) rotateY(${x}deg) rotateX(${-y}deg)`;
  });
}
attachTilt(document.getElementById('badgeContainer'));

// ---------- toast helper ----------
function showToast(message, type = '') {
  const stack = document.getElementById('toastStack');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', 'status');
  el.innerHTML = `<div class="toast-body">${message}</div>`;
  stack.appendChild(el);
  const t = new bootstrap.Toast(el, { delay: 3200 });
  t.show();
  el.addEventListener('hidden.bs.toast', () => el.remove());
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(str = '') { return escapeHtml(str).replace(/`/g, '&#96;'); }

// ---------- passcode gate ----------
// NOTE: soft, client-side gate only — keeps casual visitors out of setup.
// Firestore rules (see README.md) are what actually control who can write data.
const ADMIN_KEY = 'SPCF-CON2026';
const lockCard = document.getElementById('lockCard');
const qrProtected = document.getElementById('qrProtected');

document.getElementById('unlockBtn').addEventListener('click', () => {
  const input = document.getElementById('passcodeInput').value;
  if (input === ADMIN_KEY) {
    localStorage.setItem('authorized', 'true');
    lockCard.style.display = 'none';
    qrProtected.style.display = 'block';
    renderHistory();
    sfx.play('success');
    confettiAt(document.getElementById('unlockBtn'), { count: 60, power: 7 });
  } else {
    document.getElementById('lockError').style.display = 'block';
    sfx.play('error');
  }
});
if (localStorage.getItem('authorized') === 'true') {
  lockCard.style.display = 'none';
  qrProtected.style.display = 'block';
}
document.getElementById('relockBtn').addEventListener('click', () => {
  localStorage.removeItem('authorized');
  location.reload();
});

// ---------- helpers ----------
const baseDir = location.href.substring(0, location.href.lastIndexOf('/') + 1);
function registrationLink(sessionId) { return `${baseDir}register.html?session=${sessionId}`; }
function scannerLink() { return `${baseDir}scanner.html`; }

function defaultFields() {
  return [
    { id: 'name', label: 'Full Name', required: true },
    { id: 'section', label: 'Section', required: true },
    { id: 'studentId', label: 'Student ID', required: true }
  ];
}
function slugify(label, existingIds) {
  let base = label.trim().toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase()).replace(/[^a-zA-Z0-9]/g, '');
  if (!base) base = 'field';
  let id = base, i = 2;
  while (existingIds.includes(id)) { id = base + i; i++; }
  return id;
}
function finalizeFieldIds(fields) {
  const out = [];
  fields.forEach(f => {
    if (!f.label || !f.label.trim()) return;
    let id = f.id || slugify(f.label, out.map(x => x.id));
    out.push({ id, label: f.label.trim(), required: !!f.required });
  });
  return out;
}

let currentFields = defaultFields();
let editingSessionId = null;
let currentSessionId = null;
let currentSessionActive = true;

// ---------- fields editor ----------
function renderFieldsEditor() {
  const container = document.getElementById('fieldsEditor');
  container.innerHTML = currentFields.map((f, i) => `
    <div class="field-row d-flex align-items-center gap-2 mb-2" data-index="${i}">
      <input type="text" class="form-control form-control-sm field-label-input" value="${escapeAttr(f.label)}" placeholder="Field label">
      <div class="form-check" style="white-space:nowrap;">
        <input class="form-check-input field-required-input" type="checkbox" ${f.required ? 'checked' : ''} id="req-${i}">
        <label class="form-check-label small" for="req-${i}">Req.</label>
      </div>
      <button type="button" class="field-remove-btn" data-index="${i}" title="Remove field">×</button>
    </div>
  `).join('');

  container.querySelectorAll('.field-label-input').forEach((input, i) => {
    input.addEventListener('input', () => { currentFields[i].label = input.value; });
  });
  container.querySelectorAll('.field-required-input').forEach((input, i) => {
    input.addEventListener('change', () => { currentFields[i].required = input.checked; });
  });
  container.querySelectorAll('.field-remove-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentFields.length <= 1) { showToast('You need at least one field.', 'warn'); return; }
      currentFields.splice(Number(btn.dataset.index), 1);
      renderFieldsEditor();
    });
  });
}
document.getElementById('addFieldBtn').addEventListener('click', () => {
  currentFields.push({ id: null, label: '', required: true });
  renderFieldsEditor();
});
renderFieldsEditor();

// ---------- QR display ----------
function displaySessionQR(sessionId, name, active = true) {
  currentSessionId = sessionId;
  currentSessionActive = active;

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  const link = registrationLink(sessionId);
  new QRCode(qrDiv, {
    text: link, width: 260, height: 260,
    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
  });
  qrDiv.classList.add('pop');

  document.getElementById('badgeEventName').textContent = name;
  document.getElementById('downloadBtn').disabled = false;
  document.getElementById('copyLinkBtn').disabled = false;

  const scannerBtn = document.getElementById('openScannerBtn');
  scannerBtn.href = scannerLink();
  scannerBtn.style.pointerEvents = 'auto';
  scannerBtn.style.opacity = '1';

  document.getElementById('sessionCreatedNote').style.display = 'block';
  document.getElementById('activeSessionLabel').textContent = name;
  updateSessionStatusUI(active);

  document.getElementById('downloadBtn').onclick = () => {
    const canvas = qrDiv.querySelector('canvas');
    if (!canvas) return;
    // Re-draw at high resolution with a solid white margin (quiet zone) so
    // scanners read it reliably even when zoomed out or on dark-mode phones.
    const size = 600, pad = 48;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(canvas, pad, pad, size - pad * 2, size - pad * 2);
    const a = document.createElement('a');
    a.download = `${name.replace(/\s+/g, '_')}_registration_qr.png`;
    a.href = c.toDataURL('image/png');
    a.click();
  };
  document.getElementById('copyLinkBtn').onclick = () => {
    navigator.clipboard.writeText(link).then(() => showToast('Registration link copied.'));
  };
}

function updateSessionStatusUI(active) {
  const pill = document.getElementById('sessionStatusPill');
  pill.textContent = active ? 'Active' : 'Ended';
  pill.className = 'status-pill ' + (active ? 'in' : 'out');
  document.getElementById('toggleActiveBtn').textContent = active ? 'End session' : 'Reopen session';
}

document.getElementById('toggleActiveBtn').addEventListener('click', async () => {
  if (!currentSessionId) return;
  const newActive = !currentSessionActive;
  try {
    await updateDoc(doc(db, 'sessions', currentSessionId), { active: newActive });
    currentSessionActive = newActive;
    updateSessionStatusUI(newActive);
    sfx.play(newActive ? 'pop' : 'warn');
    showToast(newActive ? 'Session reopened.' : 'Session ended — no new registrations will be accepted.', newActive ? '' : 'warn');
  } catch (err) {
    console.error(err);
    sfx.play('error');
    showToast('Could not update session status.', 'error');
  }
});

function resetToNewSessionForm() {
  document.getElementById('eventName').value = '';
  currentFields = defaultFields();
  renderFieldsEditor();
  editingSessionId = null;
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('createSessionBtn').textContent = 'Create Session & Get QR';
}

async function enterEditMode(id) {
  try {
    const snap = await getDoc(doc(db, 'sessions', id));
    if (!snap.exists()) {
      showToast('That session no longer exists.', 'error');
      return;
    }
    const data = snap.data();
    editingSessionId = id;
    document.getElementById('eventName').value = data.name;
    currentFields = (data.fields && data.fields.length) ? JSON.parse(JSON.stringify(data.fields)) : defaultFields();
    renderFieldsEditor();
    document.getElementById('createSessionBtn').textContent = 'Save Changes';
    document.getElementById('cancelEditBtn').style.display = 'inline-block';
    showToast(`Editing "${data.name}".`);
    document.getElementById('eventName').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    console.error(err);
    showToast('Could not load that session.', 'error');
  }
}
document.getElementById('cancelEditBtn').addEventListener('click', resetToNewSessionForm);

// ---------- create / save session ----------
document.getElementById('createSessionBtn').addEventListener('click', async () => {
  const name = document.getElementById('eventName').value.trim();
  if (!name) { showToast('Enter an event name first.', 'warn'); return; }
  if (currentFields.some(f => !f.label || !f.label.trim())) { showToast('Give every field a label.', 'warn'); return; }

  const fields = finalizeFieldIds(currentFields);
  const wasEditing = !!editingSessionId;
  const btn = document.getElementById('createSessionBtn');
  btn.disabled = true;
  btn.textContent = wasEditing ? 'Saving…' : 'Creating…';

  try {
    if (wasEditing) {
      const sessionId = editingSessionId;
      await updateDoc(doc(db, 'sessions', sessionId), { name, fields });
      showToast(`Session "${name}" updated.`);
      sfx.play('pop');
      displaySessionQR(sessionId, name, currentSessionId === sessionId ? currentSessionActive : true);
      resetToNewSessionForm();
    } else {
      const docRef = await addDoc(collection(db, 'sessions'), { name, createdAt: serverTimestamp(), active: true, fields });
      showToast(`Session "${name}" created.`);
      displaySessionQR(docRef.id, name, true);
      resetToNewSessionForm();
      sfx.play('big');
      confettiAt(document.getElementById('badgeContainer'), { count: 140, power: 10 });
    }
  } catch (err) {
    console.error(err);
    showToast('Could not save session — check your Firebase config.', 'error');
    sfx.play('error');
    btn.textContent = wasEditing ? 'Save Changes' : 'Create Session & Get QR';
  } finally {
    btn.disabled = false;
  }
});

let historyUnsub = null;
function renderHistory() {
  if (historyUnsub) historyUnsub();
  const container = document.getElementById('historyList');
  const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(50));
  historyUnsub = onSnapshot(q, (snap) => {
    const sessions = snap.docs
      .map(d => ({ id: d.id, data: d.data() }))
      .filter(x => x.data.archived !== true); // archived sessions are hidden — not deleted
    if (!sessions.length) {
      container.innerHTML = '<p class="small text-body-secondary mb-0">No sessions yet.</p>';
      return;
    }
    container.innerHTML = sessions.map(({ id, data }) => {
      const active = data.active !== false;
      const isOpen = currentSessionId === id;
      return `
      <div class="history-item ${isOpen ? 'open' : ''}" data-id="${id}">
        <span class="hname">${escapeHtml(data.name || 'Untitled session')} ${active ? '<span class="status-pill in" style="font-size:9px;padding:2px 8px;">Active</span>' : '<span class="status-pill out" style="font-size:9px;padding:2px 8px;">Closed</span>'}</span>
        <div class="hactions">
          <button data-action="toggle" data-id="${id}" class="${active ? 'close-btn' : 'open-btn'}" title="Open or close this session">${active ? 'Close' : 'Open'}</button>
          <button data-action="edit" data-id="${id}">Edit</button>
          <button data-action="archive" data-id="${id}" class="arch">Archive</button>
          <button data-action="delete" data-id="${id}" class="del">Delete</button>
        </div>
      </div>`;
    }).join('');

    // Clicking a row opens that session (shows its QR + live controls) —
    // no need to hit the QR button to "jump into" a session.
    container.querySelectorAll('.history-item').forEach(row => {
      row.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return; // let the buttons do their thing
        try {
          const s = await getDoc(doc(db, 'sessions', row.dataset.id));
          if (!s.exists()) { showToast('That session no longer exists.', 'error'); return; }
          displaySessionQR(row.dataset.id, s.data().name, s.data().active !== false);
        } catch (err) { console.error(err); showToast('Could not load that session.', 'error'); }
      });
    });

    container.querySelectorAll('[data-action="toggle"]').forEach(b => {
      b.addEventListener('click', async () => toggleSessionFromRow(b.dataset.id));
    });
    container.querySelectorAll('[data-action="edit"]').forEach(b => {
      b.addEventListener('click', () => enterEditMode(b.dataset.id));
    });
    container.querySelectorAll('[data-action="archive"]').forEach(b => {
      b.addEventListener('click', () => archiveSession(b.dataset.id));
    });
    container.querySelectorAll('[data-action="delete"]').forEach(b => {
      b.addEventListener('click', () => deleteSession(b.dataset.id));
    });
  }, (err) => {
    console.error(err);
    showToast('Could not load session history — retrying…', 'error');
    setTimeout(renderHistory, 3000);
  });
}

async function toggleSessionFromRow(id) {
  try {
    const s = await getDoc(doc(db, 'sessions', id));
    if (!s.exists()) { showToast('That session no longer exists.', 'error'); return; }
    const wasActive = s.data().active !== false;
    const newActive = !wasActive;
    await updateDoc(doc(db, 'sessions', id), { active: newActive });
    if (currentSessionId === id) {
      currentSessionActive = newActive;
      updateSessionStatusUI(newActive);
    }
    sfx.play(newActive ? 'pop' : 'warn');
    showToast(newActive ? 'Session opened — available to scanners now.' : 'Session closed — no new registrations or check-ins.', newActive ? '' : 'warn');
  } catch (err) {
    console.error(err);
    showToast('Could not toggle session.', 'error');
    sfx.play('error');
  }
}

async function archiveSession(id) {
  const ok = await confirmDialog('Hide this session from all lists?<br><small>It stays saved in Firestore (registrations are kept), just hidden from the scanner, session lists, and history.</small>', { okText: 'Archive', danger: true });
  if (!ok) return;
  try {
    await updateDoc(doc(db, 'sessions', id), { archived: true });
    sfx.play('warn');
    showToast('Session archived — hidden from all lists.', 'warn');
  } catch (err) {
    console.error(err);
    showToast('Could not archive session.', 'error');
    sfx.play('error');
  }
}

renderHistory();

async function deleteSession(id) {
  const ok = await confirmDialog('Delete this session and ALL of its attendance records?<br><small>This <b>cannot be undone</b>. If you only want it hidden, use Archive instead.</small>', { okText: 'Delete', danger: true });
  if (!ok) return;

  try {
    const regsSnap = await getDocs(collection(db, 'sessions', id, 'registrations'));
    const docs = regsSnap.docs;
    for (let i = 0; i < docs.length; i += 450) {
      const batch = writeBatch(db);
      docs.slice(i, i + 450).forEach(d => batch.delete(d.ref));
      await batch.commit();
    }
    await deleteDoc(doc(db, 'sessions', id));

    if (currentSessionId === id) {
      currentSessionId = null;
      document.getElementById('badgeEventName').textContent = 'Awaiting Setup';
      document.getElementById('qrcode').innerHTML = '';
      document.getElementById('sessionCreatedNote').style.display = 'none';
      document.getElementById('downloadBtn').disabled = true;
      document.getElementById('copyLinkBtn').disabled = true;
      const scannerBtn = document.getElementById('openScannerBtn');
      scannerBtn.style.pointerEvents = 'none'; scannerBtn.style.opacity = '.35';
    }
    if (editingSessionId === id) resetToNewSessionForm();
    showToast('Session deleted.', 'warn');
  } catch (err) {
    console.error(err);
    showToast('Could not delete — check your Firebase config/rules.', 'error');
  }
}

// ---------- live feed ----------
const picker = document.getElementById('sessionPicker');
let unsubscribeLive = null;
let liveFields = defaultFields();
let liveSessionName = '';
let latestRegistrations = [];

let sessionsUnsubscribeLive = null;
function loadSessionOptions() {
  if (sessionsUnsubscribeLive) sessionsUnsubscribeLive();
  const q = query(collection(db, 'sessions'), orderBy('createdAt', 'desc'), limit(50));
  sessionsUnsubscribeLive = onSnapshot(q, (snap) => {
    const current = picker.value;
    picker.innerHTML = '<option value="">— Select a session —</option>';
    snap.forEach(d => {
      const data = d.data();
      if (data.active === false) return;
      if (data.archived === true) return;
      const opt = document.createElement('option');
      opt.value = d.id;
      opt.textContent = data.name || 'Untitled session';
      picker.appendChild(opt);
    });
    if (current && picker.querySelector(`option[value="${current}"]`)) picker.value = current;
    else if (currentSessionId && picker.querySelector(`option[value="${currentSessionId}"]`)) picker.value = currentSessionId;
  }, (err) => {
    console.error(err);
    showToast('Could not load sessions — retrying…', 'error');
    setTimeout(loadSessionOptions, 3000);
  });
}
document.querySelector('[data-bs-target="#panel-live"]').addEventListener('shown.bs.tab', loadSessionOptions);
loadSessionOptions();

function resetLiveUI() {
  document.getElementById('responseTable').style.display = 'none';
  document.getElementById('emptyState').style.display = 'block';
  document.getElementById('tableNote').style.display = 'none';
  document.getElementById('registeredCount').textContent = '0';
  document.getElementById('checkedInCount').textContent = '0';
  document.getElementById('liveDot').classList.remove('live');
  document.getElementById('exportCsvBtn').disabled = true;
  latestRegistrations = [];
}

// Large-event hardening: render at most the newest MAX_RENDER_ROWS rows and
// throttle re-renders — counts and CSV export always include EVERYONE.
const MAX_RENDER_ROWS = 300;
let renderTimer = null;

function renderLiveTable() {
  renderTimer = null;
  const table = document.getElementById('responseTable');
  const empty = document.getElementById('emptyState');
  const body = document.getElementById('tableBody');
  const note = document.getElementById('tableNote');

  if (!latestRegistrations.length) {
    table.style.display = 'none'; empty.style.display = 'block';
    note.style.display = 'none';
    countUp(document.getElementById('registeredCount'), 0);
    countUp(document.getElementById('checkedInCount'), 0);
    return;
  }

  table.style.display = 'table'; empty.style.display = 'none';
  let checkedIn = 0;
  for (const r of latestRegistrations) if (r.checkedIn) checkedIn++;

  body.innerHTML = latestRegistrations.slice(0, MAX_RENDER_ROWS).map(r => {
    const time = r.checkedInAt ? r.checkedInAt.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    const cells = liveFields.map(f => `<td>${escapeHtml(r[f.id] ?? '')}</td>`).join('');
    return `<tr>${cells}<td>${r.checkedIn ? '<span class="status-pill in">Checked In</span>' : '<span class="status-pill out">Not Yet</span>'}</td><td>${time}</td></tr>`;
  }).join('');

  if (latestRegistrations.length > MAX_RENDER_ROWS) {
    note.textContent = `Showing the newest ${MAX_RENDER_ROWS} of ${latestRegistrations.length.toLocaleString()} registrations — totals and CSV export include everyone.`;
    note.style.display = 'block';
  } else {
    note.style.display = 'none';
  }

  countUp(document.getElementById('registeredCount'), latestRegistrations.length);
  countUp(document.getElementById('checkedInCount'), checkedIn);
  document.getElementById('liveDot').classList.add('live');
}

picker.addEventListener('change', async () => {
  if (unsubscribeLive) unsubscribeLive();
  if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
  const sessionId = picker.value;
  if (!sessionId) { resetLiveUI(); return; }

  liveSessionName = picker.options[picker.selectedIndex].text;
  liveFields = defaultFields();
  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId));
    if (snap.exists() && snap.data().fields && snap.data().fields.length) liveFields = snap.data().fields;
  } catch (err) { console.error(err); }

  document.getElementById('tableHead').innerHTML =
    liveFields.map(f => `<th>${escapeHtml(f.label)}</th>`).join('') + '<th>Status</th><th>Checked In</th>';

  const q = query(collection(db, 'sessions', sessionId, 'registrations'), orderBy('registeredAt', 'desc'));
  unsubscribeLive = onSnapshot(q, (snap) => {
    latestRegistrations = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    document.getElementById('exportCsvBtn').disabled = latestRegistrations.length === 0;
    // During mass registration/check-in bursts Firestore fires many snapshots
    // per second — render at most 4x/second to keep the UI smooth.
    if (!renderTimer) renderTimer = setTimeout(renderLiveTable, 250);
  }, (err) => {
    console.error(err);
    sfx.play('error');
    showToast('Live feed lost connection — check your Firestore rules.', 'error');
  });
});

document.getElementById('exportCsvBtn').addEventListener('click', () => {
  if (!latestRegistrations.length) { showToast('No data to export yet.', 'warn'); return; }
  const headers = [...liveFields.map(f => f.label), 'Status', 'Registered At', 'Checked-In At'];
  const rows = latestRegistrations.map(r => [
    ...liveFields.map(f => r[f.id] ?? ''),
    r.checkedIn ? 'Checked In' : 'Not Yet',
    r.registeredAt ? r.registeredAt.toDate().toLocaleString() : '',
    r.checkedInAt ? r.checkedInAt.toDate().toLocaleString() : ''
  ]);
  const csvEscape = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(liveSessionName || 'attendance').replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  sfx.play('pop');
  showToast('CSV downloaded.');
});
