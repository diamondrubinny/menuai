/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import type { Tag } from '../core/schema';
import type { Ornament } from '../core/themes';

const common = {
  width: '1em', height: '1em', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  'aria-hidden': true, focusable: false,
};

const TAG_PATHS: Record<Tag, string> = {
  vegan: 'M5 19c0-8 5-13 14-14-1 9-6 14-14 14Zm0 0 7-7',
  vegetarian: 'M12 21v-9m0 0C12 7 9 4 4 4c0 5 3 8 8 8Zm0 0c0-4 2.5-7 8-7 0 4.5-3 7-8 7Z',
  glutenFree: 'M12 21V9m0 4-3-3m3 3 3-3m-3 0-3-3m3 3 3-3m-3-1V3M4 4l16 16',
  new: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 11 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8L19 14Z',
  chefPick: 'M7 14v6h10v-6M7 14a4 4 0 1 1 1.5-7.7A4 4 0 0 1 15.5 6.3 4 4 0 1 1 17 14H7Zm0 3h10',
  popular: 'M12 3s5 4.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 1.5-4S9 12 11 12c0-4 1-9 1-9Z',
  kosher: 'M12 3l2.6 4.5H20L17.3 12 20 16.5h-5.4L12 21l-2.6-4.5H4L6.7 12 4 7.5h5.4L12 3Z',
  halal: 'M15.5 4.5A8 8 0 1 0 19.5 16a6.5 6.5 0 1 1-4-11.5ZM18 8l.7 1.6L20.5 10l-1.8.5L18 12l-.7-1.5-1.8-.5 1.8-.4L18 8Z',
};

export function TagIcon({ tag }: { tag: Tag }) {
  return (
    <svg {...common} className="ma-icon">
      <path d={TAG_PATHS[tag]} />
    </svg>
  );
}

export function ChiliIcon() {
  return (
    <svg {...common} className="ma-icon ma-chili" fill="currentColor" stroke="none">
      <path d="M17.6 4.2c.4-.9 1.1-1.5 2-1.8l.5 1.1c-.5.2-.9.5-1.2 1 1.1.8 1.6 2.1 1.4 3.6-.6 5.3-6.4 11.4-14.8 12.6-1.1.2-1.7-1.1-.8-1.8 4.5-3.4 6.6-7.6 7.7-10.6.6-1.7 2.2-2.9 4-2.9.4 0 .8 0 1.2-.2Z" />
    </svg>
  );
}

/** Decorative divider. Purely visual: hidden from assistive technology. */
export function OrnamentSvg({ kind }: { kind: Ornament }) {
  if (kind === 'none') return null;
  const svg = { viewBox: '0 0 240 24', 'aria-hidden': true, focusable: false, className: `ma-ornament ma-ornament-${kind}` };
  switch (kind) {
    case 'art-deco':
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0 12h92M148 12h92M0 8h80M160 8h80M0 16h80M160 16h80" opacity=".55" />
          <path d="M120 2l10 10-10 10-10-10 10-10Z" fill="currentColor" />
          <path d="M104 12l-6-6m6 6-6 6M136 12l6-6m-6 6 6 6" />
          <circle cx="120" cy="12" r="15" opacity=".35" />
        </svg>
      );
    case 'flourish':
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round">
          <path d="M20 12h70c8 0 12-8 20-8 6 0 10 4 10 8s-4 8-10 8c-8 0-12-8-20-8M220 12h-70c-8 0-12 8-20 8-6 0-10-4-10-8" />
          <circle cx="120" cy="12" r="2.4" fill="currentColor" />
        </svg>
      );
    case 'geometric':
      return (
        <svg {...svg} fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0 12h96M144 12h96" opacity=".6" />
          <path d="M120 1l3.2 7.8 7.8 3.2-7.8 3.2L120 23l-3.2-7.8L109 12l7.8-3.2L120 1Z" />
          <path d="M112.2 4.2h15.6v15.6h-15.6Z" transform="rotate(45 120 12)" />
          <path d="M100 12l4-4 4 4-4 4-4-4ZM132 12l4-4 4 4-4 4-4-4Z" fill="currentColor" />
        </svg>
      );
    case 'dots':
      return (
        <svg {...svg} fill="currentColor">
          <circle cx="104" cy="12" r="2" opacity=".5" />
          <circle cx="120" cy="12" r="3" />
          <circle cx="136" cy="12" r="2" opacity=".5" />
        </svg>
      );
  }
}
