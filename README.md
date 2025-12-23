## Firebase Telegram Mini App

This repo contains a minimal black-and-white Telegram mini app UI (React + Vite) plus Firebase Cloud Functions.

### Quick start

```bash
cd client
npm install
npm run dev
```

Set these Vite env vars in `client/.env`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_REGION=us-central1
```

### Firebase setup

1. Configure `.firebaserc` with your project ID.
2. Install function deps:

   ```bash
   cd functions
   npm install
   ```

3. Deploy:

   ```bash
   firebase deploy --only functions,hosting
   ```

### Required runtime config

Set the following environment variables (locally via `.env` + `firebase emulators:start` or in production via `firebase functions:config:set`):

```
TELEGRAM_BOT_TOKEN=123:ABC
```

