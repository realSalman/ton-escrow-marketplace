import { TonClient } from '@ton/ton';
import { Address, toNano } from '@ton/core';
import { JettonMaster } from '@ton/ton';
import { restoreWalletFromMnemonic } from '../utils/walletUtils.js';
import { JettonWallet } from '../wrappers/JettonWallet.js';
import { USDT_MASTER_ADDRESS, JETTON_TRANSFER_GAS_FEES } from '../utils/paymentHelpers.js';
import { fetchShopItemById } from './firestoreService.js';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../firebase/client.js';

/**
 * Send 0.1 TON from server wallet to escrow wallet
 * @param {Address} escrowWalletAddress - The escrow wallet address to send TON to
 * @param {TonClient} tonClient - TON client instance
 * @returns {Promise<void>}
 */
async function sendTonToEscrowWallet(escrowWalletAddress, tonClient) {
  const sendStart = Date.now();
  try {
    console.log(`[PAYMENT] [ESCROW] [TON_SEND] Sending 0.1 TON from server wallet to escrow wallet...`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Escrow Wallet Address: ${escrowWalletAddress.toString()}`);
    
    // Get server wallet mnemonic from environment
    const serverWalletMnemonicStr = process.env.SERVER_WALLET_MNEMONIC;
    if (!serverWalletMnemonicStr) {
      console.error(`[PAYMENT] [ESCROW] [TON_SEND] ❌ SERVER_WALLET_MNEMONIC not configured`);
      throw new Error('SERVER_WALLET_MNEMONIC not configured in environment');
    }
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Server wallet mnemonic: ${serverWalletMnemonicStr ? '***CONFIGURED***' : 'NOT FOUND'}`);
    
    // Restore server wallet from mnemonic
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Restoring server wallet from mnemonic...`);
    const restoreStart = Date.now();
    const { wallet: serverWallet, keyPair: serverKeyPair } = await restoreWalletFromMnemonic(serverWalletMnemonicStr);
    const restoreTime = Date.now() - restoreStart;
    console.log(`[PAYMENT] [ESCROW] [TON_SEND] ✅ Server wallet restored (${restoreTime}ms)`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Server Wallet Address: ${serverWallet.address.toString()}`);
    
    // Check server wallet balance
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Checking server wallet TON balance...`);
    const serverBalanceStart = Date.now();
    let serverBalance;
    try {
      serverBalance = await tonClient.getBalance(serverWallet.address);
      console.log(`[PAYMENT] [ESCROW] [TON_SEND] ✅ Server wallet balance checked (${Date.now() - serverBalanceStart}ms)`);
      console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Server Balance: ${serverBalance.toString()} nanoTON (${Number(serverBalance) / 1e9} TON)`);
    } catch (error) {
      console.warn(`[PAYMENT] [ESCROW] [TON_SEND] ⚠️  Error checking server balance: ${error.message}`);
      // Continue anyway
    }
    
    // Amount to send: 0.1 TON
    const amountToSend = toNano('0.1'); // 0.1 TON = 100,000,000 nanoTON
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Amount to send: ${amountToSend.toString()} nanoTON (0.1 TON)`);
    
    // Gas fee for transfer (estimate)
    const gasFee = toNano('0.01'); // 0.01 TON for gas
    const totalRequired = amountToSend + gasFee;
    
    if (serverBalance && serverBalance < totalRequired) {
      const errorMsg = `Server wallet has insufficient balance. Required: ${totalRequired.toString()} nanoTON, Available: ${serverBalance.toString()} nanoTON`;
      console.error(`[PAYMENT] [ESCROW] [TON_SEND] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Create provider and sender for server wallet
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Creating sender for server wallet...`);
    const serverProvider = tonClient.provider(serverWallet.address);
    const serverSender = serverWallet.sender(serverProvider, serverKeyPair.secretKey);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND] ✅ Sender created`);
    
    // Send TON to escrow wallet
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Initiating TON transfer...`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]     From: ${serverWallet.address.toString()}`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]     To: ${escrowWalletAddress.toString()}`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]     Amount: ${amountToSend.toString()} nanoTON (0.1 TON)`);
    
    const transferStart = Date.now();
    const openedServerWallet = tonClient.open(serverWallet);
    await openedServerWallet.send(serverSender, {
      to: escrowWalletAddress,
      value: amountToSend,
      bounce: false,
    });
    const transferTime = Date.now() - transferStart;
    
    console.log(`[PAYMENT] [ESCROW] [TON_SEND] ✅ TON transfer sent successfully (${transferTime}ms)`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - 0.1 TON sent from server wallet to escrow wallet`);
    console.log(`[PAYMENT] [ESCROW] [TON_SEND]   - Note: Transaction may take a few seconds to confirm on blockchain`);
    
    const totalTime = Date.now() - sendStart;
    console.log(`[PAYMENT] [ESCROW] [TON_SEND] ✅ TON send process completed (${totalTime}ms)`);
  } catch (error) {
    const totalTime = Date.now() - sendStart;
    console.error(`[PAYMENT] [ESCROW] [TON_SEND] ❌ Error sending TON to escrow wallet (${totalTime}ms):`, error);
    console.error(`[PAYMENT] [ESCROW] [TON_SEND] Error details:`, {
      message: error.message,
      stack: error.stack,
      escrowWalletAddress: escrowWalletAddress.toString(),
    });
    throw error;
  }
}

/**
 * Get wallet data from database for an order
 * @param {string} orderId - The order ID
 * @returns {Promise<{mnemonic: string, walletAddress: string, userId: string|null, itemId: string|null}>}
 */
async function getWalletForOrder(orderId) {
  try {
    console.log(`[PAYMENT] [DB] Retrieving wallet data for order: ${orderId}`);
    // Try Firestore first
    const walletDocRef = doc(db, 'orderWallets', orderId);
    const dbStart = Date.now();
    const walletDoc = await getDoc(walletDocRef);
    const dbTime = Date.now() - dbStart;
    
    if (walletDoc.exists()) {
      const data = walletDoc.data();
      console.log(`[PAYMENT] [DB] ✅ Wallet data retrieved from Firestore (${dbTime}ms)`);
      console.log(`[PAYMENT] [DB]   - Wallet Address: ${data.walletAddress}`);
      console.log(`[PAYMENT] [DB]   - User ID: ${data.userId || 'none'}`);
      console.log(`[PAYMENT] [DB]   - Item ID: ${data.itemId || 'none'}`);
      console.log(`[PAYMENT] [DB]   - Created At: ${data.createdAtTimestamp ? new Date(data.createdAtTimestamp).toISOString() : 'N/A'}`);
      return {
        mnemonic: data.mnemonic,
        walletAddress: data.walletAddress,
        userId: data.userId || null,
        itemId: data.itemId || null,
      };
    }
    
    console.error(`[PAYMENT] [DB] ❌ Wallet not found in Firestore for order: ${orderId}`);
    throw new Error(`Wallet not found for order: ${orderId}`);
  } catch (error) {
    console.error(`[PAYMENT] [DB] ❌ Error getting wallet for order: ${orderId}`, error);
    throw error;
  }
}

/**
 * Get seller wallet address from listing or user profile
 * @param {string} sellerId - The seller's Telegram ID
 * @param {object} listing - The listing object (optional, checked first)
 * @returns {Promise<Address|null>}
 */
export async function getSellerWalletAddress(sellerId, listing = null) {
  try {
    console.log(`[PAYMENT] [DB] Retrieving seller wallet address for seller: ${sellerId}`);
    
    // Strategy 1: Check listing first (if provided) - listings may have walletAddress stored
    if (listing && listing.walletAddress) {
      console.log(`[PAYMENT] [DB] ✅ Seller wallet address found in listing: ${listing.walletAddress}`);
      return Address.parse(listing.walletAddress);
    }
    
    // Strategy 2: Check user profile in Firestore
    console.log(`[PAYMENT] [DB] Checking user profile in Firestore...`);
    const userDocRef = doc(db, 'users', sellerId);
    const dbStart = Date.now();
    
    // Add timeout and retry logic for offline errors
    let userDoc = null;
    let retries = 3;
    let lastError = null;
    
    while (retries > 0) {
      try {
        userDoc = await Promise.race([
          getDoc(userDocRef),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Firestore query timeout')), 5000)
          )
        ]);
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        if (error.code === 'unavailable' || error.message.includes('offline') || error.message.includes('timeout')) {
          retries--;
          if (retries > 0) {
            console.warn(`[PAYMENT] [DB] ⚠️  Firestore offline/timeout, retrying... (${retries} attempts left)`);
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
            continue;
          }
        } else {
          throw error; // Non-retryable error
        }
      }
    }
    
    if (!userDoc && lastError) {
      throw lastError;
    }
    
    const dbTime = Date.now() - dbStart;
    
    if (userDoc && userDoc.exists()) {
      const userData = userDoc.data();
      console.log(`[PAYMENT] [DB] ✅ User profile retrieved (${dbTime}ms)`);
      // Check if user has wallet address stored
      if (userData.walletAddress) {
        console.log(`[PAYMENT] [DB] ✅ Seller wallet address found in user profile: ${userData.walletAddress}`);
        return Address.parse(userData.walletAddress);
      } else {
        console.warn(`[PAYMENT] [DB] ⚠️  User profile exists but no walletAddress field found`);
        console.log(`[PAYMENT] [DB]   - Available fields: ${Object.keys(userData).join(', ')}`);
      }
    } else {
      console.warn(`[PAYMENT] [DB] ⚠️  User profile not found for seller: ${sellerId}`);
    }
    
    return null;
  } catch (error) {
    console.error(`[PAYMENT] [DB] ❌ Error getting seller wallet address for seller ${sellerId}:`, error);
    // Don't throw - return null so caller can handle gracefully
    return null;
  }
}

/**
 * Transfer USDT from escrow wallet to seller and server
 * @param {string} orderId - The order ID
 * @param {string} itemId - The item/listing ID
 * @param {TonClient} tonClient - TON client instance
 * @returns {Promise<{success: boolean, serverAmount: string, sellerAmount: string}>}
 */
export async function releaseEscrowFunds(orderId, itemId, tonClient) {
  const startTime = Date.now();
  try {
    console.log(`[PAYMENT] ========== Payment Step 2: Escrow Release Started ==========`);
    console.log(`[PAYMENT] [ESCROW] Order ID: ${orderId}`);
    console.log(`[PAYMENT] [ESCROW] Item ID: ${itemId || 'will be retrieved from DB'}`);
    console.log(`[PAYMENT] [ESCROW] Timestamp: ${new Date().toISOString()}`);
    
    // 0. Get escrow wallet address from database (just address, not mnemonic yet)
    console.log(`[PAYMENT] [ESCROW] Step 0/14: Getting escrow wallet address from database...`);
    console.log(`[PAYMENT] [ESCROW]   - Order ID: ${orderId}`);
    const addressDbStart = Date.now();
    const walletDataForAddress = await getWalletForOrder(orderId);
    const addressDbTime = Date.now() - addressDbStart;
    const escrowWalletAddress = Address.parse(walletDataForAddress.walletAddress);
    console.log(`[PAYMENT] [ESCROW] ✅ Retrieved escrow wallet address from database (${addressDbTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Escrow Wallet Address: ${escrowWalletAddress.toString()}`);
    
    // 1. Send 0.1 TON from server wallet to escrow wallet
    console.log(`[PAYMENT] [ESCROW] Step 1/14: Server wallet sending 0.1 TON to escrow wallet...`);
    const tonSendStart = Date.now();
    await sendTonToEscrowWallet(escrowWalletAddress, tonClient);
    const tonSendTime = Date.now() - tonSendStart;
    console.log(`[PAYMENT] [ESCROW] ✅ Server wallet sent 0.1 TON to escrow wallet (${tonSendTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Escrow wallet now has minimum TON balance to accept external messages`);
    
    // 2. Get escrow wallet mnemonic from database (now that we've sent TON)
    console.log(`[PAYMENT] [ESCROW] Step 2/14: Retrieving escrow wallet mnemonic from database...`);
    console.log(`[PAYMENT] [ESCROW]   - Order ID: ${orderId}`);
    const dbStart = Date.now();
    const walletData = await getWalletForOrder(orderId);
    const dbTime = Date.now() - dbStart;
    console.log(`[PAYMENT] [ESCROW] ✅ Retrieved escrow wallet mnemonic from database (${dbTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Wallet Address: ${walletData.walletAddress}`);
    console.log(`[PAYMENT] [ESCROW]   - Mnemonic: ${walletData.mnemonic ? '***RETRIEVED***' : 'NOT FOUND'}`);
    console.log(`[PAYMENT] [ESCROW]   - User ID: ${walletData.userId || 'none'}`);
    console.log(`[PAYMENT] [ESCROW]   - Item ID: ${walletData.itemId || 'none'}`);
    
    // 3. Get listing to find seller (use itemId from wallet data if not provided)
    console.log(`[PAYMENT] [ESCROW] Step 3/14: Getting listing information...`);
    const finalItemId = itemId || walletData.itemId;
    if (!finalItemId) {
      console.error(`[PAYMENT] [ESCROW] ❌ No itemId found for order: ${orderId}`);
      throw new Error(`No itemId found for order: ${orderId}`);
    }
    console.log(`[PAYMENT] [ESCROW]   - Using Item ID: ${finalItemId}`);
    
    const listingStart = Date.now();
    const listing = await fetchShopItemById(finalItemId);
    const listingTime = Date.now() - listingStart;
    if (!listing) {
      console.error(`[PAYMENT] [ESCROW] ❌ Listing not found: ${finalItemId}`);
      throw new Error(`Listing not found: ${finalItemId}`);
    }
    console.log(`[PAYMENT] [ESCROW] ✅ Listing retrieved (${listingTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Listing Title: ${listing.title || 'N/A'}`);
    console.log(`[PAYMENT] [ESCROW]   - Listing Price: ${listing.price || 'N/A'}`);
    
    const sellerId = listing.sellerId;
    if (!sellerId) {
      console.error(`[PAYMENT] [ESCROW] ❌ No seller ID found in listing: ${finalItemId}`);
      throw new Error(`No seller ID found in listing: ${finalItemId}`);
    }
    console.log(`[PAYMENT] [ESCROW]   - Seller ID: ${sellerId}`);
    
    // 4. Get seller wallet address (check listing first, then user profile)
    console.log(`[PAYMENT] [ESCROW] Step 4/14: Getting seller wallet address...`);
    const sellerWalletStart = Date.now();
    const sellerWalletAddress = await getSellerWalletAddress(sellerId, listing);
    const sellerWalletTime = Date.now() - sellerWalletStart;
    if (!sellerWalletAddress) {
      console.error(`[PAYMENT] [ESCROW] ❌ Seller wallet address not found for seller: ${sellerId}`);
      throw new Error(`Seller wallet address not found for seller: ${sellerId}. Please ensure the seller has a walletAddress in their user profile or in the listing.`);
    }
    console.log(`[PAYMENT] [ESCROW] ✅ Seller wallet address retrieved (${sellerWalletTime}ms): ${sellerWalletAddress.toString()}`);
    console.log(`[PAYMENT] [ESCROW]   - Seller Wallet: ${sellerWalletAddress.toString()}`);
    
    // 5. Get server wallet address from environment
    console.log(`[PAYMENT] [ESCROW] Step 5/14: Getting server wallet address...`);
    const serverWalletAddressStr = process.env.SERVER_WALLET_ADDRESS;
    if (!serverWalletAddressStr) {
      console.error(`[PAYMENT] [ESCROW] ❌ SERVER_WALLET_ADDRESS not configured`);
      throw new Error('SERVER_WALLET_ADDRESS not configured in environment');
    }
    const serverWalletAddress = Address.parse(serverWalletAddressStr);
    console.log(`[PAYMENT] [ESCROW] ✅ Server wallet address configured`);
    console.log(`[PAYMENT] [ESCROW]   - Server Wallet: ${serverWalletAddress.toString()}`);
    
    // 6. Restore escrow wallet from mnemonic (w5 wallet supports jetton gas payments)
    console.log(`[PAYMENT] [ESCROW] Step 6/14: Restoring escrow wallet using mnemonic...`);
    console.log(`[PAYMENT] [ESCROW]   - Using mnemonic from database: ${walletData.mnemonic ? 'YES' : 'NO'}`);
    const restoreStart = Date.now();
    const { wallet: escrowWallet, keyPair, walletType } = await restoreWalletFromMnemonic(walletData.mnemonic);
    const restoreTime = Date.now() - restoreStart;
    console.log(`[PAYMENT] [ESCROW] ✅ Escrow wallet restored from mnemonic (${restoreTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Escrow Wallet Address: ${escrowWallet.address.toString()}`);
    console.log(`[PAYMENT] [ESCROW]   - Wallet Type: ${walletType || 'w5'} (supports jetton gas payments)`);
    console.log(`[PAYMENT] [ESCROW]   - KeyPair: ${keyPair ? 'GENERATED' : 'NOT GENERATED'}`);
    
    // 7. Check escrow wallet TON balance (for reference, but gas can be paid from USDT)
    console.log(`[PAYMENT] [ESCROW] Step 7/14: Checking escrow wallet TON balance...`);
    const balanceCheckStart = Date.now();
    
    // Create provider first (needed for later steps)
    let escrowProvider = tonClient.provider(escrowWallet.address);
    
    // Use getBalance() which works even for uninitialized contracts
    // This is more reliable than calling get('balance') on the contract
    let escrowTonBalance;
    try {
      escrowTonBalance = await tonClient.getBalance(escrowWallet.address);
      console.log(`[PAYMENT] [ESCROW] ✅ Balance retrieved via getBalance(): ${escrowTonBalance.toString()}`);
    } catch (error) {
      // If getBalance fails, try alternative method
      console.warn(`[PAYMENT] [ESCROW] ⚠️  getBalance() failed, trying account state...`, error.message);
      try {
        const account = await tonClient.getAccount(escrowWallet.address);
        escrowTonBalance = account.balance;
        console.log(`[PAYMENT] [ESCROW] ✅ Balance retrieved via getAccount(): ${escrowTonBalance.toString()}`);
      } catch (accountError) {
        // If both fail, try contract method as last resort
        console.warn(`[PAYMENT] [ESCROW] ⚠️  getAccount() failed, trying contract method...`, accountError.message);
        try {
          const escrowBalance = await escrowProvider.get('balance');
          escrowTonBalance = escrowBalance.stack.readBigNumber();
          console.log(`[PAYMENT] [ESCROW] ✅ Balance retrieved via contract method: ${escrowTonBalance.toString()}`);
        } catch (contractError) {
          // If contract is not initialized (-13), assume balance is 0
          if (contractError.message?.includes('-13') || contractError.message?.includes('exit_code')) {
            console.warn(`[PAYMENT] [ESCROW] ⚠️  Wallet contract not initialized (exit_code: -13), balance is likely 0`);
            escrowTonBalance = BigInt(0);
          } else {
            throw contractError;
          }
        }
      }
    }
    
    const requiredGas = JETTON_TRANSFER_GAS_FEES * BigInt(2); // Need gas for 2 transfers
    const balanceCheckTime = Date.now() - balanceCheckStart;
    
    // Minimum TON needed to accept external messages (w5 wallets need this even if gas is paid from USDT)
    const MIN_TON_FOR_EXTERNAL_MESSAGE = toNano('0.1'); // 0.1 TON minimum
    
    console.log(`[PAYMENT] [ESCROW] ✅ TON balance checked (${balanceCheckTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Available: ${escrowTonBalance.toString()} nanoTON (${Number(escrowTonBalance) / 1e9} TON)`);
    console.log(`[PAYMENT] [ESCROW]   - Minimum Required: ${MIN_TON_FOR_EXTERNAL_MESSAGE.toString()} nanoTON (0.1 TON) to accept external messages`);
    
    // Check if wallet has minimum TON to accept external messages
    if (escrowTonBalance < MIN_TON_FOR_EXTERNAL_MESSAGE) {
      const errorMsg = `Escrow wallet has insufficient TON balance to accept external messages. Required: ${MIN_TON_FOR_EXTERNAL_MESSAGE.toString()} nanoTON (0.1 TON), Available: ${escrowTonBalance.toString()} nanoTON. Even though w5 wallets can pay gas from USDT, they still need a minimum TON balance to accept external messages. Please ensure the escrow wallet receives at least 0.1 TON before attempting transfers.`;
      console.error(`[PAYMENT] [ESCROW] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    // Note: Gas fees can be paid from USDT balance in w5 wallets
    // But we still need minimum TON to accept the external message
    if (escrowTonBalance < requiredGas) {
      console.warn(`[PAYMENT] [ESCROW] ⚠️  TON balance below gas requirement, but sufficient to accept messages`);
      console.log(`[PAYMENT] [ESCROW]   - Gas fees will be deducted from USDT balance by w5 wallet`);
    } else {
      console.log(`[PAYMENT] [ESCROW] ✅ TON balance sufficient for both message acceptance and gas fees`);
    }
    
    // 8. Get escrow wallet's USDT jetton wallet address
    console.log(`[PAYMENT] [ESCROW] Step 8/14: Getting escrow USDT jetton wallet address...`);
    const jettonAddressStart = Date.now();
    const jettonMaster = tonClient.open(JettonMaster.create(USDT_MASTER_ADDRESS));
    const escrowUsdtAddress = await jettonMaster.getWalletAddress(escrowWallet.address);
    const jettonAddressTime = Date.now() - jettonAddressStart;
    console.log(`[PAYMENT] [ESCROW] ✅ USDT jetton wallet address retrieved (${jettonAddressTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Escrow USDT Wallet: ${escrowUsdtAddress.toString()}`);
    
    // 9. Open escrow's USDT jetton wallet
    console.log(`[PAYMENT] [ESCROW] Step 9/14: Opening escrow USDT jetton wallet...`);
    const escrowJettonWallet = tonClient.open(JettonWallet.createFromAddress(escrowUsdtAddress));
    console.log(`[PAYMENT] [ESCROW] ✅ USDT jetton wallet opened`);
    
    // 10. Get current USDT balance
    console.log(`[PAYMENT] [ESCROW] Step 10/14: Checking escrow wallet's USDT balance...`);
    console.log(`[PAYMENT] [ESCROW]   - Escrow USDT Wallet Address: ${escrowUsdtAddress.toString()}`);
    const usdtBalanceStart = Date.now();
    const walletData_result = await escrowJettonWallet.getWalletData(tonClient.provider(escrowUsdtAddress));
    const totalBalance = walletData_result.balance;
    const usdtBalanceTime = Date.now() - usdtBalanceStart;
    console.log(`[PAYMENT] [ESCROW] ✅ Escrow wallet USDT balance checked (${usdtBalanceTime}ms)`);
    console.log(`[PAYMENT] [ESCROW]   - Total USDT Balance: ${totalBalance.toString()} units`);
    console.log(`[PAYMENT] [ESCROW]   - Total USDT Balance (formatted): ${Number(totalBalance) / 1000000} USDT`);
    
    if (totalBalance === BigInt(0)) {
      console.error(`[PAYMENT] [ESCROW] ❌ Escrow wallet has zero USDT balance`);
      throw new Error('Escrow wallet has zero USDT balance');
    }
    console.log(`[PAYMENT] [ESCROW]   - USDT balance is sufficient for transfer`);
    
    // 11. Calculate split: 5% server, 95% seller
    // Note: w5 wallets automatically pay gas fees from USDT, so we don't need to deduct gas fees
    // The gas will be automatically deducted by the wallet during the transfer
    console.log(`[PAYMENT] [ESCROW] Step 11/14: Calculating split (5% to server wallet, 95% to seller wallet)...`);
    console.log(`[PAYMENT] [ESCROW]   - Total Balance: ${totalBalance.toString()} units (${Number(totalBalance) / 1000000} USDT)`);
    const serverPercentage = 5; // 5%
    const sellerPercentage = 95; // 95%
    console.log(`[PAYMENT] [ESCROW]   - Split Percentage: ${serverPercentage}% server, ${sellerPercentage}% seller`);
    
    // Calculate amounts from total balance (using integer math to avoid precision issues)
    // totalBalance is in smallest USDT units (6 decimals)
    // w5 wallets will automatically deduct gas fees from the transfer amount
    if (!totalBalance || typeof totalBalance !== 'bigint' || totalBalance === BigInt(0)) {
      throw new Error(`Invalid totalBalance: ${totalBalance}`);
    }
    
    console.log(`[PAYMENT] [ESCROW]   - Calculating server amount (5% of ${totalBalance.toString()})...`);
    const serverAmount = (totalBalance * BigInt(serverPercentage)) / BigInt(100);
    console.log(`[PAYMENT] [ESCROW]   - Calculating seller amount (95% of ${totalBalance.toString()})...`);
    const sellerAmount = (totalBalance * BigInt(sellerPercentage)) / BigInt(100);
    
    // Verify amounts are valid BigInt values
    if (!serverAmount || typeof serverAmount !== 'bigint') {
      throw new Error(`Invalid serverAmount calculated: ${serverAmount}`);
    }
    if (!sellerAmount || typeof sellerAmount !== 'bigint') {
      throw new Error(`Invalid sellerAmount calculated: ${sellerAmount}`);
    }
    
    // Verify amounts add up correctly (within rounding tolerance)
    const calculatedTotal = serverAmount + sellerAmount;
    const difference = totalBalance - calculatedTotal;
    
    // If there's a small difference due to rounding, add it to seller amount
    const finalSellerAmount = sellerAmount + difference;
    
    // Final validation
    if (!finalSellerAmount || typeof finalSellerAmount !== 'bigint') {
      throw new Error(`Invalid finalSellerAmount calculated: ${finalSellerAmount}`);
    }
    
    console.log(`[PAYMENT] [ESCROW] ✅ Split calculation completed`);
    console.log(`[PAYMENT] [ESCROW]   - Server Amount (5%): ${serverAmount.toString()} units (${Number(serverAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - Seller Amount (95%): ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - Rounding difference: ${difference.toString()} units`);
    console.log(`[PAYMENT] [ESCROW]   - Note: Gas fees will be automatically deducted from transfers by w5 wallet`);
    
    // 12. Create sender for escrow wallet
    console.log(`[PAYMENT] [ESCROW] Step 12/14: Creating sender for escrow wallet...`);
    const escrowSender = escrowWallet.sender(escrowProvider, keyPair.secretKey);
    console.log(`[PAYMENT] [ESCROW] ✅ Sender created`);
    
    // 13. Transfer to server wallet (5%)
    console.log(`[PAYMENT] [ESCROW] Step 13/14: Transferring funds from escrow to server wallet (5% platform fee)...`);
    console.log(`[PAYMENT] [ESCROW]   - Transfer Type: Server fee (platform fee)`);
    console.log(`[PAYMENT] [ESCROW]   - Amount: ${serverAmount.toString()} units (${Number(serverAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - From: Escrow wallet (${escrowWallet.address.toString()})`);
    console.log(`[PAYMENT] [ESCROW]   - To: Server wallet (${serverWalletAddress.toString()})`);
    console.log(`[PAYMENT] [ESCROW]   - Gas: ${JETTON_TRANSFER_GAS_FEES.toString()} nanoTON (paid from USDT by w5 wallet)`);
    
    // Validate amounts are defined and are BigInt
    if (!serverAmount || typeof serverAmount !== 'bigint') {
      throw new Error(`Invalid serverAmount: ${serverAmount}`);
    }
    if (!serverWalletAddress) {
      throw new Error('Server wallet address is undefined');
    }
    
    const serverTransferStart = Date.now();
    console.log(`[PAYMENT] [ESCROW]   - Initiating transfer to server wallet...`);
    try {
      // When using tonClient.open(), provider is automatically injected, so we only pass via (sender) and opts
      await escrowJettonWallet.sendTransfer(escrowSender, {
        fwdAmount: BigInt(1),
        comment: `Order ${orderId} - Server fee`,
        jettonAmount: serverAmount, // Must be BigInt
        toAddress: serverWalletAddress,
        value: JETTON_TRANSFER_GAS_FEES, // Gas will be paid from USDT by w5 wallet
      });
      const serverTransferTime = Date.now() - serverTransferStart;
      console.log(`[PAYMENT] [ESCROW] ✅ Transfer to server wallet completed successfully (${serverTransferTime}ms)`);
      console.log(`[PAYMENT] [ESCROW]   - Server received: ${serverAmount.toString()} units (${Number(serverAmount) / 1000000} USDT)`);
    } catch (error) {
      const serverTransferTime = Date.now() - serverTransferStart;
      console.error(`[PAYMENT] [ESCROW] ❌ Transfer to server wallet failed (${serverTransferTime}ms)`);
      console.error(`[PAYMENT] [ESCROW]   - Error: ${error.message || 'Unknown error'}`);
      if (error.message?.includes('inbound external message rejected') || 
          error.message?.includes('cannot apply external message') ||
          error.response?.data?.error?.includes('inbound external message rejected')) {
        throw new Error(`Escrow wallet cannot accept external messages. This usually means the wallet needs at least 0.1 TON to accept external messages, even though w5 wallets can pay gas from USDT. Current balance: ${escrowTonBalance.toString()} nanoTON. Please ensure the escrow wallet receives at least 0.1 TON before attempting transfers. Original error: ${error.message || error.response?.data?.error || 'Unknown error'}`);
      }
      throw error;
    }
    
    // 14. Transfer to seller wallet (95%)
    console.log(`[PAYMENT] [ESCROW] Step 14/14: Transferring funds from escrow to seller wallet (remaining 95%)...`);
    console.log(`[PAYMENT] [ESCROW]   - Transfer Type: Seller payment`);
    console.log(`[PAYMENT] [ESCROW]   - Amount: ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - From: Escrow wallet (${escrowWallet.address.toString()})`);
    console.log(`[PAYMENT] [ESCROW]   - To: Seller wallet (${sellerWalletAddress.toString()})`);
    console.log(`[PAYMENT] [ESCROW]   - Gas: ${JETTON_TRANSFER_GAS_FEES.toString()} nanoTON (paid from USDT by w5 wallet)`);
    
    // Validate amounts are defined and are BigInt
    if (!finalSellerAmount || typeof finalSellerAmount !== 'bigint') {
      throw new Error(`Invalid sellerAmount: ${finalSellerAmount}`);
    }
    if (!sellerWalletAddress) {
      throw new Error('Seller wallet address is undefined');
    }
    
    const sellerTransferStart = Date.now();
    console.log(`[PAYMENT] [ESCROW]   - Initiating transfer to seller wallet...`);
    try {
      // When using tonClient.open(), provider is automatically injected, so we only pass via (sender) and opts
      await escrowJettonWallet.sendTransfer(escrowSender, {
        fwdAmount: BigInt(1),
        comment: `Order ${orderId} - Seller payment`,
        jettonAmount: finalSellerAmount, // Must be BigInt
        toAddress: sellerWalletAddress,
        value: JETTON_TRANSFER_GAS_FEES, // Gas will be paid from USDT by w5 wallet
      });
      const sellerTransferTime = Date.now() - sellerTransferStart;
      console.log(`[PAYMENT] [ESCROW] ✅ Transfer to seller wallet completed successfully (${sellerTransferTime}ms)`);
      console.log(`[PAYMENT] [ESCROW]   - Seller received: ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);
    } catch (error) {
      const sellerTransferTime = Date.now() - sellerTransferStart;
      console.error(`[PAYMENT] [ESCROW] ❌ Transfer to seller wallet failed (${sellerTransferTime}ms)`);
      console.error(`[PAYMENT] [ESCROW]   - Error: ${error.message || 'Unknown error'}`);
      if (error.message?.includes('inbound external message rejected') || 
          error.message?.includes('cannot apply external message') ||
          error.response?.data?.error?.includes('inbound external message rejected')) {
        throw new Error(`Escrow wallet cannot accept external messages. This usually means the wallet needs at least 0.1 TON to accept external messages, even though w5 wallets can pay gas from USDT. Current balance: ${escrowTonBalance.toString()} nanoTON. Please ensure the escrow wallet receives at least 0.1 TON before attempting transfers. Original error: ${error.message || error.response?.data?.error || 'Unknown error'}`);
      }
      throw error;
    }
    
    const totalTime = Date.now() - startTime;
    console.log(`[PAYMENT] [ESCROW] ========== Escrow Release Completed Successfully ==========`);
    console.log(`[PAYMENT] [ESCROW]   - Total Time: ${totalTime}ms`);
    console.log(`[PAYMENT] [ESCROW]   - Server Amount: ${serverAmount.toString()} units (${Number(serverAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - Seller Amount: ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT] [ESCROW]   - Total Amount: ${totalBalance.toString()} units (${Number(totalBalance) / 1000000} USDT)`);
    console.log(`[PAYMENT] ========== Payment Step 2 Complete (${totalTime}ms) ==========`);
    
    return {
      success: true,
      serverAmount: serverAmount.toString(),
      sellerAmount: finalSellerAmount.toString(),
      totalAmount: totalBalance.toString(),
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[PAYMENT] [ESCROW] ❌ Error releasing funds for order ${orderId} (${totalTime}ms):`, error);
    console.error(`[PAYMENT] [ESCROW] Error details:`, {
      message: error.message,
      stack: error.stack,
      orderId,
      itemId,
    });
    console.log(`[PAYMENT] ========== Payment Step 2 Failed (${totalTime}ms) ==========`);
    throw error;
  }
}

