import { useState, useEffect } from 'react';
import { fetchTransactions } from '../services/apiService';

export function AdminPanel({ onBack }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all'); // 'all', 'buyer_to_server', 'server_to_seller'
  const [error, setError] = useState(null);

  useEffect(() => {
    loadTransactions();
  }, [filter]);

  async function loadTransactions() {
    setLoading(true);
    setError(null);
    try {
      const type = filter === 'all' ? null : filter;
      const data = await fetchTransactions(type);
      setTransactions(data.transactions || []);
    } catch (err) {
      console.error('Error loading transactions:', err);
      setError(err.message || 'Failed to load transactions');
    } finally {
      setLoading(false);
    }
  }

  function formatAddress(address) {
    if (!address) return 'N/A';
    const addr = typeof address === 'string' ? address : address.toString();
    if (addr.length <= 10) return addr;
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  }

  function formatAmount(amount) {
    if (!amount) return '0';
    const num = typeof amount === 'string' ? BigInt(amount) : amount;
    return (Number(num) / 1000000).toFixed(6); // USDT has 6 decimals
  }

  function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    try {
      // Firestore Timestamp has toDate() method
      if (timestamp && typeof timestamp.toDate === 'function') {
        return timestamp.toDate().toLocaleString();
      }
      // If it's a number (timestamp in ms)
      if (typeof timestamp === 'number') {
        return new Date(timestamp).toLocaleString();
      }
      // If it's already a Date object
      if (timestamp instanceof Date) {
        return timestamp.toLocaleString();
      }
      // Try to parse as date string
      return new Date(timestamp).toLocaleString();
    } catch (error) {
      return 'N/A';
    }
  }

  function getTONScanUrl(transactionHash, fromAddress, network = 'mainnet') {
    // TONScan URL format
    const baseUrl = network === 'mainnet' 
      ? 'https://tonscan.org' 
      : 'https://testnet.tonscan.org';
    
    // Transaction hash might be base64 encoded or contain address_lt format
    // If it contains underscore, it's our fallback format (address_lt)
    if (transactionHash.includes('_')) {
      // This is our fallback format (address_lt), link to address page
      const address = transactionHash.split('_')[0];
      return `${baseUrl}/${address}`;
    }
    
    // Try to convert base64 to hex for TONScan
    try {
      // If it's base64, convert to hex
      const buffer = Buffer.from(transactionHash, 'base64');
      const hexHash = buffer.toString('hex');
      return `${baseUrl}/tx/${hexHash}`;
    } catch {
      // If conversion fails, try to use as hex directly, or link to address
      if (fromAddress) {
        return `${baseUrl}/${fromAddress}`;
      }
      return `${baseUrl}/tx/${transactionHash}`;
    }
  }

  const buyerToServer = transactions.filter(tx => tx.type === 'buyer_to_server');
  const serverToSeller = transactions.filter(tx => tx.type === 'server_to_seller');

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <header className="sticky top-0 z-100 bg-white border-b-2 border-black rounded-b-xl p-3 px-4 flex justify-between items-center shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-2 py-1 rounded hover:bg-gray-50"
          >
            ← Back
          </button>
          <h1 className="text-xl m-0 font-bold">Admin Panel</h1>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-y-auto">
        {/* Filter Buttons */}
        <div className="mb-4 flex gap-2 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg border-2 transition-colors ${
              filter === 'all'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-black hover:bg-gray-50'
            }`}
          >
            All ({transactions.length})
          </button>
          <button
            onClick={() => setFilter('buyer_to_server')}
            className={`px-4 py-2 rounded-lg border-2 transition-colors ${
              filter === 'buyer_to_server'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-black hover:bg-gray-50'
            }`}
          >
            Buyer → Server ({buyerToServer.length})
          </button>
          <button
            onClick={() => setFilter('server_to_seller')}
            className={`px-4 py-2 rounded-lg border-2 transition-colors ${
              filter === 'server_to_seller'
                ? 'bg-black text-white border-black'
                : 'bg-white text-black border-black hover:bg-gray-50'
            }`}
          >
            Server → Seller ({serverToSeller.length})
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8">
            <p className="text-gray-600">Loading transactions...</p>
          </div>
        )}

        {/* Transactions List */}
        {!loading && transactions.length === 0 && (
          <div className="text-center py-8">
            <p className="text-gray-600">No transactions found</p>
          </div>
        )}

        {!loading && transactions.length > 0 && (
          <div className="space-y-4">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="border-2 border-black rounded-lg p-4 bg-white"
              >
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium ${
                          tx.type === 'buyer_to_server'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {tx.type === 'buyer_to_server' ? 'Buyer → Server' : 'Server → Seller'}
                      </span>
                      {tx.orderId && (
                        <span className="text-xs text-gray-600">Order: {tx.orderId}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 font-mono">
                      Hash: {formatAddress(tx.transactionHash)}
                    </p>
                  </div>
                  <a
                    href={getTONScanUrl(tx.transactionHash, tx.fromAddress)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:text-blue-800 underline"
                  >
                    View on TONScan →
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm mt-3">
                  <div>
                    <p className="text-gray-600 text-xs">From</p>
                    <p className="font-mono text-xs">{formatAddress(tx.fromAddress)}</p>
                  </div>
                  <div>
                    <p className="text-gray-600 text-xs">To</p>
                    <p className="font-mono text-xs">{formatAddress(tx.toAddress)}</p>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-200">
                  <div className="flex justify-between items-center">
                    <div>
                      <p className="text-gray-600 text-xs">Amount</p>
                      <p className="text-lg font-bold">{formatAmount(tx.amount)} USDT</p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-600 text-xs">Date</p>
                      <p className="text-xs">{formatDate(tx.createdAtTimestamp || tx.createdAt)}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

