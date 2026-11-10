// Decodes an image into raw RGBA pixels off the main thread: fetch -> createImageBitmap ->
// OffscreenCanvas -> getImageData. The buffer is transferred back (no copy).
import { expose, transfer } from 'comlink';

export interface DecodedImage {
  data: Uint8ClampedArray;
  w: number;
  h: number;
}

const api = {
  async decode(url: string): Promise<DecodedImage> {
    const res = await fetch(url);
    // a dev server answers unknown paths with index.html and status 200: treat that as missing too
    if (!res.ok || !(res.headers.get('content-type') || '').startsWith('image/')) throw new Error(`texture 404: ${url}`);
    const bmp = await createImageBitmap(await res.blob());
    const cv = new OffscreenCanvas(bmp.width, bmp.height);
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const img = g.getImageData(0, 0, cv.width, cv.height);
    return transfer({ data: img.data, w: img.width, h: img.height }, [img.data.buffer]);
  },
};

export type TextureWorkerApi = typeof api;
expose(api);
