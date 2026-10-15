// Phone photos are several MB; a 1600px JPEG is plenty to read a signature
// or see damage, and small enough to queue offline and upload quickly.

const MAX_SIDE = 1600;

const QUALITY = 0.72;

export async function compressImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));

  const canvas = document.createElement('canvas');

  canvas.width = Math.round(bitmap.width * scale);

  canvas.height = Math.round(bitmap.height * scale);

  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  bitmap.close();

  return canvas.toDataURL('image/jpeg', QUALITY);
}
