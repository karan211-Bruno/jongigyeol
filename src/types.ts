export type ToolId = 'pen' | 'pencil' | 'highlighter' | 'eraser';
export type InkTool = Exclude<ToolId, 'eraser'>;
export type TemplateId = 'blank' | 'lined' | 'grid' | 'dot';
export type CoverId = 'linen' | 'kraft' | 'sage' | 'slate' | 'rose';

/** Flat point list: [x, y, pressure, x, y, pressure, ...] in page coordinates. */
export interface Stroke {
  id: string;
  tool: InkTool;
  color: string;
  width: number;
  points: number[];
}

export interface Page {
  id: string;
  notebookId: string;
  order: number;
  template: TemplateId;
  /** Raster background (PDF page or photo) as a data URL. */
  background?: string;
  strokes: Stroke[];
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
}

export interface Notebook {
  id: string;
  title: string;
  folder: string;
  cover: CoverId;
  /** Default paper for new pages. */
  template: TemplateId;
  createdAt: number;
  updatedAt: number;
  pageCount: number;
}

export interface PageAsset {
  pageId: string;
  dataUrl: string;
}

export const PAGE_W = 1080;
export const PAGE_H = 1528;

export interface PenSettings {
  tool: ToolId;
  penColor: string;
  pencilColor: string;
  highlighterColor: string;
  penWidth: number;
  pencilWidth: number;
  highlighterWidth: number;
  eraserWidth: number;
  fingerDraw: boolean;
}

export const INK_COLORS = [
  { name: '먹색', value: '#171714' },
  { name: '흑연', value: '#565650' },
  { name: '청색', value: '#26496f' },
  { name: '적색', value: '#8a3b32' },
  { name: '녹색', value: '#3d5a48' },
];

export const HIGHLIGHTER_COLORS = [
  { name: '노랑', value: '#efd066' },
  { name: '분홍', value: '#e9a3aa' },
  { name: '하늘', value: '#9dc3d8' },
  { name: '연두', value: '#b9d39a' },
  { name: '보라', value: '#c0a9d6' },
];

export const TEMPLATES: { id: TemplateId; label: string; note: string }[] = [
  { id: 'lined', label: '줄 노트', note: '가로 줄' },
  { id: 'grid', label: '모눈', note: '격자' },
  { id: 'dot', label: '도트', note: '점 격자' },
  { id: 'blank', label: '무지', note: '빈 종이' },
];

export const COVERS: { id: CoverId; label: string; swatch: string }[] = [
  { id: 'linen', label: '리넨', swatch: '#ded8ca' },
  { id: 'kraft', label: '크라프트', swatch: '#c9a97c' },
  { id: 'sage', label: '세이지', swatch: '#93a28d' },
  { id: 'slate', label: '슬레이트', swatch: '#5d6668' },
  { id: 'rose', label: '로즈', swatch: '#c9a4a0' },
];

export const TOOL_LABEL: Record<ToolId, string> = {
  pen: '펜',
  pencil: '연필',
  highlighter: '형광펜',
  eraser: '지우개',
};

export const DEFAULT_SETTINGS: PenSettings = {
  tool: 'pen',
  penColor: INK_COLORS[0].value,
  pencilColor: INK_COLORS[1].value,
  highlighterColor: HIGHLIGHTER_COLORS[0].value,
  penWidth: 3.4,
  pencilWidth: 3,
  highlighterWidth: 22,
  eraserWidth: 26,
  fingerDraw: false,
};

export interface ToolSizes {
  pen: number[];
  pencil: number[];
  highlighter: number[];
  eraser: number[];
}
