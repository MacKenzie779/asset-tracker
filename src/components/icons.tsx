// Single icon set for the whole app.
// Every icon: 24px viewBox, stroke = currentColor, strokeWidth 1.8, aria-hidden.
// Size with className (default 18px); nav icons pass `h-5 w-5`.
import type { SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'>;

function Svg({
  className = 'h-[18px] w-[18px]',
  strokeWidth = 1.8,
  children,
  ...rest
}: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ---------- navigation ---------- */
export function IconHome(p: IconProps) {
  return <Svg {...p}><path d="M3 11.5 12 4l9 7.5V20a2 2 0 0 1-2 2h-5v-6H10v6H5a2 2 0 0 1-2-2z" /></Svg>;
}
export function IconWallet(p: IconProps) {
  return <Svg {...p}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M16 12h4" /></Svg>;
}
export function IconArrows(p: IconProps) {
  return <Svg {...p}><path d="M7 7h10l-3-3M17 17H7l3 3" /></Svg>;
}
export function IconChart(p: IconProps) {
  return <Svg {...p}><path d="M4 19V5M8 19v-7M12 19V8M16 19v-4M20 19V10" /></Svg>;
}
export function IconTag(p: IconProps) {
  return <Svg {...p}><path d="M20 12l-8 8-8-8V4h8l8 8z" /><circle cx="9.5" cy="8.5" r="1.3" /></Svg>;
}

/* ---------- actions ---------- */
export function IconPencil(p: IconProps) {
  return <Svg {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" /></Svg>;
}
export function IconTrash(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3 6h18" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
      <path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}
export function IconCheck(p: IconProps) {
  return <Svg {...p}><path d="M20 6 9 17l-5-5" /></Svg>;
}
export function IconX(p: IconProps) {
  return <Svg {...p}><path d="M18 6 6 18M6 6l12 12" /></Svg>;
}
export function IconPlus(p: IconProps) {
  return <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>;
}
export function IconRefresh(p: IconProps) {
  return <Svg {...p}><path d="M20 12a8 8 0 1 1-2.34-5.66" /><path d="M20 4v6h-6" /></Svg>;
}
export function IconSearch(p: IconProps) {
  return <Svg {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.35-4.35" /></Svg>;
}
export function IconPaperPlane(p: IconProps) {
  return <Svg {...p}><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7Z" /></Svg>;
}
export function IconArrowUp(p: IconProps) {
  return <Svg {...p}><path d="M12 5l-7 7h14L12 5z" /></Svg>;
}
export function IconArrowDown(p: IconProps) {
  return <Svg {...p}><path d="M12 19l7-7H5l7 7z" /></Svg>;
}
export function IconChevronDown(p: IconProps) {
  return <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>;
}
export function IconExternalLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
    </Svg>
  );
}
export function IconFolder(p: IconProps) {
  return <Svg {...p}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" /></Svg>;
}
export function IconKeyboard(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
    </Svg>
  );
}
export function IconUser(p: IconProps) {
  return <Svg {...p}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></Svg>;
}
export function IconLink(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}
export function IconLock(p: IconProps) {
  return <Svg {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></Svg>;
}

/* ---------- visibility ---------- */
export function IconEye(p: IconProps) {
  return <Svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z" /><circle cx="12" cy="12" r="3" /></Svg>;
}
export function IconEyeOff(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.11 1 12c.66-1.53 1.7-2.94 2.99-4.11" />
      <path d="M10.58 10.58a2 2 0 1 0 2.83 2.83" />
      <path d="M6.1 6.1 17.9 17.9" />
      <path d="M22.94 12c-.94 2.23-2.54 4.2-4.62 5.64" />
      <path d="M9.88 4.26A10.94 10.94 0 0 1 12 4c5 0 9.27 3.89 11 8" />
    </Svg>
  );
}

/* ---------- theme ---------- */
export function IconSun(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </Svg>
  );
}
export function IconMoon(p: IconProps) {
  return <Svg {...p}><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Svg>;
}
export function IconMonitor(p: IconProps) {
  return <Svg {...p}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></Svg>;
}

/* ---------- status ---------- */
export function IconInfo(p: IconProps) {
  return <Svg {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" /></Svg>;
}
export function IconAlertTriangle(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </Svg>
  );
}
export function IconCheckCircle(p: IconProps) {
  return <Svg {...p}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><path d="M22 4 12 14.01l-3-3" /></Svg>;
}
export function IconInbox(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </Svg>
  );
}
