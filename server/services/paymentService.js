import { TonClient } from '@ton/ton';
import { Address } from '@ton/core';
import { JettonMaster } from '@ton/ton';
import { JettonWallet } from '../wrappers/JettonWallet.js';
import { restoreWalletFromMnemonic } from '../utils/walletUtils.js';
import { USDT_MASTER_ADDRESS, JETTON_TRANSFER_GAS_FEES } from '../utils/paymentHelpers.js';
import { storeTransaction } from './transactionService.js';

/**
 * Process payment: Send 95% of received USDT to seller, keep 5% as fee
 * @param {string} orderId - The order ID
 * @param {string} sellerAddress - The seller's wallet address
 * @param {TonClient} tonClient - TON client instance
 * @param {string|BigInt} amount - Optional: specific amount to process (in USDT units with 6 decimals). If not provided, processes entire balance.
 * @returns {Promise<{success: boolean, sellerAmount: string, serverAmount: string, totalAmount: string}>}
 */
export async function processPayment(orderId, sellerAddress, tonClient, amount = null) {
  const startTime = Date.now();
  try {
    console.log(`[PAYMENT] ========== Processing Payment ==========`);
    console.log(`[PAYMENT] Order ID: ${orderId}`);
    console.log(`[PAYMENT] Seller Address: ${sellerAddress}`);
    console.log(`[PAYMENT] Timestamp: ${new Date().toISOString()}`);

    // Validate inputs
    if (!orderId) {
      throw new Error('orderId is required');
    }
    if (!sellerAddress) {
      throw new Error('sellerAddress is required');
    }

    const sellerAddressParsed = Address.parse(sellerAddress);

    // Get server wallet address and mnemonic from environment
    const serverWalletAddressStr = process.env.SERVER_WALLET_ADDRESS;
    const serverWalletMnemonicStr = process.env.SERVER_WALLET_MNEMONIC;

    if (!serverWalletAddressStr) {
      throw new Error('SERVER_WALLET_ADDRESS not configured');
    }
    if (!serverWalletMnemonicStr) {
      throw new Error('SERVER_WALLET_MNEMONIC not configured');
    }

    const serverWalletAddress = Address.parse(serverWalletAddressStr);
    console.log(`[PAYMENT] Server wallet address: ${serverWalletAddress.toString()}`);

    // Restore server wallet from mnemonic
    console.log(`[PAYMENT] Restoring server wallet from mnemonic...`);
    const { wallet: serverWallet, keyPair } = await restoreWalletFromMnemonic(serverWalletMnemonicStr);
    console.log(`[PAYMENT] Server wallet restored: ${serverWallet.address.toString()}`);
    
    // Verify restored wallet address matches configured address
    if (serverWallet.address.toString() !== serverWalletAddress.toString()) {
      console.warn(`[PAYMENT] ⚠️  WARNING: Restored wallet address (${serverWallet.address.toString()}) does not match SERVER_WALLET_ADDRESS (${serverWalletAddress.toString()})`);
      console.warn(`[PAYMENT] ⚠️  Using restored wallet address for USDT jetton wallet calculation`);
    }

    // Get server's USDT jetton wallet address (use restored wallet address, not env variable)
    console.log(`[PAYMENT] Getting server's USDT jetton wallet address...`);
    const jettonMaster = tonClient.open(JettonMaster.create(USDT_MASTER_ADDRESS));
    const serverUsdtAddress = await jettonMaster.getWalletAddress(serverWallet.address);
    console.log(`[PAYMENT] Server USDT wallet: ${serverUsdtAddress.toString()}`);

    // Open server's USDT jetton wallet (using tonClient.open() to auto-inject provider)
    console.log(`[PAYMENT] Opening server's USDT jetton wallet...`);
    const serverJettonWallet = tonClient.open(JettonWallet.createFromAddress(serverUsdtAddress));

    // Determine amount to process
    let amountToProcess;
    if (amount !== null && amount !== undefined) {
      // Use provided amount
      amountToProcess = typeof amount === 'string' ? BigInt(amount) : amount;
      console.log(`[PAYMENT] Processing specific amount: ${amountToProcess.toString()} units (${Number(amountToProcess) / 1000000} USDT)`);
    } else {
      // Process entire balance
      console.log(`[PAYMENT] Checking server's USDT balance...`);
      const provider = tonClient.provider(serverUsdtAddress);
      const walletData = await serverJettonWallet.getWalletData(provider);
      amountToProcess = walletData.balance;
      console.log(`[PAYMENT] Server USDT balance: ${amountToProcess.toString()} units (${Number(amountToProcess) / 1000000} USDT)`);
    }

    if (amountToProcess === BigInt(0)) {
      throw new Error('Amount to process is zero');
    }

    // Calculate split: 5% server, 95% seller
    // Send 95% of the received USDT to seller, keep 5% as fee
    console.log(`[PAYMENT] Calculating split (5% server, 95% seller)...`);
    console.log(`[PAYMENT]   - Total received: ${amountToProcess.toString()} units (${Number(amountToProcess) / 1000000} USDT)`);
    
    const serverPercentage = 5;
    const sellerPercentage = 95;

    // Calculate 95% of the RECEIVED AMOUNT for seller
    // Using integer math: sellerAmount = (total * 95) / 100
    const sellerAmount = (amountToProcess * BigInt(sellerPercentage)) / BigInt(100);
    
    // Server keeps the remainder (5% of received amount)
    const serverAmount = amountToProcess - sellerAmount;
    
    // Final amounts
    const finalSellerAmount = sellerAmount;
    const finalServerAmount = serverAmount;

    console.log(`[PAYMENT] Split calculated:`);
    console.log(`[PAYMENT]   - Server fee (5%): ${finalServerAmount.toString()} units (${Number(finalServerAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT]   - Seller (95%): ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);

    // Check server wallet TON balance for gas fees
    console.log(`[PAYMENT] Checking server wallet TON balance for gas fees...`);
    const serverTonBalance = await tonClient.getBalance(serverWallet.address);
    console.log(`[PAYMENT] Server TON balance: ${serverTonBalance.toString()} nanoTON (${Number(serverTonBalance) / 1e9} TON)`);
    
    if (serverTonBalance < JETTON_TRANSFER_GAS_FEES) {
      const requiredTon = Number(JETTON_TRANSFER_GAS_FEES) / 1e9;
      const availableTon = Number(serverTonBalance) / 1e9;
      throw new Error(`Server wallet has insufficient TON balance for gas fees. Required: ${requiredTon} TON, Available: ${availableTon} TON. Please fund the server wallet with TON.`);
    }

    // Create sender for server wallet
    console.log(`[PAYMENT] Creating sender for server wallet...`);
    const serverProvider = tonClient.provider(serverWallet.address);
    const serverSender = serverWallet.sender(serverProvider, keyPair.secretKey);
    console.log(`[PAYMENT] Sender created for wallet: ${serverWallet.address.toString()}`);

    // Send 95% to seller
    console.log(`[PAYMENT] Sending ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT) to seller...`);
    console.log(`[PAYMENT]   - From: Server USDT wallet (${serverUsdtAddress.toString()})`);
    console.log(`[PAYMENT]   - To: ${sellerAddressParsed.toString()}`);
    console.log(`[PAYMENT]   - Gas fee: ${JETTON_TRANSFER_GAS_FEES.toString()} nanoTON (${Number(JETTON_TRANSFER_GAS_FEES) / 1e9} TON)`);

    // When using tonClient.open(), provider is automatically injected, so we only pass via (sender) and opts
    await serverJettonWallet.sendTransfer(serverSender, {
      fwdAmount: BigInt(1),
      comment: `Order ${orderId} - Payment`,
      jettonAmount: finalSellerAmount,
      toAddress: sellerAddressParsed,
      value: JETTON_TRANSFER_GAS_FEES,
    });

    console.log(`[PAYMENT] ✅ Payment processed successfully`);
    console.log(`[PAYMENT]   - Seller received: ${finalSellerAmount.toString()} units (${Number(finalSellerAmount) / 1000000} USDT)`);
    console.log(`[PAYMENT]   - Server fee: ${finalServerAmount.toString()} units (${Number(finalServerAmount) / 1000000} USDT)`);

    // Try to get transaction hash ASYNCHRONOUSLY (non-blocking)
    // This runs in background and doesn't delay the response
    setTimeout(async () => {
      try {
        // Wait a bit for transaction to be included in blockchain
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        console.log(`[PAYMENT] Attempting to retrieve transaction hash (background)...`);
        // Query recent transactions from server's USDT wallet
        const transactions = await tonClient.getTransactions(serverUsdtAddress, { limit: 5 });
        if (transactions && transactions.length > 0) {
          // Get the most recent transaction (should be the one we just sent)
          const latestTx = transactions[0];
          // TON transaction hash is computed from the transaction data
          let transactionHash = null;
          try {
            // Try to get hash from transaction cell
            const txCell = latestTx.cell();
            if (txCell) {
              transactionHash = txCell.hash().toString('base64');
            } else {
              // Fallback: use lt as identifier (less ideal but works)
              transactionHash = `${serverUsdtAddress.toString()}_${latestTx.lt.toString()}`;
            }
          } catch (hashError) {
            // Fallback: use lt as identifier
            transactionHash = `${serverUsdtAddress.toString()}_${latestTx.lt.toString()}`;
          }
          
          if (transactionHash) {
            console.log(`[PAYMENT] ✅ Transaction hash retrieved (background): ${transactionHash}`);
            
            // Store transaction in database
            await storeTransaction(
              'server_to_seller',
              transactionHash,
              orderId,
              serverUsdtAddress,
              sellerAddressParsed,
              finalSellerAmount.toString(),
              {
                serverAmount: finalServerAmount.toString(),
                totalAmount: amountToProcess.toString(),
              }
            );
            console.log(`[PAYMENT] ✅ Transaction hash stored successfully (background)`);
          }
        } else {
          console.warn(`[PAYMENT] ⚠️  Could not retrieve transaction hash (background) - no transactions found`);
        }
      } catch (txError) {
        console.warn(`[PAYMENT] ⚠️  Could not retrieve transaction hash (background):`, txError.message);
        // This is non-blocking, so we don't throw - transaction was sent successfully
      }
    }, 0); // Run in next tick, non-blocking

    const totalTime = Date.now() - startTime;
    console.log(`[PAYMENT] ========== Payment Processing Complete (${totalTime}ms) ==========`);

    // Return immediately without waiting for hash retrieval
    return {
      success: true,
      sellerAmount: finalSellerAmount.toString(),
      serverAmount: finalServerAmount.toString(),
      totalAmount: amountToProcess.toString(),
    };
  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error(`[PAYMENT] ❌ Error processing payment (${totalTime}ms):`, error);
    console.error(`[PAYMENT] Error details:`, {
      message: error.message,
      stack: error.stack,
      orderId,
      sellerAddress,
    });
    throw error;
  }
}

