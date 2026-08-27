import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, addDoc, query, where, getDocs, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { sfx, confettiBurstAtElement as confettiAt, buzz } from "./app-shell.js";

const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

const loadingState = document.getElementById('loadingState');
const invalidState = document.getElementById('invalidState');
const formState = document.getElementById('formState');
const qrState = document.getElementById('qrState');

let sessionName = '';
let sessionFields = [];

function defaultFields() {
  return [
    { id: 'name', label: 'Full Name', required: true },
    { id: 'section', label: 'Section', required: true },
    { id: 'studentId', label: 'Student ID', required: true }
  ];
}

async function init() {
  if (!sessionId) return showInvalid();

  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId));
    if (!snap.exists()) return showInvalid();

    const data = snap.data();
    sessionName = data.name;
    sessionFields = (data.fields && data.fields.length) ? data.fields : defaultFields();

    if (data.active === false || data.archived === true) {
      return showInvalid('Registration Closed', 'This session is no longer accepting new registrations. If you already registered, use the QR you were given earlier.');
    }

    document.getElementById('sessionNameDisplay').textContent = sessionName;
    renderFields();
    loadingState.style.display = 'none';
    formState.style.display = 'block';
  } catch (err) {
    console.error(err);
    showInvalid('Connection Problem', 'Could not reach the attendance system. Check your internet connection and reload.');
  }
}

function showInvalid(title = 'Link Not Valid', message = 'This registration link is missing, incorrect, or the session has closed. Ask your instructor for the current QR code.') {
  loadingState.style.display = 'none';
  invalidState.querySelector('h2').textContent = title;
  invalidState.querySelector('.desc').textContent = message;
  invalidState.style.display = 'block';
}

function renderFields() {
  const container = document.getElementById('dynamicFields');
  container.innerHTML = sessionFields.map(f => `
    <div class="mb-3">
      <label class="form-label">${escapeHtml(f.label)}</label>
      <input type="text" class="form-control" data-field-id="${escapeAttr(f.id)}" ${f.required ? 'required' : ''}>
      <div class="invalid-feedback">${escapeHtml(f.label)} is required.</div>
    </div>
  `).join('');
}
function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(str = '') { return escapeHtml(str).replace(/`/g, '&#96;'); }

// ---------- form submit ----------
document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const inputs = [...document.querySelectorAll('#dynamicFields [data-field-id]')];

  let valid = true;
  const values = {};
  inputs.forEach(el => {
    const val = el.value.trim();
    values[el.dataset.fieldId] = val;
    const required = el.hasAttribute('required');
    if (required && !val) { el.classList.add('is-invalid'); valid = false; }
    else el.classList.remove('is-invalid');
  });
  if (!valid) return;

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    const regCollection = collection(db, 'sessions', sessionId, 'registrations');
    let registrationId = null;

    // Idempotent: if a "studentId" field exists and this ID already registered,
    // reuse the existing record instead of creating a duplicate.
    if (values.studentId) {
      const dupQuery = query(regCollection, where('studentId', '==', values.studentId), limit(1));
      const dupSnap = await getDocs(dupQuery);
      if (!dupSnap.empty) registrationId = dupSnap.docs[0].id;
    }

    if (!registrationId) {
      const docRef = await addDoc(regCollection, {
        ...values,
        registeredAt: serverTimestamp(),
        checkedIn: false,
        checkedInAt: null
      });
      registrationId = docRef.id;
    }

    const displayName = values.name || values[sessionFields[0]?.id] || Object.values(values)[0] || 'Registered';
    showQr(registrationId, displayName);
  } catch (err) {
    console.error(err);
    sfx.play('error');
    alert('Something went wrong submitting your registration. Please try again.');
  } finally {
    btn.disabled = false; btn.textContent = 'Get My QR Code';
  }
});

function showQr(registrationId, name) {
  formState.style.display = 'none';
  qrState.style.display = 'block';

  document.getElementById('qrSessionName').textContent = sessionName;
  document.getElementById('qrStudentName').textContent = name;

  const qrDiv = document.getElementById('qrcode');
  qrDiv.innerHTML = '';
  const payload = `${sessionId}|${registrationId}`;
  new QRCode(qrDiv, {
    text: payload, width: 260, height: 260,
    colorDark: '#000000', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
  });
  qrDiv.classList.add('pop');

  // celebration: fanfare + haptic tick + confetti over the fresh badge
  sfx.play('big');
  buzz([30, 50, 30]);
  confettiAt(document.querySelector('#qrState .badge-box'), { count: 170, power: 11 });

  document.getElementById('downloadQrBtn').onclick = () => {
    const canvas = qrDiv.querySelector('canvas');
    if (!canvas) return;
    // High-res PNG with a solid white quiet-zone margin — reliably scannable
    // by any document scanner regardless of the phone's dark-mode setting.
    const size = 600, pad = 48;
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(canvas, pad, pad, size - pad * 2, size - pad * 2);
    const a = document.createElement('a');
    a.download = `${name.replace(/\s+/g, '_')}_attendance_qr.png`;
    a.href = c.toDataURL('image/png');
    a.click();
    sfx.play('pop');
  };
}

// ---------- badge tilt effect ----------
document.addEventListener('mousemove', (e) => {
  const badge = document.querySelector('.badge-box');
  if (!badge) return;
  const rect = badge.getBoundingClientRect();
  const x = (e.clientX - (rect.left + rect.width / 2)) / 18;
  const y = (e.clientY - (rect.top + rect.height / 2)) / 18;
  badge.style.transform = `perspective(1000px) rotateY(${x}deg) rotateX(${-y}deg)`;
});

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

init();
