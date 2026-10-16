// A toast when a submitted handover's customer emails go out: "dispatched"
// emails on the Dispatch page, "return received" emails on the Receive page.
// What was already there when the page opened is not shown again.

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

import type { DispatchNotice } from '@hexabuild/shared';

import { useDispatchNotices } from '@/hooks/queries';
import { formatCount } from '@/lib/format';

const NOTICE_TOAST_MS = 5_000;

const WORDS: Record<DispatchNotice['kind'], { email: string; handover: string }> = {
  DISPATCH: { email: 'dispatch', handover: 'pickup' },
  RECEIVE: { email: 'return received', handover: 'returns handover' },
};

/** A notice changes when more of its emails go out (late scans, a retry that worked). */
const noticeKey = (notice: DispatchNotice) => `${notice.batchId}:${notice.sent}:${notice.failed}`;

export function useNotifiedToast(kind: DispatchNotice['kind']) {
  const { data } = useDispatchNotices();

  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!data) {
      return;
    }

    const notices = data.data.filter(notice => notice.kind === kind);

    if (!seen.current) {
      seen.current = new Set(notices.map(noticeKey));
      return;
    }

    const words = WORDS[kind];

    for (const notice of notices) {
      if (seen.current.has(noticeKey(notice))) {
        continue;
      }

      seen.current.add(noticeKey(notice));

      if (notice.sent === 0) {
        toast.error('Clients not notified', {
          description: `${notice.courier} ${words.handover}${notice.error ? `: ${notice.error}` : ''}.`,
          duration: NOTICE_TOAST_MS,
        });
        continue;
      }

      const emails = `${formatCount(notice.sent)} ${words.email} ${notice.sent === 1 ? 'email' : 'emails'}`;

      toast.success('Clients notified', {
        description: `${emails} sent for the ${notice.courier} ${words.handover}${notice.recipient ? ` to ${notice.recipient}` : ''}${notice.failed > 0 ? `; ${formatCount(notice.failed)} failed` : ''}.`,
        duration: NOTICE_TOAST_MS,
        action: { label: 'View emails', onClick: () => window.open(data.inboxUrl, '_blank', 'noreferrer') },
      });
    }
  }, [data, kind]);
}
