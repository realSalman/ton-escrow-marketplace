import { Address, beginCell, SendMode, Slice, Cell } from '@ton/core';

export class JettonWallet {
  static OPCODES = {
    TRANSFER: 0xf8a7ea5,
  };

  constructor(address) {
    this.address = address;
  }

  static createFromAddress(address) {
    return new JettonWallet(address);
  }

  /**
   * Sends message of jetton transfer to jetton wallet.
   */
  async sendTransfer(provider, via, opts) {
    // constructing payload for jetton transfer
    const builder = beginCell()
      .storeUint(JettonWallet.OPCODES.TRANSFER, 32) // opcode for transfer
      .storeUint(opts.queryId ?? 0, 64)
      .storeCoins(opts.jettonAmount) // jetton amount to transfer
      .storeAddress(opts.toAddress) // jetton destination address
      .storeAddress(via.address) // excesses address
      .storeUint(0, 1) // custom payload
      .storeCoins(opts.fwdAmount); // notifications ton amount

    // if comment needed, it stored as Cell ref
    if ('comment' in opts) {
      const commentPayload = beginCell()
        .storeUint(0, 32)
        .storeStringTail(opts.comment)
        .endCell();

      builder.storeBit(1);
      builder.storeRef(commentPayload);
    } else {
      // if not, store forward payload
      if (opts.forwardPayload instanceof Slice) {
        builder.storeBit(0);
        builder.storeSlice(opts.forwardPayload);
      } else if (opts.forwardPayload instanceof Cell) {
        builder.storeBit(1);
        builder.storeRef(opts.forwardPayload);
      } else {
        builder.storeBit(0);
      }
    }

    // provider often obtained via client.open(contract) method
    await provider.internal(via, {
      value: opts.value, // value to pay gas
      sendMode: SendMode.PAY_GAS_SEPARATELY,
      body: builder.endCell(),
    });
  }

  async getWalletData(provider) {
    const { stack } = await provider.get('get_wallet_data', []);

    return {
      balance: stack.readBigNumber(),
      ownerAddress: stack.readAddress(),
      jettonMasterAddress: stack.readAddress(),
      jettonWalletCode: stack.readCell(),
    };
  }
}

