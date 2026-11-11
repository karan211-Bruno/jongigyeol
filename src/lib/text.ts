import type { TextBlock } from '../types';
import { uid } from './id';

/** 캔버스와 DOM이 같은 글꼴을 쓰도록 한 곳에서 관리합니다. */
export const TEXT_FONT =
  "'Pretendard Variable', Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', Roboto, sans-serif";
export const TEXT_LINE_HEIGHT = 1.6;
export const TEXT_SIZE_MIN = 22;
export const TEXT_SIZE_MAX = 64;
export const DEFAULT_TEXT_SIZE = 34;
export const TEXT_COLOR = '#24231e';
export const TEXT_MARGIN = 96;

let measureCanvas: HTMLCanvasElement | null = null;

function measureContext(fontSize: number): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null;
  if (!measureCanvas) measureCanvas = document.createElement('canvas');
  const ctx = measureCanvas.getContext('2d');
  if (!ctx) return null;
  ctx.font = `500 ${fontSize}px ${TEXT_FONT}`;
  return ctx;
}

function breakLongToken(token: string, ctx: CanvasRenderingContext2D, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of token) {
    const next = current + ch;
    if (current && ctx.measureText(next).width > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts.length ? parts : [''];
}

/**
 * 페이지 폭에 맞춰 글을 줄바꿈합니다. 공백 단위로 나누되,
 * 한 단어가 폭을 넘으면 글자 단위로 끊습니다.
 */
export function wrapText(text: string, maxWidth: number, fontSize = DEFAULT_TEXT_SIZE): string[] {
  const ctx = measureContext(fontSize);
  const width = Math.max(40, maxWidth);
  if (!ctx) return text.split('\n');

  const lines: string[] = [];
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n');

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    const tokens = paragraph.split(' ');
    let line = '';
    for (const token of tokens) {
      if (!token) {
        line = line ? `${line} ` : line;
        continue;
      }
      const candidate = line ? `${line} ${token}` : token;
      if (ctx.measureText(candidate).width <= width) {
        line = candidate;
        continue;
      }
      if (line) {
        lines.push(line);
        line = '';
      }
      if (ctx.measureText(token).width <= width) {
        line = token;
      } else {
        const parts = breakLongToken(token, ctx, width);
        for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i]);
        line = parts[parts.length - 1] ?? '';
      }
    }
    if (line || !tokens.length) lines.push(line);
  }

  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function textBlockHeight(block: Pick<TextBlock, 'text' | 'width' | 'fontSize'>): number {
  const lines = wrapText(block.text, block.width, block.fontSize);
  return Math.max(block.fontSize * TEXT_LINE_HEIGHT, lines.length * block.fontSize * TEXT_LINE_HEIGHT);
}

/**
 * 긴 받아쓰기 글을 페이지 높이에 맞춰 여러 조각으로 나눕니다.
 * 첫 조각은 현재 페이지의 남은 공간에, 나머지는 새 페이지에 들어갑니다.
 */
export function paginateText(
  text: string,
  width: number,
  fontSize: number,
  firstMaxHeight: number,
  restMaxHeight: number,
): string[] {
  const lines = wrapText(text, width, fontSize);
  if (!lines.length) return [];
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;
  const firstLines = Math.floor(Math.max(0, firstMaxHeight) / lineHeight);
  if (firstLines <= 0) return [];
  const restLines = Math.max(1, Math.floor(restMaxHeight / lineHeight));

  const chunks: string[] = [];
  let cursor = 0;
  let limit = firstLines;
  while (cursor < lines.length) {
    const take = Math.min(limit, lines.length - cursor);
    if (take <= 0) break;
    const chunk = lines.slice(cursor, cursor + take).join('\n').trimEnd();
    if (chunk) chunks.push(chunk);
    cursor += take;
    limit = restLines;
  }
  return chunks;
}

export function makeTextBlock(
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize = DEFAULT_TEXT_SIZE,
  audio?: { id: string; duration: number },
): TextBlock {
  const now = Date.now();
  return {
    id: uid('tx'),
    x,
    y,
    width,
    text,
    fontSize,
    color: TEXT_COLOR,
    align: 'left',
    createdAt: now,
    updatedAt: now,
    ...(audio ? { audioId: audio.id, audioDuration: audio.duration } : {}),
  };
}

/** 캔버스(내보내기·썸네일)에 글 블록을 그립니다. */
export function drawTextBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: TextBlock[] | undefined,
  scale: number,
): void {
  if (!blocks?.length) return;
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  for (const block of blocks) {
    const size = Math.max(8, block.fontSize);
    ctx.font = `500 ${size * scale}px ${TEXT_FONT}`;
    ctx.fillStyle = block.color || TEXT_COLOR;
    const lines = wrapText(block.text, block.width, size);
    const lineHeight = size * TEXT_LINE_HEIGHT * scale;
    lines.forEach((line, i) => {
      if (!line) return;
      ctx.fillText(line, block.x * scale, block.y * scale + i * lineHeight);
    });
  }
  ctx.restore();
}

/** 블록 아래쪽 끝 좌표. 다음 글을 이어 붙일 위치를 찾을 때 씁니다. */
export function textBlockBottom(block: TextBlock): number {
  return block.y + textBlockHeight(block);
}
