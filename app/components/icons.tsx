import type { SVGProps } from "react";

const base = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** Кассета с плёнкой: пункт навигации «Папки» */
export function FilmIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="8" width="13" height="12" rx="2" />
      <path d="M8 8V5.5h5V8" />
      <circle cx="10.5" cy="14" r="2.6" />
      <path d="M17 12.5h3.2v4.2H17" />
    </svg>
  );
}

/** Папка, простой контур: кнопка «открыть папку» в углу кадра */
export function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 8.2A1.8 1.8 0 0 1 4.8 6.4h4.5l1.8 2.1h8.1a1.8 1.8 0 0 1 1.8 1.8v6.9a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.2Z" />
    </svg>
  );
}

export function ShuffleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M3 7h3.5c5 0 5 10 10 10H21M3 17h3.5c1.6 0 2.8-.7 3.7-1.7M13.8 8.7C14.7 7.7 15.5 7 17 7h4" />
      <path d="M18.5 4.5 21 7l-2.5 2.5M18.5 14.5 21 17l-2.5 2.5" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function ChevronIcon({ dir = "right", ...props }: SVGProps<SVGSVGElement> & { dir?: "left" | "right" }) {
  return (
    <svg {...base} {...props}>
      <path d={dir === "right" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"} />
    </svg>
  );
}

/** Сетка ленты: пункт навигации «Лента» в нижней панели на мобильном/планшете */
export function GridIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.4" />
      <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4" />
      <rect x="13" y="13" width="7.5" height="7.5" rx="1.4" />
    </svg>
  );
}

export function UploadIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M12 16V4M7 9l5-5 5 5M5 20h14" />
    </svg>
  );
}

export function RetryIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v4.5h-4.5" />
    </svg>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base} {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
