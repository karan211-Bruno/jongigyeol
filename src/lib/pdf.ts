import { PAGE_H, PAGE_W } from '../types';

export interface PdfImportResult {
  images: string[];
  pageWidth: number;
  pageHeight: number;
}

let workerReady = false;

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!workerReady) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    workerReady = true;
  }
  return pdfjs;
}

export async function pdfToPageImages(
  file: File,
  onProgress?: (done: number, total: number) => void,
): Promise<PdfImportResult> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const images: string[] = [];
  const total = doc.numPages;

  for (let i = 1; i <= total; i++) {
    const pdfPage = await doc.getPage(i);
    const base = pdfPage.getViewport({ scale: 1 });
    const targetWidth = 1240;
    const scale = Math.min(3, Math.max(1, targetWidth / base.width));
    const viewport = pdfPage.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: ctx, canvas, viewport }).promise;

    // Fit the rendered page onto the app's A4 canvas so every page has one ratio.
    const out = document.createElement('canvas');
    out.width = PAGE_W;
    out.height = PAGE_H;
    const octx = out.getContext('2d');
    if (!octx) throw new Error('캔버스를 만들지 못했습니다.');
    octx.fillStyle = '#ffffff';
    octx.fillRect(0, 0, PAGE_W, PAGE_H);
    const ratio = Math.min(PAGE_W / canvas.width, PAGE_H / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;
    octx.drawImage(canvas, (PAGE_W - w) / 2, (PAGE_H - h) / 2, w, h);
    images.push(out.toDataURL('image/jpeg', 0.86));
    pdfPage.cleanup();
    onProgress?.(i, total);
  }
  await doc.loadingTask.destroy();
  return { images, pageWidth: PAGE_W, pageHeight: PAGE_H };
}

export async function imageFileToDataUrl(file: File, maxSide = 2000): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
      image.src = url;
    });
    const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}
