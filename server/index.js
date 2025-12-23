import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import express from 'express';
import cors from 'cors';
import {
  uploadMediaFiles,
  createShopItemRealtime,
  fetchShopItemsRealtime,
  fetchShopItemById,
  fetchUserProfile,
  toggleWantedItem,
  checkIfWanted,
  fetchWantedItems,
} from './services/firestoreService.js';
import { storeTransaction, fetchTransactions } from './services/transactionService.js';
import {
  calculateUsdtAmount,
  parsePrice,
  JETTON_TRANSFER_GAS_FEES,
  USDT_MASTER_ADDRESS,
} from './utils/paymentHelpers.js';
import { processPayment } from './services/paymentService.js';
import { getHttpEndpoint } from '@orbs-network/ton-access';
import { TonClient } from '@ton/ton';

// Load environment variables from server/.env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increased limit for base64 images/videos
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Get Firebase config for client
// GET /api/firebase-config
app.get('/api/firebase-config', (req, res) => {
  try {
    const config = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
      databaseURL: process.env.FIREBASE_DATABASE_URL,
      region: process.env.FIREBASE_REGION || 'us-central1',
    };

    const missing = Object.entries(config)
      .filter(([key, value]) => key !== 'region' && !value)
      .map(([key]) => key);

    if (missing.length) {
      return res.status(500).json({ 
        error: `Missing Firebase config values: ${missing.join(', ')}` 
      });
    }

    res.json({ config });
  } catch (error) {
    console.error('Error getting Firebase config:', error);
    res.status(500).json({ error: error.message });
  }
});

// Upload media files (convert to base64)
// POST /api/upload-media
// Body: { uid: string, files: string[] } (files are base64 strings)
app.post('/api/upload-media', async (req, res) => {
  try {
    const { uid, files } = req.body;
    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }
    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'files array is required' });
    }
    
    const results = await uploadMediaFiles(uid, files);
    res.json({ results });
  } catch (error) {
    console.error('Error uploading media:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create shop item
// POST /api/shop-items
// Body: { uid: string, payload: object, sellerInfo: object|null }
// Headers: Authorization: Bearer <firebase-id-token>
app.post('/api/shop-items', async (req, res) => {
  try {
    const { uid, payload, sellerInfo } = req.body;
    if (!uid) {
      return res.status(400).json({ error: 'uid is required' });
    }
    if (!payload) {
      return res.status(400).json({ error: 'payload is required' });
    }
    
    // Get auth token from Authorization header
    const authHeader = req.headers.authorization;
    const authToken = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    if (!authToken) {
      return res.status(401).json({ error: 'Authentication required. Please provide Firebase ID token in Authorization header.' });
    }
    
    const itemId = await createShopItemRealtime(uid, payload, sellerInfo || null, authToken);
    res.json({ itemId });
  } catch (error) {
    console.error('Error creating shop item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch shop items
// GET /api/shop-items?searchTerm=&limit=10&lastCreatedAt=&minimal=true
app.get('/api/shop-items', async (req, res) => {
  try {
    const searchTerm = req.query.searchTerm || '';
    const limit = parseInt(req.query.limit) || 10;
    const lastCreatedAt = req.query.lastCreatedAt ? parseInt(req.query.lastCreatedAt) : null;
    const minimal = req.query.minimal === 'true';
    
    const items = await fetchShopItemsRealtime(searchTerm, limit, lastCreatedAt, minimal);
    res.json({ items });
  } catch (error) {
    console.error('Error fetching shop items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch a single shop item by ID with full data
// GET /api/shop-items/:itemId
app.get('/api/shop-items/:itemId', async (req, res) => {
  try {
    const { itemId } = req.params;
    
    const item = await fetchShopItemById(itemId);
    if (!item) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    res.json({ item });
  } catch (error) {
    console.error('Error fetching shop item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch user profile
// GET /api/users/:uid?timeoutMs=3000
app.get('/api/users/:uid', async (req, res) => {
  try {
    const { uid } = req.params;
    const timeoutMs = req.query.timeoutMs ? parseInt(req.query.timeoutMs) : 3000;
    
    const profile = await fetchUserProfile(uid, timeoutMs);
    res.json({ profile });
  } catch (error) {
    console.error('Error fetching user profile:', error);
    res.status(500).json({ error: error.message });
  }
});

// Process payment: Send 95% to seller, keep 5% as fee
// POST /api/payment/process
// Body: { orderId: string, sellerAddress: string, amount?: string }
// amount is optional - if not provided, processes entire server wallet balance
app.post('/api/payment/process', async (req, res) => {
  const startTime = Date.now();
  try {
    const { orderId, sellerAddress, amount } = req.body;
    
    if (!orderId) {
      return res.status(400).json({ error: 'orderId is required' });
    }
    if (!sellerAddress) {
      return res.status(400).json({ error: 'sellerAddress is required' });
    }

    // Initialize TON client
    const network = process.env.TON_NETWORK || 'testnet';
    const endpoint = await getHttpEndpoint({ network });
    const tonClient = new TonClient({ endpoint });

    // Process payment (amount is optional)
    const result = await processPayment(orderId, sellerAddress, tonClient, amount || null);
    
    const totalTime = Date.now() - startTime;
    console.log(`[PAYMENT] Payment processing completed (${totalTime}ms)`);
    
    res.json({ success: true, ...result });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[PAYMENT] Error processing payment (${totalTime}ms):`, error);
    res.status(500).json({ error: error.message });
  }
});

// Toggle wanted item
// POST /api/wanted/toggle
// Body: { itemId: string, userId: string }
// Headers: Authorization: Bearer <firebase-id-token>
app.post('/api/wanted/toggle', async (req, res) => {
  try {
    const { itemId, userId } = req.body;
    if (!itemId || !userId) {
      return res.status(400).json({ error: 'itemId and userId are required' });
    }
    
    // Get auth token from Authorization header
    const authHeader = req.headers.authorization;
    const authToken = authHeader && authHeader.startsWith('Bearer ') 
      ? authHeader.substring(7) 
      : null;
    
    if (!authToken) {
      return res.status(401).json({ error: 'Authentication required. Please provide Firebase ID token in Authorization header.' });
    }
    
    const isWanted = await toggleWantedItem(itemId, userId, authToken);
    res.json({ isWanted });
  } catch (error) {
    console.error('Error toggling wanted item:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check if item is wanted
// GET /api/wanted/check?itemId=&userId=
app.get('/api/wanted/check', async (req, res) => {
  try {
    const { itemId, userId } = req.query;
    if (!itemId || !userId) {
      return res.status(400).json({ error: 'itemId and userId are required' });
    }
    
    const isWanted = await checkIfWanted(itemId, userId);
    res.json({ isWanted });
  } catch (error) {
    console.error('Error checking wanted status:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch wanted items
// GET /api/wanted?userId=
app.get('/api/wanted', async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    const items = await fetchWantedItems(userId);
    res.json({ items });
  } catch (error) {
    console.error('Error fetching wanted items:', error);
    res.status(500).json({ error: error.message });
  }
});

// Calculate USDT amount
// POST /api/utils/calculate-usdt
// Body: { usdCents: number }
app.post('/api/utils/calculate-usdt', async (req, res) => {
  try {
    const { usdCents } = req.body;
    if (usdCents === undefined || usdCents === null) {
      return res.status(400).json({ error: 'usdCents is required' });
    }
    const amount = calculateUsdtAmount(usdCents);
    res.json({ amount: amount.toString() });
  } catch (error) {
    console.error('Error calculating USDT amount:', error);
    res.status(500).json({ error: error.message });
  }
});

// Parse price string
// POST /api/utils/parse-price
// Body: { priceString: string }
app.post('/api/utils/parse-price', async (req, res) => {
  try {
    const { priceString } = req.body;
    const price = parsePrice(priceString || '');
    res.json({ price });
  } catch (error) {
    console.error('Error parsing price:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get payment constants
// GET /api/utils/payment-constants
app.get('/api/utils/payment-constants', async (req, res) => {
  try {
    if (!process.env.SERVER_WALLET_ADDRESS) {
      throw new Error('SERVER_WALLET_ADDRESS not configured');
    }
    res.json({
      jettonTransferGasFees: JETTON_TRANSFER_GAS_FEES.toString(),
      usdtMasterAddress: USDT_MASTER_ADDRESS.toString(),
      serverWalletAddress: process.env.SERVER_WALLET_ADDRESS,
    });
  } catch (error) {
    console.error('Error getting payment constants:', error);
    res.status(500).json({ error: error.message });
  }
});

// Store buyer to server transaction
// POST /api/transactions/buyer-to-server
app.post('/api/transactions/buyer-to-server', async (req, res) => {
  try {
    const { transactionHash, orderId, fromAddress, toAddress, amount } = req.body;
    
    if (!transactionHash || !orderId || !fromAddress || !toAddress || !amount) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const success = await storeTransaction(
      'buyer_to_server',
      transactionHash,
      orderId,
      fromAddress,
      toAddress,
      amount
    );

    res.json({ success });
  } catch (error) {
    console.error('Error storing buyer transaction:', error);
    res.status(500).json({ error: error.message });
  }
});

// Fetch transactions
// GET /api/transactions?type=buyer_to_server|server_to_seller
app.get('/api/transactions', async (req, res) => {
  try {
    const type = req.query.type || null;
    const limitCount = parseInt(req.query.limit) || 100;
    
    const transactions = await fetchTransactions(type, limitCount);
    res.json({ transactions });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: error.message });
  }
});

// Serve JettonWallet class as ES module
// GET /api/wrappers/JettonWallet.js
app.get('/api/wrappers/JettonWallet.js', async (req, res) => {
  try {
    const { readFile } = await import('fs/promises');
    const { fileURLToPath } = await import('url');
    const { dirname, join } = await import('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const filePath = join(__dirname, 'wrappers', 'JettonWallet.js');
    const content = await readFile(filePath, 'utf-8');
    res.setHeader('Content-Type', 'application/javascript');
    res.send(content);
  } catch (error) {
    console.error('Error serving JettonWallet:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  if (process.env.SERVER_WALLET_ADDRESS) {
    console.log(`Server wallet: ${process.env.SERVER_WALLET_ADDRESS}`);
  } else {
    console.warn('WARNING: SERVER_WALLET_ADDRESS not configured');
  }
});

