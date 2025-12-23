// API service for communicating with backend server
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

// Get Firebase ID token for authenticated requests
async function getIdToken() {
  const { auth } = await import('../firebase/client.js');
  if (!auth.currentUser) {
    throw new Error('User not authenticated');
  }
  return await auth.currentUser.getIdToken();
}

// Helper function for API calls
async function apiCall(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Get ID token for authenticated requests
  let idToken = null;
  try {
    idToken = await getIdToken();
  } catch (error) {
    console.warn('Could not get ID token:', error);
  }
  
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  };
  
  if (idToken) {
    headers['Authorization'] = `Bearer ${idToken}`;
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP error! status: ${response.status}`);
  }

  return response.json();
}

// Simple function to convert file to base64 (works for images and videos)
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result); // Returns data:image/jpeg;base64,... or data:video/mp4;base64,...
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Store media files as base64 in Realtime Database (free, no Storage needed)
// Works for both images and videos
export async function uploadMediaFiles(uid, files = []) {
  if (!files || files.length === 0) return [];
  
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB max (Realtime DB has 32MB node limit, base64 adds ~33% size)
  const results = [];
  
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`${file.name} is too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max is 10MB.`);
    }
    
    const base64 = await fileToBase64(file);
    results.push(base64); // Simple: just store the base64 string directly
  }
  
  // Send to backend API
  const response = await apiCall('/api/upload-media', {
    method: 'POST',
    body: JSON.stringify({ uid, files: results }),
  });
  
  return response.results;
}

// Realtime Database functions for shop items
// uid should be the Telegram ID (numeric string)
export async function createShopItemRealtime(uid, payload, sellerInfo = null) {
  const response = await apiCall('/api/shop-items', {
    method: 'POST',
    body: JSON.stringify({ uid, payload, sellerInfo }),
  });
  
  return response.itemId;
}

// Fetch shop items with pagination (10 items at a time)
// minimal: if true, only returns thumbnail, title, price, wantCount, id, createdAt
export async function fetchShopItemsRealtime(searchTerm = '', limit = 10, lastCreatedAt = null, minimal = false) {
  const params = new URLSearchParams();
  if (searchTerm) params.append('searchTerm', searchTerm);
  if (limit) params.append('limit', limit.toString());
  if (lastCreatedAt) params.append('lastCreatedAt', lastCreatedAt.toString());
  if (minimal) params.append('minimal', 'true');
  
  const response = await apiCall(`/api/shop-items?${params.toString()}`);
  return response.items;
}

// Fetch a single shop item by ID with full data
export async function fetchShopItemById(itemId) {
  const response = await apiCall(`/api/shop-items/${itemId}`);
  return response.item;
}

// Fetch user profile by ID (one-time fetch, not subscription)
// uid should be the Telegram ID (numeric string)
export async function fetchUserProfile(uid, timeoutMs = 3000) {
  const response = await apiCall(`/api/users/${uid}?timeoutMs=${timeoutMs}`);
  return response.profile;
}

// Store wallet mnemonic and address for an order
// Stores in both Firestore and Realtime Database for redundancy
// This function is non-blocking - it won't throw errors, just logs them
export async function storeWalletForOrder(orderId, mnemonic, walletAddress, userId = null, itemId = null) {
  try {
    const response = await apiCall('/api/wallets', {
      method: 'POST',
      body: JSON.stringify({
        orderId,
        mnemonic: Array.isArray(mnemonic) ? mnemonic : mnemonic,
        walletAddress,
        userId,
        itemId,
      }),
    });
    return response.success;
  } catch (error) {
    console.warn('Failed to store wallet in database (continuing anyway):', error);
    return false;
  }
}

// Toggle wanted status for an item
// Stores wanted users in an object like chat "members": { userId1: true, userId2: true, ... }
// uid should be the Telegram ID (numeric string)
export async function toggleWantedItem(itemId, userId) {
  const response = await apiCall('/api/wanted/toggle', {
    method: 'POST',
    body: JSON.stringify({ itemId, userId }),
  });
  
  return response.isWanted;
}

// Check if an item is wanted by a user
// Checks if user's Telegram UID exists in the wanted object (like checking chat members)
// uid should be the Telegram ID (numeric string)
export async function checkIfWanted(itemId, userId) {
  const response = await apiCall(`/api/wanted/check?itemId=${itemId}&userId=${userId}`);
  return response.isWanted;
}

// Fetch all items wanted by a user
// Checks if user's Telegram UID exists in each item's wanted object (like checking chat members)
// uid should be the Telegram ID (numeric string)
export async function fetchWantedItems(userId) {
  const response = await apiCall(`/api/wanted?userId=${userId}`);
  return response.items;
}

// Create new TON wallet
export async function createNewTonWallet() {
  const response = await apiCall('/api/utils/create-wallet', {
    method: 'POST',
  });
  // Convert address string back to Address object for frontend use
  const { Address } = await import('@ton/core');
  return {
    mnemonic: response.mnemonic,
    address: Address.parse(response.address),
    walletAddress: response.walletAddress,
  };
}

// Calculate USDT amount from USD cents
export async function calculateUsdtAmount(usdCents) {
  const response = await apiCall('/api/utils/calculate-usdt', {
    method: 'POST',
    body: JSON.stringify({ usdCents }),
  });
  return BigInt(response.amount);
}

// Parse price string to number (synchronous version for simple parsing)
export function parsePrice(priceString) {
  if (!priceString) return 0;
  const match = priceString.toString().match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

// Get payment constants
let paymentConstantsCache = null;
export async function getPaymentConstants() {
  if (paymentConstantsCache) {
    return paymentConstantsCache;
  }
  const response = await apiCall('/api/utils/payment-constants');
  const { Address } = await import('@ton/core');
  // Server already sends gas fees in nanoTON (as string), so convert directly to BigInt
  // DO NOT use toNano() again - that would convert it as if it were TON units!
  paymentConstantsCache = {
    JETTON_TRANSFER_GAS_FEES: BigInt(response.jettonTransferGasFees),
    USDT_MASTER_ADDRESS: Address.parse(response.usdtMasterAddress),
    SERVER_WALLET_ADDRESS: Address.parse(response.serverWalletAddress),
  };
  return paymentConstantsCache;
}

// Process payment: Send 95% to seller, keep 5% as fee
// POST /api/payment/process
export async function processPayment(orderId, sellerAddress, amount = null) {
  const body = { orderId, sellerAddress };
  if (amount !== null && amount !== undefined) {
    body.amount = typeof amount === 'bigint' ? amount.toString() : amount;
  }
  return await apiCall('/api/payment/process', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// Store buyer to server transaction
// POST /api/transactions/buyer-to-server
export async function storeBuyerTransaction(transactionHash, orderId, fromAddress, toAddress, amount) {
  return await apiCall('/api/transactions/buyer-to-server', {
    method: 'POST',
    body: JSON.stringify({
      transactionHash,
      orderId,
      fromAddress: fromAddress.toString ? fromAddress.toString() : fromAddress,
      toAddress: toAddress.toString ? toAddress.toString() : toAddress,
      amount: typeof amount === 'bigint' ? amount.toString() : amount,
    }),
  });
}

// Fetch transactions
// GET /api/transactions?type=buyer_to_server|server_to_seller
export async function fetchTransactions(type = null) {
  const params = new URLSearchParams();
  if (type) params.append('type', type);
  return await apiCall(`/api/transactions?${params.toString()}`);
}

// Note: subscribeToOrders and subscribeToProfile are not moved to backend
// as they require real-time subscriptions which are better handled client-side
// These will remain in the original firestoreService.js for direct Firebase access

