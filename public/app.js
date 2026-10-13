// StepHack Client Controller

let state = {
  totalSteps: 5000,
  durationMinutes: 45,
  timeMode: 'duration',
  startTime: null,
  endTime: null,
  paceType: 'natural',
  device: { manufacturer: 'Google', model: 'Pixel 8 Pro' },
  isConnected: false,
  todaySteps: 0,
  previewData: null
};

function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

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
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

document.addEventListener('DOMContentLoaded', () => {
  initDefaults();
  bindEvents();
  checkUrlParams();
  loadStatus();
  loadHistory();
  triggerPreview();
});

function initDefaults() {
  const now = new Date();
  const past = new Date(now.getTime() - state.durationMinutes * 60000);

  state.endTime = now.toISOString();
  state.startTime = past.toISOString();

  const formatForInput = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startInput = document.getElementById('input-start-time');
  const endInput = document.getElementById('input-end-time');
  if (startInput) startInput.value = formatForInput(past);
  if (endInput) endInput.value = formatForInput(now);
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
        debouncedPreview();
      }
    });
  }

  if (btnStepPlus) {
    btnStepPlus.addEventListener('click', () => {
      state.totalSteps = Math.min(100000, state.totalSteps + 500);
      if (inputSteps) inputSteps.value = state.totalSteps;
      debouncedPreview();
    });
  }

  if (btnStepMinus) {
    btnStepMinus.addEventListener('click', () => {
      state.totalSteps = Math.max(100, state.totalSteps - 500);
      if (inputSteps) inputSteps.value = state.totalSteps;
      debouncedPreview();
    });
  }

  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.set) {
        state.totalSteps = parseInt(chip.dataset.set, 10);
        if (inputSteps) inputSteps.value = state.totalSteps;
        debouncedPreview();
      }
    });
  });

  if (durationSlider) {
    durationSlider.addEventListener('input', () => {
      state.durationMinutes = parseInt(durationSlider.value, 10);
      const textEl = document.getElementById('duration-val-text');
      if (textEl) textEl.textContent = state.durationMinutes;
      updateTimesFromDuration();
      debouncedPreview();
    });
  }

  if (btnAutoDuration) {
    btnAutoDuration.addEventListener('click', () => {
      const idealMinutes = Math.max(5, Math.min(180, Math.round(state.totalSteps / 110)));
      state.durationMinutes = idealMinutes;
      if (durationSlider) durationSlider.value = idealMinutes;
      const textEl = document.getElementById('duration-val-text');
      if (textEl) textEl.textContent = idealMinutes;
      updateTimesFromDuration();
      debouncedPreview();
    });
  }

  if (tabDuration && tabRange) {
    tabDuration.addEventListener('click', () => {
      state.timeMode = 'duration';
      tabDuration.classList.add('active');
      tabRange.classList.remove('active');
      document.getElementById('view-mode-duration')?.classList.remove('hidden');
      document.getElementById('view-mode-range')?.classList.add('hidden');
      updateTimesFromDuration();
      debouncedPreview();
    });

    tabRange.addEventListener('click', () => {
      state.timeMode = 'range';
      tabRange.classList.add('active');
      tabDuration.classList.remove('active');
      document.getElementById('view-mode-range')?.classList.remove('hidden');
      document.getElementById('view-mode-duration')?.classList.add('hidden');
      updateTimesFromInputs();
      debouncedPreview();
    });
  }

  if (startInput) startInput.addEventListener('change', () => { updateTimesFromInputs(); debouncedPreview(); });
  if (endInput) endInput.addEventListener('change', () => { updateTimesFromInputs(); debouncedPreview(); });

  document.querySelectorAll('.pace-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pace-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const radio = tab.querySelector('input');
      if (radio) {
        radio.checked = true;
        state.paceType = radio.value;
      }
      debouncedPreview();
    });
  });

  if (selectDevice) {
    selectDevice.addEventListener('change', () => {
      const [manufacturer, model] = selectDevice.value.split('|');
      state.device = { manufacturer, model };
      debouncedPreview();
    });
  }

  if (btnSync) btnSync.addEventListener('click', handleSyncSteps);
  if (btnRefreshFit) btnRefreshFit.addEventListener('click', () => { loadTodaySteps(); loadStatus(); });
  if (btnConnectGoogle) btnConnectGoogle.addEventListener('click', handleConnectGoogle);
  if (btnDisconnect) btnDisconnect.addEventListener('click', handleDisconnect);
  if (btnRefreshHistory) btnRefreshHistory.addEventListener('click', loadHistory);
}

function updateTimesFromDuration() {
  const now = new Date();
  const start = new Date(now.getTime() - state.durationMinutes * 60000);
  state.endTime = now.toISOString();
  state.startTime = start.toISOString();
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
      state.durationMinutes = Math.round((e - s) / 60000);
    }
  }
}

const debouncedPreview = debounce(() => {
  triggerPreview();
}, 250);

async function triggerPreview() {
  if (state.timeMode === 'duration') {
    updateTimesFromDuration();
  }

  try {
    const res = await fetch('/api/preview', {
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

    if (!res.ok) return;

    const data = await res.json();
    state.previewData = data;
    updateMetricsUI(data.meta);
    renderCanvasChart(data.previewPoints);
  } catch (err) {
    console.error('Preview error:', err);
  }
}

function updateMetricsUI(meta) {
  const distEl = document.getElementById('metric-dist');
  const calEl = document.getElementById('metric-cal');
  const spmEl = document.getElementById('metric-spm');
  const countEl = document.getElementById('chart-points-count');

  if (distEl) distEl.textContent = `${meta.totalDistanceKm} km`;
  if (calEl) calEl.textContent = `${meta.totalCaloriesKcal} kcal`;
  if (spmEl) spmEl.textContent = `${meta.avgCadence} spm`;
  if (countEl) countEl.textContent = `${meta.previewPoints?.length || Math.round(meta.durationMinutes * 2)} intervals`;
}

function renderCanvasChart(points = []) {
  const canvas = document.getElementById('cadence-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);
  if (!points || points.length === 0) return;

  const maxSteps = Math.max(...points.map(p => p.steps), 10);
  const paddingBottom = 16;
  const paddingTop = 8;
  const plotH = h - paddingBottom - paddingTop;

  const barCount = points.length;
  const barGap = 1.5;
  const barWidth = Math.max(2, (w - (barCount - 1) * barGap) / barCount);

  // Subtle uniform blue
  ctx.fillStyle = '#3b82f6';

  points.forEach((p, i) => {
    const x = i * (barWidth + barGap);
    const barHeight = Math.max(2, (p.steps / maxSteps) * plotH);
    const y = h - paddingBottom - barHeight;

    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, [1, 1, 0, 0]) : ctx.rect(x, y, barWidth, barHeight);
    ctx.fill();
  });

  // Subtle average pace dotted line
  const avgSteps = points.reduce((a, b) => a + b.steps, 0) / barCount;
  const avgY = h - paddingBottom - (avgSteps / maxSteps) * plotH;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(0, avgY);
  ctx.lineTo(w, avgY);
  ctx.stroke();
  ctx.restore();

  // Clean time labels
  ctx.fillStyle = '#64748b';
  ctx.font = '10px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(points[0]?.time || '', 0, h - 2);

  ctx.textAlign = 'right';
  ctx.fillText(points[points.length - 1]?.time || '', w, h - 2);
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
    const linkedEl = document.getElementById('auth-linked');
    const connectBanner = document.getElementById('connect-banner');
    const todayCard = document.getElementById('today-counter-card');

    if (data.isConnected && data.user) {
      state.isConnected = true;
      if (unlinkedEl) unlinkedEl.classList.add('hidden');
      if (linkedEl) linkedEl.classList.remove('hidden');
      if (connectBanner) connectBanner.classList.add('hidden');
      if (todayCard) todayCard.classList.remove('hidden');

      const avatar = document.getElementById('user-avatar');
      const name = document.getElementById('user-name');
      if (avatar) avatar.src = data.user.picture || '';
      if (name) name.textContent = data.user.name || data.user.email || 'User';

      loadTodaySteps();
    } else {
      state.isConnected = false;
      if (unlinkedEl) unlinkedEl.classList.remove('hidden');
      if (linkedEl) linkedEl.classList.add('hidden');
      if (connectBanner) connectBanner.classList.remove('hidden');
      if (todayCard) todayCard.classList.add('hidden');
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

async function loadTodaySteps() {
  if (!state.isConnected) return;
  const stepValEl = document.getElementById('today-steps-val');
  if (stepValEl) stepValEl.textContent = '...';

  try {
    const res = await fetch('/api/today-steps');
    if (res.ok) {
      const data = await res.json();
      if (stepValEl) stepValEl.textContent = formatNum(data.todaySteps);
      state.todaySteps = data.todaySteps;
    }
  } catch (err) {
    if (stepValEl) stepValEl.textContent = '0';
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

async function loadHistory() {
  const listEl = document.getElementById('history-list');
  if (!listEl) return;

  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      listEl.innerHTML = '<div class="empty-state">No sessions logged in this session yet.</div>';
      return;
    }

    listEl.innerHTML = history.map(item => `
      <div class="history-item">
        <div class="hist-left">
          <span class="hist-steps">+${formatNum(item.steps)} steps</span>
          <span class="hist-meta">${item.distanceKm} km &bull; ${item.durationMinutes}m &bull; ${item.caloriesKcal} kcal</span>
        </div>
        <div class="hist-time">
          ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('History load failed:', err);
  }
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
