import type { SVGProps } from 'react';

export type IconName =
  | 'pen'
  | 'pencil'
  | 'highlighter'
  | 'eraser'
  | 'undo'
  | 'redo'
  | 'plus'
  | 'back'
  | 'search'
  | 'more'
  | 'grid'
  | 'download'
  | 'upload'
  | 'focus'
  | 'expand'
  | 'zoomIn'
  | 'zoomOut'
  | 'trash'
  | 'copy'
  | 'close'
  | 'check'
  | 'folder'
  | 'chevronDown'
  | 'chevronLeft'
  | 'chevronRight'
  | 'settings'
  | 'page'
  | 'book'
  | 'hand'
  | 'info'
  | 'sparkle'
  | 'file'
  | 'mic'
  | 'play'
  | 'stop'
  | 'text';

const paths: Record<IconName, React.ReactNode> = {
  pen: (
    <>
      <path d="M12 3.2l6.4 6.4-6.4 11.2L5.6 9.6 12 3.2Z" />
      <path d="M12 8.2v6.2" />
      <circle cx="12" cy="16.6" r="1.05" fill="currentColor" stroke="none" />
      <path d="M9.2 6.4h5.6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l.9-3.6L16.3 5a1.8 1.8 0 0 1 2.6 0l.1.1a1.8 1.8 0 0 1 0 2.6L7.6 19.1 4 20Z" />
      <path d="M13.8 7.6l2.6 2.6" />
      <path d="M4.6 19.4l3.2-.8" />
    </>
  ),
  highlighter: (
    <>
      <path d="M6 14.5l7.8-7.8a2 2 0 0 1 2.8 0l.7.7a2 2 0 0 1 0 2.8L9.5 18H6v-3.5Z" />
      <path d="M4 21h16" />
      <path d="M13 7.5l3.5 3.5" />
    </>
  ),
  eraser: (
    <>
      <path d="M8.5 19H20" />
      <path d="M14.8 4.5l4.7 4.7a1.8 1.8 0 0 1 0 2.6l-6.8 6.8a1.8 1.8 0 0 1-2.6 0l-4.7-4.7a1.8 1.8 0 0 1 0-2.6l6.8-6.8a1.8 1.8 0 0 1 2.6 0Z" />
      <path d="M8 8l8 8" />
    </>
  ),
  hand: (
    <>
      <path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5" />
      <path d="M14 10.8V6.5a1.5 1.5 0 0 1 3 0V13" />
      <path d="M17 9.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.2a6 6 0 0 1-4.4-1.9L5 15.6a1.6 1.6 0 0 1 2.3-2.2L9 15" />
    </>
  ),
  undo: (
    <>
      <path d="M8 7H5v-3" />
      <path d="M5.5 7.5A8 8 0 1 1 4 13" />
    </>
  ),
  redo: (
    <>
      <path d="M16 7h3v-3" />
      <path d="M18.5 7.5A8 8 0 1 0 20 13" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  more: (
    <>
      <circle cx="5.5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 19V8" />
      <path d="M7.5 12.5L12 8l4.5 4.5" />
      <path d="M4.5 4.5h15" />
    </>
  ),
  focus: (
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </>
  ),
  expand: (
    <>
      <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
    </>
  ),
  zoomIn: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M11 8.5v5M8.5 11h5M20 20l-4.2-4.2" />
    </>
  ),
  zoomOut: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M8.5 11h5M20 20l-4.2-4.2" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15" />
      <path d="M9 7V4.5h6V7" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 13l5 5L20 7" />,
  folder: (
    <>
      <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.3a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7.5Z" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </>
  ),
  page: (
    <>
      <path d="M6 3.5h8l4 4v13H6v-17Z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 13h6M9 16.5h4" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21V5.5Z" />
      <path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
      <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2Z" />
    </>
  ),
  file: (
    <>
      <path d="M6 3.5h8l4 4v13H6v-17Z" />
      <path d="M14 3.5v4h4" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.2" width="6" height="10.4" rx="3" />
      <path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0" />
      <path d="M12 17.4V21" />
      <path d="M8.8 21h6.4" />
    </>
  ),
  play: <path d="M8 5.2l11 6.8-11 6.8V5.2Z" />,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  text: (
    <>
      <path d="M5 5.5h14" />
      <path d="M12 5.5V20" />
      <path d="M8.5 20h7" />
    </>
  ),
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.55}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
