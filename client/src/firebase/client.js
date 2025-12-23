import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getFunctions } from 'firebase/functions';

// Get API base URL from environment variable
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

console.log('🔥 Firebase client: API_BASE_URL =', API_BASE_URL);

// Fetch Firebase config from backend server with timeout and retry
async function fetchFirebaseConfig() {
  if (!API_BASE_URL) {
    throw new Error('VITE_API_BASE_URL is not set in environment variables');
  }

  const url = `${API_BASE_URL}/api/firebase-config`;
  console.log('🔥 Fetching Firebase config from:', url);

  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Firebase config response error:', response.status, errorText);
      throw new Error(`Failed to fetch Firebase config: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('✅ Firebase config fetched successfully');
    return data.config;
  } catch (error) {
    console.error('❌ Error fetching Firebase config from server:', error);
    throw new Error(`Failed to load Firebase configuration: ${error.message}`);
  }
}

// Initialize Firebase - check env vars FIRST (faster, no network delay)
// Only fetch from server if env vars are not available
const envConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  region: import.meta.env.VITE_FIREBASE_REGION || 'us-central1',
};

const hasEnvConfig = Object.values(envConfig).filter(v => v && v !== 'us-central1').length >= 5; // At least 5 required fields

let firebaseConfig;

if (hasEnvConfig) {
  // Use env vars immediately - no network delay!
  console.log('✅ Using Firebase config from environment variables (fast path)');
  firebaseConfig = envConfig;
  } else {
    // No env vars, fetch from server (slower)
    console.log('⚠️ No env vars found, fetching Firebase config from server...');
    try {
      firebaseConfig = await fetchFirebaseConfig();
      console.log('✅ Firebase config fetched from server successfully');
    } catch (error) {
      console.error('❌ Failed to fetch Firebase config from server:', error);
      console.error('❌ CRITICAL: No Firebase config available (server fetch failed AND no env vars)');
      
      // Show error immediately - use setTimeout to ensure DOM is ready
      const showError = () => {
        const root = document.getElementById('root');
        if (root) {
          // Clear any existing content
          root.innerHTML = '';
          root.innerHTML = `
          <div style="padding: 20px; color: red; background: white; min-height: 100vh; font-family: system-ui, sans-serif;">
            <h1 style="margin-top: 0;">Firebase Configuration Error</h1>
            <p><strong>${error.message}</strong></p>
            <p>API URL: ${API_BASE_URL || 'NOT SET'}</p>
            <div style="margin-top: 20px; font-size: 12px; line-height: 1.6;">
              <p><strong>Please check:</strong></p>
              <ol style="margin: 10px 0; padding-left: 20px;">
                <li>Server is running and accessible</li>
                <li>VITE_API_BASE_URL is correct (not localhost on mobile!)</li>
                <li>Network connection is working</li>
                <li>CORS is configured on server</li>
              </ol>
              <p style="margin-top: 15px;"><strong>OR</strong> set VITE_FIREBASE_* environment variables in client/.env file</p>
            </div>
            <button onclick="window.location.reload()" style="margin-top: 20px; padding: 10px 20px; background: #000; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px;">
              Retry
            </button>
          </div>
        `;
        }
      };
      
      // Try immediately, and also after a short delay in case DOM isn't ready
      showError();
      setTimeout(showError, 100);
      
      // Still throw to prevent Firebase initialization with invalid config
      throw new Error(`Firebase configuration failed: ${error.message}. Please set VITE_FIREBASE_* environment variables or ensure server is accessible.`);
    }
  }

const region = firebaseConfig.region || 'us-central1';

// Check for missing required values
const missing = Object.entries(firebaseConfig)
  .filter(([key, value]) => key !== 'region' && !value)
  .map(([key]) => key);

if (missing.length) {
  throw new Error(
    `Missing Firebase config values (${missing.join(
      ', ',
    )}). Please configure them in the server environment variables.`,
  );
}

// Initialize Firebase app
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

// Initialize services - same as before, just using config from server
export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize Realtime Database - getDatabase requires databaseURL in config
if (!firebaseConfig.databaseURL) {
  console.warn('Firebase Realtime Database URL not configured. Please add FIREBASE_DATABASE_URL to server environment variables.');
  console.warn('Expected format: https://PROJECT_ID-default-rtdb.REGION.firebasedatabase.app');
}
export const realtimeDb = getDatabase(app);
export const functions = getFunctions(app, region);

export default app;


