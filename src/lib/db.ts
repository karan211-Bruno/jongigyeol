import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Notebook, Page } from '../types';

interface MetaRow {
  key: string;
  value: unknown;
}

interface Schema extends DBSchema {
  notebooks: {
    key: string;
    value: Notebook;
    indexes: { updatedAt: number };
  };
  pages: {
    key: string;
    value: Page;
    indexes: { notebookId: string };
  };
  meta: {
    key: string;
    value: MetaRow;
  };
}

const DB_NAME = 'jongigyeol';
let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, 1, {
      upgrade(d) {
        const notes = d.createObjectStore('notebooks', { keyPath: 'id' });
        notes.createIndex('updatedAt', 'updatedAt');
        const pages = d.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('notebookId', 'notebookId');
        d.createObjectStore('meta', { keyPath: 'key' });
      },
    });
  }
  return dbPromise;
}

export async function listNotebooks(): Promise<Notebook[]> {
  const d = await db();
  const all = await d.getAll('notebooks');
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getNotebook(id: string): Promise<Notebook | undefined> {
  return (await db()).get('notebooks', id);
}

export async function saveNotebook(nb: Notebook): Promise<void> {
  await (await db()).put('notebooks', nb);
}

export async function getPages(notebookId: string): Promise<Page[]> {
  const d = await db();
  const pages = await d.getAllFromIndex('pages', 'notebookId', notebookId);
  return pages.sort((a, b) => a.order - b.order);
}

export async function getPage(id: string): Promise<Page | undefined> {
  return (await db()).get('pages', id);
}

export async function savePage(page: Page): Promise<void> {
  await (await db()).put('pages', page);
}

export async function savePages(pages: Page[]): Promise<void> {
  if (!pages.length) return;
  const d = await db();
  const tx = d.transaction('pages', 'readwrite');
  await Promise.all([...pages.map((p) => tx.store.put(p)), tx.done]);
}

export async function removePages(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const d = await db();
  const tx = d.transaction('pages', 'readwrite');
  await Promise.all([...ids.map((id) => tx.store.delete(id)), tx.done]);
}

export async function deleteNotebookDeep(id: string): Promise<void> {
  const pages = await getPages(id);
  await removePages(pages.map((p) => p.id));
  await (await db()).delete('notebooks', id);
}

export async function touchNotebook(id: string, patch: Partial<Notebook> = {}): Promise<void> {
  const nb = await getNotebook(id);
  if (!nb) return;
  await saveNotebook({ ...nb, ...patch, updatedAt: Date.now() });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await db()).get('meta', key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value });
}

export interface Backup {
  app: 'jongigyeol';
  version: 1;
  exportedAt: number;
  notebooks: Notebook[];
  pages: Page[];
}

export async function exportBackup(): Promise<Backup> {
  const d = await db();
  const [notebooks, pages] = await Promise.all([d.getAll('notebooks'), d.getAll('pages')]);
  return {
    app: 'jongigyeol',
    version: 1,
    exportedAt: Date.now(),
    notebooks,
    pages,
  };
}

export async function importBackup(backup: Backup): Promise<{ notebooks: number; pages: number }> {
  if (!backup || backup.app !== 'jongigyeol' || !Array.isArray(backup.notebooks)) {
    throw new Error('종이결 백업 파일이 아닙니다.');
  }
  const d = await db();
  const tx = d.transaction(['notebooks', 'pages'], 'readwrite');
  for (const nb of backup.notebooks) await tx.objectStore('notebooks').put(nb);
  for (const page of backup.pages) await tx.objectStore('pages').put(page);
  await tx.done;
  return { notebooks: backup.notebooks.length, pages: backup.pages.length };
}

export async function wipeAll(): Promise<void> {
  const d = await db();
  await Promise.all([
    d.clear('notebooks'),
    d.clear('pages'),
    d.clear('meta'),
  ]);
}
