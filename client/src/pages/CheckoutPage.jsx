import { useState, useCallback, useEffect } from 'react';
import { JettonMaster } from '@ton/ton';
import { Address } from '@ton/core';
import { useTonConnectModal } from '@tonconnect/ui-react';
import { useTonConnect } from '../hooks/useTonConnect';
import { JettonWallet } from '../wrappers/JettonWallet';
import { 
  calculateUsdtAmount, 
  parsePrice, 
  getPaymentConstants,
  processPayment as processPaymentApi,
  storeBuyerTransaction
} from '../services/apiService';

export function CheckoutPage({ listing, onBack, onPaymentComplete }) {
  const { sender, walletAddress, tonClient, connected, network, tonConnectUI } = useTonConnect();
  const { open } = useTonConnectModal();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [paymentConstants, setPaymentConstants] = useState(null);

  // Generate order ID (simple UUID-like string)
  const orderId = `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // Load payment constants from backend
  useEffect(() => {
    getPaymentConstants().then(setPaymentConstants).catch(console.error);
  }, []);

  const price = parsePrice(listing?.price || '0');
  const fee = price * 0.05; // 5% fee
  const totalCost = price + fee; // Total including fee

  const handleConnectWallet = useCallback(() => {
    open();
  }, [open]);

  // Format wallet address in Tonkeeper style (first 6 and last 4 characters)
  // Uses user-friendly format (UQ prefix) like Tonkeeper
  const formatWalletAddress = useCallback((address) => {
    if (!address) return '';
    // Get user-friendly format (UQ prefix) like Tonkeeper uses
    const addressStr = address.toString({ bounceable: false });
    if (addressStr.length <= 10) return addressStr;
    // Show first 6 characters and last 4 characters, like Tonkeeper: "UQAbc1...xyz"
    return `${addressStr.slice(0, 6)}...${addressStr.slice(-4)}`;
  }, []);

  const handleCompletePayment = useCallback(async () => {
    if (!tonClient || !walletAddress) {
      setError('Wallet not connected');
      return;
    }

    if (!paymentConstants) {
      setError('Payment constants not loaded');
      return;
    }

    // Get seller address from listing
    const sellerWalletAddress = listing?.walletAddress;
    if (!sellerWalletAddress) {
      setError('Seller wallet address not found in listing');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      console.log('Starting payment:', { 
        walletAddress: walletAddress?.toString({ bounceable: false }), 
        network,
        orderId,
        sellerAddress: sellerWalletAddress
      });

      // Get server wallet address from payment constants
      const serverWalletAddress = paymentConstants.SERVER_WALLET_ADDRESS;
      console.log('Server wallet address:', serverWalletAddress.toString());

      // Get user's USDT wallet address
      console.log('Opening jetton master...');
      const jettonMaster = tonClient.open(JettonMaster.create(paymentConstants.USDT_MASTER_ADDRESS));
      const usersUsdtAddress = await jettonMaster.getWalletAddress(walletAddress);
      console.log('User USDT address:', usersUsdtAddress.toString());

      // Create and open user's jetton wallet instance
      console.log('Opening jetton wallet...');
      const jettonWallet = tonClient.open(JettonWallet.createFromAddress(usersUsdtAddress));
      console.log('Jetton wallet opened');

      // Calculate USDT amount (price in USD * 100 to get cents, then convert to USDT)
      const usdtAmount = await calculateUsdtAmount(totalCost * 100);
      console.log('USDT amount calculated:', usdtAmount.toString());

      // Create comment with orderId and seller address for server processing
      // Format: "orderId|sellerAddress"
      const comment = `${orderId}|${sellerWalletAddress}`;
      console.log('Payment comment:', comment);
      console.log('Sending transfer to server wallet:', serverWalletAddress.toString());

      // Send USDT directly to server wallet (jetton system will route to server's USDT wallet)
      console.log('Initiating USDT transfer...');
      await jettonWallet.sendTransfer(sender, {
        fwdAmount: BigInt(1),
        comment: comment,
        jettonAmount: usdtAmount,
        toAddress: serverWalletAddress, // Send to server's TON wallet, jetton system routes to USDT wallet
        value: paymentConstants.JETTON_TRANSFER_GAS_FEES,
      });
      console.log('USDT transfer sent successfully');

      // Process payment immediately: Server sends 95% to seller, keeps 5% as fee
      // Don't wait for transaction hash - process payment right away
      console.log('Processing payment on server...');
      try {
        await processPaymentApi(orderId, sellerWalletAddress, usdtAmount.toString());
        console.log('Payment processed successfully - 95% sent to seller');
      } catch (processError) {
        console.error('Error processing payment on server:', processError);
        const errorMessage = processError?.message || processError?.error || 'Unknown error';
        
        // Show error to user
        setError(`Payment sent to server wallet, but automatic processing failed: ${errorMessage}. The payment can be processed manually later.`);
        
        // Don't fail the entire payment if processing fails - the payment was sent
        // The server can process it later manually or via monitoring
        console.warn('Payment sent but server processing failed. Payment can be processed manually.');
        
        // Still call onPaymentComplete so the UI updates, but user sees the error
        if (onPaymentComplete) {
          onPaymentComplete(orderId, totalCost);
        }
        return; // Exit early since processing failed
      }

      // Payment successful - show success immediately
      console.log('Payment completed successfully, calling onPaymentComplete');
      if (onPaymentComplete) {
        onPaymentComplete(orderId, totalCost);
      }

      // Try to get transaction hash ASYNCHRONOUSLY (non-blocking)
      // This runs in background and doesn't delay the success message
      (async () => {
        try {
          // Wait a bit for transaction to be included in blockchain (but don't block main flow)
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          console.log('Attempting to retrieve transaction hash (background)...');
          // Query recent transactions from user's USDT wallet
          const transactions = await tonClient.getTransactions(usersUsdtAddress, { limit: 5 });
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
                transactionHash = `${usersUsdtAddress.toString()}_${latestTx.lt.toString()}`;
              }
            } catch (hashError) {
              // Fallback: use lt as identifier
              transactionHash = `${usersUsdtAddress.toString()}_${latestTx.lt.toString()}`;
            }
            
            if (transactionHash) {
              console.log('Transaction hash retrieved (background):', transactionHash);
              
              // Store transaction in database
              await storeBuyerTransaction(
                transactionHash,
                orderId,
                walletAddress,
                serverWalletAddress,
                usdtAmount.toString()
              );
              console.log('Transaction hash stored successfully (background)');
            }
          } else {
            console.warn('Could not retrieve transaction hash (background) - no transactions found');
          }
        } catch (txError) {
          console.warn('Could not retrieve transaction hash (background):', txError.message);
          // This is non-blocking, so we don't throw - transaction was sent successfully
        }
      })(); // Immediately invoked, runs in background
    } catch (err) {
      console.error('Payment error:', err);
      console.error('Error details:', {
        message: err.message,
        stack: err.stack,
        name: err.name,
        fullError: err
      });
      
      let errorMessage = 'Payment failed. Please try again.';
      if (err.message?.includes('exit_code: -13')) {
        errorMessage = 'Unable to access USDT wallet. Make sure you have USDT in your wallet and are connected to the correct network (testnet/mainnet).';
      } else if (err.message) {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setProcessing(false);
    }
  }, [tonClient, walletAddress, sender, orderId, totalCost, onPaymentComplete, paymentConstants, listing]);

  if (!listing) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-xl p-4 text-center">
        <p>Listing not found</p>
        <button
          onClick={onBack}
          className="mt-4 bg-black text-white px-4 py-2 rounded-lg"
        >
          Go Back
        </button>
      </div>
    );
  }

  return (
    <section className="min-h-screen flex flex-col">
      <header className="mb-6 p-4 border-b border-gray-200">
        <div className="flex justify-between items-center mb-4">
          <button
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
            type="button"
            onClick={onBack}
            aria-label="Back"
            disabled={processing}
          >
            ← Back
          </button>
          {connected && (
            <button
              onClick={() => tonConnectUI.disconnect()}
              className="text-xs text-gray-600 hover:text-gray-900 transition-colors px-2 py-1 border border-gray-300 rounded hover:bg-gray-50"
              aria-label="Disconnect Wallet"
              title="Disconnect Wallet"
              disabled={processing}
            >
              Disconnect Wallet
            </button>
          )}
        </div>
        <h2 className="text-2xl font-bold">Checkout</h2>
      </header>

      <div className="flex-1 p-4">
        {/* Listing Summary */}
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="text-lg font-medium mb-2">{listing.title}</h3>
          {listing.media && listing.media.length > 0 && (
            <img
              src={listing.media[0]}
              alt={listing.title}
              className="w-full h-48 object-cover rounded-lg mb-3"
            />
          )}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">Price</span>
            <span className="text-xl font-bold">{listing.price} USDT</span>
          </div>
        </div>

        {/* Wallet Connection Status */}
        <div className="mb-6">
          {!connected ? (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-yellow-800 mb-3">
                Please connect your TON wallet to proceed with payment.
              </p>
              <button
                onClick={handleConnectWallet}
                disabled={processing}
                className="w-full bg-black text-white px-4 py-3 rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                Connect Wallet
              </button>
            </div>
          ) : (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-green-800 mb-1">
                ✓ Wallet Connected
              </p>
              <p className="text-xs text-green-600 font-mono" title={walletAddress?.toString({ bounceable: false })}>
                {formatWalletAddress(walletAddress)}
              </p>
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Payment Button */}
        {connected && (
          <button
            onClick={handleCompletePayment}
            disabled={processing || !connected}
            className="w-full bg-black text-white px-4 py-3 rounded-lg font-medium text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity active:opacity-70"
          >
            {processing ? 'Processing Payment...' : `Pay ${totalCost.toFixed(2)} USDT`}
          </button>
        )}

        {/* Order Summary */}
        <div className="mt-6 pt-6 border-t border-gray-200">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600">Subtotal</span>
            <span className="font-medium">{price.toFixed(2)} USDT</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span className="text-gray-600">Service Fee (5%)</span>
            <span className="font-medium">{fee.toFixed(2)} USDT</span>
          </div>
          <div className="flex justify-between text-lg font-bold mt-3 pt-3 border-t border-gray-200">
            <span>Total</span>
            <span>{totalCost.toFixed(2)} USDT</span>
          </div>
        </div>
      </div>
    </section>
  );
}



