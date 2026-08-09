import { db } from "./firebase-config.js";
import {
  doc, getDoc, collection, addDoc, query, where, getDocs, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

const loadingState = document.getElementById('loadingState');
const invalidState = document.getElementById('invalidState');
const formState = document.getElementById('formState');
const qrState = document.getElementById('qrState');

let sessionName = '';

async function init() {
  if (!sessionId) return showInvalid();

  try {
    const snap = await getDoc(doc(db, 'sessions', sessionId));
    if (!snap.exists()) return showInvalid();

    const data = snap.data();
    sessionName = data.name;

    if (data.active === false) {
      return showInvalid('Registration Closed', 'This session is no longer accepting new registrations. If you already registered, use the QR you were given earlier.');
    }

    document.getElementById('sessionNameDisplay').textContent = sessionName;
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

// ---------- form submit ----------
document.getElementById('regForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const nameEl = document.getElementById('fullName');
  const sectionEl = document.getElementById('section');
  const idEl = document.getElementById('studentId');

  let valid = true;
  [nameEl, sectionEl, idEl].forEach(el => {
    if (!el.value.trim()) { el.classList.add('is-invalid'); valid = false; }
    else el.classList.remove('is-invalid');
  });
  if (!valid) return;

  const name = nameEl.value.trim();
  const section = sectionEl.value.trim();
  const studentId = idEl.value.trim();

  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = 'Submitting…';

  try {
    const regCollection = collection(db, 'sessions', sessionId, 'registrations');

    // Idempotent: if this student ID already registered for this session,
    // reuse their existing record instead of creating a duplicate.
    const dupQuery = query(regCollection, where('studentId', '==', studentId), limit(1));
    const dupSnap = await getDocs(dupQuery);

    let registrationId;
    if (!dupSnap.empty) {
      registrationId = dupSnap.docs[0].id;
    } else {
      const docRef = await addDoc(regCollection, {
        name, section, studentId,
        registeredAt: serverTimestamp(),
        checkedIn: false,
        checkedInAt: null
      });
      registrationId = docRef.id;
    }

    showQr(registrationId, name);
  } catch (err) {
    console.error(err);
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
    text: payload, width: 230, height: 230,
    colorDark: '#0B3D2E', colorLight: '#ffffff', correctLevel: QRCode.CorrectLevel.H
  });
  qrDiv.classList.add('pop');

  document.getElementById('downloadQrBtn').onclick = () => {
    const canvas = qrDiv.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `${name.replace(/\s+/g, '_')}_attendance_qr.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };
}

init();
