import type { Notebook, Page } from '../types';
import { drawImageContain, drawPaper, drawStrokes, loadImage } from './paper';
import { drawTextBlocks } from './text';
import { downloadBlob, safeFilename } from './model';
import { exportBackup } from './db';

export async function renderPage(page: Page, scale = 2): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(page.width * scale);
  canvas.height = Math.round(page.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
  drawPaper(ctx, page.template, scale, page.width, page.height);
  if (page.background) {
    const img = await loadImage(page.background);
    drawImageContain(ctx, img, scale, page.width, page.height);
  }
  drawStrokes(ctx, page.strokes, scale);
  drawTextBlocks(ctx, page.textBlocks, scale);
  return canvas;
}

export async function exportPagePNG(page: Page, title: string): Promise<void> {
  const canvas = await renderPage(page, 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG를 만들지 못했습니다.');
  await downloadBlob(blob, `${safeFilename(title)}.png`);
}

export async function exportNotebookPDF(
  notebook: Notebook,
  pages: Page[],
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pw = pdf.internal.pageSize.getWidth();
  const ph = pdf.internal.pageSize.getHeight();

  for (let i = 0; i < pages.length; i++) {
    const canvas = await renderPage(pages[i], 1.6);
    const data = canvas.toDataURL('image/jpeg', 0.9);
    if (i > 0) pdf.addPage();
    pdf.addImage(data, 'JPEG', 0, 0, pw, ph, undefined, 'FAST');
    canvas.width = 0;
    canvas.height = 0;
    onProgress?.(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  await downloadBlob(pdf.output('blob'), `${safeFilename(notebook.title)}.pdf`);
}

export async function exportAllBackup(): Promise<void> {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  await downloadBlob(blob, `종이결-백업-${stamp}.json`);
}
