import { nextTick, shallowRef } from 'vue';

// Drag-to-reorder for short lists (playlist entries, arrangement chips), on
// the browser's own drag and drop. Dragging is never the only way: every
// list keeps buttons that move an item one step (WCAG 2.5.7), and those
// buttons are the keyboard path.

export type DropSide = 'before' | 'after';

/**
 * The index an item ends up at when it is dropped on `side` of the item at
 * `targetIndex`, or null when the drop leaves it where it is.
 */
export function reorderTarget(
  from: number,
  targetIndex: number,
  side: DropSide,
): number | null {
  const insertion = side === 'before' ? targetIndex : targetIndex + 1;
  const to = from < insertion ? insertion - 1 : insertion;
  return to === from ? null : to;
}

/** A copy of `list` with the item at `from` moved to `to`. */
export function moveItem<Value>(
  list: readonly Value[],
  from: number,
  to: number,
): Value[] {
  const result = [...list];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length) {
    return result;
  }
  const [moved] = result.splice(from, 1);
  result.splice(to, 0, moved!);
  return result;
}

/** Moves focus to the first of `selectors` that is enabled, once Vue has rendered. */
export async function focusFirstEnabled(...selectors: string[]): Promise<void> {
  await nextTick();
  for (const selector of selectors) {
    const element = document.querySelector<HTMLButtonElement>(selector);
    if (element && !element.disabled) {
      element.focus();
      return;
    }
  }
}

interface DragReorderOptions<List> {
  /** How the list runs: rows stack vertically, chips run horizontally. */
  axis: 'vertical' | 'horizontal';
  /** While true, no drag starts (a save is in flight). */
  isDisabled?: () => boolean;
  onMove: (list: List, from: number, to: number) => void;
}

/**
 * One instance serves every list of a component; `list` (any value compared
 * by identity) tells them apart, and an item never drops into another list.
 */
export function useDragReorder<List>(options: DragReorderOptions<List>) {
  const dragging = shallowRef<{ list: List; index: number } | null>(null);
  const target = shallowRef<{ index: number; side: DropSide } | null>(null);

  const isFromList = (list: List) => dragging.value?.list === list;

  function end(): void {
    dragging.value = null;
    target.value = null;
  }

  return {
    /** dragstart on the dragged element; `preview` is drawn under the pointer. */
    start(list: List, index: number, event: DragEvent, preview?: Element) {
      if (options.isDisabled?.()) {
        event.preventDefault();
        return;
      }
      dragging.value = { list, index };
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        if (preview) event.dataTransfer.setDragImage(preview, 16, 16);
      }
    },

    /** dragover on each item: accepts only an item of the same list. */
    over(list: List, index: number, event: DragEvent) {
      if (!isFromList(list)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
      const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const isBefore =
        options.axis === 'vertical'
          ? event.clientY < box.top + box.height / 2
          : event.clientX < box.left + box.width / 2;
      target.value = { index, side: isBefore ? 'before' : 'after' };
    },

    /** drop on each item. */
    drop(list: List, event: DragEvent) {
      const source = dragging.value;
      const destination = target.value;
      if (!source || source.list !== list || !destination) return;
      event.preventDefault();
      end();
      const to = reorderTarget(
        source.index,
        destination.index,
        destination.side,
      );
      if (to !== null) options.onMove(list, source.index, to);
    },

    /** dragleave on the list: no marker once the pointer leaves it. */
    leave(event: DragEvent) {
      const container = event.currentTarget as HTMLElement;
      if (!container.contains(event.relatedTarget as Node | null)) {
        target.value = null;
      }
    },

    /** dragend on the dragged element (also after a drop outside the list). */
    end,

    isDragged(list: List, index: number): boolean {
      return isFromList(list) && dragging.value?.index === index;
    },

    /** Which side of this item shows the drop marker, if any. */
    markerAt(list: List, index: number): DropSide | null {
      const source = dragging.value;
      const destination = target.value;
      if (!source || source.list !== list || destination?.index !== index) {
        return null;
      }
      // No marker where dropping would change nothing.
      return reorderTarget(source.index, index, destination.side) === null
        ? null
        : destination.side;
    },
  };
}
