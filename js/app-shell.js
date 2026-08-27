/* =====================================================================
   CON ATTENDANCE — APP SHELL + PRO FX LAYER
   Shared by every page. Provides:

   • Service-worker registration  → makes the site an installable app
   • "Install App" floating button with native prompt handling
   • Offline / back-online banner
   • Web-Audio sound engine (sfx) — zero audio files needed
   • Canvas confetti bursts (confettiBurst / confettiBurstAtElement)
   • Ambient particle field behind the content
   • countUp() number animation for live stats
   • buzz() haptic feedback helper
   • confirmDialog() custom confirm modal (works in iOS standalone PWA)
   • Build badge (bottom corner) — verifies which build a device runs

   Usage in page modules:
     import { sfx, confettiBurstAtElement, countUp, buzz, confirmDialog } from './app-shell.js';
   ===================================================================== */

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const IS_STANDALONE = window.matchMedia('(display-mode: standalone)').matches ||
                      window.navigator.standalone === true;

/* ---------------------------------------------------------------------
   Service worker — registers silently; no-ops on http:// or file://
   Auto-reloads the page once whenever a newly deployed build takes over,
   so the installed app instantly reflects whatever changed on the web.
--------------------------------------------------------------------- */
if ('serviceWorker' in navigator &&
    (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  window.addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('./sw.js');
      // When a new service worker (new build) is found:
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'activated' && navigator.serviceWorker.controller) {
            window.location.reload();
          }
        });
      });
    } catch (err) {
      console.warn('[app] service worker not registered:', err);
    }
  });
}

/* ---------------------------------------------------------------------
   Sound engine — tiny synthesized cues via WebAudio (no assets)
--------------------------------------------------------------------- */
export const sfx = {
  _ctx: null,
  enabled: localStorage.getItem('con_sfx') !== 'off',

  _ensure() {
    if (!this.enabled) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this._ctx) this._ctx = new AC();
    if (this._ctx.state === 'suspended') this._ctx.resume();
    return this._ctx;
  },

  _note(freq, delay, duration, { type = 'sine', vol = 0.15 } = {}) {
    const ctx = this._ctx;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const t = ctx.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  },

  play(name) {
    if (!this._ensure()) return;
    switch (name) {
      case 'success':                                   // bright two-note chime
        this._note(659.25, 0, 0.14);
        this._note(987.77, 0.09, 0.22);
        break;
      case 'big':                                       // rising fanfare arpeggio
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this._note(f, i * 0.07, 0.26));
        break;
      case 'warn':                                      // double mid blip
        this._note(440, 0, 0.12, { type: 'triangle' });
        this._note(440, 0.16, 0.12, { type: 'triangle' });
        break;
      case 'error':                                     // low descending buzz
        this._note(196, 0, 0.22, { type: 'sawtooth', vol: 0.11 });
        this._note(147, 0.12, 0.3, { type: 'sawtooth', vol: 0.11 });
        break;
      case 'pop':                                       // short sparkle
        this._note(1318.5, 0, 0.09, { type: 'triangle', vol: 0.11 });
        break;
      case 'tick':                                      // micro click
        this._note(2093, 0, 0.04, { type: 'square', vol: 0.04 });
        break;
    }
  }
};

// Browsers block audio until a user gesture — warm the context up early.
['pointerdown', 'keydown'].forEach(evt =>
  document.addEventListener(evt, () => sfx._ensure(), { once: true, capture: true }));

/* ---------------------------------------------------------------------
   Haptics (Android/Chrome; silently ignored elsewhere)
--------------------------------------------------------------------- */
export function buzz(pattern) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch { /* noop */ }
}

/* ---------------------------------------------------------------------
   Confetti — canvas overlay, brand colors, physics-based bursts
--------------------------------------------------------------------- */
let confettiCanvas = null, confettiCtx = null, confettiParts = [], confettiRAF = null;
const CONFETTI_COLORS = ['#D4A73D', '#E9C468', '#2FE6B0', '#F6F2E7', '#1B6E4C', '#C1502E'];

function ensureConfettiCanvas() {
  if (confettiCanvas) return;
  confettiCanvas = document.createElement('canvas');
  confettiCanvas.id = 'fx-confetti';
  document.body.appendChild(confettiCanvas);
  confettiCtx = confettiCanvas.getContext('2d');
  const fit = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    confettiCanvas.width = innerWidth * dpr;
    confettiCanvas.height = innerHeight * dpr;
    confettiCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  fit();
  addEventListener('resize', fit);
}

export function confettiBurst(origin = {}, opts = {}) {
  if (REDUCED_MOTION) return;
  ensureConfettiCanvas();
  const { x = innerWidth / 2, y = innerHeight * 0.42 } = origin;
  const count = opts.count ?? 90;
  const power = opts.power ?? 9;

  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = power * (0.35 + Math.random());
    confettiParts.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - power * 0.55,
      w: 5 + Math.random() * 6,
      h: 8 + Math.random() * 8,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.32,
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 1,
      decay: 0.008 + Math.random() * 0.012
    });
  }
  if (!confettiRAF) confettiLoop();
}

export function confettiBurstAtElement(el, opts = {}) {
  if (!el) return confettiBurst({}, opts);
  const r = el.getBoundingClientRect();
  return confettiBurst({ x: r.left + r.width / 2, y: r.top + r.height / 2 }, opts);
}

function confettiLoop() {
  confettiRAF = requestAnimationFrame(() => {
    confettiCtx.clearRect(0, 0, innerWidth, innerHeight);
    confettiParts = confettiParts.filter(p => p.life > 0 && p.y < innerHeight + 40);
    for (const p of confettiParts) {
      p.vy += 0.22;
      p.vx *= 0.992;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.life -= p.decay;
      confettiCtx.save();
      confettiCtx.globalAlpha = Math.max(p.life, 0);
      confettiCtx.translate(p.x, p.y);
      confettiCtx.rotate(p.rot);
      confettiCtx.fillStyle = p.color;
      confettiCtx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      confettiCtx.restore();
    }
    if (confettiParts.length) {
      confettiLoop();
    } else {
      cancelAnimationFrame(confettiRAF);
      confettiRAF = null;
      confettiCtx.clearRect(0, 0, innerWidth, innerHeight);
    }
  });
}

/* ---------------------------------------------------------------------
   Ambient particle field — faint drifting specks behind the content
--------------------------------------------------------------------- */
(function initParticles() {
  if (REDUCED_MOTION) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'fx-particles';
  document.body.prepend(canvas);
  const ctx = canvas.getContext('2d');
  let W, H, parts = [], raf = null;
  const COLORS = ['212,167,61', '233,196,104', '47,230,176', '246,242,231'];
  const COUNT = () => Math.min(70, Math.max(30, Math.floor(innerWidth / 16)));

  function fit() {
    W = canvas.width = innerWidth;
    H = canvas.height = innerHeight;
  }
  function seed() {
    parts = Array.from({ length: COUNT() }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      r: 0.8 + Math.random() * 2.1,
      vy: -(0.06 + Math.random() * 0.3),
      vx: (Math.random() - 0.5) * 0.1,
      a: 0.05 + Math.random() * 0.18,
      tw: Math.random() * Math.PI * 2,
      c: COLORS[(Math.random() * COLORS.length) | 0]
    }));
  }
  function loop() {
    raf = requestAnimationFrame(loop);
    ctx.clearRect(0, 0, W, H);
    for (const p of parts) {
      p.y += p.vy;
      p.x += p.vx;
      p.tw += 0.02;
      if (p.y < -12) { p.y = H + 12; p.x = Math.random() * W; }
      const alpha = p.a * (0.6 + 0.4 * Math.sin(p.tw));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${p.c},${alpha.toFixed(3)})`;
      ctx.fill();
    }
  }
  function start() { if (raf === null) loop(); }
  function stop() { if (raf !== null) { cancelAnimationFrame(raf); raf = null; } }

  fit(); seed(); start();
  addEventListener('resize', () => { fit(); seed(); });
  document.addEventListener('visibilitychange', () => document.hidden ? stop() : start());
})();

/* ---------------------------------------------------------------------
   Install App button
   • Android/desktop: uses the native beforeinstallprompt flow
   • iPhone/iPad: Apple never fires install prompts — the only way is the
     manual Share → "Add to Home Screen" flow, so we detect iOS and show
     step-by-step instructions instead.
--------------------------------------------------------------------- */
let deferredPrompt = null;
const DISMISS_KEY = 'con_install_dismissed';
const IS_IOS = /iP(hone|ad|od)/i.test(navigator.userAgent) ||
               (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function buildInstallButton() {
  let btn = document.getElementById('pwaInstallBtn');
  if (btn) return btn;
  btn = document.createElement('button');
  btn.id = 'pwaInstallBtn';
  btn.className = 'pwa-install-btn';
  btn.type = 'button';
  btn.innerHTML = `<span class="ico">&#8681;</span><span class="label">Install App</span><span class="kill" role="button" aria-label="Dismiss" title="Dismiss">&times;</span>`;
  btn.addEventListener('click', async (e) => {
    if (e.target.classList.contains('kill')) {
      localStorage.setItem(DISMISS_KEY, '1');
      hideInstallButton();
      return;
    }
    if (IS_IOS || !deferredPrompt) {
      showInstallHelp();
      return;
    }
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (outcome === 'accepted') {
      localStorage.setItem('con_installed', '1');
      sfx.play('big');
      confettiBurst({ x: innerWidth - 110, y: innerHeight - 70 }, { count: 150, power: 11 });
    }
    deferredPrompt = null;
    hideInstallButton();
  });
  document.body.appendChild(btn);
  return btn;
}

function hideInstallButton() {
  document.getElementById('pwaInstallBtn')?.classList.remove('show');
}

function maybeShowInstallButton() {
  if (IS_STANDALONE) return;
  if (localStorage.getItem(DISMISS_KEY) === '1' || localStorage.getItem('con_installed') === '1') return;
  const btn = buildInstallButton();
  if (IS_IOS) {
    btn.querySelector('.label').textContent = 'Add to Home Screen';
    btn.classList.add('ios');
  }
  btn.classList.add('show');
}

function showInstallHelp() {
  if (document.getElementById('installHelpSheet')) return;

  const iosSteps = `
    <ol class="ih-steps">
      <li><span class="step-num">1</span><div>Open this page in <b>Safari</b>, then tap the <b>Share</b> button <span class="ios-glyph">&#8593;</span> (bottom of the screen on iPhone, top on iPad).</div></li>
      <li><span class="step-num">2</span><div>Scroll down the share menu and tap <b>Add to Home Screen</b>.</div></li>
      <li><span class="step-num">3</span><div>Tap <b>Add</b> — launch CON Attendance from your home screen for full-screen app mode.</div></li>
    </ol>
    <p class="ih-note">Apple doesn't allow automatic install prompts on iPhone/iPad — this one-time manual step is how every web app is installed on iOS.</p>`;

  const otherSteps = `
    <ol class="ih-steps">
      <li><span class="step-num">1</span><div><b>Android</b>: tap the <b>&#8942;</b> menu &rarr; <b>Install app</b> (or <i>Add to Home screen</i>).</div></li>
      <li><span class="step-num">2</span><div><b>PC (Chrome/Edge)</b>: click the install icon in the address bar, or menu &rarr; <b>Install app</b>.</div></li>
      <li><span class="step-num">3</span><div>Open CON Attendance from your home screen or desktop like any other app.</div></li>
    </ol>
    <p class="ih-note">The one-tap install prompt appears automatically when your browser is ready — this guide works any time.</p>`;

  const sheet = document.createElement('div');
  sheet.id = 'installHelpSheet';
  sheet.innerHTML = `
    <div class="ih-card">
      <button class="ih-close" aria-label="Close">&times;</button>
      <div class="ih-badge">&#8681;</div>
      <h3>${IS_IOS ? 'Install on iPhone / iPad' : 'Install the app'}</h3>
      ${IS_IOS ? iosSteps : otherSteps}
    </div>`;
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet || e.target.classList.contains('ih-close')) sheet.remove();
  });
  document.body.appendChild(sheet);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  if (IS_STANDALONE) return;
  if (localStorage.getItem(DISMISS_KEY) === '1' || localStorage.getItem('con_installed') === '1') return;
  buildInstallButton().classList.add('show');
});
maybeShowInstallButton();

window.addEventListener('appinstalled', () => {
  localStorage.setItem('con_installed', '1');
  hideInstallButton();
});

/* ---------------------------------------------------------------------
   Connectivity banner — offline notice / back-online flash
--------------------------------------------------------------------- */
const netBanner = document.createElement('div');
netBanner.id = 'netBanner';
netBanner.hidden = true;
document.body.appendChild(netBanner);

let onlineTimer = null;
function updateNetBanner() {
  clearTimeout(onlineTimer);
  if (!navigator.onLine) {
    netBanner.className = 'offline';
    netBanner.textContent = '\u26A1 You are offline \u2014 using saved app data';
    netBanner.hidden = false;
  } else {
    netBanner.className = 'online-flash';
    netBanner.textContent = '\u2713 Back online';
    netBanner.hidden = false;
    onlineTimer = setTimeout(() => { netBanner.hidden = true; }, 2400);
  }
}
window.addEventListener('offline', updateNetBanner);
window.addEventListener('online', updateNetBanner);
if (!navigator.onLine) updateNetBanner();

/* ---------------------------------------------------------------------
   countUp — smooth eased number transitions for live stats
--------------------------------------------------------------------- */
const countTimers = new WeakMap();
export function countUp(el, target, duration = 600) {
  if (!el) return;
  const from = parseInt(String(el.textContent).replace(/\D/g, ''), 10) || 0;
  const to = Number(target) || 0;
  if (from === to) { el.textContent = String(to); return; }
  cancelAnimationFrame(countTimers.get(el));
  if (REDUCED_MOTION) { el.textContent = String(to); return; }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (t < 1) countTimers.set(el, requestAnimationFrame(step));
  };
  countTimers.set(el, requestAnimationFrame(step));
}

/* ---------------------------------------------------------------------
   Build badge — tiny version marker fixed to the bottom corner.
   Shows the build AND the Firebase project the app talks to, so you can
   instantly verify a device is current and on the right database.
--------------------------------------------------------------------- */
const APP_BUILD = 'v2.0.2';
(function buildBadge() {
  try {
    const badge = document.createElement('div');
    badge.id = 'buildBadge';
    badge.textContent = 'build ' + APP_BUILD + ' · spcf-con-attendance';
    document.body.appendChild(badge);
  } catch { /* noop */ }
})();

/* ---------------------------------------------------------------------
   confirmDialog — Promise-based custom confirm modal.
   Native confirm()/alert() are silently blocked in iOS standalone PWAs,
   which is why buttons like "Archive" appeared to do nothing there.
--------------------------------------------------------------------- */
export function confirmDialog(message, { okText = 'Confirm', danger = false } = {}) {
  return new Promise((resolve) => {
    if (document.getElementById('confirmDialog')) return resolve(false);
    const overlay = document.createElement('div');
    overlay.id = 'confirmDialog';
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-card">
        <p class="confirm-msg">${message}</p>
        <div class="confirm-actions">
          <button type="button" class="btn btn-gold confirm-cancel">Cancel</button>
          <button type="button" class="btn ${danger ? 'btn-confirm-danger' : 'btn-primary'} confirm-ok">${okText}</button>
        </div>
      </div>`;
    const close = (val) => { overlay.remove(); resolve(val); };
    overlay.querySelector('.confirm-cancel').addEventListener('click', () => close(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
    document.body.appendChild(overlay);
    const firstBtn = overlay.querySelector('.confirm-cancel');
    if (firstBtn) firstBtn.focus();
  });
}