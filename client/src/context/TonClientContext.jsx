import { createContext } from 'react';
import { CHAIN, useTonWallet } from '@tonconnect/ui-react';
import { TonClient } from '@ton/ton';
import { getHttpEndpoint } from '@orbs-network/ton-access';
import { useAsyncInitialize } from '../hooks/useAsyncInitialize';

const TonClientContext = createContext({
  tonClient: undefined,
});

export const TonClientProvider = ({ children }) => {
  const wallet = useTonWallet();
  const network = wallet?.account?.chain;
  
  const client = useAsyncInitialize(async () => {
    if (!network) return;

    const endpoint = await getHttpEndpoint({
      network: network === CHAIN.MAINNET ? 'mainnet' : 'testnet',
    });

    return new TonClient({ endpoint });
  }, [network]);

  return (
    <TonClientContext.Provider value={{ tonClient: client }}>
      {children}
    </TonClientContext.Provider>
  );
};

export { TonClientContext };

