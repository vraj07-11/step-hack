# 👟 StepHack — Realistic Google Fit Step Logger

A mobile-first web app designed for Android and desktop that logs walking steps directly into **Google Fit** as **raw hardware sensor data** (`com.google.step_count.delta` on `device: phone`), complete with time-distributed cadence, calculated distance (`com.google.distance.delta`), calories burned (`com.google.calories.expended`), and active walking sessions (`com.google.activity.segment`).

---

## 💡 Why This Counts as "Real" Phone Steps
When you manually add an activity in Google Fit or 3rd party apps, Google flags it as a *manual entry* or a single lump sum. Many fitness rewards, insurance programs, and sync engines (e.g. Adventure Sync) ignore manual entries.

**StepHack avoids this by:**
1. **Raw Sensor Stream**: Registers data under `type: "raw"` and `device.type: "phone"` (emulating Google Pixel, Samsung Galaxy, OnePlus, etc.).
2. **Time-Distributed Micro-Intervals**: Breaks your walk into **30-second cadence chunks** with natural human momentum, warmup, cooldown, and micro-pauses (e.g., stopping for pedestrian lights).
3. **Synchronized Metrics**: Simultaneously writes matching **distance (meters)**, **calories (kcal)**, and **activity segment (Walking: type 7)** over the exact timeline.

---

## 📋 Manual Setup Task (Takes ~2 Minutes)
To allow StepHack to communicate with your Google Fit account, Google requires you to create your own free OAuth 2.0 Client credentials in Google Cloud Console.

### Step 1: Open Google Cloud Console
1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Click the project dropdown at the top and select **New Project**.
3. Name it **StepHack** and click **Create**.

### Step 2: Enable the Fitness API
1. In the left menu, go to **APIs & Services** &rarr; **Library**.
2. Search for **Fitness API**.
3. Click on **Fitness API** and click **Enable**.

### Step 3: Configure OAuth Consent Screen
1. In the left menu, go to **APIs & Services** &rarr; **OAuth consent screen**.
2. Choose **External** and click **Create**.
3. App information:
   - App name: `StepHack`
   - User support email: `Your Gmail`
   - Developer contact email: `Your Gmail`
4. Click **Save and Continue** until you reach **Test users**.
5. Under **Test users**, click **+ ADD USERS** and add your own Google email address.
6. Click **Save and Continue**.

### Step 4: Create OAuth 2.0 Credentials
1. In the left menu, go to **APIs & Services** &rarr; **Credentials**.
2. Click **+ CREATE CREDENTIALS** &rarr; **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `StepHack Web Client`.
5. Under **Authorized redirect URIs**, click **+ ADD URI** and add:
   - `http://localhost:3000/auth/callback`
   - `http://<your-computer-ip>:3000/auth/callback` (e.g. `http://10.113.48.52:3000/auth/callback`)
6. Click **Create**.
7. Copy your **Client ID** and **Client Secret**.

### Step 5: Save Credentials in StepHack
1. Open StepHack in your browser (`http://localhost:3000` or on your phone).
2. Click the ⚙️ **Settings** gear icon in the top right.
3. Paste your **Client ID** and **Client Secret**.
4. Click **Save Credentials**.
5. Click **Connect Google Fit** to log in and authorize step writing!

---

## 📱 How to Use on Your Android Phone
1. Ensure your Android phone is on the same Wi-Fi network as your computer.
2. Open StepHack on your computer, click the **QR code icon** in the top header.
3. Scan the QR code with your Android phone's camera, or type:
   ```
   http://<your-local-ip>:3000
   ```
4. **Add to Home screen**: In Chrome on Android, tap the three dots &rarr; **Add to Home screen** to use it like a native Android app!

---

## Running the App
To start the server at any time:
```bash
npm start
```
The server will print the URLs and terminal QR code.
