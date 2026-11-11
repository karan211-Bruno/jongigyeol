import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Page, PenSettings, Stroke, TextBlock } from '../types';
import { drawImageContain, drawPaper, drawStroke, drawStrokes, loadImage, strokesHitBy } from '../lib/paper';
import { TEXT_FONT, TEXT_LINE_HEIGHT } from '../lib/text';
import { uid } from '../lib/id';
import { Icon } from './Icon';

const RES = 2;

export interface CanvasHandle {
  fit: () => void;
  zoomBy: (factor: number) => void;
  zoomTo: (scale: number) => void;
}

interface Props {
  page: Page;
  settings: PenSettings;
  onCommit: (stroke: Stroke) => void;
  onErase: (ids: string[]) => void;
  onScale?: (scale: number) => void;
  onTextMove: (block: TextBlock, x: number, y: number) => void;
  onTextEdit: (block: TextBlock) => void;
  onTextDelete: (block: TextBlock) => void;
  onTextPlay: (block: TextBlock) => void;
}

type Mode = 'idle' | 'draw' | 'erase' | 'pan' | 'pinch';

interface Pt {
  x: number;
  y: number;
  pressure: number;
}

export const DrawCanvas = forwardRef<CanvasHandle, Props>(function DrawCanvas(
  { page, settings, onCommit, onErase, onScale, onTextMove, onTextEdit, onTextDelete, onTextPlay },
  ref,
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);

  const vp = useRef({ s: 1, x: 0, y: 0 });
  const [scaleLabel, setScaleLabel] = useState(1);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const strokesRef = useRef(page.strokes);
  strokesRef.current = page.strokes;

  const mode = useRef<Mode>('idle');
  const drawPointer = useRef<number | null>(null);
  const current = useRef<Stroke | null>(null);
  const lastPenAt = useRef(0);
  const lastCursor = useRef<Pt | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number; type: string }>());
  const panStart = useRef({ x: 0, y: 0, vx: 0, vy: 0 });
  const pinchStart = useRef({ dist: 0, cx: 0, cy: 0, s: 1, x: 0, y: 0 });
  const rendered = useRef<{ pageId: string; strokes: Stroke[] }>({ pageId: '', strokes: [] });
  const pendingErase = useRef(new Set<string>());
  const eraseFrame = useRef<number | null>(null);
  const fittedOnce = useRef(false);

  const publishScale = useCallback(
    (s: number) => {
      setScaleLabel(s);
      onScale?.(s);
    },
    [onScale],
  );

  const applyTransform = useCallback(() => {
    const el = paperRef.current;
    if (!el) return;
    const { s, x, y } = vp.current;
    el.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${s})`;
    publishScale(s);
  }, [publishScale]);

  const fit = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const narrow = rect.width <= 1100;
    const portrait = rect.height > rect.width;
    const padX = narrow ? (portrait ? 16 : 88) : rect.width > 1180 ? 132 : 96;
    const topInset = narrow ? 18 : 26;
    const bottomInset = narrow ? 190 : 76;
    const availW = Math.max(80, rect.width - padX * 2);
    const availH = Math.max(80, rect.height - topInset - bottomInset);
    const s = Math.min(availW / page.width, availH / page.height, 1.2);
    const scale = Math.max(0.15, s);
    vp.current = {
      s: scale,
      x: (rect.width - page.width * scale) / 2,
      y: topInset + Math.max(0, (availH - page.height * scale) / 2),
    };
    applyTransform();
  }, [page.width, page.height, applyTransform]);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const stage = stageRef.current;
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const next = Math.max(0.2, Math.min(4, vp.current.s * factor));
      const ratio = next / vp.current.s;
      vp.current = {
        s: next,
        x: cx - (cx - vp.current.x) * ratio,
        y: cy - (cy - vp.current.y) * ratio,
      };
      applyTransform();
    },
    [applyTransform],
  );

  useImperativeHandle(
    ref,
    () => ({
      fit,
      zoomBy: (factor: number) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        zoomAt(factor, rect.width / 2, rect.height / 2);
      },
      zoomTo: (scale: number) => {
        const stage = stageRef.current;
        if (!stage) return;
        const rect = stage.getBoundingClientRect();
        const factor = scale / vp.current.s;
        zoomAt(factor, rect.width / 2, rect.height / 2);
      },
    }),
    [fit, zoomAt],
  );

  // Size the canvases once per page.
  useEffect(() => {
    setSelectedText(null);
    for (const c of [bgRef.current, inkRef.current, overlayRef.current]) {
      if (!c) continue;
      c.width = Math.round(page.width * RES);
      c.height = Math.round(page.height * RES);
    }
    rendered.current = { pageId: '', strokes: [] };
    current.current = null;
    const overlay = overlayRef.current?.getContext('2d');
    if (overlay) overlay.clearRect(0, 0, page.width * RES, page.height * RES);
  }, [page.id, page.width, page.height]);

  // Paper / imported background.
  useEffect(() => {
    const canvas = bgRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    let cancelled = false;
    drawPaper(ctx, page.template, RES, page.width, page.height);
    if (page.background) {
      loadImage(page.background)
        .then((img) => {
          if (cancelled) return;
          drawPaper(ctx, page.template, RES, page.width, page.height);
          drawImageContain(ctx, img, RES, page.width, page.height);
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [page.id, page.template, page.background, page.width, page.height]);

  // Committed ink layer, with a fast path for one new stroke.
  useEffect(() => {
    const canvas = inkRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const prev = rendered.current;
    const samePage = prev.pageId === page.id;
    const appendedOne =
      samePage &&
      page.strokes.length === prev.strokes.length + 1 &&
      page.strokes.slice(0, -1).every((s, i) => s === prev.strokes[i]);
    if (appendedOne) {
      drawStroke(ctx, page.strokes[page.strokes.length - 1], RES);
    } else if (!samePage || page.strokes !== prev.strokes) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStrokes(ctx, page.strokes, RES);
    }
    rendered.current = { pageId: page.id, strokes: page.strokes };
  }, [page.strokes, page.id]);

  // Fit on first paint, page change, and viewport resize.
  useEffect(() => {
    fit();
    fittedOnce.current = true;
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === 'undefined') return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => fit());
    });
    ro.observe(stage);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fit, page.id]);

  const paintOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const set = settingsRef.current;
    if (current.current) {
      drawStroke(ctx, current.current, RES);
    } else if (mode.current === 'erase' && lastCursor.current) {
      const r = Math.max(6, (set.eraserWidth / 2) * RES);
      ctx.save();
      ctx.beginPath();
      ctx.arc(lastCursor.current.x * RES, lastCursor.current.y * RES, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(23, 23, 20, 0.5)';
      ctx.lineWidth = 1.6;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.restore();
    }
  }, []);

  const toPage = useCallback((clientX: number, clientY: number): Pt | null => {
    const canvas = overlayRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = ((clientX - rect.left) / rect.width) * page.width;
    const y = ((clientY - rect.top) / rect.height) * page.height;
    if (x < 0 || y < 0 || x > page.width || y > page.height) return null;
    return { x, y, pressure: 0.5 };
  }, [page.width, page.height]);

  const flushErase = useCallback(() => {
    if (eraseFrame.current !== null) return;
    eraseFrame.current = requestAnimationFrame(() => {
      eraseFrame.current = null;
      if (pendingErase.current.size) {
        const ids = [...pendingErase.current];
        pendingErase.current.clear();
        onErase(ids);
      }
    });
  }, [onErase]);

  const eraseAt = useCallback(
    (pt: Pt) => {
      const radius = Math.max(4, settingsRef.current.eraserWidth / 2);
      const hits = strokesHitBy(strokesRef.current, pt.x, pt.y, radius);
      if (hits.length) {
        hits.forEach((id) => pendingErase.current.add(id));
        flushErase();
      }
      lastCursor.current = pt;
      paintOverlay();
    },
    [flushErase, paintOverlay],
  );

  const beginStroke = useCallback(
    (e: ReactPointerEvent) => {
      const set = settingsRef.current;
      const pt = toPage(e.clientX, e.clientY);
      if (!pt) return;
      const pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };

      if (set.tool === 'eraser') {
        mode.current = 'erase';
        drawPointer.current = e.pointerId;
        eraseAt(pt);
        return;
      }

      const widths: Record<string, number> = {
        pen: set.penWidth,
        pencil: set.pencilWidth,
        highlighter: set.highlighterWidth,
      };
      const colors: Record<string, string> = {
        pen: set.penColor,
        pencil: set.pencilColor,
        highlighter: set.highlighterColor,
      };
      const stroke: Stroke = {
        id: uid('s'),
        tool: set.tool,
        color: colors[set.tool],
        width: widths[set.tool],
        points: [pt.x, pt.y, e.pointerType === 'pen' ? Math.max(0.12, e.pressure) : 0.55],
      };
      mode.current = 'draw';
      drawPointer.current = e.pointerId;
      current.current = stroke;
      lastCursor.current = pt;
      pointers.current.set(e.pointerId, pointer);
      paintOverlay();
    },
    [eraseAt, paintOverlay, toPage],
  );

  const appendPoint = useCallback(
    (clientX: number, clientY: number, pressure: number, pointerType: string) => {
      const stroke = current.current;
      if (!stroke) return;
      const canvas = overlayRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(0, Math.min(page.width, ((clientX - rect.left) / rect.width) * page.width));
      const y = Math.max(0, Math.min(page.height, ((clientY - rect.top) / rect.height) * page.height));
      const n = stroke.points.length / 3;
      const lx = stroke.points[(n - 1) * 3];
      const ly = stroke.points[(n - 1) * 3 + 1];
      if (Math.hypot(x - lx, y - ly) < 0.45) return;
      const p = pointerType === 'pen' ? Math.max(0.12, Math.min(1, pressure || 0.4)) : 0.55;
      stroke.points.push(x, y, p);
      lastCursor.current = { x, y, pressure: p };
      paintOverlay();
    },
    [page.width, page.height, paintOverlay],
  );

  const finishStroke = useCallback(() => {
    const stroke = current.current;
    current.current = null;
    const ctx = overlayRef.current?.getContext('2d');
    if (ctx && overlayRef.current) {
      ctx.clearRect(0, 0, overlayRef.current.width, overlayRef.current.height);
    }
    if (stroke && stroke.points.length >= 3) {
      const merged: number[] = [];
      const n = stroke.points.length / 3;
      for (let i = 0; i < n; i++) {
        const x = stroke.points[i * 3];
        const y = stroke.points[i * 3 + 1];
        const p = stroke.points[i * 3 + 2];
        const prevX = merged[merged.length - 3];
        const prevY = merged[merged.length - 2];
        if (merged.length && prevX !== undefined && prevY !== undefined && Math.hypot(x - prevX, y - prevY) < 0.7) {
          continue;
        }
        merged.push(x, y, p);
      }
      if (merged.length >= 3) onCommit({ ...stroke, points: merged });
    }
  }, [onCommit]);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const stage = stageRef.current;
      if (!stage) return;
      setSelectedText(null);
      try {
        (e.target as Element).setPointerCapture?.(e.pointerId);
      } catch {
        /* synthetic or already-released pointers */
      }
      const pointer = { x: e.clientX, y: e.clientY, type: e.pointerType };
      pointers.current.set(e.pointerId, pointer);

      if (e.pointerType === 'pen') lastPenAt.current = performance.now();

      // Palm rejection: ignore touch that arrives right after the stylus.
      const recentPen = performance.now() - lastPenAt.current < 900;
      const isTouch = e.pointerType === 'touch';
      if (isTouch && recentPen) {
        return;
      }

      if (e.button === 2 || e.button === 1) {
        mode.current = 'pan';
        panStart.current = { x: e.clientX, y: e.clientY, vx: vp.current.x, vy: vp.current.y };
        return;
      }

      if (isTouch && pointers.current.size >= 2) {
        if (mode.current === 'draw') {
          current.current = null;
          drawPointer.current = null;
          paintOverlay();
        }
        const pts = [...pointers.current.values()].filter((p) => p.type === 'touch');
        if (pts.length >= 2) {
          const a = pts[0];
          const b = pts[1];
          pinchStart.current = {
            dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
            cx: (a.x + b.x) / 2,
            cy: (a.y + b.y) / 2,
            s: vp.current.s,
            x: vp.current.x,
            y: vp.current.y,
          };
          mode.current = 'pinch';
          return;
        }
      }

      if (isTouch) {
        if (settingsRef.current.fingerDraw && !recentPen) {
          beginStroke(e);
        } else {
          mode.current = 'pan';
          panStart.current = { x: e.clientX, y: e.clientY, vx: vp.current.x, vy: vp.current.y };
        }
        return;
      }

      if (e.pointerType === 'mouse' && e.button !== 0) return;
      beginStroke(e);
    },
    [beginStroke, paintOverlay],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      const existing = pointers.current.get(e.pointerId);
      if (existing) {
        existing.x = e.clientX;
        existing.y = e.clientY;
      }

      if (mode.current === 'pinch') {
        const pts = [...pointers.current.values()].filter((p) => p.type === 'touch');
        if (pts.length < 2) return;
        const a = pts[0];
        const b = pts[1];
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const midStage = stageRef.current?.getBoundingClientRect();
        if (!midStage) return;
        const cx = (a.x + b.x) / 2 - midStage.left;
        const cy = (a.y + b.y) / 2 - midStage.top;
        const start = pinchStart.current;
        const next = Math.max(0.2, Math.min(4, start.s * (dist / start.dist)));
        const px = (start.cx - midStage.left - start.x) / start.s;
        const py = (start.cy - midStage.top - start.y) / start.s;
        vp.current = { s: next, x: cx - px * next, y: cy - py * next };
        applyTransform();
        return;
      }

      if (mode.current === 'pan') {
        vp.current.x = panStart.current.vx + (e.clientX - panStart.current.x);
        vp.current.y = panStart.current.vy + (e.clientY - panStart.current.y);
        applyTransform();
        return;
      }

      if (mode.current === 'draw' && drawPointer.current === e.pointerId) {
        const coalesced =
          typeof e.nativeEvent.getCoalescedEvents === 'function'
            ? e.nativeEvent.getCoalescedEvents()
            : [];
        const events = coalesced.length ? coalesced : [e.nativeEvent];
        for (const ev of events) {
          appendPoint(ev.clientX, ev.clientY, ev.pressure, e.pointerType);
        }
        return;
      }

      if (mode.current === 'erase' && drawPointer.current === e.pointerId) {
        const pt = toPage(e.clientX, e.clientY);
        if (pt) eraseAt(pt);
      }
    },
    [appendPoint, applyTransform, eraseAt, toPage],
  );

  const endPointer = useCallback(
    (e: ReactPointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (mode.current === 'draw' && drawPointer.current === e.pointerId) {
        drawPointer.current = null;
        finishStroke();
        mode.current = 'idle';
        paintOverlay();
        return;
      }
      if (mode.current === 'erase' && drawPointer.current === e.pointerId) {
        drawPointer.current = null;
        mode.current = 'idle';
        lastCursor.current = null;
        paintOverlay();
        if (pendingErase.current.size) {
          const ids = [...pendingErase.current];
          pendingErase.current.clear();
          onErase(ids);
        }
        return;
      }
      if (mode.current === 'pinch' || mode.current === 'pan') {
        if (pointers.current.size === 0) {
          mode.current = 'idle';
        } else if (mode.current === 'pinch' && pointers.current.size === 1) {
          const p = [...pointers.current.values()][0];
          if (p) {
            mode.current = 'pan';
            panStart.current = { x: p.x, y: p.y, vx: vp.current.x, vy: vp.current.y };
          }
        }
      }
    },
    [finishStroke, onErase, paintOverlay],
  );

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        const factor = Math.exp(-e.deltaY * 0.012);
        zoomAt(factor, e.clientX - rect.left, e.clientY - rect.top);
      } else {
        vp.current.x -= e.deltaX;
        vp.current.y -= e.deltaY;
        applyTransform();
      }
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [applyTransform, zoomAt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === '0' || e.key === '9')) {
        e.preventDefault();
        fit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fit]);

  return (
    <div
      ref={stageRef}
      className="stage"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPointer}
      onPointerCancel={endPointer}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="paper"
        ref={paperRef}
        style={{ width: page.width, height: page.height }}
      >
        <canvas ref={bgRef} className="layer" />
        <canvas ref={inkRef} className="layer" />
        <canvas ref={overlayRef} className="layer" />
        <TextLayer
          page={page}
          scale={scaleLabel}
          selectedId={selectedText}
          onSelect={setSelectedText}
          onMove={onTextMove}
          onEdit={onTextEdit}
          onDelete={onTextDelete}
          onPlay={onTextPlay}
        />
      </div>
      <div className="stage-readout" aria-hidden="true">
        {Math.round(scaleLabel * 100)}%
      </div>
    </div>
  );
});

/* -------------------------------- text layer ------------------------------- */

interface TextLayerProps {
  page: Page;
  /** 현재 화면 배율. 도구 막대가 작아지지 않도록 역보정합니다. */
  scale: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (block: TextBlock, x: number, y: number) => void;
  onEdit: (block: TextBlock) => void;
  onDelete: (block: TextBlock) => void;
  onPlay: (block: TextBlock) => void;
}

interface TextDrag {
  id: string;
  startX: number;
  startY: number;
  origX: number;
  origY: number;
  width: number;
  scale: number;
  x: number;
  y: number;
  moved: boolean;
}

function TextLayer({
  page,
  scale,
  selectedId,
  onSelect,
  onMove,
  onEdit,
  onDelete,
  onPlay,
}: TextLayerProps) {
  const [drag, setDrag] = useState<TextDrag | null>(null);
  const dragRef = useRef<TextDrag | null>(null);
  const lastTap = useRef({ id: '', at: 0 });
  const blocks = page.textBlocks ?? [];

  const setDragState = useCallback((next: TextDrag | null) => {
    dragRef.current = next;
    setDrag(next);
  }, []);

  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(Math.max(min, max), value));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, block: TextBlock) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
    const paper = e.currentTarget.closest('.paper') as HTMLElement | null;
    const rect = paper?.getBoundingClientRect();
    const currentScale = rect && rect.width ? rect.width / page.width : 1;
    const now = performance.now();
    const doubleTap = lastTap.current.id === block.id && now - lastTap.current.at < 380;
    lastTap.current = { id: block.id, at: now };
    onSelect(block.id);
    if (doubleTap) {
      setDragState(null);
      onEdit(block);
      return;
    }
    setDragState({
      id: block.id,
      startX: e.clientX,
      startY: e.clientY,
      origX: block.x,
      origY: block.y,
      width: block.width,
      scale: currentScale,
      x: block.x,
      y: block.y,
      moved: false,
    });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const active = dragRef.current;
    if (!active) return;
    e.stopPropagation();
    const dx = (e.clientX - active.startX) / active.scale;
    const dy = (e.clientY - active.startY) / active.scale;
    const x = clamp(active.origX + dx, 8, page.width - active.width - 8);
    const y = clamp(active.origY + dy, 8, page.height - 30);
    setDragState({
      ...active,
      x,
      y,
      moved: active.moved || Math.abs(dx) + Math.abs(dy) > 2,
    });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>, block: TextBlock) => {
    const active = dragRef.current;
    if (!active || active.id !== block.id) {
      setDragState(null);
      return;
    }
    e.stopPropagation();
    if (active.moved) onMove(block, active.x, active.y);
    setDragState(null);
  };

  if (!blocks.length) return null;

  // 화면 배율이 작아져도 편집 도구는 같은 크기로 보이게 합니다.
  const toolScale = 1 / Math.max(0.32, Math.min(1.6, scale));

  return (
    <div className="text-layer">
      {blocks.map((block) => {
        const active = drag?.id === block.id;
        const x = active ? drag.x : block.x;
        const y = active ? drag.y : block.y;
        return (
          <div
            key={block.id}
            className={`text-block ${selectedId === block.id ? 'is-on' : ''} ${active ? 'is-drag' : ''}`}
            style={{
              left: x,
              top: y,
              width: block.width,
              fontSize: block.fontSize,
              lineHeight: TEXT_LINE_HEIGHT,
              color: block.color,
              fontFamily: TEXT_FONT,
              textAlign: block.align,
            }}
            onPointerDown={(e) => onPointerDown(e, block)}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => onPointerUp(e, block)}
            onPointerCancel={(e) => onPointerUp(e, block)}
            onLostPointerCapture={() => setDragState(null)}
            onContextMenu={(e) => e.preventDefault()}
          >
            {block.text}
            {selectedId === block.id ? (
              <div
                className="text-tools"
                style={{ transform: `scale(${toolScale})` }}
                onPointerDown={(e) => e.stopPropagation()}
                onPointerMove={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEdit(block);
                  }}
                  aria-label="글 편집"
                  title="글 편집"
                >
                  <Icon name="pencil" size={14} />
                </button>
                {block.audioId ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPlay(block);
                    }}
                    aria-label="녹음 재생"
                    title="녹음 재생"
                  >
                    <Icon name="play" size={14} />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(block);
                  }}
                  aria-label="글 삭제"
                  title="글 삭제"
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
