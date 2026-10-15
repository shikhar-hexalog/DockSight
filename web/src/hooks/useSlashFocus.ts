import { type RefObject, useEffect } from 'react';

const FOCUS_KEY = '/';

/** Focuses the given input when "/" is pressed outside another text field. */
export function useSlashFocus(ref: RefObject<HTMLInputElement | null>) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;

      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

      if (event.key === FOCUS_KEY && !typing) {
        event.preventDefault();
        ref.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ref]);
}
