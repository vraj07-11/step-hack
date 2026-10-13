const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, 'config.json');
const TOKENS_PATH = path.join(__dirname, 'tokens.json');
const LOGS_PATH = path.join(__dirname, 'history.json');

// Helper to read JSON file safely
function loadJson(filePath, defaultVal = {}) {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    }
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err.message);
  }
  return defaultVal;
}

// Helper to save JSON file
function saveJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// Load config
function getConfig() {
  const fileConfig = loadJson(CONFIG_PATH, {});
  return {
    clientId: process.env.GOOGLE_CLIENT_ID || fileConfig.clientId || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || fileConfig.clientSecret || '',
    redirectUri: process.env.REDIRECT_URI || fileConfig.redirectUri || `http://localhost:${PORT}/auth/callback`
  };
}

// Scopes required for Google Fit
const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.write',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.location.write',
  'https://www.googleapis.com/auth/fitness.location.read',
  'https://www.googleapis.com/auth/fitness.body.write',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email'
];

// Helper to get OAuth2 client
function getOAuthClient(customRedirect = null) {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret) {
    return null;
  }
  const redirect = customRedirect || config.redirectUri;
  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    redirect
  );

  const tokens = loadJson(TOKENS_PATH, null);
  if (tokens) {
    oauth2Client.setCredentials(tokens);
  }

  // Auto save refreshed tokens
  oauth2Client.on('tokens', (newTokens) => {
    const existing = loadJson(TOKENS_PATH, {});
    const merged = { ...existing, ...newTokens };
    saveJson(TOKENS_PATH, merged);
  });

  return oauth2Client;
}

// Get local IPv4 address for phone access
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const ifaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[ifaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// ---------------------- API ROUTES ----------------------

// 1. Get status: credentials loaded, connection status, user profile
app.get('/api/status', async (req, res) => {
  const config = getConfig();
  const tokens = loadJson(TOKENS_PATH, null);
  const localIp = getLocalIp();

  const status = {
    hasCredentials: !!(config.clientId && config.clientSecret),
    clientId: config.clientId ? `${config.clientId.slice(0, 15)}...` : '',
    redirectUri: config.redirectUri,
    localIp,
    localUrl: `http://${localIp}:${PORT}`,
    isConnected: false,
    user: null
  };

  if (!status.hasCredentials || !tokens) {
    return res.json(status);
  }

  try {
    const oauth2Client = getOAuthClient();
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    status.isConnected = true;
    status.user = {
      name: userInfo.data.name,
      email: userInfo.data.email,
      picture: userInfo.data.picture
    };
  } catch (error) {
    console.error('Failed to get user info:', error.message);
    status.isConnected = false;
    status.error = error.message;
  }

  res.json(status);
});

// 2. Save Google Cloud credentials
app.post('/api/config', (req, res) => {
  const { clientId, clientSecret, redirectUri } = req.body;
  if (!clientId || !clientSecret) {
    return res.status(400).json({ error: 'Client ID and Client Secret are required.' });
  }

  const currentConfig = loadJson(CONFIG_PATH, {});
  const newConfig = {
    ...currentConfig,
    clientId: clientId.trim(),
    clientSecret: clientSecret.trim(),
    redirectUri: redirectUri ? redirectUri.trim() : `http://localhost:${PORT}/auth/callback`
  };
  saveJson(CONFIG_PATH, newConfig);

  res.json({ success: true, message: 'Credentials saved successfully!' });
});

// 3. Generate OAuth Auth URL
app.get('/api/auth/url', (req, res) => {
  const redirectUri = req.query.redirectUri || null;
  const oauth2Client = getOAuthClient(redirectUri);
  if (!oauth2Client) {
    return res.status(400).json({ error: 'Please configure Google Client ID and Secret first.' });
  }

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES
  });

  res.json({ authUrl });
});

// 4. OAuth callback route
app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(error)}`);
  }
  if (!code) {
    return res.redirect('/?auth_error=No+code+provided');
  }

  try {
    const oauth2Client = getOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);
    saveJson(TOKENS_PATH, tokens);
    res.redirect('/?connected=1');
  } catch (err) {
    console.error('OAuth token exchange error:', err);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// 5. Manual token / code exchange endpoint (for convenience on mobile)
app.post('/api/auth/token', async (req, res) => {
  const { code, redirectUri } = req.body;
  if (!code) {
    return res.status(400).json({ error: 'Auth code is required' });
  }

  try {
    const oauth2Client = getOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    saveJson(TOKENS_PATH, tokens);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Disconnect / Logout
app.post('/api/auth/disconnect', (req, res) => {
  if (fs.existsSync(TOKENS_PATH)) {
    fs.unlinkSync(TOKENS_PATH);
  }
  res.json({ success: true, message: 'Disconnected from Google Fit.' });
});

// 7. Get today's total steps directly from Google Fit
app.get('/api/today-steps', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient();
    if (!oauth2Client) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });
    
    // Start and end of today in local time
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = now.getTime();

    const aggregateRes = await fitness.users.dataset.aggregate({
      userId: 'me',
      requestBody: {
        aggregateBy: [{
          dataTypeName: 'com.google.step_count.delta'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: startOfDay,
        endTimeMillis: endOfDay
      }
    });

    let totalSteps = 0;
    const buckets = aggregateRes.data.bucket || [];
    for (const bucket of buckets) {
      for (const dataset of bucket.dataset || []) {
        for (const point of dataset.point || []) {
          for (const val of point.value || []) {
            if (val.intVal) {
              totalSteps += val.intVal;
            }
          }
        }
      }
    }

    res.json({ todaySteps: totalSteps, date: now.toDateString() });
  } catch (err) {
    console.error('Error fetching today steps:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ---------------- CADENCE & REALISTIC SENSOR GENERATOR ----------------

/**
 * Generates realistic walking data points with natural cadence fluctuations.
 * Avoids constant robotic cadence; adds natural walking curves, micro-pauses,
 * and distributes total steps precisely across intervals.
 */
function generateRealisticWalkData({
  totalSteps,
  startTime,
  endTime,
  paceType = 'natural', // natural, brisk, jog, custom
  device = { manufacturer: 'Google', model: 'Pixel 8 Pro' }
}) {
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const durationMs = endMs - startMs;
  const durationMinutes = durationMs / 60000;

  if (durationMinutes <= 0) {
    throw new Error('End time must be after start time.');
  }
  if (totalSteps <= 0) {
    throw new Error('Steps must be greater than 0.');
  }

  // Interval resolution: 30 seconds chunks for realistic sensor updates
  const intervalSeconds = 30;
  const totalIntervals = Math.max(1, Math.round((durationMs / 1000) / intervalSeconds));
  
  // Base average steps per interval
  const baseStepsPerInterval = totalSteps / totalIntervals;

  // Generate realistic weights using smooth random walk + micro pauses
  const weights = [];
  let currentMomentum = 1.0;

  for (let i = 0; i < totalIntervals; i++) {
    const progress = i / totalIntervals;

    // Warm-up factor: start slightly slower in the first 5%
    let warmUpFactor = 1.0;
    if (progress < 0.05) {
      warmUpFactor = 0.7 + (progress / 0.05) * 0.3;
    }
    // Cool-down factor: taper slightly in the last 5%
    let coolDownFactor = 1.0;
    if (progress > 0.95) {
      coolDownFactor = 0.8 + (1 - (progress - 0.95) / 0.05) * 0.2;
    }

    // Natural variation with momentum
    const jitter = (Math.random() - 0.5) * 0.2; // +/- 10%
    currentMomentum = Math.max(0.7, Math.min(1.3, currentMomentum + jitter));

    // Occasional simulated brief pause (like waiting at a pedestrian crosswalk ~3% chance)
    const isPause = totalIntervals > 10 && Math.random() < 0.03 && progress > 0.1 && progress < 0.9;
    const pauseFactor = isPause ? 0.15 : 1.0;

    const intervalWeight = currentMomentum * warmUpFactor * coolDownFactor * pauseFactor;
    weights.push(intervalWeight);
  }

  // Normalize weights to strictly equal totalSteps
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedSteps = weights.map(w => Math.floor((w / totalWeight) * totalSteps));

  // Distribute remainder so the sum exactly matches totalSteps
  let allocatedSteps = normalizedSteps.reduce((a, b) => a + b, 0);
  let remainder = totalSteps - allocatedSteps;
  let idx = 0;
  while (remainder > 0) {
    normalizedSteps[idx % totalIntervals]++;
    remainder--;
    idx++;
  }

  // Stride length and calories based on pace
  let strideMeters = 0.74; // standard adult walk
  let calPerStep = 0.042; // standard walk calories
  if (paceType === 'brisk') {
    strideMeters = 0.78;
    calPerStep = 0.046;
  } else if (paceType === 'jog') {
    strideMeters = 0.86;
    calPerStep = 0.055;
  }

  const intervalMs = Math.floor(durationMs / totalIntervals);
  const stepPoints = [];
  const distancePoints = [];
  const caloriePoints = [];
  const previewPoints = [];

  for (let i = 0; i < totalIntervals; i++) {
    const chunkStartMs = startMs + (i * intervalMs);
    const chunkEndMs = (i === totalIntervals - 1) ? endMs : startMs + ((i + 1) * intervalMs);
    
    // Convert to BigInt nanoseconds strings
    const startNanos = (BigInt(chunkStartMs) * 1000000n).toString();
    const endNanos = (BigInt(chunkEndMs) * 1000000n).toString();

    const steps = normalizedSteps[i];
    const distanceMeters = parseFloat((steps * strideMeters).toFixed(2));
    const calories = parseFloat((steps * calPerStep).toFixed(3));

    // Step delta point
    stepPoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.step_count.delta',
      value: [{ intVal: steps }]
    });

    // Distance delta point
    distancePoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.distance.delta',
      value: [{ fpVal: distanceMeters }]
    });

    // Calories point
    caloriePoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.calories.expended',
      value: [{ fpVal: calories }]
    });

    // Timeline chart point for preview UI
    previewPoints.push({
      time: new Date(chunkStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      steps,
      distanceMeters,
      calories,
      spm: Math.round(steps * (60 / (intervalSeconds))) // Steps Per Minute cadence
    });
  }

  // Walking activity segment covering the entire duration (type 7 = walking)
  const minStartNanos = (BigInt(startMs) * 1000000n).toString();
  const maxEndNanos = (BigInt(endMs) * 1000000n).toString();

  const activityPoint = {
    startTimeNanos: minStartNanos,
    endTimeNanos: maxEndNanos,
    dataTypeName: 'com.google.activity.segment',
    value: [{ intVal: 7 }] // 7 = Walking
  };

  const totalDistanceKm = parseFloat((totalSteps * strideMeters / 1000).toFixed(2));
  const totalCaloriesKcal = Math.round(totalSteps * calPerStep);
  const avgCadence = Math.round(totalSteps / durationMinutes);

  return {
    meta: {
      totalSteps,
      totalDistanceKm,
      totalCaloriesKcal,
      avgCadence,
      durationMinutes: Math.round(durationMinutes),
      minStartNanos,
      maxEndNanos,
      startMs,
      endMs,
      device
    },
    stepPoints,
    distancePoints,
    caloriePoints,
    activityPoint,
    previewPoints
  };
}

// 8. Preview Cadence & Time-based Steps (without writing to Google Fit)
app.post('/api/preview', (req, res) => {
  try {
    const { totalSteps, startTime, endTime, paceType, device } = req.body;
    const walkData = generateRealisticWalkData({
      totalSteps: parseInt(totalSteps, 10),
      startTime,
      endTime,
      paceType,
      device
    });

    res.json({
      meta: walkData.meta,
      previewPoints: walkData.previewPoints
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Helper: Ensure or create raw phone sensor data sources
async function getOrCreateDataSource(fitness, { typeName, streamName, valueFormat, device }) {
  const fieldFormat = valueFormat === 'integer' ? 'integer' : 'floatPoint';
  const fieldName = typeName === 'com.google.step_count.delta' ? 'steps'
    : typeName === 'com.google.distance.delta' ? 'distance'
    : typeName === 'com.google.calories.expended' ? 'calories'
    : 'activity';

  const dataSourcePayload = {
    dataStreamName: streamName,
    type: 'raw', // RAW indicates direct hardware sensor stream
    application: {
      name: 'StepHack Mobile Device Sensor',
      version: '1.0'
    },
    dataType: {
      name: typeName,
      field: [{ name: fieldName, format: fieldFormat }]
    },
    device: {
      uid: 'stephack-sensor-hw-01',
      type: 'phone',
      manufacturer: device?.manufacturer || 'Google',
      model: device?.model || 'Pixel 8 Pro',
      version: '1.0'
    }
  };

  try {
    const createRes = await fitness.users.dataSources.create({
      userId: 'me',
      requestBody: dataSourcePayload
    });
    return createRes.data.dataStreamId;
  } catch (err) {
    // If it already exists or returns 409 conflict, list dataSources to find it
    if (err.code === 409 || err.message?.includes('already exists')) {
      const listRes = await fitness.users.dataSources.list({ userId: 'me' });
      const found = (listRes.data.dataSource || []).find(
        ds => ds.dataType?.name === typeName && ds.dataStreamName === streamName
      );
      if (found) return found.dataStreamId;
    }
    throw err;
  }
}

// 9. Sync Steps directly to Google Fit
app.post('/api/sync', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient();
    if (!oauth2Client) {
      return res.status(401).json({ error: 'Google Fit is not connected. Please connect first.' });
    }

    const { totalSteps, startTime, endTime, paceType, device } = req.body;
    const walkData = generateRealisticWalkData({
      totalSteps: parseInt(totalSteps, 10),
      startTime,
      endTime,
      paceType,
      device
    });

    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });
    const { minStartNanos, maxEndNanos } = walkData.meta;
    const datasetId = `${minStartNanos}-${maxEndNanos}`;

    // 1. Step Count Delta Data Source
    const stepStreamId = await getOrCreateDataSource(fitness, {
      typeName: 'com.google.step_count.delta',
      streamName: 'StepHackPhoneStepSensor',
      valueFormat: 'integer',
      device: walkData.meta.device
    });

    // Patch step dataset
    await fitness.users.dataSources.datasets.patch({
      userId: 'me',
      dataSourceId: stepStreamId,
      datasetId,
      requestBody: {
        dataSourceId: stepStreamId,
        minStartTimeNs: minStartNanos,
        maxEndTimeNs: maxEndNanos,
        point: walkData.stepPoints
      }
    });

    // 2. Distance Delta Data Source
    const distStreamId = await getOrCreateDataSource(fitness, {
      typeName: 'com.google.distance.delta',
      streamName: 'StepHackPhoneDistanceSensor',
      valueFormat: 'floatPoint',
      device: walkData.meta.device
    });

    await fitness.users.dataSources.datasets.patch({
      userId: 'me',
      dataSourceId: distStreamId,
      datasetId,
      requestBody: {
        dataSourceId: distStreamId,
        minStartTimeNs: minStartNanos,
        maxEndTimeNs: maxEndNanos,
        point: walkData.distancePoints
      }
    });

    // 3. Calories Expended Data Source
    const calStreamId = await getOrCreateDataSource(fitness, {
      typeName: 'com.google.calories.expended',
      streamName: 'StepHackPhoneCalorieSensor',
      valueFormat: 'floatPoint',
      device: walkData.meta.device
    });

    await fitness.users.dataSources.datasets.patch({
      userId: 'me',
      dataSourceId: calStreamId,
      datasetId,
      requestBody: {
        dataSourceId: calStreamId,
        minStartTimeNs: minStartNanos,
        maxEndTimeNs: maxEndNanos,
        point: walkData.caloriePoints
      }
    });

    // 4. Activity Segment (Walking = 7)
    const actStreamId = await getOrCreateDataSource(fitness, {
      typeName: 'com.google.activity.segment',
      streamName: 'StepHackActivitySegment',
      valueFormat: 'integer',
      device: walkData.meta.device
    });

    await fitness.users.dataSources.datasets.patch({
      userId: 'me',
      dataSourceId: actStreamId,
      datasetId,
      requestBody: {
        dataSourceId: actStreamId,
        minStartTimeNs: minStartNanos,
        maxEndTimeNs: maxEndNanos,
        point: [walkData.activityPoint]
      }
    });

    // Record in history log
    const history = loadJson(LOGS_PATH, []);
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      steps: walkData.meta.totalSteps,
      distanceKm: walkData.meta.totalDistanceKm,
      caloriesKcal: walkData.meta.totalCaloriesKcal,
      durationMinutes: walkData.meta.durationMinutes,
      startTime,
      endTime,
      device: `${walkData.meta.device.manufacturer} ${walkData.meta.device.model}`
    };
    history.unshift(logEntry);
    // Keep last 30 logs
    saveJson(LOGS_PATH, history.slice(0, 30));

    res.json({
      success: true,
      message: `Successfully logged ${walkData.meta.totalSteps.toLocaleString()} steps to Google Fit!`,
      summary: logEntry
    });
  } catch (err) {
    console.error('Error syncing to Google Fit:', err);
    res.status(500).json({
      error: err.message,
      details: err.response?.data || null
    });
  }
});

// 10. History route
app.get('/api/history', (req, res) => {
  const history = loadJson(LOGS_PATH, []);
  res.json({ history });
});

// 11. QR Code route for mobile quick-open
app.get('/api/qrcode', async (req, res) => {
  const localIp = getLocalIp();
  const url = `http://${localIp}:${PORT}`;
  try {
    const dataUrl = await qrcode.toDataURL(url, { margin: 1, width: 250 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  const localIp = getLocalIp();
  console.log(`\n======================================================`);
  console.log(`🚀 Step Hack Server is live!`);
  console.log(`💻 Desktop:  http://localhost:${PORT}`);
  console.log(`📱 Android:  http://${localIp}:${PORT}`);
  console.log(`======================================================\n`);
  try {
    const qrTerminal = await qrcode.toString(`http://${localIp}:${PORT}`, { type: 'terminal', small: true });
    console.log(`Scan with your Android phone camera to open directly:`);
    console.log(qrTerminal);
  } catch (e) {
    // ignore
  }
});
