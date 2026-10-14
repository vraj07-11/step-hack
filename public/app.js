// StepHack High-Performance Client Controller

let state = {
  totalSteps: 5000,
  durationMinutes: 45,
  timeMode: 'duration',
  startTime: null,
  endTime: null,
  paceType: 'natural',
  device: { manufacturer: 'Google', model: 'Pixel 8 Pro' },
  isConnected: false,
  todaySteps: 0
};

let renderScheduled = false;

function formatNum(n) {
  return (n || 0).toLocaleString();
}

function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 3200);
}

document.addEventListener('DOMContentLoaded', () => {
  initDefaults();
  bindEvents();
  checkUrlParams();
  loadStatus();
  loadHistory();
  updatePreviewInstant();
});

const DURATION_MILESTONES = [
  { mins: 15, pct: 0 },
  { mins: 30, pct: 20 },
  { mins: 45, pct: 40 },
  { mins: 60, pct: 60 },
  { mins: 90, pct: 80 },
  { mins: 120, pct: 100 }
];

function minutesToSliderPct(mins) {
  const m = Math.max(15, Math.min(120, mins));
  for (let i = 0; i < DURATION_MILESTONES.length - 1; i++) {
    const curr = DURATION_MILESTONES[i];
    const next = DURATION_MILESTONES[i + 1];
    if (m >= curr.mins && m <= next.mins) {
      const ratio = (m - curr.mins) / (next.mins - curr.mins);
      return curr.pct + ratio * (next.pct - curr.pct);
    }
  }
  return m <= 15 ? 0 : 100;
}

function sliderPctToMinutes(pct) {
  const p = Math.max(0, Math.min(100, pct));
  for (let i = 0; i < DURATION_MILESTONES.length - 1; i++) {
    const curr = DURATION_MILESTONES[i];
    const next = DURATION_MILESTONES[i + 1];
    if (p >= curr.pct && p <= next.pct) {
      const ratio = (p - curr.pct) / (next.pct - curr.pct);
      const exactMins = curr.mins + ratio * (next.mins - curr.mins);
      return Math.round(exactMins / 5) * 5;
    }
  }
  return 45;
}

function updateSliderProgress(pct) {
  const durationSlider = document.getElementById('input-duration-range');
  if (!durationSlider) return;
  const clampedPct = Math.max(0, Math.min(100, pct));
  durationSlider.style.setProperty('--slider-pct', `${clampedPct}%`);
  durationSlider.style.background = `linear-gradient(to right, var(--primary) 0%, var(--primary) ${clampedPct}%, rgba(255, 255, 255, 0.1) ${clampedPct}%, rgba(255, 255, 255, 0.1) 100%)`;
}

function updateScaleActiveButtons(mins) {
  document.querySelectorAll('.scale-point').forEach(btn => {
    const bMins = parseInt(btn.dataset.mins, 10);
    if (bMins === mins) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function setDuration(mins, updateSliderPos = true) {
  state.durationMinutes = Math.max(15, Math.min(120, mins));
  const textEl = document.getElementById('duration-val-text');
  if (textEl) textEl.textContent = state.durationMinutes;

  const slider = document.getElementById('input-duration-range');
  const pct = minutesToSliderPct(state.durationMinutes);
  if (slider) {
    if (updateSliderPos) {
      slider.value = pct;
    }
    slider.setAttribute('aria-valuenow', state.durationMinutes);
    slider.setAttribute('aria-valuetext', `${state.durationMinutes} minutes`);
  }
  updateSliderProgress(pct);
  updateScaleActiveButtons(state.durationMinutes);
  updateTimesFromDuration();
  updatePreviewInstant();
}

function initDefaults() {
  const now = new Date();
  const past = new Date(now.getTime() - state.durationMinutes * 60000);

  state.endTime = now.toISOString();
  state.startTime = past.toISOString();

  const pad = (n) => String(n).padStart(2, '0');
  const formatInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const startInput = document.getElementById('input-start-time');
  const endInput = document.getElementById('input-end-time');
  if (startInput) startInput.value = formatInput(past);
  if (endInput) endInput.value = formatInput(now);

  setDuration(state.durationMinutes);
}

function bindEvents() {
  const inputSteps = document.getElementById('input-steps');
  const btnStepPlus = document.getElementById('btn-step-plus');
  const btnStepMinus = document.getElementById('btn-step-minus');
  const durationSlider = document.getElementById('input-duration-range');
  const btnAutoDuration = document.getElementById('btn-auto-duration');
  const tabDuration = document.getElementById('tab-mode-duration');
  const tabRange = document.getElementById('tab-mode-range');
  const startInput = document.getElementById('input-start-time');
  const endInput = document.getElementById('input-end-time');
  const selectDevice = document.getElementById('select-device');
  const btnSync = document.getElementById('btn-sync-steps');
  const btnRefreshFit = document.getElementById('btn-refresh-fit');
  const btnConnectGoogle = document.getElementById('btn-connect-google');
  const btnDisconnect = document.getElementById('btn-disconnect');
  const btnRefreshHistory = document.getElementById('btn-refresh-history');

  if (inputSteps) {
    inputSteps.addEventListener('input', () => {
      const val = parseInt(inputSteps.value, 10);
      if (!isNaN(val) && val > 0) {
        state.totalSteps = val;
        updatePreviewInstant();
      }
    });
  }

  if (btnStepPlus) {
    btnStepPlus.addEventListener('click', () => {
      state.totalSteps = Math.min(100000, state.totalSteps + 500);
      if (inputSteps) inputSteps.value = state.totalSteps;
      updatePreviewInstant();
    });
  }

  if (btnStepMinus) {
    btnStepMinus.addEventListener('click', () => {
      state.totalSteps = Math.max(100, state.totalSteps - 500);
      if (inputSteps) inputSteps.value = state.totalSteps;
      updatePreviewInstant();
    });
  }

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.set) {
        state.totalSteps = parseInt(chip.dataset.set, 10);
        if (inputSteps) inputSteps.value = state.totalSteps;
        updatePreviewInstant();
      }
    });
  });

  if (durationSlider) {
    // Instant 60fps input event while sliding
    durationSlider.addEventListener('input', () => {
      const rawPct = parseFloat(durationSlider.value);
      const mins = sliderPctToMinutes(rawPct);
      state.durationMinutes = mins;
      const textEl = document.getElementById('duration-val-text');
      if (textEl) textEl.textContent = mins;
      durationSlider.setAttribute('aria-valuenow', mins);
      durationSlider.setAttribute('aria-valuetext', `${mins} minutes`);
      updateSliderProgress(rawPct);
      updateScaleActiveButtons(mins);
      updateTimesFromDuration();
      updatePreviewInstant();
    });

    durationSlider.addEventListener('change', () => {
      // Snap neatly to the mapped milestone position on release
      setDuration(state.durationMinutes);
    });
  }

  if (btnAutoDuration) {
    btnAutoDuration.addEventListener('click', () => {
      const idealMinutes = Math.max(15, Math.min(120, Math.round(state.totalSteps / 110 / 5) * 5 || 45));
      setDuration(idealMinutes);
    });
  }

  document.querySelectorAll('.scale-point').forEach(btn => {
    btn.addEventListener('click', () => {
      const mins = parseInt(btn.dataset.mins, 10);
      if (!isNaN(mins)) {
        setDuration(mins);
      }
    });
  });

  if (tabDuration && tabRange) {
    tabDuration.addEventListener('click', () => {
      state.timeMode = 'duration';
      tabDuration.classList.add('active');
      tabRange.classList.remove('active');
      document.getElementById('view-mode-duration')?.classList.remove('hidden');
      document.getElementById('view-mode-range')?.classList.add('hidden');
      setDuration(state.durationMinutes);
    });

    tabRange.addEventListener('click', () => {
      state.timeMode = 'range';
      tabRange.classList.add('active');
      tabDuration.classList.remove('active');
      document.getElementById('view-mode-range')?.classList.remove('hidden');
      document.getElementById('view-mode-duration')?.classList.add('hidden');
      syncInputsFromDuration();
      updateTimesFromInputs();
      updatePreviewInstant();
    });
  }

  if (startInput) startInput.addEventListener('change', () => { updateTimesFromInputs(); updatePreviewInstant(); });
  if (endInput) endInput.addEventListener('change', () => { updateTimesFromInputs(); updatePreviewInstant(); });

  document.querySelectorAll('.pace-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const radio = tab.querySelector('input');
      if (radio) {
        radio.checked = true;
        state.paceType = radio.value;
      }
      updatePreviewInstant();
    });
  });

  if (selectDevice) {
    selectDevice.addEventListener('change', () => {
      const [manufacturer, model] = selectDevice.value.split('|');
      state.device = { manufacturer, model };
    });
  }

  const btnProfileToggle = document.getElementById('btn-profile-toggle');
  const profileDropdown = document.getElementById('profile-dropdown');
  const btnClearHistory = document.getElementById('btn-clear-history');

  if (btnProfileToggle && profileDropdown) {
    btnProfileToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = profileDropdown.classList.contains('hidden');
      profileDropdown.classList.toggle('hidden', !isHidden);
      btnProfileToggle.setAttribute('aria-expanded', isHidden ? 'true' : 'false');
    });

    document.addEventListener('click', (e) => {
      if (!profileDropdown.contains(e.target) && !btnProfileToggle.contains(e.target)) {
        profileDropdown.classList.add('hidden');
        btnProfileToggle.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        profileDropdown.classList.add('hidden');
        btnProfileToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', async () => {
      if (!confirm('Clear recent session history?')) return;
      try {
        localStorage.removeItem(LOCAL_STORAGE_HISTORY_KEY);
        await fetch('/api/history/clear', { method: 'POST' });
        showToast('History cleared.');
        loadHistory();
      } catch (err) {
        showToast('Failed to clear history.', 'error');
      }
    });
  }

  if (btnSync) btnSync.addEventListener('click', handleSyncSteps);
  if (btnRefreshFit) btnRefreshFit.addEventListener('click', () => { loadTodaySteps(); loadStatus(); });
  if (btnConnectGoogle) btnConnectGoogle.addEventListener('click', handleConnectGoogle);
  if (btnDisconnect) btnDisconnect.addEventListener('click', handleDisconnect);
  if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadHistory);

  // Smart real-time background sync every 45s (only when tab is visible, saving battery/data)
  setInterval(() => {
    if (state.isConnected && document.visibilityState === 'visible') {
      loadTodaySteps();
    }
  }, 45000);

  // Instant data refresh upon tab refocus/visibility change
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.isConnected) {
      loadTodaySteps();
    }
  });

  // Re-render chart on orientation change or window resize
  window.addEventListener('resize', () => {
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        updatePreviewInstant();
        renderScheduled = false;
      });
    }
  });
}

function syncInputsFromDuration() {
  const now = new Date();
  const past = new Date(now.getTime() - state.durationMinutes * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  const formatInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const startInput = document.getElementById('input-start-time');
  const endInput = document.getElementById('input-end-time');
  if (startInput) startInput.value = formatInput(past);
  if (endInput) endInput.value = formatInput(now);
}

function updateTimesFromDuration() {
  const now = new Date();
  const start = new Date(now.getTime() - state.durationMinutes * 60000);
  state.endTime = now.toISOString();
  state.startTime = start.toISOString();
  syncInputsFromDuration();
}

function updateTimesFromInputs() {
  const startVal = document.getElementById('input-start-time')?.value;
  const endVal = document.getElementById('input-end-time')?.value;
  if (startVal && endVal) {
    const s = new Date(startVal);
    const e = new Date(endVal);
    if (e > s) {
      state.startTime = s.toISOString();
      state.endTime = e.toISOString();
      state.durationMinutes = Math.max(1, Math.round((e - s) / 60000));
    }
  }
}

// Client-Side Instant Math Engine (Zero network delay, 60fps responsive)
function updatePreviewInstant() {
  if (state.timeMode === 'duration') {
    updateTimesFromDuration();
  }

  const { totalSteps, durationMinutes, paceType } = state;
  const durationMs = durationMinutes * 60000;
  const intervalSeconds = 30;
  const totalIntervals = Math.max(1, Math.round((durationMs / 1000) / intervalSeconds));

  const weights = [];
  let currentMomentum = 1.0;

  for (let i = 0; i < totalIntervals; i++) {
    const progress = i / totalIntervals;
    const warmUp = progress < 0.05 ? 0.7 + (progress / 0.05) * 0.3 : 1.0;
    const coolDown = progress > 0.95 ? 0.8 + (1 - (progress - 0.95) / 0.05) * 0.2 : 1.0;
    currentMomentum = Math.max(0.7, Math.min(1.3, currentMomentum + (Math.random() - 0.5) * 0.15));
    const isPause = totalIntervals > 10 && Math.random() < 0.02 && progress > 0.1 && progress < 0.9;
    weights.push(currentMomentum * warmUp * coolDown * (isPause ? 0.2 : 1.0));
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedSteps = weights.map(w => Math.floor((w / totalWeight) * totalSteps));
  let allocated = normalizedSteps.reduce((a, b) => a + b, 0);
  let remainder = totalSteps - allocated;
  let idx = 0;
  while (remainder > 0) {
    normalizedSteps[idx % totalIntervals]++;
    remainder--;
    idx++;
  }

  const strideMeters = paceType === 'brisk' ? 0.78 : paceType === 'jog' ? 0.86 : 0.74;
  const calPerStep = paceType === 'brisk' ? 0.046 : paceType === 'jog' ? 0.055 : 0.042;

  const totalDistanceKm = parseFloat((totalSteps * strideMeters / 1000).toFixed(2));
  const totalCaloriesKcal = Math.round(totalSteps * calPerStep);
  const avgCadence = Math.round(totalSteps / durationMinutes);

  // Update DOM metrics instantly
  const distEl = document.getElementById('metric-dist');
  const calEl = document.getElementById('metric-cal');
  const spmEl = document.getElementById('metric-spm');
  const countEl = document.getElementById('chart-points-count');

  if (distEl) distEl.textContent = `${totalDistanceKm} km`;
  if (calEl) calEl.textContent = `${totalCaloriesKcal} kcal`;
  if (spmEl) spmEl.textContent = `${avgCadence} spm`;
  if (countEl) countEl.textContent = `${totalIntervals} intervals`;

  // Dynamic duration recommendation note
  const adviceBox = document.getElementById('duration-advice-box');
  const adviceText = document.getElementById('duration-advice-text');
  if (adviceText) {
    const suggestedMins = Math.max(5, Math.round(totalSteps / 110));
    let timeStr = `${suggestedMins} mins`;
    if (suggestedMins >= 60) {
      const h = Math.floor(suggestedMins / 60);
      const m = suggestedMins % 60;
      timeStr = m > 0 ? `${h}h ${m}m` : `${h}h`;
    }

    if (avgCadence > 135) {
      if (adviceBox) adviceBox.classList.add('advice-warning');
      adviceText.innerHTML = `<strong>Pace Warning (${avgCadence} spm):</strong> Suggested duration is ~<strong>${timeStr}</strong> for ${totalSteps.toLocaleString()} steps (~110 spm) so Google Fit doesn't flag high-cadence data as fake.`;
    } else {
      if (adviceBox) adviceBox.classList.remove('advice-warning');
      adviceText.innerHTML = `<strong>Suggested duration:</strong> ~<strong>${timeStr}</strong> for ${totalSteps.toLocaleString()} steps (~110 spm) so Google Fit registers natural human cadence and doesn't flag fake data.`;
    }
  }

  // Draw chart in next animation frame
  requestAnimationFrame(() => {
    renderCanvasChart(normalizedSteps);
  });
}

function renderCanvasChart(stepValues = []) {
  const canvas = document.getElementById('cadence-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const rect = canvas.getBoundingClientRect();
  if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }

  ctx.save();
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);
  if (!stepValues || stepValues.length === 0) {
    ctx.restore();
    return;
  }

  const maxSteps = Math.max(...stepValues, 10);
  const paddingBottom = 16;
  const paddingTop = 6;
  const plotH = h - paddingBottom - paddingTop;

  const barCount = stepValues.length;
  const barGap = 1.5;
  const barWidth = Math.max(1.5, (w - (barCount - 1) * barGap) / barCount);

  ctx.fillStyle = '#3b82f6';

  for (let i = 0; i < barCount; i++) {
    const x = i * (barWidth + barGap);
    const barHeight = Math.max(2, (stepValues[i] / maxSteps) * plotH);
    const y = h - paddingBottom - barHeight;

    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, [1, 1, 0, 0]) : ctx.rect(x, y, barWidth, barHeight);
    ctx.fill();
  }

  // Dotted average guideline
  const avgSteps = stepValues.reduce((a, b) => a + b, 0) / barCount;
  const avgY = h - paddingBottom - (avgSteps / maxSteps) * plotH;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, avgY);
  ctx.lineTo(w, avgY);
  ctx.stroke();

  // Subtle start and end time text
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  const startStr = state.startTime ? new Date(state.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const endStr = state.endTime ? new Date(state.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  ctx.fillText(startStr, 0, h - 2);

  ctx.textAlign = 'right';
  ctx.fillText(endStr, w, h - 2);

  ctx.restore();
}

async function handleSyncSteps() {
  const btnSync = document.getElementById('btn-sync-steps');
  const btnText = btnSync?.querySelector('.btn-sync-text');

  if (!state.isConnected) {
    showToast('Please sign in with Google first.', 'error');
    handleConnectGoogle();
    return;
  }

  if (btnSync) btnSync.classList.add('loading');
  if (btnText) btnText.textContent = 'Syncing...';

  // In Recent mode, refresh end time to exact current moment right before sync
  if (state.timeMode === 'duration') {
    updateTimesFromDuration();
  }

  try {
    const res = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        totalSteps: state.totalSteps,
        startTime: state.startTime,
        endTime: state.endTime,
        paceType: state.paceType,
        device: state.device
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to sync steps');

    showToast(`Logged ${formatNum(state.totalSteps)} steps to Google Fit.`, 'success');
    if (data.summary) {
      saveLocalHistory(data.summary);
    }
    loadTodaySteps();
    loadHistory();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btnSync) btnSync.classList.remove('loading');
    if (btnText) btnText.textContent = 'Log Steps to Google Fit';
  }
}

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const unlinkedEl = document.getElementById('auth-unlinked');
    const profileBtn = document.getElementById('btn-profile-toggle');
    const connectBanner = document.getElementById('connect-banner');
    const todayCard = document.getElementById('today-counter-card');

    if (data.isConnected && data.user) {
      state.isConnected = true;
      if (unlinkedEl) unlinkedEl.classList.add('hidden');
      if (profileBtn) profileBtn.classList.remove('hidden');
      if (connectBanner) connectBanner.classList.add('hidden');

      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      const menuAvatar = document.getElementById('profile-menu-avatar');
      const menuName = document.getElementById('profile-menu-name');
      const menuEmail = document.getElementById('profile-menu-email');

      if (avatar) avatar.src = data.user.picture || '';
      if (name) name.textContent = data.user.name || data.user.email || 'User';
      if (menuAvatar) menuAvatar.src = data.user.picture || '';
      if (menuName) menuName.textContent = data.user.name || 'User';
      if (menuEmail) menuEmail.textContent = data.user.email || '';

      loadTodaySteps();
    } else {
      state.isConnected = false;
      if (unlinkedEl) unlinkedEl.classList.remove('hidden');
      if (profileBtn) profileBtn.classList.add('hidden');
      if (connectBanner) connectBanner.classList.remove('hidden');
      if (todayCard) todayCard.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

async function loadTodaySteps() {
  if (!state.isConnected) return;
  const todayCard = document.getElementById('today-counter-card');
  const stepValEl = document.getElementById('today-steps-val');
  const distValEl = document.getElementById('today-dist-val');
  const calValEl = document.getElementById('today-cal-val');
  const timeEl = document.getElementById('today-sync-time');
  const profToday = document.getElementById('prof-today-steps');

  try {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = now.getTime();

    const res = await fetch(`/api/today-steps?startMs=${startOfDay}&endMs=${endOfDay}`);
    if (res.ok) {
      const data = await res.json();
      state.todaySteps = data.todaySteps || 0;

      if (stepValEl) stepValEl.textContent = formatNum(data.todaySteps);
      if (distValEl) distValEl.textContent = `${data.todayDistanceKm} km`;
      if (calValEl) calValEl.textContent = `${formatNum(data.todayCaloriesKcal)} kcal`;
      if (timeEl && data.lastUpdated) timeEl.textContent = data.lastUpdated;
      if (profToday) profToday.textContent = formatNum(data.todaySteps);

      // Only display the real-time card if positive steps were fetched
      // If 0 steps or not available, keep the real-time card removed from view so it doesn't clutter with 0s
      if (todayCard) {
        if (data.todaySteps > 0) {
          todayCard.classList.remove('hidden');
        } else {
          todayCard.classList.add('hidden');
        }
      }
    } else {
      if (todayCard) todayCard.classList.add('hidden');
    }
  } catch (err) {
    if (todayCard) todayCard.classList.add('hidden');
  }
}

async function handleConnectGoogle() {
  try {
    const res = await fetch('/api/auth/url');
    const data = await res.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      showToast(data.error || 'Login unavailable.', 'error');
    }
  } catch (err) {
    showToast('Failed to connect to Google.', 'error');
  }
}

async function handleDisconnect() {
  try {
    await fetch('/api/auth/disconnect', { method: 'POST' });
    showToast('Signed out of Google Fit.', 'success');
    loadStatus();
  } catch (err) {
    showToast('Sign out error.', 'error');
  }
}

const LOCAL_STORAGE_HISTORY_KEY = 'stephack_recent_history';

function getLocalHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(entry) {
  try {
    const current = getLocalHistory();
    const updated = [entry, ...current.filter(item => item.id !== entry.id)].slice(0, 20);
    localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(updated));
    return updated;
  } catch {
    return [];
  }
}

async function loadHistory() {
  const listEl = document.getElementById('history-list');
  const profCount = document.getElementById('prof-sessions-count');
  if (!listEl) return;

  let historyList = getLocalHistory();

  try {
    const res = await fetch('/api/history');
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.history) && data.history.length > 0) {
        const serverIds = new Set(data.history.map(h => h.id));
        const combined = [...data.history, ...historyList.filter(h => !serverIds.has(h.id))].slice(0, 20);
        historyList = combined;
        try {
          localStorage.setItem(LOCAL_STORAGE_HISTORY_KEY, JSON.stringify(combined));
        } catch {}
      }
    }
  } catch (err) {
    console.warn('History fetch warning, using local history cache:', err);
  }

  if (profCount) profCount.textContent = historyList.length;

  if (historyList.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No sessions logged in this session yet.</div>';
    return;
  }

  listEl.innerHTML = historyList.map(item => `
    <div class="history-item">
      <div class="hist-left">
        <span class="hist-steps">+${formatNum(item.steps)} steps</span>
        <span class="hist-meta">${item.distanceKm || '0'} km &bull; ${item.durationMinutes || '0'}m &bull; ${formatNum(item.caloriesKcal || 0)} kcal</span>
      </div>
      <div class="hist-time">
        ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  `).join('');
}

function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === '1') {
    showToast('Connected to Google Fit.', 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (params.get('auth_error')) {
    showToast('Login failed: ' + decodeURIComponent(params.get('auth_error')), 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
