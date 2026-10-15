import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

import { RETURN_TYPES, type ReturnType } from '@hexabuild/shared';

const TYPE_PARAM = 'type';

function parseType(value: string | null): ReturnType | undefined {
  return RETURN_TYPES.find(type => type === value);
}

/** RTO / DTO filter kept in the URL so it survives reloads and page switches. */
export function useTypeFilter() {
  const [params, setParams] = useSearchParams();

  const type = parseType(params.get(TYPE_PARAM));

  const setType = useCallback(
    (next: ReturnType | undefined) => {
      setParams(prev => {
        const updated = new URLSearchParams(prev);

        if (next) {
          updated.set(TYPE_PARAM, next);
        } else {
          updated.delete(TYPE_PARAM);
        }

        return updated;
      });
    },
    [setParams]
  );

  return { type, setType };
}
