import { Address, toNano } from '@ton/core';

// Calculate USDT amount from USD (USDT has 6 decimals)
export const calculateUsdtAmount = (usdCents) => {
  // Convert USD cents to USDT (multiply by 10,000 to get 6 decimal places)
  return BigInt(usdCents * 10000);
};

// Calculate USD from USDT amount
export const calculateUsdFromUsdt = (usdtAmount) => {
  return Math.round((Number(usdtAmount) / 1000000) * 100) / 100;
};

// Parse price string (e.g., "100 USDT" or "100") to number
export const parsePrice = (priceString) => {
  if (!priceString) return 0;
  const match = priceString.toString().match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
};

// Gas fees for jetton transfer (in nanoTON)
export const JETTON_TRANSFER_GAS_FEES = toNano('0.038');

// USDT Master Contract Address (testnet) - already parsed as Address object
export const USDT_MASTER_ADDRESS = Address.parse('EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs');

/**
 * Creates a new invoice wallet for an order and stores it in the database
 * This function is called from CheckoutPage when user clicks Pay
 * @param {string} orderId - The order ID
 * @param {string|null} userId - Optional user ID
 * @returns {Promise<Address>} The address of the newly created wallet
 */
export async function createInvoiceWalletForOrder(orderId, userId = null) {
  const { createNewTonWallet } = await import('./walletUtils.js');
  const { storeWalletForOrder } = await import('../services/firestoreService.js');
  
  // Create new wallet
  const { mnemonic, address, walletAddress } = await createNewTonWallet();
  
  // Store in database
  await storeWalletForOrder(orderId, mnemonic, walletAddress, userId);
  
  return address;
}

