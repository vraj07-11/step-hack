// StepHack Client Logic & Interactive Preview Engine

let state = {
  totalSteps: 5000,
  durationMinutes: 45,
  timeMode: 'duration', // 'duration' or 'range'
  startTime: null,
  endTime: null,
  paceType: 'natural',
  device: { manufacturer: 'Google', model: 'Pixel 8 Pro' },
  isConnected: false,
  todaySteps: 0,
  previewData: null
};

// Debounce helper
function debounce(fn, ms = 200) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Format number with commas
function formatNum(n) {
  return (n || 0).toLocaleString();
}

// Toast notification helper
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '⚠️'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initDefaults();
  bindEvents();
  checkUrlParams();
  loadStatus();
  loadHistory();
  loadQrCode();
  triggerPreview();
});

// Set default times
function initDefaults() {
  const now = new Date();
  const past = new Date(now.getTime() - state.durationMinutes * 60000);

  state.endTime = now.toISOString();
  state.startTime = past.toISOString();

  // Set datetime-local inputs format: YYYY-MM-DDTHH:mm
  const formatForInput = (d) => {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const startInput = document.getElementById('input-start-time');
  const endInput = document.getElementById('input-end-time');
  if (startInput) startInput.value = formatForInput(past);
  if (endInput) endInput.value = formatForInput(now);
}

// Bind DOM events
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

  // Step counter input
  inputSteps.addEventListener('input', () => {
    const val = parseInt(inputSteps.value, 10);
    if (!isNaN(val) && val > 0) {
      state.totalSteps = val;
      debouncedPreview();
    }
  });

  btnStepPlus.addEventListener('click', () => {
    state.totalSteps = Math.min(100000, state.totalSteps + 500);
    inputSteps.value = state.totalSteps;
    debouncedPreview();
  });

  btnStepMinus.addEventListener('click', () => {
    state.totalSteps = Math.max(100, state.totalSteps - 500);
    inputSteps.value = state.totalSteps;
    debouncedPreview();
  });

  // Quick Chips
  document.querySelectorAll('.chip-btn').forEach(chip => {
    chip.addEventListener('click', () => {
      if (chip.dataset.add) {
        state.totalSteps += parseInt(chip.dataset.add, 10);
      } else if (chip.dataset.set) {
        state.totalSteps = parseInt(chip.dataset.set, 10);
      }
      inputSteps.value = state.totalSteps;
      debouncedPreview();
    });
  });

  // Duration Slider
  durationSlider.addEventListener('input', () => {
    state.durationMinutes = parseInt(durationSlider.value, 10);
    document.getElementById('duration-val-text').textContent = state.durationMinutes;
    updateTimesFromDuration();
    debouncedPreview();
  });

  // Auto Duration button
  btnAutoDuration.addEventListener('click', () => {
    // Normal human walk cadence is ~110 steps per minute
    const idealMinutes = Math.max(5, Math.min(180, Math.round(state.totalSteps / 110)));
    state.durationMinutes = idealMinutes;
    durationSlider.value = idealMinutes;
    document.getElementById('duration-val-text').textContent = idealMinutes;
    updateTimesFromDuration();
    debouncedPreview();
    showToast(`Pace optimized: ${idealMinutes} mins at ~110 steps/min`, 'success');
  });

  // Time Mode Switch Tabs
  tabDuration.addEventListener('click', () => {
    state.timeMode = 'duration';
    tabDuration.classList.add('active');
    tabRange.classList.remove('active');
    document.getElementById('view-mode-duration').classList.remove('hidden');
    document.getElementById('view-mode-range').classList.add('hidden');
    updateTimesFromDuration();
    debouncedPreview();
  });

  tabRange.addEventListener('click', () => {
    state.timeMode = 'range';
    tabRange.classList.add('active');
    tabDuration.classList.remove('active');
    document.getElementById('view-mode-range').classList.remove('hidden');
    document.getElementById('view-mode-duration').classList.add('hidden');
    updateTimesFromInputs();
    debouncedPreview();
  });

  startInput.addEventListener('change', () => {
    updateTimesFromInputs();
    debouncedPreview();
  });

  endInput.addEventListener('change', () => {
    updateTimesFromInputs();
    debouncedPreview();
  });

  // Pace Radio Cards
  document.querySelectorAll('.pace-radio-card').forEach(card => {
    card.addEventListener('click', () => {
      document.querySelectorAll('.pace-radio-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      const radio = card.querySelector('input');
      radio.checked = true;
      state.paceType = radio.value;
      debouncedPreview();
    });
  });

  // Device Select
  selectDevice.addEventListener('change', () => {
    const [manufacturer, model] = selectDevice.value.split('|');
    state.device = { manufacturer, model };
    debouncedPreview();
  });

  // Main Sync Button
  btnSync.addEventListener('click', handleSyncSteps);

  // Refresh Fit Steps
  btnRefreshFit.addEventListener('click', () => {
    loadTodaySteps();
    loadStatus();
  });

  // Connect Google Button
  btnConnectGoogle.addEventListener('click', handleConnectGoogle);

  // Disconnect Button
  btnDisconnect.addEventListener('click', handleDisconnect);

  // Refresh History
  btnRefreshHistory.addEventListener('click', loadHistory);

  // Modals & Settings
  setupModals();
}

function updateTimesFromDuration() {
  const now = new Date();
  const start = new Date(now.getTime() - state.durationMinutes * 60000);
  state.endTime = now.toISOString();
  state.startTime = start.toISOString();
}

function updateTimesFromInputs() {
  const startVal = document.getElementById('input-start-time').value;
  const endVal = document.getElementById('input-end-time').value;
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

// Debounced preview trigger
const debouncedPreview = debounce(() => {
  triggerPreview();
}, 250);

// Fetch preview data and render chart & metrics
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

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Preview failed');
    }

    const data = await res.json();
    state.previewData = data;
    updateMetricsUI(data.meta);
    renderCanvasChart(data.previewPoints);
    updateCadenceHealth(data.meta.avgCadence);
  } catch (err) {
    console.error('Preview error:', err);
  }
}

// Update calculated metrics
function updateMetricsUI(meta) {
  document.getElementById('metric-dist').textContent = `${meta.totalDistanceKm} km`;
  document.getElementById('metric-cal').textContent = `${meta.totalCaloriesKcal} kcal`;
  document.getElementById('metric-spm').textContent = `${meta.avgCadence} spm`;
  document.getElementById('chart-points-count').textContent = `${meta.previewPoints?.length || meta.totalSteps ? Math.round(meta.durationMinutes * 2) : 0} intervals (30s each)`;
}

// Update Cadence health advice banner
function updateCadenceHealth(spm) {
  const box = document.getElementById('cadence-indicator-box');
  const rateText = document.getElementById('cadence-rate-text');
  const descText = document.getElementById('cadence-desc-text');

  rateText.textContent = `${spm} steps/min`;

  if (spm >= 85 && spm <= 135) {
    box.className = 'cadence-box optimal';
    descText.textContent = 'Natural human walking pace. Ideal for Google Fit & Adventure Sync.';
  } else if (spm > 135 && spm <= 180) {
    box.className = 'cadence-box optimal';
    descText.textContent = 'Brisk walking / jogging cadence. High acceptance rate.';
  } else if (spm > 180) {
    box.className = 'cadence-box warning';
    descText.textContent = '⚠️ Unusually fast cadence (>180 SPM). Consider increasing the duration.';
  } else {
    box.className = 'cadence-box warning';
    descText.textContent = '⚠️ Very slow cadence (<85 SPM). Looks like an intermittent stroll.';
  }
}

// Render dynamic canvas chart of intervals
function renderCanvasChart(points = []) {
  const canvas = document.getElementById('cadence-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;

  // Responsive canvas resolution
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = rect.height;

  ctx.clearRect(0, 0, w, h);

  if (!points || points.length === 0) return;

  // Find max steps for scaling
  const maxSteps = Math.max(...points.map(p => p.steps), 10);
  const paddingBottom = 20;
  const paddingTop = 12;
  const plotH = h - paddingBottom - paddingTop;

  const barCount = points.length;
  const barGap = 2;
  const barWidth = Math.max(2, (w - (barCount - 1) * barGap) / barCount);

  // Gradient for bars
  const grad = ctx.createLinearGradient(0, paddingTop, 0, h - paddingBottom);
  grad.addColorStop(0, '#00f2fe');
  grad.addColorStop(1, '#10b981');

  // Draw bars
  points.forEach((p, i) => {
    const x = i * (barWidth + barGap);
    const barHeight = Math.max(3, (p.steps / maxSteps) * plotH);
    const y = h - paddingBottom - barHeight;

    ctx.fillStyle = grad;
    // Rounded top bar
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]) : ctx.rect(x, y, barWidth, barHeight);
    ctx.fill();
  });

  // Draw average cadence dashed line
  const avgSteps = points.reduce((a, b) => a + b.steps, 0) / barCount;
  const avgY = h - paddingBottom - (avgSteps / maxSteps) * plotH;

  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(0, avgY);
  ctx.lineTo(w, avgY);
  ctx.stroke();
  ctx.restore();

  // Time labels (start, mid, end)
  ctx.fillStyle = '#64748b';
  ctx.font = '10px JetBrains Mono, monospace';
  ctx.textAlign = 'left';
  ctx.fillText(points[0]?.time || 'Start', 0, h - 4);

  if (points.length > 2) {
    const midIdx = Math.floor(points.length / 2);
    ctx.textAlign = 'center';
    ctx.fillText(points[midIdx]?.time || '', w / 2, h - 4);
  }

  ctx.textAlign = 'right';
  ctx.fillText(points[points.length - 1]?.time || 'End', w, h - 4);
}

// Handle Sync Steps to Google Fit
async function handleSyncSteps() {
  const btnSync = document.getElementById('btn-sync-steps');
  const btnText = btnSync.querySelector('.btn-sync-text');

  if (!state.isConnected) {
    showToast('Please connect your Google Fit account first!', 'error');
    handleConnectGoogle();
    return;
  }

  btnSync.classList.add('loading');
  btnText.textContent = 'Syncing to Google Fit Sensor Stream...';

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
    if (!res.ok) {
      throw new Error(data.error || 'Failed to sync steps');
    }

    showToast(`🎉 Logged ${formatNum(state.totalSteps)} steps to Google Fit!`, 'success');
    loadTodaySteps();
    loadHistory();
  } catch (err) {
    console.error('Sync failed:', err);
    showToast(`Sync error: ${err.message}`, 'error');
  } finally {
    btnSync.classList.remove('loading');
    btnText.textContent = 'Log Steps to Google Fit';
  }
}

// Load Google Fit connection status
async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    const dot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const profileRow = document.getElementById('user-profile-row');
    const statsRow = document.getElementById('fit-stats-row');
    const notConnected = document.getElementById('not-connected-banner');

    // Update LAN redirect URI hints in modal
    const lanUri = document.getElementById('uri-lan');
    if (lanUri && data.localIp) {
      lanUri.textContent = `http://${data.localIp}:3000/auth/callback`;
    }

    if (data.isConnected && data.user) {
      state.isConnected = true;
      dot.className = 'status-dot connected';
      statusText.textContent = 'Connected to Google Fit';

      document.getElementById('user-avatar').src = data.user.picture || '';
      document.getElementById('user-name').textContent = data.user.name || 'Google Fit User';
      document.getElementById('user-email').textContent = data.user.email || '';

      profileRow.classList.remove('hidden');
      statsRow.classList.remove('hidden');
      notConnected.classList.add('hidden');

      loadTodaySteps();
    } else {
      state.isConnected = false;
      dot.className = 'status-dot disconnected';
      statusText.textContent = (data.hasCredentials || data.serverConfigured) ? 'Click below to connect Google Fit' : 'Google Cloud Setup Required';

      profileRow.classList.add('hidden');
      statsRow.classList.add('hidden');
      notConnected.classList.remove('hidden');

      // If server has credentials configured, hide manual credentials form in modal
      const credsForm = document.getElementById('form-credentials');
      const setupSteps = document.querySelector('.setup-steps');
      const modalIntro = document.querySelector('.modal-intro');
      if (data.serverConfigured && credsForm) {
        credsForm.classList.add('hidden');
        if (setupSteps) setupSteps.classList.add('hidden');
        if (modalIntro) {
          modalIntro.innerHTML = '🔒 <strong>Google OAuth is securely configured on the server.</strong><br>Visitors can simply tap <strong>"Connect Google Fit"</strong> to log in with 1 click.';
        }
      }
    }
  } catch (err) {
    console.error('Failed to load status:', err);
  }
}

// Fetch today's total steps directly from Google Fit
async function loadTodaySteps() {
  if (!state.isConnected) return;
  const stepValEl = document.getElementById('today-steps-val');
  stepValEl.textContent = '...';

  try {
    const res = await fetch('/api/today-steps');
    if (res.ok) {
      const data = await res.json();
      stepValEl.textContent = formatNum(data.todaySteps);
      state.todaySteps = data.todaySteps;
    } else {
      stepValEl.textContent = '0';
    }
  } catch (err) {
    stepValEl.textContent = '0';
  }
}

// Connect Google Fit button action
async function handleConnectGoogle() {
  try {
    const res = await fetch('/api/auth/url');
    const data = await res.json();
    if (data.authUrl) {
      window.location.href = data.authUrl;
    } else {
      openModal('modal-settings');
      showToast(data.error || 'Please enter Client ID and Secret in settings.', 'error');
    }
  } catch (err) {
    openModal('modal-settings');
  }
}

// Disconnect action
async function handleDisconnect() {
  if (!confirm('Are you sure you want to disconnect from Google Fit?')) return;
  try {
    await fetch('/api/auth/disconnect', { method: 'POST' });
    showToast('Disconnected from Google Fit', 'success');
    loadStatus();
  } catch (err) {
    showToast('Disconnect error: ' + err.message, 'error');
  }
}

// Load sync history
async function loadHistory() {
  const listEl = document.getElementById('history-list');
  try {
    const res = await fetch('/api/history');
    const data = await res.json();
    const history = data.history || [];

    if (history.length === 0) {
      listEl.innerHTML = '<div class="empty-history">No logged sessions yet. Your synced walks will appear here.</div>';
      return;
    }

    listEl.innerHTML = history.map(item => `
      <div class="history-item">
        <div class="hist-left">
          <span class="hist-steps">+${formatNum(item.steps)} steps</span>
          <span class="hist-meta">${item.distanceKm} km • ${item.durationMinutes} mins • ${item.caloriesKcal} kcal</span>
        </div>
        <div class="hist-time">
          ${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          <div style="font-size: 0.65rem; color: #64748b;">${new Date(item.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error('History load failed:', err);
  }
}

// Load QR Code for mobile access
async function loadQrCode() {
  try {
    const res = await fetch('/api/qrcode');
    const data = await res.json();
    if (data.dataUrl) {
      document.getElementById('qr-image').src = data.dataUrl;
      document.getElementById('mobile-url-text').textContent = data.url;
    }
  } catch (err) {
    console.error('QR code fetch error:', err);
  }
}

// Setup modals and copy buttons
function setupModals() {
  const btnSettings = document.getElementById('btn-settings-modal');
  const btnQr = document.getElementById('btn-qr-modal');

  btnSettings.addEventListener('click', () => openModal('modal-settings'));
  btnQr.addEventListener('click', () => openModal('modal-qr'));

  // Close buttons
  document.querySelectorAll('.modal-close, [data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-close');
      if (targetId) closeModal(targetId);
    });
  });

  // Close on outside click
  document.querySelectorAll('.modal-overlay').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
      }
    });
  });

  // Credentials form save
  const formCreds = document.getElementById('form-credentials');
  formCreds.addEventListener('submit', async (e) => {
    e.preventDefault();
    const clientId = document.getElementById('cfg-client-id').value.trim();
    const clientSecret = document.getElementById('cfg-client-secret').value.trim();

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      showToast('Credentials saved! Initiating Google login...', 'success');
      closeModal('modal-settings');
      setTimeout(handleConnectGoogle, 500);
    } catch (err) {
      showToast('Error saving credentials: ' + err.message, 'error');
    }
  });

  // Copy buttons
  document.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.getAttribute('data-copy'));
      if (target) {
        navigator.clipboard.writeText(target.textContent.trim());
        const original = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = original, 1500);
      }
    });
  });

  const btnCopyMobile = document.getElementById('btn-copy-mobile-url');
  if (btnCopyMobile) {
    btnCopyMobile.addEventListener('click', () => {
      const url = document.getElementById('mobile-url-text').textContent;
      navigator.clipboard.writeText(url);
      btnCopyMobile.textContent = 'Copied!';
      setTimeout(() => btnCopyMobile.textContent = 'Copy URL', 1500);
    });
  }
}

function openModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// URL Params check (OAuth redirect return)
function checkUrlParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('connected') === '1') {
    showToast('🎉 Successfully connected to Google Fit!', 'success');
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (params.get('auth_error')) {
    showToast('Login error: ' + decodeURIComponent(params.get('auth_error')), 'error');
    window.history.replaceState({}, document.title, window.location.pathname);
  }
}
