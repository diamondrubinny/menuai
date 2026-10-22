export interface MenuRuntime {
  refresh(): void;
  destroy(): void;
}

export function initMenuRuntime(
  container: HTMLElement,
  options?: { scrollRoot?: Element | null; syncUrl?: boolean },
): MenuRuntime;
