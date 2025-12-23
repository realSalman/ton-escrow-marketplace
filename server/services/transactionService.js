import { collection, doc, setDoc, query, orderBy, limit, getDocs, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/client.js';

/**
 * Store a transaction record
 * @param {string} type - 'buyer_to_server' or 'server_to_seller'
 * @param {string} transactionHash - The transaction hash
 * @param {string} orderId - The order ID
 * @param {string} fromAddress - Sender address
 * @param {string} toAddress - Recipient address
 * @param {string} amount - Amount in USDT units (as string)
 * @param {object} metadata - Additional metadata (optional)
 * @returns {Promise<boolean>}
 */
export async function storeTransaction(type, transactionHash, orderId, fromAddress, toAddress, amount, metadata = {}) {
  try {
    const transactionData = {
      type, // 'buyer_to_server' or 'server_to_seller'
      transactionHash,
      orderId,
      fromAddress: fromAddress.toString ? fromAddress.toString() : fromAddress,
      toAddress: toAddress.toString ? toAddress.toString() : toAddress,
      amount: typeof amount === 'bigint' ? amount.toString() : amount,
      ...metadata,
      createdAt: serverTimestamp(),
      createdAtTimestamp: Date.now(),
    };

    // Store in Firestore
    const transactionRef = doc(collection(db, 'transactions'), transactionHash);
    await setDoc(transactionRef, transactionData, { merge: false });
    
    console.log(`[TRANSACTION] ✅ Stored ${type} transaction: ${transactionHash}`);
    return true;
  } catch (error) {
    console.error(`[TRANSACTION] ❌ Error storing transaction:`, error);
    return false;
  }
}

/**
 * Fetch all transactions, optionally filtered by type
 * @param {string|null} type - 'buyer_to_server', 'server_to_seller', or null for all
 * @param {number} limitCount - Maximum number of transactions to fetch
 * @returns {Promise<Array>}
 */
export async function fetchTransactions(type = null, limitCount = 100) {
  try {
    let q = query(
      collection(db, 'transactions'),
      orderBy('createdAtTimestamp', 'desc'),
      limit(limitCount)
    );

    const snapshot = await getDocs(q);
    let transactions = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data(),
    }));

    // Filter by type if specified
    if (type) {
      transactions = transactions.filter(tx => tx.type === type);
    }

    return transactions;
  } catch (error) {
    console.error(`[TRANSACTION] ❌ Error fetching transactions:`, error);
    throw error;
  }
}

