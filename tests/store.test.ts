import { beforeEach, describe, expect, it } from 'vitest';
import { useMenuStore } from '../src/store/menuStore';
import { createSampleMenu } from '../src/core/sample';

const s = () => useMenuStore.getState();

describe('menu store', () => {
  beforeEach(() => useMenuStore.setState({ menu: createSampleMenu(), past: [], future: [], lastKey: null }));

  it('undoes and redoes', () => {
    const before = s().menu.sections.length;
    s().addSection();
    expect(s().menu.sections.length).toBe(before + 1);
    s().undo();
    expect(s().menu.sections.length).toBe(before);
    s().redo();
    expect(s().menu.sections.length).toBe(before + 1);
  });

  it('coalesces rapid typing into one undo step', () => {
    s().update((m) => ({ ...m, title: { he: 'a' } }), 'title');
    s().update((m) => ({ ...m, title: { he: 'ab' } }), 'title');
    s().update((m) => ({ ...m, title: { he: 'abc' } }), 'title');
    expect(s().past).toHaveLength(1);
    s().undo();
    expect(s().menu.title.he).toBe('לומייר');
  });

  it('moves, duplicates and removes items with fresh ids', () => {
    const section = s().menu.sections[0]!;
    const [first, second] = section.items;
    s().moveItem(section.id, first!.id, 1);
    expect(s().menu.sections[0]!.items[1]!.id).toBe(first!.id);
    s().moveItem(section.id, second!.id, -1); // already first: no-op
    expect(s().menu.sections[0]!.items[0]!.id).toBe(second!.id);
    s().duplicateItem(section.id, first!.id);
    const items = s().menu.sections[0]!.items;
    expect(items).toHaveLength(section.items.length + 1);
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
    s().removeItem(section.id, first!.id);
    expect(s().menu.sections[0]!.items.some((i) => i.id === first!.id)).toBe(false);
  });

  it('resets look & feel when switching theme', () => {
    s().setDesign({ palette: { bg: '#000000' }, effects: { glow: true } });
    s().setTheme('ivory-bistro');
    expect(s().menu.design.palette).toEqual({});
    expect(s().menu.design.effects).toEqual({});
    expect(s().menu.design.layout).toBe('list');
  });
});
