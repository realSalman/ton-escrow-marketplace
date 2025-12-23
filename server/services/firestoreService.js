import {
  collection,
  doc,
  setDoc,
  getDoc,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';
import {
  ref as dbRef,
  push,
  set,
  onValue,
  off,
  query as dbQuery,
  orderByChild,
  limitToLast,
  endAt,
  get,
  remove,
  update,
} from 'firebase/database';
import { db, realtimeDb } from '../firebase/client.js';

// Helper to get database URL from environment
function getDatabaseUrl() {
  const dbUrl = process.env.FIREBASE_DATABASE_URL;
  if (!dbUrl) {
    throw new Error('FIREBASE_DATABASE_URL not configured');
  }
  // REST API uses the same URL format as the client SDK
  // https://PROJECT_ID-default-rtdb.REGION.firebasedatabase.app
  return dbUrl;
}

// Helper to make authenticated REST API calls to Realtime Database
async function dbRestCall(path, method, data, authToken) {
  const dbUrl = getDatabaseUrl();
  const url = `${dbUrl}${path}.json${authToken ? `?auth=${authToken}` : ''}`;
  
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };
  
  // Only include body for methods that support it and when data is provided
  if (data !== undefined && data !== null && method !== 'DELETE' && method !== 'GET') {
    options.body = JSON.stringify(data);
  }
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `Database error: ${response.statusText}`);
  }
  
  // For GET and POST, return the JSON response
  // For PUT/PATCH, response might be empty or contain the written data
  // For DELETE, response is typically empty
  if (method === 'GET' || method === 'POST') {
    return await response.json();
  } else if (method === 'PUT' || method === 'PATCH') {
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }
  return null;
}

// Store media files as base64 in Realtime Database (free, no Storage needed)
// Works for both images and videos
// Note: In backend, files are already base64 strings from frontend
export async function uploadMediaFiles(uid, files = []) {
  if (!files || files.length === 0) return [];
  
  // Files are already base64 strings from frontend
  // Just validate and return them
  const results = [];
  
  for (const file of files) {
    // If it's already a base64 string, use it directly
    if (typeof file === 'string' && file.startsWith('data:')) {
      results.push(file);
    } else {
      // If it's an object with base64 property, extract it
      if (file.base64) {
        results.push(file.base64);
      } else {
        throw new Error('Invalid file format. Expected base64 string.');
      }
    }
  }
  
  return results;
}

// Realtime Database functions for shop items
// uid should be the Telegram ID (numeric string)
// authToken is the Firebase ID token for authentication
export async function createShopItemRealtime(uid, payload, sellerInfo = null, authToken = null) {
  const searchTokens = (payload.title || '')
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);
  
  // Use Telegram ID directly as sellerId
  const sellerId = uid?.toString() || uid;
  
  // Build seller info object with proper fallbacks
  // Always include sellerId - it's required for all listings
  let sellerData = {
    sellerId: sellerId,
  };
  
  // If sellerInfo is provided, denormalize seller info into the listing
  // This avoids extra fetches when displaying listings
  if (sellerInfo && typeof sellerInfo === 'object') {
    // Compute seller name with proper fallback chain
    // This matches the logic used in useMiniAppAuth for consistency
    const sellerName = sellerInfo.fullName || 
                      (sellerInfo.firstName && sellerInfo.lastName 
                        ? `${sellerInfo.firstName} ${sellerInfo.lastName}`.trim()
                        : sellerInfo.firstName) ||
                      sellerInfo.username || 
                      null;
    
    // Store seller info if we have at least a name
    if (sellerName) {
      sellerData = {
        ...sellerData, // Include sellerId
        sellerName: sellerName,
        sellerUsername: sellerInfo.username || '',
        sellerAvatar: sellerInfo.avatar || '',
      };
      console.log('Storing seller info in listing:', { sellerName, sellerUsername: sellerData.sellerUsername, hasAvatar: !!sellerData.sellerAvatar });
    } else {
      console.warn('Seller info provided but no name could be extracted. Seller info keys:', Object.keys(sellerInfo));
    }
  } else if (sellerInfo === null) {
    console.log('No sellerInfo provided, storing only sellerId');
  } else {
    console.warn('Invalid sellerInfo format:', typeof sellerInfo, sellerInfo);
  }
  
  const itemData = {
    ...payload,
    ...sellerData,
    status: 'active',
    createdAt: Date.now(),
    searchTokens,
  };
  
  console.log('Writing to Realtime DB with auth token:', { hasToken: !!authToken, sellerData });
  
  // Use REST API with auth token if provided, otherwise use SDK (for reads)
  if (authToken) {
    // Use REST API for authenticated write
    const result = await dbRestCall('/shopItems', 'POST', itemData, authToken);
    const itemId = result.name; // REST API returns { name: "itemId" }
    console.log('Successfully written to Realtime DB via REST API, key:', itemId);
    return itemId;
  } else {
    // Fallback to SDK (may fail without auth, but keeps same logic)
    const itemsRef = dbRef(realtimeDb, 'shopItems');
    const newItemRef = push(itemsRef);
    await set(newItemRef, itemData);
    const itemId = newItemRef.key;
    console.log('Successfully written to Realtime DB via SDK, key:', itemId);
    return itemId;
  }
}

// Fetch shop items with pagination (10 items at a time)
// minimal: if true, only return thumbnail (first image), title, price, wantCount, id, createdAt
export async function fetchShopItemsRealtime(searchTerm = '', limit = 10, lastCreatedAt = null, minimal = false) {
  const itemsRef = dbRef(realtimeDb, 'shopItems');
  let q;
  
  if (lastCreatedAt) {
    // Fetch next batch: items with createdAt less than lastCreatedAt
    q = dbQuery(
      itemsRef,
      orderByChild('createdAt'),
      endAt(lastCreatedAt - 1),
      limitToLast(limit)
    );
  } else {
    // Fetch first batch: newest items
    q = dbQuery(
      itemsRef,
      orderByChild('createdAt'),
      limitToLast(limit)
    );
  }
  
  const snapshot = await get(q);
  
  if (!snapshot.exists()) {
    return [];
  }
  
  const data = snapshot.val();
  let items = Object.keys(data).map((key) => ({
    id: key,
    ...data[key],
  }));
  
  // Sort by createdAt descending (newest first)
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  // Client-side filtering: only show active items
  items = items.filter((item) => item.status === 'active' || !item.status);
  
  // Client-side filtering for search
  if (searchTerm) {
    const term = searchTerm.toLowerCase();
    items = items.filter((item) => {
      const titleMatch = item.title?.toLowerCase().includes(term);
      const descMatch = item.description?.toLowerCase().includes(term);
      const tokenMatch = item.searchTokens?.some((token) => token.includes(term));
      return titleMatch || descMatch || tokenMatch;
    });
  }
  
  // If minimal mode, only return essential fields
  if (minimal) {
    items = items.map((item) => {
      // Extract thumbnail from first media item
      let thumbnail = null;
      if (item.media && Array.isArray(item.media) && item.media.length > 0) {
        thumbnail = item.media[0];
      } else if (item.media && typeof item.media === 'string') {
        // Handle case where media might be a single string instead of array
        thumbnail = item.media;
      }
      
      return {
        id: item.id,
        title: item.title,
        price: item.price,
        wantCount: item.wantCount || 0,
        createdAt: item.createdAt,
        thumbnail: thumbnail,
      };
    });
  }
  
  return items;
}

// Fetch a single shop item by ID with full data
export async function fetchShopItemById(itemId) {
  if (!itemId) {
    throw new Error('itemId is required');
  }
  
  const itemRef = dbRef(realtimeDb, `shopItems/${itemId}`);
  const snapshot = await get(itemRef);
  
  if (!snapshot.exists()) {
    return null;
  }
  
  const data = snapshot.val();
  return {
    id: itemId,
    ...data,
  };
}

export function subscribeToOrders(uid, callback) {
  const q = query(
    collection(db, 'orders'),
    where('participants', 'array-contains', uid),
    orderBy('createdAt', 'desc'),
    limit(25),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
  });
}

export function subscribeToProfile(uid, callback) {
  const profileRef = doc(db, 'users', uid);
  return onSnapshot(profileRef, (snap) => callback({ id: snap.id, ...snap.data() }));
}

// Fetch user profile by ID (one-time fetch, not subscription)
// uid should be the Telegram ID (numeric string)
export async function fetchUserProfile(uid, timeoutMs = 3000) {
  if (!uid) {
    return null;
  }
  
  // Use Telegram ID directly
  const userId = uid.toString();
  const profileRef = doc(db, 'users', userId);
  
  // Add timeout to prevent long delays
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Profile fetch timeout')), timeoutMs);
  });
  
  try {
    const snap = await Promise.race([
      getDoc(profileRef),
      timeoutPromise,
    ]);
    return snap.exists() ? { id: snap.id, ...snap.data() } : null;
  } catch (error) {
    // If timeout or other error, return null (non-blocking)
    console.warn('Failed to fetch user profile:', error.message);
    return null;
  }
}

// Store wallet mnemonic and address for an order
// Stores in both Firestore and Realtime Database for redundancy
// This function is non-blocking - it won't throw errors, just logs them
export async function storeWalletForOrder(orderId, mnemonic, walletAddress, userId = null, itemId = null) {
  console.log(`[PAYMENT] [DB] Starting wallet storage for order: ${orderId}`);
  console.log(`[PAYMENT] [DB]   - Wallet Address: ${walletAddress}`);
  console.log(`[PAYMENT] [DB]   - User ID: ${userId || 'none'}`);
  console.log(`[PAYMENT] [DB]   - Item ID: ${itemId || 'none'}`);
  
  const walletData = {
    orderId,
    mnemonic: Array.isArray(mnemonic) ? mnemonic.join(' ') : mnemonic, // Store as space-separated string
    walletAddress,
    walletType: 'w5', // Store wallet type (w5 supports jetton gas payments)
    userId: userId || null,
    itemId: itemId || null, // Store itemId for later retrieval
    createdAt: serverTimestamp(),
    createdAtTimestamp: Date.now(),
  };

  console.log(`[PAYMENT] [DB] Prepared wallet data structure`);

  // Helper function to write with timeout (non-blocking)
  const writeWithTimeout = async (writePromise, dbName, timeoutMs = 3000) => {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${dbName} write timeout after ${timeoutMs}ms`)), timeoutMs);
    });

    try {
      await Promise.race([writePromise, timeoutPromise]);
      console.log(`${dbName} write completed`);
      return true;
    } catch (error) {
      console.warn(`${dbName} write failed (non-blocking):`, error.message);
      return false;
    }
  };

  // Try Firestore first (non-blocking)
  const firestoreData = { ...walletData };
  const walletDocRef = doc(db, 'orderWallets', orderId);
  console.log(`[PAYMENT] [DB] Writing to Firestore: orderWallets/${orderId}`);
  const firestoreStart = Date.now();
  const firestoreSuccess = await writeWithTimeout(
    setDoc(walletDocRef, firestoreData, { merge: false }),
    'Firestore',
    3000
  );
  const firestoreTime = Date.now() - firestoreStart;
  
  if (firestoreSuccess) {
    console.log(`[PAYMENT] [DB] ✅ Firestore write successful (${firestoreTime}ms)`);
  } else {
    console.warn(`[PAYMENT] [DB] ⚠️  Firestore write failed or timed out (${firestoreTime}ms)`);
  }

  // Try Realtime Database (non-blocking)
  const realtimeData = {
    ...walletData,
    createdAt: Date.now(), // Realtime DB uses timestamp, not serverTimestamp
  };
  const walletRef = dbRef(realtimeDb, `orderWallets/${orderId}`);
  console.log(`[PAYMENT] [DB] Writing to Realtime Database: orderWallets/${orderId}`);
  const realtimeStart = Date.now();
  const realtimeSuccess = await writeWithTimeout(
    set(walletRef, realtimeData),
    'Realtime Database',
    3000
  );
  const realtimeTime = Date.now() - realtimeStart;
  
  if (realtimeSuccess) {
    console.log(`[PAYMENT] [DB] ✅ Realtime Database write successful (${realtimeTime}ms)`);
  } else {
    console.warn(`[PAYMENT] [DB] ⚠️  Realtime Database write failed or timed out (${realtimeTime}ms)`);
  }

  if (firestoreSuccess || realtimeSuccess) {
    console.log(`[PAYMENT] [DB] ✅ Wallet stored successfully in at least one database for order: ${orderId}`);
    console.log(`[PAYMENT] [DB]   - Firestore: ${firestoreSuccess ? '✅' : '❌'}`);
    console.log(`[PAYMENT] [DB]   - Realtime DB: ${realtimeSuccess ? '✅' : '❌'}`);
    return true;
  } else {
    console.error(`[PAYMENT] [DB] ❌ Failed to store wallet in both databases for order: ${orderId}`);
    return false;
  }
}

// Toggle wanted status for an item
// Stores wanted users in an object like chat "members": { userId1: true, userId2: true, ... }
// uid should be the Telegram ID (numeric string)
// authToken is the Firebase ID token for authentication
export async function toggleWantedItem(itemId, userId, authToken = null) {
  if (!itemId || !userId) {
    throw new Error('Item ID and User ID are required');
  }

  const userIdStr = userId.toString();
  
  if (authToken) {
    // Use REST API for authenticated operations
    // First, get current item to check wanted status
    const itemData = await dbRestCall(`/shopItems/${itemId}`, 'GET', undefined, authToken);
    if (!itemData) {
      throw new Error('Item not found');
    }
    
    const wantedData = itemData.wanted || {};
    const isWanted = wantedData[userIdStr] === true;
    
    // Calculate current wantCount based on wanted object
    const currentWantCount = Object.keys(wantedData).filter(key => wantedData[key] === true).length;
    
    if (isWanted) {
      // Remove from wanted list - delete the user's entry
      await dbRestCall(`/shopItems/${itemId}/wanted/${userIdStr}`, 'DELETE', null, authToken);
      
      // Update wantCount separately
      await dbRestCall(`/shopItems/${itemId}`, 'PATCH', { wantCount: Math.max(0, currentWantCount - 1) }, authToken);
      return false; // Item is no longer wanted
    } else {
      // Add to wanted list - set the user's entry to true
      await dbRestCall(`/shopItems/${itemId}/wanted/${userIdStr}`, 'PUT', true, authToken);
      
      // Update wantCount separately
      await dbRestCall(`/shopItems/${itemId}`, 'PATCH', { wantCount: currentWantCount + 1 }, authToken);
      return true; // Item is now wanted
    }
  } else {
    // Fallback to SDK (may fail without auth, but keeps same logic)
    const itemRef = dbRef(realtimeDb, `shopItems/${itemId}`);
    const wantedUserRef = dbRef(realtimeDb, `shopItems/${itemId}/wanted/${userIdStr}`);
    
    // Get current item and wanted list
    const itemSnapshot = await get(itemRef);
    if (!itemSnapshot.exists()) {
      throw new Error('Item not found');
    }
    
    const itemData = itemSnapshot.val();
    const wantedData = itemData.wanted || {};
    const isWanted = wantedData[userIdStr] === true;
    
    // Calculate current wantCount based on wanted object
    const currentWantCount = Object.keys(wantedData).filter(key => wantedData[key] === true).length;
    
    if (isWanted) {
      // Remove from wanted list (like removing from members) - only update our own entry
      await remove(wantedUserRef);
      
      // Update wantCount separately
      await update(itemRef, {
        wantCount: Math.max(0, currentWantCount - 1),
      });
      return false; // Item is no longer wanted
    } else {
      // Add to wanted list (like adding to members) - only update our own entry
      await set(wantedUserRef, true);
      
      // Update wantCount separately
      await update(itemRef, {
        wantCount: currentWantCount + 1,
      });
      return true; // Item is now wanted
    }
  }
}

// Check if an item is wanted by a user
// Checks if user's Telegram UID exists in the wanted object (like checking chat members)
// uid should be the Telegram ID (numeric string)
export async function checkIfWanted(itemId, userId) {
  if (!itemId || !userId) {
    return false;
  }

  const userIdStr = userId.toString();
  const itemRef = dbRef(realtimeDb, `shopItems/${itemId}`);
  const snapshot = await get(itemRef);
  
  if (!snapshot.exists()) {
    return false;
  }
  
  const itemData = snapshot.val();
  const wantedData = itemData.wanted || {};
  
  // Check if user's Telegram UID exists in wanted object (like checking members.hasChild)
  return wantedData[userIdStr] === true;
}

// Fetch all items wanted by a user
// Checks if user's Telegram UID exists in each item's wanted object (like checking chat members)
// uid should be the Telegram ID (numeric string)
export async function fetchWantedItems(userId) {
  if (!userId) {
    return [];
  }

  const userIdStr = userId.toString();
  const shopItemsRef = dbRef(realtimeDb, 'shopItems');
  const snapshot = await get(shopItemsRef);
  
  if (!snapshot.exists()) {
    return [];
  }
  
  const itemsData = snapshot.val();
  const wantedItems = [];
  
  // Iterate through all items and check if user's Telegram UID is in the wanted object
  for (const itemId in itemsData) {
    const item = itemsData[itemId];
    
    // Check if item is active and user's Telegram UID is in wanted object (like checking members.hasChild)
    const wantedData = item.wanted || {};
    const isWanted = wantedData[userIdStr] === true;
    
    if (isWanted && (item.status === 'active' || !item.status)) {
      wantedItems.push({
        id: itemId,
        ...item,
      });
    }
  }
  
  // Sort by createdAt descending (newest first)
  wantedItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  return wantedItems;
}

