import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import { getFunctions } from 'firebase/functions';

// Load environment variables from server/.env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '..', '.env') });

const testMode = process.env.FIREBASE_TEST_MODE === 'true';

const projectId = process.env.FIREBASE_PROJECT_ID;
const region = process.env.FIREBASE_REGION;

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
  databaseURL: process.env.FIREBASE_DATABASE_URL,
};

const missing = Object.entries(firebaseConfig)
  .filter(([, value]) => !value)
  .map(([key]) => key);

if (missing.length) {
  if (testMode) {
    console.warn(
      `Running Firebase in test mode. Missing values replaced with placeholders: ${missing.join(', ')}`,
    );
  } else {
    throw new Error(
      `Missing Firebase config values (${missing.join(
        ', ',
      )}). Add your Firebase web keys to environment variables.`,
    );
  }
}

if (!region) {
  throw new Error('Missing FIREBASE_REGION. Add it to environment variables (default us-central1).');
}

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);

// Initialize Realtime Database - getDatabase requires databaseURL in config
if (!firebaseConfig.databaseURL) {
  console.warn('Firebase Realtime Database URL not configured. Please add FIREBASE_DATABASE_URL to your environment variables.');
  console.warn('Expected format: https://PROJECT_ID-default-rtdb.REGION.firebasedatabase.app');
}
export const realtimeDb = getDatabase(app);
export const functions = getFunctions(app, region);

export default app;

