// The search text, kept in the URL (?q=) so a search survives reloads and
// can be shared. Typing is instant; the query updates after a short pause.

import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';

export const SEARCH_PARAM = 'q';

const DEBOUNCE_MS = 250;

export function useSearchQuery() {
  const [params, setParams] = useSearchParams();

  const fromUrl = params.get(SEARCH_PARAM) ?? '';

  const [text, setText] = useState(fromUrl);

  const debounced = useDebouncedValue(text.trim(), DEBOUNCE_MS);

  useEffect(() => {
    if (debounced === fromUrl) {
      return;
    }

    setParams(
      prev => {
        const next = new URLSearchParams(prev);

        if (debounced) {
          next.set(SEARCH_PARAM, debounced);
        } else {
          next.delete(SEARCH_PARAM);
        }

        return next;
      },
      { replace: true }
    );
  }, [debounced, fromUrl, setParams]);

  return { text, setText, q: fromUrl || undefined };
}
