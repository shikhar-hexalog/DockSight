// Header button + pairing dialog: shows a QR code the phone opens to become
// a wireless scanner for this screen.

import { Smartphone } from 'lucide-react';
import { useState } from 'react';

import { REMOTE_TARGET_LABEL } from '@hexabuild/shared';

import { Mono } from '@/components/common/Mono';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

import { QrCode } from './QrCode';
import type { PhoneLink } from './usePhoneLink';

function PairingBody({ link }: { link: PhoneLink }) {
  if (link.error) {
    return <p className="text-sm text-overdue">{link.error}</p>;
  }

  if (!link.session) {
    return <Spinner className="m-6" />;
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <QrCode value={link.session.phoneUrl} />

      <Mono className="text-center text-[11px] break-all text-muted-foreground">{link.session.phoneUrl}</Mono>

      <ol className="list-decimal space-y-1 self-stretch pl-5 text-sm">
        <li>Connect the phone to the same Wi-Fi as this laptop.</li>

        <li>Open the phone camera and point it at this code.</li>

        <li>If the browser warns about the connection, tap Advanced, then Proceed (it's this laptop's own certificate).</li>

        <li>Tap Start scanning and allow the camera.</li>
      </ol>

      <PairingStatus joined={link.phoneJoined} />
    </div>
  );
}

function PairingStatus({ joined }: { joined: boolean }) {
  if (joined) {
    return <p className="text-sm font-medium text-ok">Phone connected. Scans will appear on this screen.</p>;
  }

  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <Spinner className="size-3.5" />
      Waiting for the phone…
    </p>
  );
}

function DisconnectButton({ link, onDone }: { link: PhoneLink; onDone: () => void }) {
  if (!link.session) {
    return null;
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        link.disconnect();
        onDone();
      }}
    >
      Disconnect phone
    </Button>
  );
}

export function PhoneScannerButton({ link }: { link: PhoneLink }) {
  const [open, setOpen] = useState(false);

  function onOpen() {
    setOpen(true);

    void link.start();
  }

  const label = link.phoneJoined ? 'Phone scanner connected' : 'Scan with phone';

  return (
    <>
      <Button size="sm" variant={link.phoneJoined ? 'secondary' : 'outline'} onClick={onOpen}>
        <span className={cn('size-1.5 rounded-full', link.phoneJoined ? 'bg-ok' : 'hidden')} />
        <Smartphone />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Scan with a phone</DialogTitle>

            <DialogDescription>
              The phone camera works like the barcode gun for {link.session ? REMOTE_TARGET_LABEL[link.session.target] : 'this screen'}.
            </DialogDescription>
          </DialogHeader>

          <PairingBody link={link} />

          <div className="flex justify-end">
            <DisconnectButton link={link} onDone={() => setOpen(false)} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
