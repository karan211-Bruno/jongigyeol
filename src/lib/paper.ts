import type { Stroke, TemplateId } from '../types';

export const PAPER_COLOR = '#fcfbf7';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 불러오지 못했습니다.'));
    img.src = src;
  });
}

export function drawPaper(
  ctx: CanvasRenderingContext2D,
  template: TemplateId,
  scale: number,
  w: number,
  h: number,
): void {
  ctx.save();
  ctx.fillStyle = PAPER_COLOR;
  ctx.fillRect(0, 0, w * scale, h * scale);
  ctx.lineWidth = Math.max(1, 1 * scale);

  if (template === 'lined') {
    const gap = 72;
    const top = 148;
    ctx.strokeStyle = 'rgba(32, 32, 27, 0.11)';
    for (let y = top; y < h - 90; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale);
      ctx.lineTo(w * scale, y * scale);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(138, 59, 50, 0.16)';
    ctx.beginPath();
    ctx.moveTo(92 * scale, 0);
    ctx.lineTo(92 * scale, h * scale);
    ctx.stroke();
  } else if (template === 'grid') {
    const gap = 60;
    ctx.strokeStyle = 'rgba(32, 32, 27, 0.085)';
    for (let x = gap; x < w; x += gap) {
      ctx.beginPath();
      ctx.moveTo(x * scale, 0);
      ctx.lineTo(x * scale, h * scale);
      ctx.stroke();
    }
    for (let y = gap; y < h; y += gap) {
      ctx.beginPath();
      ctx.moveTo(0, y * scale);
      ctx.lineTo(w * scale, y * scale);
      ctx.stroke();
    }
  } else if (template === 'dot') {
    const gap = 56;
    ctx.fillStyle = 'rgba(32, 32, 27, 0.22)';
    const r = Math.max(0.8, 1.9 * scale);
    for (let y = gap; y < h; y += gap) {
      for (let x = gap; x < w; x += gap) {
        ctx.beginPath();
        ctx.arc(x * scale, y * scale, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  ctx.restore();
}

export function drawImageContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  scale: number,
  w: number,
  h: number,
): void {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;
  const ratio = Math.min(w / iw, h / ih);
  const dw = iw * ratio * scale;
  const dh = ih * ratio * scale;
  const dx = ((w * scale) - dw) / 2;
  const dy = ((h * scale) - dh) / 2;
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w * scale, h * scale);
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}

interface Pt {
  x: number;
  y: number;
  p: number;
}

function ptAt(points: number[], i: number): Pt {
  return {
    x: points[i * 3],
    y: points[i * 3 + 1],
    p: Number.isFinite(points[i * 3 + 2]) ? points[i * 3 + 2] : 0.5,
  };
}

function smoothTrace(ctx: CanvasRenderingContext2D, points: number[], scale: number): void {
  const n = Math.floor(points.length / 3);
  const p0 = ptAt(points, 0);
  ctx.beginPath();
  ctx.moveTo(p0.x * scale, p0.y * scale);
  if (n === 1) {
    ctx.lineTo(p0.x * scale + 0.01, p0.y * scale + 0.01);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const a = ptAt(points, i);
    const b = ptAt(points, i + 1);
    ctx.quadraticCurveTo(a.x * scale, a.y * scale, ((a.x + b.x) / 2) * scale, ((a.y + b.y) / 2) * scale);
  }
  const last = ptAt(points, n - 1);
  ctx.lineTo(last.x * scale, last.y * scale);
}

function variableTrace(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  scale: number,
  widthMul: number,
  offsetX = 0,
  offsetY = 0,
): void {
  const n = Math.floor(stroke.points.length / 3);
  if (n < 1) return;
  const base = Math.max(0.4, stroke.width * widthMul);
  ctx.strokeStyle = stroke.color;

  if (n === 1) {
    const p = ptAt(stroke.points, 0);
    ctx.beginPath();
    ctx.arc((p.x + offsetX) * scale, (p.y + offsetY) * scale, (base * (0.4 + 0.5 * p.p)) / 2, 0, Math.PI * 2);
    ctx.fillStyle = stroke.color;
    ctx.fill();
    return;
  }

  for (let i = 1; i < n; i++) {
    const prev = ptAt(stroke.points, i - 1);
    const cur = ptAt(stroke.points, i);
    const p = Math.max(0.08, Math.min(1, (prev.p + cur.p) / 2));
    const width = base * (0.32 + 0.82 * p);
    if (width < 0.15) continue;
    ctx.lineWidth = width;
    ctx.beginPath();
    if (i === 1) {
      ctx.moveTo((prev.x + offsetX) * scale, (prev.y + offsetY) * scale);
    } else {
      const before = ptAt(stroke.points, i - 2);
      ctx.moveTo((((before.x + prev.x) / 2) + offsetX) * scale, (((before.y + prev.y) / 2) + offsetY) * scale);
    }
    ctx.quadraticCurveTo(
      (prev.x + offsetX) * scale,
      (prev.y + offsetY) * scale,
      (((prev.x + cur.x) / 2) + offsetX) * scale,
      (((prev.y + cur.y) / 2) + offsetY) * scale,
    );
    ctx.stroke();
  }
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke, scale: number): void {
  const n = Math.floor(stroke.points.length / 3);
  if (!n) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = Math.max(2, stroke.width * scale);
    ctx.strokeStyle = stroke.color;
    smoothTrace(ctx, stroke.points, scale);
    ctx.stroke();
  } else if (stroke.tool === 'pencil') {
    ctx.globalAlpha = 0.78;
    variableTrace(ctx, stroke, scale, 1);
    ctx.globalAlpha = 0.22;
    variableTrace(ctx, stroke, scale, 0.82, 0.5 / scale, 0.4 / scale);
    ctx.globalAlpha = 0.16;
    variableTrace(ctx, stroke, scale, 1.15, -0.45 / scale, -0.3 / scale);
  } else {
    variableTrace(ctx, stroke, scale, 1);
  }
  ctx.restore();
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  scale: number,
): void {
  for (const stroke of strokes) drawStroke(ctx, stroke, scale);
}

function segDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokesHitBy(
  strokes: Stroke[],
  x: number,
  y: number,
  radius: number,
): string[] {
  const hits: string[] = [];
  for (const s of strokes) {
    const reach = radius + s.width * 0.65;
    const n = Math.floor(s.points.length / 3);
    if (!n) continue;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const px = s.points[i * 3];
      const py = s.points[i * 3 + 1];
      if (px < minX) minX = px;
      if (py < minY) minY = py;
      if (px > maxX) maxX = px;
      if (py > maxY) maxY = py;
    }
    if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) continue;
    if (n === 1) {
      if (Math.hypot(x - minX, y - minY) <= reach) hits.push(s.id);
      continue;
    }
    let found = false;
    for (let i = 1; i < n && !found; i++) {
      const ax = s.points[(i - 1) * 3];
      const ay = s.points[(i - 1) * 3 + 1];
      const bx = s.points[i * 3];
      const by = s.points[i * 3 + 1];
      if (segDistance(x, y, ax, ay, bx, by) <= reach) {
        hits.push(s.id);
        found = true;
      }
    }
  }
  return hits;
}

export function strokeBounds(stroke: Stroke): { x: number; y: number; w: number; h: number } {
  const n = Math.floor(stroke.points.length / 3);
  if (!n) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = stroke.points[i * 3];
    const y = stroke.points[i * 3 + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const pad = stroke.width * 0.7;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}
