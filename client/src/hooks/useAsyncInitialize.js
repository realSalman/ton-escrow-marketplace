import { useEffect, useState } from 'react';

export const useAsyncInitialize = (func, deps = []) => {
  const [state, setState] = useState();

  useEffect(() => {
    (async () => {
      setState(await func());
    })();
  }, deps);

  return state;
};

