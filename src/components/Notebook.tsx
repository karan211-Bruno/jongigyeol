import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Notebook, Page, PenSettings, Stroke, TemplateId, TextBlock, ToolId } from '../types';
import {
  DEFAULT_SETTINGS,
  HIGHLIGHTER_COLORS,
  INK_COLORS,
  TEMPLATES,
  TOOL_LABEL,
} from '../types';
import {
  getAudio,
  getNotebook,
  getPages,
  removePages,
  saveAudio,
  saveNotebook,
  savePage,
  savePages,
} from '../lib/db';
import { uid } from '../lib/id';
import { makePage, safeFilename } from '../lib/model';
import { DrawCanvas, type CanvasHandle } from './DrawCanvas';
import { DictationSheet } from './DictationSheet';
import { Icon } from './Icon';
import { Confirm, Menu, Sheet, Spinner, useToast } from './ui';
import { drawImageContain, drawPaper, drawStrokes, loadImage, strokeBounds } from '../lib/paper';
import { exportNotebookPDF, exportPagePNG } from '../lib/export';
import { imageFileToDataUrl, pdfToPageImages } from '../lib/pdf';
import {
  DEFAULT_TEXT_SIZE,
  TEXT_MARGIN,
  drawTextBlocks,
  makeTextBlock,
  paginateText,
  textBlockBottom,
} from '../lib/text';
import { audioExtension, preparePlayback, type RecordingResult } from '../lib/recorder';
import { saveBlob } from '../lib/native';

const SETTINGS_KEY = 'jg-pen-settings';

const SIZES: Record<ToolId, number[]> = {
  pen: [1.6, 2.4, 3.4, 5],
  pencil: [1.4, 2.2, 3, 4.4],
  highlighter: [14, 22, 32, 44],
  eraser: [16, 26, 38, 54],
};

function pageContentBottom(page: Page): number {
  let bottom = page.background ? 96 : 120;
  for (const stroke of page.strokes) {
    const box = strokeBounds(stroke);
    bottom = Math.max(bottom, box.y + box.h);
  }
  for (const block of page.textBlocks ?? []) {
    bottom = Math.max(bottom, textBlockBottom(block));
  }
  return bottom;
}

function loadSettings(): PenSettings {
  let base: PenSettings = { ...DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) base = { ...base, ...(JSON.parse(raw) as Partial<PenSettings>) };
    const finger = localStorage.getItem('jg-finger-draw');
    if (finger !== null) base.fingerDraw = finger === '1';
  } catch {
    /* ignore */
  }
  const snap = (value: number, list: number[]) =>
    list.reduce((best, next) => (Math.abs(next - value) < Math.abs(best - value) ? next : best), list[0]);
  base.penWidth = snap(base.penWidth, SIZES.pen);
  base.pencilWidth = snap(base.pencilWidth, SIZES.pencil);
  base.highlighterWidth = snap(base.highlighterWidth, SIZES.highlighter);
  base.eraserWidth = snap(base.eraserWidth, SIZES.eraser);
  if (!INK_COLORS.some((c) => c.value === base.penColor)) base.penColor = INK_COLORS[0].value;
  if (!INK_COLORS.some((c) => c.value === base.pencilColor)) base.pencilColor = INK_COLORS[1].value;
  if (!HIGHLIGHTER_COLORS.some((c) => c.value === base.highlighterColor)) {
    base.highlighterColor = HIGHLIGHTER_COLORS[0].value;
  }
  return base;
}

interface Props {
  notebookId: string;
  onBack: () => void;
}

interface Snapshot {
  pageId: string;
  strokes: Stroke[];
  textBlocks: TextBlock[];
}

export function NotebookView({ notebookId, onBack }: Props) {
  const toast = useToast();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<PenSettings>(loadSettings);
  const [focus, setFocus] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving'>('saved');
  const [scale, setScale] = useState(1);
  const [histTick, setHistTick] = useState(0);
  const [dictationOpen, setDictationOpen] = useState(false);
  const [editBlock, setEditBlock] = useState<{ pageId: string; block: TextBlock } | null>(null);
  const [editText, setEditText] = useState('');
  const [editSize, setEditSize] = useState(DEFAULT_TEXT_SIZE);

  const canvasRef = useRef<CanvasHandle>(null);
  const pagesRef = useRef<Page[]>([]);
  const indexRef = useRef(0);
  const nbRef = useRef<Notebook | null>(null);
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const lastEraseAt = useRef(0);
  const savedTimer = useRef<number | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  pagesRef.current = pages;
  indexRef.current = index;
  nbRef.current = notebook;

  const page = pages[index];

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      /* ignore */
    }
  }, [settings]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [nb, list] = await Promise.all([getNotebook(notebookId), getPages(notebookId)]);
      if (!alive) return;
      if (!nb) {
        toast.show('노트를 찾을 수 없습니다.', 'warn');
        onBack();
        return;
      }
      if (!list.length) {
        const first = makePage(nb.id, 0, nb.template);
        await savePage(first);
        list.push(first);
      }
      setNotebook(nb);
      setPages(list);
      setIndex(0);
      setLoading(false);
      if (!localStorage.getItem('jg-tip-seen')) {
        localStorage.setItem('jg-tip-seen', '1');
        window.setTimeout(
          () => toast.show('펜으로 쓰고, 두 손가락으로 확대해 보세요.'),
          900,
        );
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notebookId]);

  useEffect(() => {
    return () => {
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
    };
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    const el = rail?.querySelector<HTMLElement>('.page-thumb.is-on');
    el?.scrollIntoView({ block: 'nearest' });
  }, [index, pages.length]);

  const flashSave = useCallback(() => {
    setSaveState('saving');
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaveState('saved'), 550);
  }, []);

  const syncHist = useCallback(() => setHistTick((n) => n + 1), []);

  const pushUndo = useCallback(
    (snap: Snapshot) => {
      undoRef.current.push(snap);
      if (undoRef.current.length > 60) undoRef.current.shift();
      redoRef.current = [];
      syncHist();
    },
    [syncHist],
  );

  const persist = useCallback(
    (next: Page) => {
      void savePage(next);
      flashSave();
    },
    [flashSave],
  );

  const patchPage = useCallback(
    (pageId: string, patch: Partial<Page>, recordUndo = true) => {
      const target = pagesRef.current.find((p) => p.id === pageId);
      if (!target) return;
      if (recordUndo) pushUndo({ pageId, strokes: target.strokes, textBlocks: target.textBlocks ?? [] });
      const next = { ...target, ...patch, updatedAt: Date.now() };
      const list = pagesRef.current.map((p) => (p.id === pageId ? next : p));
      pagesRef.current = list;
      setPages(list);
      persist(next);
    },
    [persist, pushUndo],
  );

  const commitStroke = useCallback(
    (stroke: Stroke) => {
      const current = pagesRef.current[indexRef.current];
      if (!current) return;
      const next = { ...current, strokes: [...current.strokes, stroke], updatedAt: Date.now() };
      pushUndo({ pageId: current.id, strokes: current.strokes, textBlocks: current.textBlocks ?? [] });
      const list = pagesRef.current.map((p) => (p.id === current.id ? next : p));
      pagesRef.current = list;
      setPages(list);
      persist(next);
    },
    [persist, pushUndo],
  );

  const eraseStrokes = useCallback(
    (ids: string[]) => {
      const current = pagesRef.current[indexRef.current];
      if (!current || !ids.length) return;
      const idSet = new Set(ids);
      const nextStrokes = current.strokes.filter((s) => !idSet.has(s.id));
      if (nextStrokes.length === current.strokes.length) return;
      const now = performance.now();
      if (now - lastEraseAt.current > 1200) {
        pushUndo({ pageId: current.id, strokes: current.strokes, textBlocks: current.textBlocks ?? [] });
      }
      lastEraseAt.current = now;
      const next = { ...current, strokes: nextStrokes, updatedAt: Date.now() };
      const list = pagesRef.current.map((p) => (p.id === current.id ? next : p));
      pagesRef.current = list;
      setPages(list);
      persist(next);
    },
    [persist, pushUndo],
  );

  const undo = useCallback(() => {
    const snap = undoRef.current.pop();
    if (!snap) return;
    const pageNow = pagesRef.current.find((p) => p.id === snap.pageId);
    if (!pageNow) return;
    redoRef.current.push({
      pageId: pageNow.id,
      strokes: pageNow.strokes,
      textBlocks: pageNow.textBlocks ?? [],
    });
    const next = {
      ...pageNow,
      strokes: snap.strokes,
      textBlocks: snap.textBlocks,
      updatedAt: Date.now(),
    };
    const list = pagesRef.current.map((p) => (p.id === pageNow.id ? next : p));
    pagesRef.current = list;
    setPages(list);
    persist(next);
    const i = list.findIndex((p) => p.id === pageNow.id);
    if (i >= 0) setIndex(i);
    syncHist();
  }, [persist, syncHist]);

  const redo = useCallback(() => {
    const snap = redoRef.current.pop();
    if (!snap) return;
    const pageNow = pagesRef.current.find((p) => p.id === snap.pageId);
    if (!pageNow) return;
    undoRef.current.push({
      pageId: pageNow.id,
      strokes: pageNow.strokes,
      textBlocks: pageNow.textBlocks ?? [],
    });
    const next = {
      ...pageNow,
      strokes: snap.strokes,
      textBlocks: snap.textBlocks,
      updatedAt: Date.now(),
    };
    const list = pagesRef.current.map((p) => (p.id === pageNow.id ? next : p));
    pagesRef.current = list;
    setPages(list);
    persist(next);
    const i = list.findIndex((p) => p.id === pageNow.id);
    if (i >= 0) setIndex(i);
    syncHist();
  }, [persist, syncHist]);

  const go = useCallback((next: number) => {
    setIndex((i) => {
      const clamped = Math.max(0, Math.min(pagesRef.current.length - 1, next));
      return clamped === i ? i : clamped;
    });
  }, []);

  const syncPageCount = useCallback((count: number) => {
    const nb = nbRef.current;
    if (!nb) return;
    const next = { ...nb, pageCount: count, updatedAt: Date.now() };
    nbRef.current = next;
    setNotebook(next);
    void saveNotebook(next);
  }, []);

  const addPage = useCallback(
    async (after = indexRef.current) => {
      const nb = nbRef.current;
      if (!nb) return;
      const prev = pagesRef.current;
      const at = Math.max(0, Math.min(prev.length - 1, after)) + 1;
      const fresh = makePage(nb.id, at, nb.template);
      const list = [...prev.slice(0, at), fresh, ...prev.slice(at)];
      const normalized = list.map((p, i) => (p.order === i ? p : { ...p, order: i }));
      const before = new Map(prev.map((p) => [p.id, p]));
      const changed = normalized.filter((p) => before.get(p.id) !== p);
      pagesRef.current = normalized;
      setPages(normalized);
      setIndex(at);
      await savePages(changed);
      syncPageCount(normalized.length);
      flashSave();
      requestAnimationFrame(() => canvasRef.current?.fit());
    },
    [flashSave, syncPageCount],
  );

  const duplicatePage = useCallback(async () => {
    const current = pagesRef.current[indexRef.current];
    if (!current) return;
    const copy: Page = {
      ...current,
      id: uid('pg'),
      order: current.order + 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const at = indexRef.current + 1;
    const prev = pagesRef.current;
    const list = [...prev.slice(0, at), copy, ...prev.slice(at)];
    const normalized = list.map((p, i) => (p.order === i ? p : { ...p, order: i }));
    const before = new Map(prev.map((p) => [p.id, p]));
    const changed = normalized.filter((p) => before.get(p.id) !== p);
    pagesRef.current = normalized;
    setPages(normalized);
    setIndex(at);
    await savePages(changed);
    syncPageCount(normalized.length);
    flashSave();
    setPagesOpen(false);
    toast.show('페이지를 복제했습니다.');
  }, [flashSave, syncPageCount, toast]);

  const deletePage = useCallback(async () => {
    if (pagesRef.current.length <= 1) {
      toast.show('마지막 페이지는 삭제할 수 없습니다.', 'warn');
      setDeleteOpen(false);
      return;
    }
    const target = pagesRef.current[indexRef.current];
    if (!target) return;
    const prev = pagesRef.current;
    const list = prev.filter((p) => p.id !== target.id);
    const normalized = list.map((p, i) => (p.order === i ? p : { ...p, order: i }));
    const before = new Map(prev.map((p) => [p.id, p]));
    const changed = normalized.filter((p) => before.get(p.id) !== p);
    pagesRef.current = normalized;
    setPages(normalized);
    setIndex(Math.max(0, Math.min(indexRef.current, normalized.length - 1)));
    await removePages([target.id]);
    await savePages(changed);
    syncPageCount(normalized.length);
    setDeleteOpen(false);
    setPagesOpen(false);
    toast.show('페이지를 삭제했습니다.');
  }, [syncPageCount, toast]);

  const movePage = useCallback(
    async (dir: -1 | 1) => {
      const i = indexRef.current;
      const j = i + dir;
      if (j < 0 || j >= pagesRef.current.length) return;
      const prev = pagesRef.current;
      const list = [...prev];
      const a = { ...list[i], order: j };
      const b = { ...list[j], order: i };
      list[i] = b;
      list[j] = a;
      pagesRef.current = list;
      setPages(list);
      setIndex(j);
      await savePages([a, b]);
      flashSave();
      setPagesOpen(false);
    },
    [flashSave],
  );

  const clearPage = useCallback(() => {
    const current = pagesRef.current[indexRef.current];
    if (!current) return;
    patchPage(current.id, { strokes: [] });
    setClearOpen(false);
    toast.show('페이지를 비웠습니다. 되돌리기로 복구할 수 있습니다.');
  }, [patchPage, toast]);

  const insertDictation = useCallback(
    async (value: string, recording: RecordingResult | null) => {
      const current = pagesRef.current[indexRef.current];
      const nb = nbRef.current;
      if (!current || !nb) throw new Error('페이지를 찾을 수 없습니다.');

      const width = Math.max(260, current.width - TEXT_MARGIN * 2);
      const fontSize = DEFAULT_TEXT_SIZE;
      const startY = Math.min(
        current.height - 180,
        Math.max(current.background ? 104 : 132, pageContentBottom(current) + 36),
      );
      const firstMaxHeight = current.height - startY - TEXT_MARGIN;
      const restMaxHeight = current.height - 120 - TEXT_MARGIN;

      let chunks = paginateText(value, width, fontSize, firstMaxHeight, restMaxHeight);
      const useCurrent = chunks.length > 0;
      if (!useCurrent) {
        chunks = paginateText(value, width, fontSize, restMaxHeight, restMaxHeight);
      }
      if (!chunks.length) throw new Error('글이 너무 깁니다.');

      const audioId = recording ? uid('au') : undefined;
      const audioMeta = audioId ? { id: audioId, duration: recording?.duration ?? 0 } : undefined;
      const firstText = chunks[0];
      const rest = chunks.slice(1);

      const newPages: Page[] = [];
      let firstBlock: TextBlock;
      let firstPageId: string;

      if (useCurrent) {
        firstBlock = makeTextBlock(firstText, TEXT_MARGIN, startY, width, fontSize, audioMeta);
        firstPageId = current.id;
      } else {
        const fresh = makePage(nb.id, current.order + 1, nb.template);
        firstBlock = makeTextBlock(firstText, TEXT_MARGIN, 120, width, fontSize, audioMeta);
        fresh.textBlocks = [firstBlock];
        newPages.push(fresh);
        firstPageId = fresh.id;
      }

      rest.forEach((chunk) => {
        const fresh = makePage(nb.id, current.order + 1 + newPages.length, nb.template);
        fresh.textBlocks = [makeTextBlock(chunk, TEXT_MARGIN, 120, width, fontSize)];
        newPages.push(fresh);
      });

      if (recording && audioId) {
        await saveAudio({
          id: audioId,
          notebookId: nb.id,
          pageId: firstPageId,
          mime: recording.mime,
          duration: recording.duration,
          createdAt: Date.now(),
          blob: recording.blob,
        });
      }

      const prev = pagesRef.current;
      const currentIndex = indexRef.current;
      if (useCurrent) {
        pushUndo({
          pageId: current.id,
          strokes: current.strokes,
          textBlocks: current.textBlocks ?? [],
        });
      }
      const base = [...prev];
      if (useCurrent) {
        base[currentIndex] = {
          ...current,
          textBlocks: [...(current.textBlocks ?? []), firstBlock],
          updatedAt: Date.now(),
        };
      }
      const insertAt = currentIndex + 1;
      const merged = [...base.slice(0, insertAt), ...newPages, ...base.slice(insertAt)];
      const normalized = merged.map((p, i) => (p.order === i ? p : { ...p, order: i }));
      const before = new Map(prev.map((p) => [p.id, p]));
      const changed = normalized.filter((p) => before.get(p.id) !== p);

      pagesRef.current = normalized;
      setPages(normalized);
      setIndex(useCurrent ? currentIndex : currentIndex + 1);
      await savePages(changed);
      syncPageCount(normalized.length);
      flashSave();
    },
    [flashSave, pushUndo, syncPageCount],
  );

  const moveTextBlock = useCallback(
    (block: TextBlock, x: number, y: number) => {
      const current = pagesRef.current[indexRef.current];
      if (!current) return;
      const blocks = (current.textBlocks ?? []).map((item) =>
        item.id === block.id ? { ...item, x, y, updatedAt: Date.now() } : item,
      );
      patchPage(current.id, { textBlocks: blocks });
    },
    [patchPage],
  );

  const openTextEdit = useCallback((block: TextBlock) => {
    const current = pagesRef.current[indexRef.current];
    if (!current) return;
    setEditBlock({ pageId: current.id, block });
    setEditText(block.text);
    setEditSize(block.fontSize);
  }, []);

  const saveTextEdit = useCallback(() => {
    if (!editBlock) return;
    const pageNow = pagesRef.current.find((p) => p.id === editBlock.pageId);
    if (!pageNow) return;
    const text = editText.trim();
    if (!text) return;
    const blocks = (pageNow.textBlocks ?? []).map((item) =>
      item.id === editBlock.block.id
        ? { ...item, text, fontSize: editSize, updatedAt: Date.now() }
        : item,
    );
    patchPage(pageNow.id, { textBlocks: blocks });
    setEditBlock(null);
  }, [editBlock, editSize, editText, patchPage]);

  const deleteTextBlock = useCallback(
    (block: TextBlock) => {
      const current = pagesRef.current[indexRef.current];
      if (!current) return;
      const blocks = (current.textBlocks ?? []).filter((item) => item.id !== block.id);
      patchPage(current.id, { textBlocks: blocks });
      // 되돌리기로 글을 복구할 수 있도록 녹음 파일은 남겨 둡니다.
      toast.show('글을 삭제했습니다. 되돌리기로 복구할 수 있습니다.');
    },
    [patchPage, toast],
  );

  const playTextAudio = useCallback(
    async (block: TextBlock) => {
      if (!block.audioId) return;
      const stored = await getAudio(block.audioId);
      if (!stored) {
        toast.show('녹음 파일을 찾을 수 없습니다.', 'warn');
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      await preparePlayback();
      const url = URL.createObjectURL(stored.blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
      };
      try {
        await audio.play();
      } catch {
        URL.revokeObjectURL(url);
        if (audioRef.current === audio) audioRef.current = null;
        toast.show('녹음을 재생하지 못했습니다.', 'warn');
      }
    },
    [toast],
  );

  const saveDictationAudio = useCallback(
    async (recording: RecordingResult) => {
      const ext = audioExtension(recording.mime);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      await saveBlob(recording.blob, `${safeFilename(notebook?.title ?? '받아쓰기')}-${stamp}.${ext}`);
    },
    [notebook?.title],
  );

  const changeTitle = useCallback((title: string) => {
    const nb = nbRef.current;
    if (!nb) return;
    const next = { ...nb, title, updatedAt: Date.now() };
    nbRef.current = next;
    setNotebook(next);
    setSaveState('saving');
    void saveNotebook({ ...next, title: title.trim() || '제목 없는 노트' });
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaveState('saved'), 500);
  }, []);

  const patchSettings = useCallback((patch: Partial<PenSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
  }, []);

  const activeColor =
    settings.tool === 'highlighter'
      ? settings.highlighterColor
      : settings.tool === 'pencil'
        ? settings.pencilColor
        : settings.penColor;

  const activeWidth =
    settings.tool === 'pen'
      ? settings.penWidth
      : settings.tool === 'pencil'
        ? settings.pencilWidth
        : settings.tool === 'highlighter'
          ? settings.highlighterWidth
          : settings.eraserWidth;

  const setActiveColor = useCallback(
    (color: string) => {
      if (settings.tool === 'highlighter') patchSettings({ highlighterColor: color });
      else if (settings.tool === 'pencil') patchSettings({ pencilColor: color });
      else patchSettings({ penColor: color });
    },
    [patchSettings, settings.tool],
  );

  const setActiveWidth = useCallback(
    (width: number) => {
      if (settings.tool === 'pen') patchSettings({ penWidth: width });
      else if (settings.tool === 'pencil') patchSettings({ pencilWidth: width });
      else if (settings.tool === 'highlighter') patchSettings({ highlighterWidth: width });
      else patchSettings({ eraserWidth: width });
    },
    [patchSettings, settings.tool],
  );

  const changeTemplate = useCallback(
    (template: TemplateId) => {
      if (!page) return;
      patchPage(page.id, { template }, false);
    },
    [page, patchPage],
  );

  const importPdf = useCallback(
    async (file: File) => {
      setImportOpen(false);
      setBusy('PDF를 불러오는 중…');
      try {
        const result = await pdfToPageImages(file, (done, total) =>
          setProgress(`PDF 페이지 변환 ${done}/${total}`),
        );
        const nb = nbRef.current;
        if (!nb) return;
        const start = pagesRef.current.length;
        const fresh = result.images.map((img, i) => makePage(nb.id, start + i, 'blank', img));
        const list = [...pagesRef.current, ...fresh];
        pagesRef.current = list;
        setPages(list);
        setIndex(start);
        await savePages(fresh);
        syncPageCount(list.length);
        flashSave();
        toast.show(`${fresh.length}쪽을 노트에 추가했습니다.`);
      } catch {
        toast.show('PDF를 가져오지 못했습니다.', 'warn');
      } finally {
        setBusy(null);
        setProgress(null);
      }
    },
    [flashSave, syncPageCount, toast],
  );

  const importImage = useCallback(
    async (files: FileList) => {
      setImportOpen(false);
      setBusy('이미지를 불러오는 중…');
      try {
        const nb = nbRef.current;
        if (!nb) return;
        const start = pagesRef.current.length;
        const fresh: Page[] = [];
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) continue;
          const url = await imageFileToDataUrl(file);
          fresh.push(makePage(nb.id, start + fresh.length, 'blank', url));
        }
        if (!fresh.length) throw new Error('empty');
        const list = [...pagesRef.current, ...fresh];
        pagesRef.current = list;
        setPages(list);
        setIndex(start);
        await savePages(fresh);
        syncPageCount(list.length);
        flashSave();
        toast.show('이미지를 페이지로 추가했습니다.');
      } catch {
        toast.show('이미지를 가져오지 못했습니다.', 'warn');
      } finally {
        setBusy(null);
      }
    },
    [flashSave, syncPageCount, toast],
  );

  const exportPng = useCallback(async () => {
    if (!page) return;
    setExportOpen(false);
    setBusy('PNG를 만드는 중…');
    try {
      await exportPagePNG(page, `${notebook?.title ?? '노트'} ${index + 1}쪽`);
      toast.show('PNG를 내려받았습니다.');
    } catch {
      toast.show('PNG를 만들지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
    }
  }, [index, notebook?.title, page, toast]);

  const exportPdf = useCallback(async () => {
    if (!notebook) return;
    setExportOpen(false);
    setBusy('PDF를 만드는 중…');
    try {
      await exportNotebookPDF(notebook, pages, (done, total) =>
        setProgress(`PDF 만드는 중… ${done}/${total}`),
      );
      toast.show('PDF를 내려받았습니다.');
    } catch {
      toast.show('PDF를 만들지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }, [notebook, pages, toast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        go(indexRef.current - 1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        go(indexRef.current + 1);
      } else if (e.key.toLowerCase() === 'b') {
        patchSettings({ tool: 'pen' });
      } else if (e.key.toLowerCase() === 'p') {
        patchSettings({ tool: 'pencil' });
      } else if (e.key.toLowerCase() === 'h') {
        patchSettings({ tool: 'highlighter' });
      } else if (e.key.toLowerCase() === 'e') {
        patchSettings({ tool: 'eraser' });
      } else if (e.key.toLowerCase() === 'f') {
        patchSettings({ fingerDraw: !settings.fingerDraw });
      } else if (e.key === 'Escape' && focus) {
        setFocus(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focus, go, patchSettings, redo, settings.fingerDraw, undo]);

  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  const tools = useMemo(
    () =>
      (['pen', 'pencil', 'highlighter', 'eraser'] as ToolId[]).map((id) => ({
        id,
        label: TOOL_LABEL[id],
      })),
    [],
  );

  if (loading || !notebook) {
    return (
      <div className="editor-loading">
        <Spinner text="노트를 펼치는 중…" />
      </div>
    );
  }

  return (
    <div className={`editor ${focus ? 'is-focus' : ''}`} data-hist={histTick}>
      <header className="ed-top">
        <button className="icon-btn soft" onClick={onBack} aria-label="서재로 돌아가기">
          <Icon name="back" />
        </button>
        <div className="ed-title">
          <input
            value={notebook.title}
            onChange={(e) => changeTitle(e.target.value)}
            aria-label="노트 제목"
            maxLength={80}
          />
          <span className={`save-state ${saveState}`}>
            <i />
            {saveState === 'saving' ? '저장 중' : '저장됨'}
          </span>
        </div>
        <div className="ed-actions">
          <button className="icon-btn" onClick={undo} disabled={!canUndo} aria-label="되돌리기" title="되돌리기 (⌘Z)">
            <Icon name="undo" />
          </button>
          <button className="icon-btn" onClick={redo} disabled={!canRedo} aria-label="다시 실행" title="다시 실행 (⇧⌘Z)">
            <Icon name="redo" />
          </button>
          <span className="top-divider" />
          <button
            className={`icon-btn ${focus ? 'is-on' : ''}`}
            onClick={() => {
              setFocus((f) => !f);
              requestAnimationFrame(() => canvasRef.current?.fit());
            }}
            aria-label={focus ? '집중 모드 끄기' : '집중 모드'}
            title="집중 모드"
          >
            <Icon name="focus" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setDictationOpen(true)}
            aria-label="받아쓰기"
            title="받아쓰기"
          >
            <Icon name="mic" />
          </button>
          <button
            className="icon-btn"
            onClick={() => setExportOpen(true)}
            aria-label="내보내기"
            title="내보내기"
          >
            <Icon name="download" />
          </button>
          <Menu
            items={[
              { label: '페이지 관리', icon: 'page', onSelect: () => setPagesOpen(true) },
              { label: '받아쓰기', icon: 'mic', onSelect: () => setDictationOpen(true) },
              { label: 'PDF · 이미지 가져오기', icon: 'upload', onSelect: () => setImportOpen(true) },
              {
                label: settings.fingerDraw ? '손가락 그리기 끄기' : '손가락 그리기 켜기',
                icon: 'hand',
                onSelect: () => patchSettings({ fingerDraw: !settings.fingerDraw }),
              },
              { label: '현재 페이지 비우기', icon: 'trash', danger: true, onSelect: () => setClearOpen(true) },
            ]}
          />
        </div>
      </header>

      <div className="stage-area">
        <div className="tool-dock" role="toolbar" aria-label="필기 도구">
          {tools.map((t) => (
            <button
              key={t.id}
              className={`tool-btn ${settings.tool === t.id ? 'is-on' : ''}`}
              onClick={() => {
                patchSettings({ tool: t.id });
              }}
              aria-pressed={settings.tool === t.id}
              aria-label={t.label}
              title={`${t.label}${t.id === 'pen' ? ' (B)' : t.id === 'pencil' ? ' (P)' : t.id === 'highlighter' ? ' (H)' : ' (E)'}`}
            >
              <Icon name={t.id} size={21} />
              <span>{t.label}</span>
            </button>
          ))}
          <span className="dock-divider" />
          <button
            className={`tool-btn small ${settings.fingerDraw ? 'is-on' : ''}`}
            onClick={() => patchSettings({ fingerDraw: !settings.fingerDraw })}
            aria-pressed={settings.fingerDraw}
            aria-label="손가락으로 그리기"
            title="손가락으로 그리기 (F)"
          >
            <Icon name="hand" size={19} />
            <span>손가락</span>
          </button>
          <button
            className="tool-btn small"
            onClick={() => canvasRef.current?.fit()}
            aria-label="화면에 맞추기"
            title="화면에 맞추기"
          >
            <Icon name="expand" size={19} />
            <span>맞춤</span>
          </button>
        </div>

        <div className="options" aria-label="도구 설정">
          {settings.tool !== 'eraser' ? (
            <div className="opt-group">
              <span className="opt-label">색</span>
              <div className="swatches">
                {(settings.tool === 'highlighter' ? HIGHLIGHTER_COLORS : INK_COLORS).map((color) => (
                  <button
                    key={color.value}
                    className={`swatch ${activeColor === color.value ? 'is-on' : ''}`}
                    style={{ background: color.value }}
                    onClick={() => setActiveColor(color.value)}
                    aria-label={color.name}
                    title={color.name}
                  />
                ))}
              </div>
            </div>
          ) : null}
          <div className="opt-group">
            <span className="opt-label">{settings.tool === 'eraser' ? '지우개' : '굵기'}</span>
            <div className="sizes">
              {SIZES[settings.tool].map((w) => (
                <button
                  key={w}
                  className={`size-dot ${Math.abs(activeWidth - w) < 0.01 ? 'is-on' : ''}`}
                  onClick={() => setActiveWidth(w)}
                  aria-label={`굵기 ${w}`}
                  title={`${w}`}
                >
                  <span
                    style={{
                      width: Math.max(4, Math.min(20, w + (settings.tool === 'highlighter' ? 2 : 3))),
                      height: Math.max(4, Math.min(20, w + (settings.tool === 'highlighter' ? 2 : 3))),
                    }}
                  />
                </button>
              ))}
            </div>
          </div>
          <span className="opt-divider" />
          <div className="opt-group">
            <span className="opt-label">종이</span>
            <div className="paper-switch">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className={`paper-chip ${t.id} ${page?.template === t.id ? 'is-on' : ''}`}
                  onClick={() => changeTemplate(t.id)}
                  aria-label={t.label}
                  title={`${t.label} · ${t.note}`}
                />
              ))}
            </div>
          </div>
        </div>

        {page ? (
          <DrawCanvas
            ref={canvasRef}
            page={page}
            settings={settings}
            onCommit={commitStroke}
            onErase={eraseStrokes}
            onScale={setScale}
            onTextMove={moveTextBlock}
            onTextEdit={openTextEdit}
            onTextDelete={deleteTextBlock}
            onTextPlay={(block) => void playTextAudio(block)}
          />
        ) : null}

        <aside className="page-rail" aria-label="페이지 목록" ref={railRef}>
          <div className="rail-head">
            <span>{pages.length}쪽</span>
            <button className="mini-btn" onClick={() => void addPage()} aria-label="페이지 추가" title="페이지 추가">
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="rail-scroll">
            {pages.map((p, i) => (
              <button
                key={p.id}
                className={`page-thumb ${i === index ? 'is-on' : ''}`}
                onClick={() => go(i)}
                aria-label={`${i + 1}페이지`}
                aria-current={i === index}
              >
                <PageThumb page={p} width={94} />
                <span className="thumb-index">{i + 1}</span>
              </button>
            ))}
            <button className="page-add" onClick={() => void addPage()} aria-label="페이지 추가">
              <Icon name="plus" size={18} />
              <span>새 페이지</span>
            </button>
          </div>
        </aside>

        <div className="pager">
          <div className="pager-zoom">
            <button className="tiny-btn" onClick={() => canvasRef.current?.zoomBy(1 / 1.25)} aria-label="축소">
              <Icon name="zoomOut" size={17} />
            </button>
            <button className="zoom-value" onClick={() => canvasRef.current?.fit()} title="화면에 맞추기">
              {Math.round(scale * 100)}%
            </button>
            <button className="tiny-btn" onClick={() => canvasRef.current?.zoomBy(1.25)} aria-label="확대">
              <Icon name="zoomIn" size={17} />
            </button>
          </div>
          <span className="pager-divider" />
          <button className="tiny-btn" onClick={() => go(index - 1)} disabled={index <= 0} aria-label="이전 페이지">
            <Icon name="chevronLeft" size={18} />
          </button>
          <button className="page-counter" onClick={() => setPagesOpen(true)} title="페이지 관리">
            {index + 1} <span>/ {pages.length}</span>
          </button>
          <button
            className="tiny-btn"
            onClick={() => go(index + 1)}
            disabled={index >= pages.length - 1}
            aria-label="다음 페이지"
          >
            <Icon name="chevronRight" size={18} />
          </button>
          <span className="pager-divider" />
          <button className="tiny-btn" onClick={() => void addPage()} aria-label="페이지 추가" title="페이지 추가">
            <Icon name="plus" size={18} />
          </button>
          <button className="tiny-btn" onClick={() => setPagesOpen(true)} aria-label="페이지 관리" title="페이지 관리">
            <Icon name="grid" size={17} />
          </button>
        </div>

        {focus ? (
          <button className="exit-focus" onClick={() => setFocus(false)}>
            <Icon name="close" size={16} />
            집중 모드 끝내기
          </button>
        ) : null}
      </div>

      <input
        ref={pdfRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importPdf(f);
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void importImage(files);
          e.target.value = '';
        }}
      />

      <Sheet open={pagesOpen} title="페이지 관리" onClose={() => setPagesOpen(false)} wide>
        <div className="sheet-thumbs">
          {pages.map((p, i) => (
            <button
              key={p.id}
              className={`sheet-thumb ${i === index ? 'is-on' : ''}`}
              onClick={() => {
                go(i);
                setPagesOpen(false);
              }}
            >
              <PageThumb page={p} width={84} />
              <span>{i + 1}</span>
            </button>
          ))}
          <button
            className="sheet-thumb add"
            onClick={() => {
              setPagesOpen(false);
              void addPage();
            }}
          >
            <span className="add-square">
              <Icon name="plus" />
            </span>
            <span>새 페이지</span>
          </button>
        </div>
        <div className="page-actions">
          <button
            className="action-row"
            onClick={() => {
              setPagesOpen(false);
              void addPage();
            }}
          >
            <Icon name="plus" size={18} />
            <span>현재 뒤에 새 페이지</span>
          </button>
          <button className="action-row" onClick={() => void duplicatePage()}>
            <Icon name="copy" size={18} />
            <span>현재 페이지 복제</span>
          </button>
          <button className="action-row" onClick={() => void movePage(-1)} disabled={index === 0}>
            <Icon name="chevronLeft" size={18} />
            <span>왼쪽으로 이동</span>
          </button>
          <button
            className="action-row"
            onClick={() => void movePage(1)}
            disabled={index === pages.length - 1}
          >
            <Icon name="chevronRight" size={18} />
            <span>오른쪽으로 이동</span>
          </button>
          <button className="action-row danger" onClick={() => setDeleteOpen(true)}>
            <Icon name="trash" size={18} />
            <span>페이지 삭제</span>
          </button>
        </div>
      </Sheet>

      <Sheet open={exportOpen} title="내보내기" onClose={() => setExportOpen(false)}>
        <div className="import-list">
          <button className="import-row" onClick={() => void exportPng()}>
            <span className="import-icon">
              <Icon name="page" />
            </span>
            <span>
              <strong>현재 페이지 PNG</strong>
              <small>지금 보고 있는 {index + 1}쪽을 이미지로 저장합니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
          <button className="import-row" onClick={() => void exportPdf()}>
            <span className="import-icon">
              <Icon name="file" />
            </span>
            <span>
              <strong>노트 전체 PDF</strong>
              <small>{pages.length}쪽을 한 권의 PDF로 묶습니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
        <p className="muted small export-note">
          내보낸 파일은 이 기기의 다운로드 폴더에 저장됩니다. 백업은 서재의 설정에서 받을 수 있습니다.
        </p>
      </Sheet>

      <Sheet open={importOpen} title="페이지로 가져오기" onClose={() => setImportOpen(false)}>
        <div className="import-list">
          <button
            className="import-row"
            onClick={() => {
              setImportOpen(false);
              pdfRef.current?.click();
            }}
          >
            <span className="import-icon">
              <Icon name="file" />
            </span>
            <span>
              <strong>PDF</strong>
              <small>문서의 각 페이지를 노트 끝에 붙입니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
          <button
            className="import-row"
            onClick={() => {
              setImportOpen(false);
              imageRef.current?.click();
            }}
          >
            <span className="import-icon">
              <Icon name="grid" />
            </span>
            <span>
              <strong>이미지</strong>
              <small>사진이나 스캔본을 페이지 배경으로 씁니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </Sheet>

      <Confirm
        open={clearOpen}
        title="페이지를 비울까요?"
        body="이 페이지의 모든 필기가 지워집니다. 되돌리기로 복구할 수 있지만, 새로 쓰기 전에 한 번 더 확인해 주세요."
        confirmLabel="비우기"
        onCancel={() => setClearOpen(false)}
        onConfirm={clearPage}
      />

      <Confirm
        open={deleteOpen}
        title="페이지를 삭제할까요?"
        body={`${index + 1}쪽과 그 위의 필기가 삭제됩니다. 되돌릴 수 없습니다.`}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void deletePage()}
      />

      <DictationSheet
        open={dictationOpen}
        onClose={() => setDictationOpen(false)}
        onInsert={insertDictation}
        onSaveAudio={saveDictationAudio}
      />

      <Sheet open={Boolean(editBlock)} title="글 편집" onClose={() => setEditBlock(null)}>
        <textarea
          className="dictation-text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          rows={8}
          aria-label="글 내용"
        />
        <div className="text-size-row">
          <span className="opt-label">글자 크기</span>
          <div className="sizes">
            {[26, 34, 44, 56].map((size) => (
              <button
                key={size}
                className={`size-dot ${editSize === size ? 'is-on' : ''}`}
                onClick={() => setEditSize(size)}
                aria-label={`글자 크기 ${size}`}
                title={`${size}`}
              >
                <span
                  style={{
                    width: Math.max(6, Math.round(size / 3)),
                    height: Math.max(6, Math.round(size / 3)),
                  }}
                />
              </button>
            ))}
          </div>
        </div>
        <div className="row-end">
          <button className="btn ghost" onClick={() => setEditBlock(null)}>
            취소
          </button>
          <button className="btn solid" onClick={saveTextEdit} disabled={!editText.trim()}>
            저장
          </button>
        </div>
      </Sheet>

      {busy ? (
        <div className="busy-veil" role="alert">
          <div className="busy-card">
            <Spinner text={progress ?? busy} />
            <p className="muted small">창을 닫지 마세요.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PageThumb({ page, width }: { page: Page; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const scale = (width * 2) / page.width;
    canvas.width = Math.round(page.width * scale);
    canvas.height = Math.round(page.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    drawPaper(ctx, page.template, scale, page.width, page.height);
    drawStrokes(ctx, page.strokes, scale);
    drawTextBlocks(ctx, page.textBlocks, scale);
    if (page.background) {
      loadImage(page.background)
        .then((img) => {
          if (cancelled) return;
          drawPaper(ctx, page.template, scale, page.width, page.height);
          drawImageContain(ctx, img, scale, page.width, page.height);
          drawStrokes(ctx, page.strokes, scale);
          drawTextBlocks(ctx, page.textBlocks, scale);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [page, width]);

  return (
    <canvas
      ref={ref}
      className="thumb-canvas"
      style={{ width, height: Math.round((width * page.height) / page.width) }}
    />
  );
}
