const express = require('express');
const { google } = require('googleapis');
const cookieSession = require('cookie-session');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const qrcode = require('qrcode');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production' || !!process.env.RENDER;

// Trust reverse proxies (Render, Cloudflare, etc.) for correct IP resolution in rate limiting
app.set('trust proxy', 1);

// 1. Security Headers (Helmet)
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: [
          "'self'",
          'data:',
          'https://*.googleusercontent.com',
          'https://lh3.googleusercontent.com'
        ],
        connectSrc: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

// 2. Cookie Session for Multi-User Privacy & Stateless Scalability
app.use(
  cookieSession({
    name: '__stephack_session',
    keys: [process.env.SESSION_SECRET || 'stephack-secret-salt-2026-auth-prod'],
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true, // Prevents client-side script access
    secure: isProd, // True on HTTPS production
    sameSite: 'lax'
  })
);

const compression = require('compression');
app.use(compression());

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '1d' : '1h',
  etag: true,
  lastModified: true
}));

// 3. Rate Limiters
// General API limiter: 120 requests per minute
const generalLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please wait a moment.' }
});

// Sync limiter: max 20 step syncs per 10 minutes per IP/session
const syncLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded: maximum 20 syncs per 10 minutes to protect Google Fit quota.' }
});

// Auth URL limiter: max 15 attempts per 5 minutes
const authLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait 5 minutes.' }
});

app.use('/api/', generalLimiter);
app.use('/api/sync', syncLimiter);
app.use('/api/auth/', authLimiter);

const CONFIG_PATH = path.join(__dirname, 'config.json');

// Helper to read JSON safely
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

// Load server config
function getConfig() {
  const fileConfig = loadJson(CONFIG_PATH, {});
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || fileConfig.clientId || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || fileConfig.clientSecret || '').trim(),
    redirectUri: (process.env.REDIRECT_URI || fileConfig.redirectUri || `http://localhost:${PORT}/auth/callback`).trim()
  };
}

// Scopes required for Google Fit & User Profile
const SCOPES = [
  'https://www.googleapis.com/auth/fitness.activity.write',
  'https://www.googleapis.com/auth/fitness.activity.read',
  'https://www.googleapis.com/auth/fitness.location.write',
  'https://www.googleapis.com/auth/fitness.location.read',
  'https://www.googleapis.com/auth/fitness.body.write',
  'https://www.googleapis.com/auth/fitness.body.read',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'openid'
];

// Helper to decode OpenID Connect id_token without extra network requests
function decodeIdToken(idToken) {
  try {
    if (!idToken || typeof idToken !== 'string') return null;
    const parts = idToken.split('.');
    if (parts.length < 2) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    return {
      name: payload.name || payload.given_name || payload.email?.split('@')[0] || 'User',
      email: payload.email || '',
      picture: payload.picture || ''
    };
  } catch {
    return null;
  }
}

// Helper to get OAuth2 client for a specific user request
function getOAuthClient(req = null) {
  const config = getConfig();
  if (!config.clientId || !config.clientSecret) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri
  );

  // If user has a session with tokens, attach them
  if (req && req.session && req.session.tokens) {
    oauth2Client.setCredentials(req.session.tokens);

    // Auto-update session when tokens refresh
    oauth2Client.on('tokens', (newTokens) => {
      req.session.tokens = { ...req.session.tokens, ...newTokens };
    });
  }

  return oauth2Client;
}

// Get local IPv4 address
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

// ---------------------- INPUT SANITIZATION ----------------------

function validateWalkInput({ totalSteps, startTime, endTime, paceType, device }) {
  const parsedSteps = parseInt(totalSteps, 10);
  if (isNaN(parsedSteps) || parsedSteps < 10 || parsedSteps > 100000) {
    throw new Error('Steps must be between 10 and 100,000 steps.');
  }

  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();

  if (isNaN(startMs) || isNaN(endMs)) {
    throw new Error('Invalid start or end time format.');
  }

  const durationMs = endMs - startMs;
  if (durationMs < 60000) {
    throw new Error('Walk duration must be at least 1 minute.');
  }

  if (durationMs > 24 * 60 * 60 * 1000) {
    throw new Error('Walk duration cannot exceed 24 hours in a single session.');
  }

  const now = Date.now();
  // Allow up to 10 minutes in the future for clock skew
  if (endMs > now + 10 * 60 * 1000) {
    throw new Error('End time cannot be in the future.');
  }

  // Do not allow walks older than 35 days (Google Fit limit)
  if (startMs < now - 35 * 24 * 60 * 60 * 1000) {
    throw new Error('Start time cannot be older than 30 days.');
  }

  const validPaces = ['natural', 'brisk', 'jog'];
  const sanitizedPace = validPaces.includes(paceType) ? paceType : 'natural';

  const sanitizedDevice = {
    manufacturer: String(device?.manufacturer || 'Google').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) || 'Google',
    model: String(device?.model || 'Pixel 8 Pro').replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 30) || 'Pixel 8 Pro'
  };

  return {
    totalSteps: parsedSteps,
    startMs,
    endMs,
    durationMs,
    paceType: sanitizedPace,
    device: sanitizedDevice
  };
}

// Lightweight health / keep-alive ping route (for UptimeRobot / cron bots)
app.get('/health', (req, res) => {
  res.status(200).send('OK');
});

// 1. Status route: Returns user session info without leaking secrets
app.get('/api/status', async (req, res) => {
  const config = getConfig();
  const localIp = getLocalIp();

  const status = {
    hasCredentials: !!(config.clientId && config.clientSecret),
    serverConfigured: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    redirectUri: config.redirectUri,
    localIp,
    localUrl: `http://${localIp}:${PORT}`,
    isConnected: false,
    user: req.session?.user || null
  };

  if (!status.hasCredentials || !req.session || !req.session.tokens) {
    return res.json(status);
  }

  status.isConnected = true;

  // If user profile is not cached in session, attempt to fetch it once safely
  if (!status.user) {
    try {
      const oauth2Client = getOAuthClient(req);
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfo = await oauth2.userinfo.get();
      status.user = {
        name: userInfo.data.name || userInfo.data.email?.split('@')[0] || 'User',
        email: userInfo.data.email || '',
        picture: userInfo.data.picture || ''
      };
      req.session.user = status.user;
    } catch (error) {
      console.warn('[Status] UserInfo API call warning:', error.message);
      // Fallback profile so user remains connected even if Google OAuth2 API is disabled in GCP
      status.user = {
        name: 'Google Fit User',
        email: '',
        picture: ''
      };
      req.session.user = status.user;
    }
  }

  res.json(status);
});

// 2. Generate Auth URL with Cryptographic CSRF State
app.get('/api/auth/url', (req, res) => {
  const oauth2Client = getOAuthClient(req);
  if (!oauth2Client) {
    return res.status(400).json({ error: 'OAuth credentials not configured on the server.' });
  }

  // Generate secure random state token to prevent CSRF attacks
  const stateToken = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = stateToken;

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
    state: stateToken
  });

  res.json({ authUrl });
});

// 3. OAuth Callback Handler with CSRF State Verification
app.get('/auth/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error) {
    return res.redirect(`/?auth_error=${encodeURIComponent(String(error))}`);
  }

  // Verify CSRF state token
  if (!state || !req.session || state !== req.session.oauthState) {
    return res.redirect('/?auth_error=Security+check+failed+(CSRF+State+Mismatch)');
  }
  // Clear state after single use
  req.session.oauthState = null;

  if (!code) {
    return res.redirect('/?auth_error=No+authorization+code+provided');
  }

  try {
    const oauth2Client = getOAuthClient(req);
    const { tokens } = await oauth2Client.getToken(String(code));
    
    // Store only lean tokens to prevent exceeding browser 4KB cookie limit
    req.session.tokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date
    };

    // Decode user profile directly from id_token (no extra network roundtrip)
    const profile = decodeIdToken(tokens.id_token);
    if (profile) {
      req.session.user = profile;
    }

    res.redirect('/?connected=1');
  } catch (err) {
    console.error('OAuth token exchange error:', err.message);
    res.redirect(`/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// 4. Logout / Disconnect (clears session cookie)
app.post('/api/auth/disconnect', (req, res) => {
  req.session = null;
  res.json({ success: true, message: 'Disconnected successfully.' });
});

// 5. Today's steps for logged-in user
app.get('/api/today-steps', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    if (!oauth2Client || !req.session?.tokens) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });
    
    // Support client-passed local start/end times if provided, else fallback to server local day
    const clientStart = parseInt(req.query.startMs, 10);
    const clientEnd = parseInt(req.query.endMs, 10);

    const now = new Date();
    const startOfDay = !isNaN(clientStart) ? clientStart : new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = !isNaN(clientEnd) ? clientEnd : (startOfDay + 86400000 - 1);

    let totalSteps = 0;
    let totalDistanceMeters = 0;
    let totalCalories = 0;

    // Helper to query aggregate safely with metric isolation so missing permissions don't break step count
    const fetchAggregateMetric = async (aggregateByItem) => {
      try {
        const result = await fitness.users.dataset.aggregate({
          userId: 'me',
          requestBody: {
            aggregateBy: [aggregateByItem],
            bucketByTime: { durationMillis: 86400000 },
            startTimeMillis: startOfDay,
            endTimeMillis: Math.max(endOfDay, startOfDay + 1000)
          }
        });
        return result.data;
      } catch (err) {
        console.warn(`[Fit API] Aggregate failed for ${aggregateByItem.dataTypeName || aggregateByItem.dataSourceId}:`, err.message);
        return null;
      }
    };

    // Helper to safely extract total sum from Google Fit aggregate buckets
    const extractMetricSum = (data, metricKey = 'intVal') => {
      let sum = 0;
      if (!data?.bucket) return sum;
      for (const bucket of data.bucket) {
        for (const dataset of bucket.dataset || []) {
          for (const point of dataset.point || []) {
            for (const val of point.value || []) {
              if (metricKey === 'intVal') {
                if (typeof val.intVal === 'number') sum += val.intVal;
                else if (typeof val.fpVal === 'number') sum += Math.round(val.fpVal);
              } else if (metricKey === 'fpVal') {
                if (typeof val.fpVal === 'number') sum += val.fpVal;
                else if (typeof val.intVal === 'number') sum += val.intVal;
              }
            }
          }
        }
      }
      return sum;
    };

    // 1. Fetch generic step count (covers all step providers, phones, wearables, and StepHack sensors)
    let stepsData = await fetchAggregateMetric({
      dataTypeName: 'com.google.step_count.delta'
    });
    totalSteps = extractMetricSum(stepsData, 'intVal');

    // If generic count returned 0, check Google Fit app's estimated_steps stream
    if (totalSteps === 0) {
      const estimatedData = await fetchAggregateMetric({
        dataTypeName: 'com.google.step_count.delta',
        dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps'
      });
      totalSteps = Math.max(totalSteps, extractMetricSum(estimatedData, 'intVal'));
    }

    // If still 0, check merged step deltas stream
    if (totalSteps === 0) {
      const mergedData = await fetchAggregateMetric({
        dataTypeName: 'com.google.step_count.delta',
        dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:merge_step_deltas'
      });
      totalSteps = Math.max(totalSteps, extractMetricSum(mergedData, 'intVal'));
    }

    // 2. Fetch Distance
    const distData = await fetchAggregateMetric({
      dataTypeName: 'com.google.distance.delta'
    });
    totalDistanceMeters = extractMetricSum(distData, 'fpVal');

    // 3. Fetch Calories
    const calData = await fetchAggregateMetric({
      dataTypeName: 'com.google.calories.expended'
    });
    totalCalories = extractMetricSum(calData, 'fpVal');

    // Also include steps logged in current user session today if Google cloud hasn't aggregated yet
    const sessionHistory = req.session?.history || [];
    const sessionStepsToday = sessionHistory.reduce((acc, item) => {
      const itemTime = new Date(item.timestamp).getTime();
      return (itemTime >= startOfDay && itemTime <= endOfDay) ? acc + (item.steps || 0) : acc;
    }, 0);

    if (sessionStepsToday > totalSteps) {
      totalSteps = sessionStepsToday;
    }

    const totalDistanceKm = totalDistanceMeters > 0
      ? parseFloat((totalDistanceMeters / 1000).toFixed(2))
      : parseFloat((totalSteps * 0.74 / 1000).toFixed(2));

    const totalCaloriesKcal = totalCalories > 0
      ? Math.round(totalCalories)
      : Math.round(totalSteps * 0.042);

    res.json({
      todaySteps: totalSteps,
      todayDistanceKm,
      todayCaloriesKcal,
      lastUpdated: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  } catch (err) {
    console.error('Failed to fetch today steps:', err.message);
    res.status(500).json({ error: 'Failed to fetch today steps' });
  }
});

// ---------------- CADENCE & REALISTIC SENSOR GENERATOR ----------------

function generateRealisticWalkData(validated) {
  const { totalSteps, startMs, endMs, durationMs, paceType, device } = validated;
  const durationMinutes = durationMs / 60000;

  const intervalSeconds = 30;
  const totalIntervals = Math.max(1, Math.round((durationMs / 1000) / intervalSeconds));
  
  const weights = [];
  let currentMomentum = 1.0;

  for (let i = 0; i < totalIntervals; i++) {
    const progress = i / totalIntervals;

    // Warm-up factor
    let warmUpFactor = 1.0;
    if (progress < 0.05) {
      warmUpFactor = 0.7 + (progress / 0.05) * 0.3;
    }
    // Cool-down factor
    let coolDownFactor = 1.0;
    if (progress > 0.95) {
      coolDownFactor = 0.8 + (1 - (progress - 0.95) / 0.05) * 0.2;
    }

    const jitter = (Math.random() - 0.5) * 0.2;
    currentMomentum = Math.max(0.7, Math.min(1.3, currentMomentum + jitter));

    const isPause = totalIntervals > 10 && Math.random() < 0.03 && progress > 0.1 && progress < 0.9;
    const pauseFactor = isPause ? 0.15 : 1.0;

    weights.push(currentMomentum * warmUpFactor * coolDownFactor * pauseFactor);
  }

  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const normalizedSteps = weights.map(w => Math.floor((w / totalWeight) * totalSteps));

  let allocatedSteps = normalizedSteps.reduce((a, b) => a + b, 0);
  let remainder = totalSteps - allocatedSteps;
  let idx = 0;
  while (remainder > 0) {
    normalizedSteps[idx % totalIntervals]++;
    remainder--;
    idx++;
  }

  let strideMeters = 0.74;
  let calPerStep = 0.042;
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
    
    const startNanos = (BigInt(chunkStartMs) * 1000000n).toString();
    const endNanos = (BigInt(chunkEndMs) * 1000000n).toString();

    const steps = normalizedSteps[i];
    const distanceMeters = parseFloat((steps * strideMeters).toFixed(2));
    const calories = parseFloat((steps * calPerStep).toFixed(3));

    stepPoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.step_count.delta',
      value: [{ intVal: steps }]
    });

    distancePoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.distance.delta',
      value: [{ fpVal: distanceMeters }]
    });

    caloriePoints.push({
      startTimeNanos: startNanos,
      endTimeNanos: endNanos,
      dataTypeName: 'com.google.calories.expended',
      value: [{ fpVal: calories }]
    });

    previewPoints.push({
      time: new Date(chunkStartMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      steps,
      distanceMeters,
      calories,
      spm: Math.round(steps * (60 / intervalSeconds))
    });
  }

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

// 6. Preview Route
app.post('/api/preview', (req, res) => {
  try {
    const validated = validateWalkInput(req.body);
    const walkData = generateRealisticWalkData(validated);

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
    type: 'raw',
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

// 7. Sync Steps to Google Fit
app.post('/api/sync', async (req, res) => {
  try {
    const oauth2Client = getOAuthClient(req);
    if (!oauth2Client || !req.session?.tokens) {
      return res.status(401).json({ error: 'Please sign in with Google first.' });
    }

    const validated = validateWalkInput(req.body);
    const walkData = generateRealisticWalkData(validated);

    const fitness = google.fitness({ version: 'v1', auth: oauth2Client });
    const { minStartNanos, maxEndNanos } = walkData.meta;
    const datasetId = `${minStartNanos}-${maxEndNanos}`;

    // 1. Step Count Delta
    const stepStreamId = await getOrCreateDataSource(fitness, {
      typeName: 'com.google.step_count.delta',
      streamName: 'StepHackPhoneStepSensor',
      valueFormat: 'integer',
      device: walkData.meta.device
    });

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

    // 2. Distance Delta
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

    // 3. Calories Expended
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

    // Save session-private history
    if (!req.session.history) req.session.history = [];
    const logEntry = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      steps: walkData.meta.totalSteps,
      distanceKm: walkData.meta.totalDistanceKm,
      caloriesKcal: walkData.meta.totalCaloriesKcal,
      durationMinutes: walkData.meta.durationMinutes,
      startTime: req.body.startTime,
      endTime: req.body.endTime,
      device: `${walkData.meta.device.manufacturer} ${walkData.meta.device.model}`
    };
    req.session.history.unshift(logEntry);
    req.session.history = req.session.history.slice(0, 5);

    res.json({
      success: true,
      message: `Successfully logged ${walkData.meta.totalSteps.toLocaleString()} steps to Google Fit!`,
      summary: logEntry
    });
  } catch (err) {
    console.error('Error syncing to Google Fit:', err.message);
    res.status(500).json({
      error: err.message || 'Failed to sync to Google Fit'
    });
  }
});

// 8. Session-private history routes
app.get('/api/history', (req, res) => {
  const history = req.session?.history || [];
  res.json({ history });
});

app.post('/api/history/clear', (req, res) => {
  if (req.session) {
    req.session.history = [];
  }
  res.json({ success: true });
});

// 9. QR Code route
app.get('/api/qrcode', async (req, res) => {
  const localIp = getLocalIp();
  const url = isProd ? (process.env.REDIRECT_URI ? process.env.REDIRECT_URI.replace('/auth/callback', '') : `http://${localIp}:${PORT}`) : `http://${localIp}:${PORT}`;
  try {
    const dataUrl = await qrcode.toDataURL(url, { margin: 1, width: 250 });
    res.json({ url, dataUrl });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 StepHack Secure Server running on port ${PORT} [Production: ${isProd}]`);
});
