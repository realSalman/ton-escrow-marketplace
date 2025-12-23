import { mnemonicNew, mnemonicToPrivateKey } from '@ton/crypto';
import { WalletContractV5R1 } from '@ton/ton';
import { Address } from '@ton/core';

/**
 * Creates a new TON w5 wallet (WalletContractV5R1) with a 24-word mnemonic phrase
 * w5 wallets support paying gas fees with jettons (USDT)
 * @returns {Promise<{mnemonic: string[], address: Address, walletAddress: string, walletType: string}>}
 */
export async function createNewTonWallet() {
  try {
    // Generate 24-word mnemonic
    const mnemonic = await mnemonicNew(24);
    
    // Convert mnemonic to key pair
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    
    // Create w5 wallet contract instance (supports jetton gas payments)
    // w5 wallets can pay gas fees with jettons (USDT) instead of TON
    const wallet = WalletContractV5R1.create({
      publicKey: keyPair.publicKey,
      workchain: 0,
    });
    
    // Get wallet address
    const address = wallet.address;
    const walletAddress = address.toString();
    
    console.log(`[WALLET] Created w5 wallet: ${walletAddress}`);
    
    return {
      mnemonic,
      address,
      walletAddress,
      walletType: 'w5', // Store wallet type for reference
      keyPair, // Store keyPair in case needed later
    };
  } catch (error) {
    console.error('Error creating TON wallet:', error);
    throw new Error(`Failed to create TON wallet: ${error.message}`);
  }
}

/**
 * Restores a TON w5 wallet from a mnemonic phrase
 * @param {string|string[]} mnemonic - Mnemonic phrase (array or space-separated string)
 * @returns {Promise<{wallet: WalletContractV5R1, keyPair: KeyPair, address: Address, walletType: string}>}
 */
export async function restoreWalletFromMnemonic(mnemonic) {
  try {
    // Convert string to array if needed
    const mnemonicArray = Array.isArray(mnemonic) 
      ? mnemonic 
      : mnemonic.split(' ').filter(word => word.length > 0);
    
    if (mnemonicArray.length !== 24) {
      throw new Error(`Invalid mnemonic length: expected 24 words, got ${mnemonicArray.length}`);
    }
    
    // Convert mnemonic to key pair
    const keyPair = await mnemonicToPrivateKey(mnemonicArray);
    
    // Create w5 wallet contract instance (supports jetton gas payments)
    // w5 wallets can pay gas fees with jettons (USDT) instead of TON
    const wallet = WalletContractV5R1.create({
      publicKey: keyPair.publicKey,
      workchain: 0,
    });
    
    console.log(`[WALLET] Restored w5 wallet: ${wallet.address.toString()}`);
    
    return {
      wallet,
      keyPair,
      address: wallet.address,
      walletType: 'w5', // Store wallet type for reference
    };
  } catch (error) {
    console.error('Error restoring wallet from mnemonic:', error);
    throw new Error(`Failed to restore wallet: ${error.message}`);
  }
}

