import {
  collection,
  doc,
  query,
  orderBy,
  limit,
  where,
  onSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase/client';

// Re-export functions from apiService for backward compatibility
// These functions now call the backend API
export {
  uploadMediaFiles,
  createShopItemRealtime,
  fetchShopItemsRealtime,
  fetchShopItemById,
  fetchUserProfile,
  storeWalletForOrder,
  toggleWantedItem,
  checkIfWanted,
  fetchWantedItems,
} from './apiService.js';

// Subscription functions remain client-side for real-time updates
// These use Firebase onSnapshot which works best client-side
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

