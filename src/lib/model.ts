import type { Notebook, Page } from '../types';
import { PAGE_H, PAGE_W } from '../types';
import { uid } from './id';
import { saveBlob } from './native';

export function makeNotebook(
  title: string,
  folder = '내 노트',
  cover: Notebook['cover'] = 'linen',
  template: Notebook['template'] = 'lined',
): Notebook {
  const now = Date.now();
  return {
    id: uid('nb'),
    title: title.trim() || '제목 없는 노트',
    folder: folder.trim() || '내 노트',
    cover,
    template,
    createdAt: now,
    updatedAt: now,
    pageCount: 1,
  };
}

export function makePage(
  notebookId: string,
  order: number,
  template: Page['template'],
  background?: string,
): Page {
  const now = Date.now();
  return {
    id: uid('pg'),
    notebookId,
    order,
    template,
    background,
    strokes: [],
    width: PAGE_W,
    height: PAGE_H,
    createdAt: now,
    updatedAt: now,
  };
}

export function withPages(nb: Notebook, pages: Page[]): Notebook {
  return { ...nb, pageCount: pages.length, updatedAt: Date.now() };
}

export function formatDate(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return sameYear ? `${mm}.${dd}` : `${d.getFullYear()}. ${mm}. ${dd}`;
}

export function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '방금';
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;
  return formatDate(ts);
}

export function downloadBlob(blob: Blob, filename: string): Promise<void> {
  return saveBlob(blob, filename);
}

export function safeFilename(name: string): string {
  return (name.trim() || '노트').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 60);
}
