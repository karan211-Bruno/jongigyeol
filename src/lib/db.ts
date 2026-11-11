import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Notebook, Page } from '../types';

interface MetaRow {
  key: string;
  value: unknown;
}

/** 받아쓰기 녹음 파일. Blob은 IndexedDB에 그대로 저장합니다. */
export interface StoredAudio {
  id: string;
  notebookId: string;
  pageId: string;
  mime: string;
  duration: number;
  createdAt: number;
  blob: Blob;
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
  audio: {
    key: string;
    value: StoredAudio;
    indexes: { pageId: string };
  };
  meta: {
    key: string;
    value: MetaRow;
  };
}

const DB_NAME = 'jongigyeol';
const DB_VERSION = 2;
let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

function db(): Promise<IDBPDatabase<Schema>> {
  if (!dbPromise) {
    dbPromise = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const notes = d.createObjectStore('notebooks', { keyPath: 'id' });
          notes.createIndex('updatedAt', 'updatedAt');
          const pages = d.createObjectStore('pages', { keyPath: 'id' });
          pages.createIndex('notebookId', 'notebookId');
          d.createObjectStore('meta', { keyPath: 'key' });
        }
        if (oldVersion < 2) {
          const audio = d.createObjectStore('audio', { keyPath: 'id' });
          audio.createIndex('pageId', 'pageId');
        }
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
  const tx = d.transaction(['pages', 'audio'], 'readwrite');
  const audio = tx.objectStore('audio');
  for (const id of ids) {
    await tx.objectStore('pages').delete(id);
    const keys = await audio.index('pageId').getAllKeys(id);
    for (const key of keys) await audio.delete(key);
  }
  await tx.done;
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

/* ---------------------------------- audio --------------------------------- */

export async function saveAudio(audio: StoredAudio): Promise<void> {
  await (await db()).put('audio', audio);
}

export async function getAudio(id: string): Promise<StoredAudio | undefined> {
  return (await db()).get('audio', id);
}

export async function deleteAudio(id: string): Promise<void> {
  await (await db()).delete('audio', id);
}

export async function getAudioForPage(pageId: string): Promise<StoredAudio[]> {
  return (await db()).getAllFromIndex('audio', 'pageId', pageId);
}

/* ---------------------------------- meta ---------------------------------- */

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await (await db()).get('meta', key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', { key, value });
}

/* --------------------------------- backup --------------------------------- */

export interface BackupAudio extends Omit<StoredAudio, 'blob'> {
  /** data URL (base64) */
  data: string;
}

export interface Backup {
  app: 'jongigyeol';
  version: 2;
  exportedAt: number;
  notebooks: Notebook[];
  pages: Page[];
  audio?: BackupAudio[];
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('녹음 파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

async function dataUrlToBlob(data: string): Promise<Blob> {
  const response = await fetch(data);
  return response.blob();
}

export async function exportBackup(): Promise<Backup> {
  const d = await db();
  const [notebooks, pages, audio] = await Promise.all([
    d.getAll('notebooks'),
    d.getAll('pages'),
    d.getAll('audio'),
  ]);
  const audioBackup: BackupAudio[] = [];
  for (const item of audio) {
    try {
      audioBackup.push({
        id: item.id,
        notebookId: item.notebookId,
        pageId: item.pageId,
        mime: item.mime,
        duration: item.duration,
        createdAt: item.createdAt,
        data: await blobToDataUrl(item.blob),
      });
    } catch {
      /* 읽지 못한 녹음은 백업에서 건너뜁니다. */
    }
  }
  return {
    app: 'jongigyeol',
    version: 2,
    exportedAt: Date.now(),
    notebooks,
    pages,
    audio: audioBackup,
  };
}

export async function importBackup(backup: Backup): Promise<{ notebooks: number; pages: number; audio: number }> {
  if (!backup || backup.app !== 'jongigyeol' || !Array.isArray(backup.notebooks)) {
    throw new Error('종이결 백업 파일이 아닙니다.');
  }

  // IndexedDB 트랜잭션은 await 사이에 비활성화되므로, base64 변환은 미리 끝냅니다.
  const audioRows: StoredAudio[] = [];
  if (Array.isArray(backup.audio)) {
    for (const item of backup.audio) {
      try {
        const blob = await dataUrlToBlob(item.data);
        audioRows.push({
          id: item.id,
          notebookId: item.notebookId,
          pageId: item.pageId,
          mime: item.mime,
          duration: item.duration,
          createdAt: item.createdAt,
          blob,
        });
      } catch {
        /* 손상된 녹음은 건너뜁니다. */
      }
    }
  }

  const d = await db();
  const tx = d.transaction(['notebooks', 'pages', 'audio'], 'readwrite');
  const notebookStore = tx.objectStore('notebooks');
  const pageStore = tx.objectStore('pages');
  const audioStore = tx.objectStore('audio');
  for (const nb of backup.notebooks) void notebookStore.put(nb);
  for (const page of backup.pages) void pageStore.put(page);
  for (const row of audioRows) void audioStore.put(row);
  await tx.done;
  return {
    notebooks: backup.notebooks.length,
    pages: backup.pages.length,
    audio: audioRows.length,
  };
}

export async function wipeAll(): Promise<void> {
  const d = await db();
  await Promise.all([
    d.clear('notebooks'),
    d.clear('pages'),
    d.clear('audio'),
    d.clear('meta'),
  ]);
}
