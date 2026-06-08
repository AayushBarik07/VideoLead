/* ============================================================
   VideoLead — script.js
   YouTube Iframe API + Lead Capture + Theme + Scroll Reveal
   ============================================================ */

'use strict';

/* ── CONFIG ─────────────────────────────────────────────────── */
const TRIGGER_SECONDS = 6;             // Seconds of watch time before popup
const VIDEO_ID        = 'RJTCAL1DRro'; // Default YouTube video ID
const LS_REGISTERED   = 'vl_registered'; // localStorage key prefix
const LS_THEME        = 'vl_theme';      // localStorage key — theme

/* ── STATE ──────────────────────────────────────────────────── */
let player         = null;       // YouTube player instance
let watchSeconds   = 0;          // Accumulated genuine watch seconds
let watchInterval  = null;       // Interval for counting watch time
let triggered      = false;      // Has the popup fired for this load?
let isRegistered   = false;      // Is user registered for the CURRENT video?
let currentVideoId = VIDEO_ID;   // ID of the video currently loaded
let ytApiReady     = false;      // Has onYouTubeIframeAPIReady fired?

/* ── DOM REFS ───────────────────────────────────────────────── */
const modalOverlay   = document.getElementById('modalOverlay');
const formView       = document.getElementById('formView');
const successView    = document.getElementById('successView');
const leadForm       = document.getElementById('leadForm');
const closeFormBtn   = document.getElementById('closeFormBtn');
const returnBtn      = document.getElementById('returnToVideoBtn');
const timerFill      = document.getElementById('timerFill');
const timerLabel     = document.getElementById('timerLabel');
const themeToggle    = document.getElementById('themeToggle');
const themeToggleMob = document.getElementById('themeToggleMobile');
const navbar         = document.getElementById('navbar');
const menuBtn        = document.getElementById('menuBtn');
const mobileMenu     = document.getElementById('mobileMenu');
const playerContainer = document.getElementById('player-container');

// Custom video panel
const customVideoUrl = document.getElementById('customVideoUrl');
const cvpLoadBtn     = document.getElementById('cvpLoadBtn');
const cvpClearBtn    = document.getElementById('cvpClearBtn');
const cvpFeedback    = document.getElementById('cvpFeedback');

/* ============================================================
   YOUTUBE IFRAME API
   ============================================================ */

/**
 * Destroy existing player (if any) and create a fresh one.
 */
function createPlayer(videoId) {
  // 1. Stop any running watch timer
  stopWatchTimer();

  // 2. Destroy old player cleanly
  if (player && typeof player.destroy === 'function') {
    try { player.destroy(); } catch (_) {}
    player = null;
  }

  // 3. Recreate a fresh target div — the YT API replaces it with an iframe
  playerContainer.innerHTML = '<div id="player"></div>';

  // 4. Build the new player
  //    NOTE: 'origin' is intentionally omitted — it causes black screens
  //    when the page is served from file:// or certain local/dev servers.
  player = new YT.Player('player', {
    videoId: videoId,
    playerVars: {
      rel:            0,
      modestbranding: 1,
      playsinline:    1,
      enablejsapi:    1,
      autoplay:       0,   // Render visible immediately; user presses play
    },
    events: {
      onReady:       onPlayerReady,
      onStateChange: onPlayerStateChange,
      onError:       onPlayerError,
    },
  });
}

/**
 * Called by the YouTube Iframe API once the script has fully loaded.
 * Must be a global function on window.
 *
 * FIX: We also check whether YT is already available when script.js
 * first executes (handles the race where the API loads before this file).
 */
window.onYouTubeIframeAPIReady = function () {
  ytApiReady = true;
  currentVideoId = VIDEO_ID;
  syncRegistrationState();
  createPlayer(VIDEO_ID);
};

// ── Race-condition safety: if the YT API loaded before this script ran,
//    onYouTubeIframeAPIReady will never fire again. Kick it off manually.
(function checkYTAlreadyReady() {
  if (typeof YT !== 'undefined' && YT.Player) {
    // API already loaded — fire our init directly
    window.onYouTubeIframeAPIReady();
  }
  // Otherwise the API will call onYouTubeIframeAPIReady when it's ready
})();

function onPlayerReady() {
  // Player rendered and ready — nothing extra needed
}

function onPlayerStateChange(event) {
  const state = event.data;

  if (state === YT.PlayerState.PLAYING) {
    if (!isRegistered && !triggered) {
      startWatchTimer();
    }
  } else {
    stopWatchTimer();
  }
}

function onPlayerError(event) {
  // Silently handle errors (e.g. video removed / embedding disabled)
  console.warn('YouTube player error code:', event.data);
}

/* ── WATCH TIMER ────────────────────────────────────────────── */

function startWatchTimer() {
  if (watchInterval) return;
  watchInterval = setInterval(() => {
    watchSeconds++;
    updateTimerUI();

    if (watchSeconds >= TRIGGER_SECONDS) {
      stopWatchTimer();
      triggerPopup();
    }
  }, 1000);
}

function stopWatchTimer() {
  clearInterval(watchInterval);
  watchInterval = null;
}

function resetWatchTimer() {
  stopWatchTimer();
  watchSeconds = 0;
  triggered    = false;
  updateTimerUI();
}

function updateTimerUI() {
  const pct = Math.min((watchSeconds / TRIGGER_SECONDS) * 100, 100);
  timerFill.style.width      = pct + '%';
  timerFill.style.background = '';
  timerLabel.textContent     = `Watch time: ${watchSeconds}s / ${TRIGGER_SECONDS}s`;
}

/* ── POPUP TRIGGER ──────────────────────────────────────────── */

function triggerPopup() {
  triggered = true;

  if (player && player.pauseVideo) {
    player.pauseVideo();
  }

  formView.classList.remove('hidden');
  successView.classList.add('hidden');

  leadForm.reset();
  clearErrors();

  openModal();
}

function openModal() {
  modalOverlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const firstInput = leadForm.querySelector('input');
    if (firstInput) firstInput.focus();
  }, 350);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  document.body.style.overflow = '';
}

/* ── FORM VALIDATION ────────────────────────────────────────── */

function clearErrors() {
  document.getElementById('nameError').textContent   = '';
  document.getElementById('emailError').textContent  = '';
  document.getElementById('mobileError').textContent = '';
  document.getElementById('fullName').classList.remove('error-input');
  document.getElementById('email').classList.remove('error-input');
  document.getElementById('mobile').classList.remove('error-input');
}

function validateForm() {
  clearErrors();
  let valid = true;

  const name   = document.getElementById('fullName');
  const email  = document.getElementById('email');
  const mobile = document.getElementById('mobile');

  if (!name.value.trim()) {
    showError('nameError', name, 'Full name is required.');
    valid = false;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email.value.trim()) {
    showError('emailError', email, 'Email address is required.');
    valid = false;
  } else if (!emailRegex.test(email.value.trim())) {
    showError('emailError', email, 'Please enter a valid email address.');
    valid = false;
  }

  const mobileDigits = mobile.value.replace(/\D/g, '');
  if (!mobile.value.trim()) {
    showError('mobileError', mobile, 'Mobile number is required.');
    valid = false;
  } else if (mobileDigits.length !== 10) {
    showError('mobileError', mobile, 'Mobile number must be exactly 10 digits.');
    valid = false;
  }

  return valid;
}

function showError(errorId, inputEl, message) {
  document.getElementById(errorId).textContent = message;
  inputEl.classList.add('error-input');
}

/* ── FORM SUBMISSION ────────────────────────────────────────── */

leadForm.addEventListener('submit', function (e) {
  e.preventDefault();
  if (!validateForm()) return;

  markRegistered(currentVideoId);
  isRegistered = true;

  formView.classList.add('hidden');
  successView.classList.remove('hidden');
});

/* ── CLOSE FORM (without registering) ──────────────────────── */

closeFormBtn.addEventListener('click', function () {
  closeModal();

  if (player && player.seekTo) {
    player.seekTo(0, true);
    setTimeout(() => { if (player && player.pauseVideo) player.pauseVideo(); }, 100);
  }

  resetWatchTimer();
});

/* ── RETURN TO VIDEO (after success) ───────────────────────── */

returnBtn.addEventListener('click', function () {
  closeModal();
  if (player && player.playVideo) {
    player.playVideo();
  }
});

/* ── INPUT CLEANUP: only digits for mobile ──────────────────── */
document.getElementById('mobile').addEventListener('input', function () {
  this.value = this.value.replace(/\D/g, '').slice(0, 10);
});

/* ── CLEAR ERROR ON INPUT ───────────────────────────────────── */
['fullName', 'email', 'mobile'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', function () {
    this.classList.remove('error-input');
    const errorMap = { fullName: 'nameError', email: 'emailError', mobile: 'mobileError' };
    document.getElementById(errorMap[id]).textContent = '';
  });
});

/* ============================================================
   THEME SWITCHING
   ============================================================ */

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(LS_THEME, theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

themeToggle.addEventListener('click', toggleTheme);
themeToggleMob.addEventListener('click', toggleTheme);

(function initTheme() {
  const saved = localStorage.getItem(LS_THEME) || 'light';
  applyTheme(saved);
})();

/* ============================================================
   NAVBAR — SCROLL + MOBILE MENU
   ============================================================ */

window.addEventListener('scroll', function () {
  navbar.classList.toggle('scrolled', window.scrollY > 20);
}, { passive: true });

menuBtn.addEventListener('click', function () {
  mobileMenu.classList.toggle('open');
});

mobileMenu.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => mobileMenu.classList.remove('open'));
});

/* ============================================================
   SCROLL REVEAL — INTERSECTION OBSERVER
   ============================================================ */

(function initScrollReveal() {
  const elements = document.querySelectorAll('.reveal');
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const siblings = entry.target.parentElement.querySelectorAll('.reveal:not(.visible)');
          let delay = 0;
          siblings.forEach((el, idx) => { if (el === entry.target) delay = idx * 80; });
          setTimeout(() => entry.target.classList.add('visible'), delay);
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );
  elements.forEach(el => observer.observe(el));
})();

/* ============================================================
   FAQ ACCORDION
   ============================================================ */

document.querySelectorAll('.faq-question').forEach(btn => {
  btn.addEventListener('click', function () {
    const item   = this.closest('.faq-item');
    const isOpen = item.classList.contains('open');

    document.querySelectorAll('.faq-item').forEach(i => {
      i.classList.remove('open');
      i.querySelector('.faq-question').setAttribute('aria-expanded', 'false');
    });

    if (!isOpen) {
      item.classList.add('open');
      this.setAttribute('aria-expanded', 'true');
    }
  });
});

/* ============================================================
   PER-VIDEO REGISTRATION HELPERS
   ============================================================ */

function regKey(videoId)          { return LS_REGISTERED + '_' + videoId; }
function checkRegistered(videoId) { return localStorage.getItem(regKey(videoId)) === 'true'; }
function markRegistered(videoId)  { localStorage.setItem(regKey(videoId), 'true'); }

function syncRegistrationState() {
  isRegistered = checkRegistered(currentVideoId);
  if (isRegistered) {
    timerLabel.textContent     = '✅ Registered — video plays freely';
    timerFill.style.width      = '100%';
    timerFill.style.background = 'linear-gradient(90deg, #22c55e, #16a34a)';
  } else {
    timerFill.style.width      = '0%';
    timerFill.style.background = '';
    timerLabel.textContent     = `Watch time: 0s / ${TRIGGER_SECONDS}s`;
  }
}

/* ============================================================
   CUSTOM VIDEO PANEL
   ============================================================ */

function extractYouTubeId(raw) {
  const s = raw.trim();

  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;

  try {
    const u = new URL(s);

    if (u.hostname === 'youtu.be') {
      const id = u.pathname.slice(1).split(/[?&]/)[0];
      return id.length === 11 ? id : null;
    }

    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v && v.length === 11) return v;

      const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch (_) {}

  return null;
}

function showCvpFeedback(msg, type) {
  cvpFeedback.textContent = msg;
  cvpFeedback.className   = 'cvp-feedback ' + (type || '');
}

function loadCustomVideo(videoId) {
  currentVideoId = videoId;
  triggered      = false;
  watchSeconds   = 0;

  syncRegistrationState();

  if (ytApiReady) {
    createPlayer(videoId);
  }
}

/* ── Live URL validation as user types ─────────────────────── */
customVideoUrl.addEventListener('input', function () {
  const val = this.value.trim();

  cvpClearBtn.classList.toggle('visible', val.length > 0);
  this.classList.remove('cvp-error', 'cvp-success');
  showCvpFeedback('');

  if (!val) return;

  const id = extractYouTubeId(val);
  if (id) {
    this.classList.add('cvp-success');
    showCvpFeedback('✓ Valid YouTube URL — click Load Video to apply.', 'success');
  } else if (val.length > 10) {
    this.classList.add('cvp-error');
    showCvpFeedback('⚠ Could not find a YouTube video ID. Make sure it\'s a valid YouTube link.', 'error');
  }
});

/* ── Clear button ───────────────────────────────────────────── */
cvpClearBtn.addEventListener('click', function () {
  customVideoUrl.value = '';
  customVideoUrl.classList.remove('cvp-error', 'cvp-success');
  cvpClearBtn.classList.remove('visible');
  showCvpFeedback('');
  customVideoUrl.focus();
});

/* ── Load button ────────────────────────────────────────────── */
cvpLoadBtn.addEventListener('click', function () {
  const val = customVideoUrl.value.trim();

  if (!val) {
    customVideoUrl.classList.add('cvp-error');
    showCvpFeedback('⚠ Please paste a YouTube URL first.', 'error');
    customVideoUrl.focus();
    return;
  }

  const videoId = extractYouTubeId(val);

  if (!videoId) {
    customVideoUrl.classList.add('cvp-error');
    showCvpFeedback('⚠ That doesn\'t look like a valid YouTube URL. Try youtube.com/watch?v=...', 'error');
    customVideoUrl.focus();
    return;
  }

  if (videoId === currentVideoId) {
    showCvpFeedback('ℹ This video is already loaded.', 'success');
    return;
  }

  cvpLoadBtn.disabled = true;
  cvpLoadBtn.textContent = 'Loading…';

  loadCustomVideo(videoId);

  customVideoUrl.classList.remove('cvp-error');
  customVideoUrl.classList.add('cvp-success');

  const alreadyReg = checkRegistered(videoId);
  if (alreadyReg) {
    showCvpFeedback('✅ Video loaded! Already registered — plays freely.', 'success');
  } else {
    showCvpFeedback('✅ Video loaded! Press play — the lead form appears after 6 seconds.', 'success');
  }

  setTimeout(() => {
    cvpLoadBtn.disabled    = false;
    cvpLoadBtn.textContent = 'Load Video';
  }, 1800);

  document.getElementById('video-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

/* ── Enter key shortcut ─────────────────────────────────────── */
customVideoUrl.addEventListener('keydown', function (e) {
  if (e.key === 'Enter') cvpLoadBtn.click();
});