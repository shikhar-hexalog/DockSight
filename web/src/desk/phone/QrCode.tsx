import { BrowserQRCodeSvgWriter } from '@zxing/library';
import { useEffect, useRef } from 'react';

const SIZE = 220;

/** A QR code for a link, drawn as SVG. */
export function QrCode({ value }: { value: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = ref.current;

    if (!host) {
      return;
    }

    host.replaceChildren(new BrowserQRCodeSvgWriter().write(value, SIZE, SIZE));
  }, [value]);

  return <div ref={ref} className="rounded-lg bg-white p-2" style={{ width: SIZE + 16, height: SIZE + 16 }} />;
}
