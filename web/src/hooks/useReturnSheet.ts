import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

const RETURN_PARAM = 'return';

/** The open return lives in the URL (?return=<id>), so it survives reloads and can be shared. */
export function useReturnSheet() {
  const [params, setParams] = useSearchParams();

  const openId = params.get(RETURN_PARAM);

  const open = useCallback(
    (id: string) => {
      setParams(prev => {
        const next = new URLSearchParams(prev);
        next.set(RETURN_PARAM, id);
        return next;
      });
    },
    [setParams]
  );

  const close = useCallback(() => {
    setParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete(RETURN_PARAM);
      return next;
    });
  }, [setParams]);

  return { openId, open, close };
}
