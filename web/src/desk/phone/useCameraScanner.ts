// Continuous barcode reading from the phone's back camera.
// Uses the browser's built-in BarcodeDetector where there is one (Android
// Chrome: fast, native) and falls back to zxing (iPhone Safari).

import { BarcodeFormat, BrowserMultiFormatReader, DecodeHintType } from '@zxing/library';
import { type RefObject, useCallback, useEffect, useRef, useState } from 'react';

// Shipping labels: AWBs are mostly Code 128; QR for some couriers and our pairing.
const NATIVE_FORMATS = ['code_128', 'code_39', 'code_93', 'codabar', 'ean_13', 'ean_8', 'itf', 'upc_a', 'qr_code', 'data_matrix'];

const ZXING_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.CODE_39,
  BarcodeFormat.CODE_93,
  BarcodeFormat.CODABAR,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.ITF,
  BarcodeFormat.UPC_A,
  BarcodeFormat.QR_CODE,
  BarcodeFormat.DATA_MATRIX,
];

const DETECT_EVERY_MS = 120;

const CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
};

interface DetectedBarcode {
  rawValue: string;
}

interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>;
}

interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): NativeBarcodeDetector;
  getSupportedFormats(): Promise<string[]>;
}

function nativeDetectorClass(): NativeBarcodeDetectorClass | null {
  return (window as unknown as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector ?? null;
}

async function startNative(Detector: NativeBarcodeDetectorClass, video: HTMLVideoElement, onCode: (code: string) => void) {
  const supported = await Detector.getSupportedFormats();

  const detector = new Detector({ formats: NATIVE_FORMATS.filter(f => supported.includes(f)) });

  const stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);

  video.srcObject = stream;

  await video.play();

  let stopped = false;

  async function tick() {
    if (stopped) {
      return;
    }

    try {
      const [first] = await detector.detect(video);

      if (first?.rawValue) {
        onCode(first.rawValue);
      }
    } catch {
      // A frame that couldn't be read: try the next one.
    }

    setTimeout(() => void tick(), DETECT_EVERY_MS);
  }

  void tick();

  return () => {
    stopped = true;
    stream.getTracks().forEach(track => track.stop());
  };
}

async function startZxing(video: HTMLVideoElement, onCode: (code: string) => void) {
  const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS]]);

  const reader = new BrowserMultiFormatReader(hints, DETECT_EVERY_MS);

  await reader.decodeFromConstraints(CONSTRAINTS, video, result => {
    if (result) {
      onCode(result.getText());
    }
  });

  return () => reader.reset();
}

export const CameraState = {
  IDLE: 'idle',
  STARTING: 'starting',
  ON: 'on',
  FAILED: 'failed',
} as const;

export type CameraState = (typeof CameraState)[keyof typeof CameraState];

export function useCameraScanner(videoRef: RefObject<HTMLVideoElement | null>, onCode: (code: string) => void) {
  const [state, setState] = useState<CameraState>(CameraState.IDLE);

  const [error, setError] = useState<string | null>(null);

  const stopRef = useRef<(() => void) | null>(null);

  const onCodeRef = useRef(onCode);

  onCodeRef.current = onCode;

  const start = useCallback(async () => {
    const video = videoRef.current;

    if (!video || stopRef.current) {
      return;
    }

    setState(CameraState.STARTING);

    setError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('This page needs HTTPS for the camera. Open the link from the QR code.');
      }

      const Detector = nativeDetectorClass();

      const handle = (code: string) => onCodeRef.current(code);

      stopRef.current = Detector ? await startNative(Detector, video, handle) : await startZxing(video, handle);

      setState(CameraState.ON);
    } catch (err) {
      setError((err as Error).message || 'Camera not available');
      setState(CameraState.FAILED);
    }
  }, [videoRef]);

  useEffect(
    () => () => {
      stopRef.current?.();
      stopRef.current = null;
    },
    []
  );

  return { state, error, start };
}
