/*! @license
 * MenuAI — open-source menu builder · https://github.com/diamondrubinny/menuai
 * Copyright (c) 2026 Diamond Rubinny and MenuAI contributors · MIT License
 * Powered by MenuAI. This notice must be kept (see LICENSE and NOTICE).
 */
import { useState, type ReactNode } from 'react';

/** <details> that remembers its own state and only renders its body while open (keeps large menus fast). */
export function Details({ initialOpen = false, className, summary, children }: {
  initialOpen?: boolean; className?: string; summary: ReactNode; children: () => ReactNode;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <details className={className} open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      {open && <div className="card-body">{children()}</div>}
    </details>
  );
}
