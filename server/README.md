# Escrow Backend Server

This is the backend server for the Escrow application. It provides API endpoints for shop-related operations that were moved from the frontend.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables. Create a `.env` file in the server directory with the following:

```env
# Firebase Configuration
FIREBASE_API_KEY=your_api_key
FIREBASE_AUTH_DOMAIN=your_auth_domain
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_MESSAGING_SENDER_ID=your_sender_id
FIREBASE_APP_ID=your_app_id
FIREBASE_DATABASE_URL=your_database_url
FIREBASE_REGION=us-central1

# Server Configuration
PORT=3001
```

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## API Endpoints

- `GET /health` - Health check endpoint
- `GET /api/firebase-config` - Get Firebase configuration for client (secure, server-side env vars)
- `POST /api/upload-media` - Upload media files (convert to base64)
- `POST /api/shop-items` - Create a new shop item
- `GET /api/shop-items` - Fetch shop items with pagination
- `GET /api/users/:uid` - Fetch user profile
- `POST /api/wallets` - Store wallet for an order
- `POST /api/wanted/toggle` - Toggle wanted status for an item
- `GET /api/wanted/check` - Check if item is wanted
- `GET /api/wanted` - Fetch all wanted items for a user

## Frontend Configuration

The frontend needs to know the backend URL. Set the following environment variable in `client/.env`:

```env
VITE_API_BASE_URL=http://localhost:3001
```

For production, update this to your production backend URL.

