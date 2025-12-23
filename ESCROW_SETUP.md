# Escrow Auto-Release System Setup

## Overview

The escrow system automatically releases funds 1 minute after payment completion:
- **5%** goes to the server wallet (service fee)
- **95%** goes to the seller wallet

## Environment Variables

Add these to your `server/.env` file:

```env
# Server wallet address (where 5% service fee goes)
SERVER_WALLET_ADDRESS=UQ...your-server-wallet-address...

# TON network (testnet or mainnet)
TON_NETWORK=testnet
```

## Important Notes

### 1. Server Wallet Address
- You need to create a TON wallet and add its address to `SERVER_WALLET_ADDRESS`
- This wallet will receive 5% of each transaction as service fee
- Make sure this wallet is secure and you have the mnemonic backed up

### 2. Seller Wallet Address
- Sellers must have their wallet address stored in their user profile
- The system looks for `walletAddress` field in Firestore `users/{sellerId}` collection
- If a seller doesn't have a wallet address, the escrow release will fail

### 3. Gas Fees
- **Important**: The escrow wallet needs TON (not USDT) to pay for gas fees
- Each USDT transfer requires ~0.038 TON for gas
- The checkout flow automatically sends 0.1 TON along with USDT to the escrow wallet
- This ensures the escrow wallet can pay gas fees for the automatic transfers (2 transfers: server + seller)
- The buyer will need to approve both transactions (USDT transfer + TON transfer)

### 4. Automatic Release
- Funds are automatically released **1 minute** after payment completion
- The system schedules a job when the wallet is stored
- If the automatic release fails, you can manually trigger it via API

## Manual Release Endpoint

If automatic release fails, you can manually trigger it:

```bash
POST /api/escrow/release
Content-Type: application/json

{
  "orderId": "order-1234567890-abc123",
  "itemId": "item-id-optional"
}
```

## How It Works

1. **Payment**: Buyer sends USDT to newly created escrow wallet
2. **Storage**: Escrow wallet mnemonic and itemId are stored in database
3. **Scheduling**: System schedules automatic release after 1 minute
4. **Release**: After 1 minute:
   - Retrieves escrow wallet mnemonic from database
   - Restores wallet from mnemonic
   - Gets USDT balance from escrow wallet
   - Calculates split (5% server, 95% seller)
   - Transfers USDT to both wallets
   - Pays gas fees from escrow wallet's TON balance

## Database Structure

### Firestore: `orderWallets/{orderId}`
```json
{
  "orderId": "order-1234567890-abc123",
  "mnemonic": "word1 word2 ... word24",
  "walletAddress": "UQ...",
  "userId": "user-id",
  "itemId": "item-id",
  "createdAt": "timestamp",
  "createdAtTimestamp": 1234567890
}
```

### Firestore: `users/{sellerId}`
```json
{
  "walletAddress": "UQ...seller-wallet-address..."
}
```

## Testing

1. Make sure `SERVER_WALLET_ADDRESS` is set in `.env`
2. Ensure seller has `walletAddress` in their user profile
3. Complete a test purchase
4. Wait 1 minute or manually trigger release via API
5. Check server and seller wallets for USDT

## Troubleshooting

### Error: "SERVER_WALLET_ADDRESS not configured"
- Add `SERVER_WALLET_ADDRESS` to `server/.env`

### Error: "Seller wallet address not found"
- Seller needs to add their wallet address to their user profile
- Update Firestore: `users/{sellerId}` with `walletAddress` field

### Error: "Escrow wallet has insufficient TON balance"
- Buyer needs to send TON along with USDT to escrow wallet
- Or manually fund the escrow wallet with TON for gas fees

### Error: "Escrow wallet has zero USDT balance"
- Payment may not have completed
- Check if USDT was actually sent to escrow wallet address

