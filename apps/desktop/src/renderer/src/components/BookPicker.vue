<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';

import { findBooks } from '../../../shared/bible-reference';
import type { BibleBook } from '../../../shared/ipc-contract';

// Chooses a book of the open translation by typing part of its name or a
// short form ("jn", "1 cor", "salmo"): an editable combobox (the WAI-ARIA
// combobox pattern). The books are the translation on this laptop, so it
// works offline. Leaving it without choosing puts back the current book.

const props = defineProps<{
  books: readonly BibleBook[];
  isDisabled?: boolean;
}>();
const bookCode = defineModel<string | null>({ required: true });

const listId = useId();
const current = computed(
  () => props.books.find((book) => book.code === bookCode.value) ?? null,
);
const query = ref('');
const isOpen = ref(false);
const activeIndex = ref(0);

const matches = computed(() => findBooks(props.books, query.value));

const activeOptionId = computed(() =>
  isOpen.value && matches.value.length > 0
    ? `${listId}-${activeIndex.value}`
    : undefined,
);

// Shows the chosen book's name whenever the field is not being typed in.
watch(
  current,
  (book) => {
    if (!isOpen.value) query.value = book?.name ?? '';
  },
  { immediate: true },
);

function open(event: FocusEvent): void {
  isOpen.value = true;
  activeIndex.value = 0;
  query.value = '';
  // Typing replaces the name; nothing to delete first.
  (event.target as HTMLInputElement).select();
}

function onInput(): void {
  isOpen.value = true;
  activeIndex.value = 0;
}

function choose(book: BibleBook, input?: HTMLInputElement): void {
  bookCode.value = book.code;
  query.value = book.name;
  isOpen.value = false;
  input?.blur();
}

function move(step: number): void {
  isOpen.value = true;
  const count = matches.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + step + count) % count;
  void nextTick(() =>
    document
      .getElementById(`${listId}-${activeIndex.value}`)
      ?.scrollIntoView({ block: 'nearest' }),
  );
}

function onEnter(event: KeyboardEvent): void {
  const book = matches.value[activeIndex.value];
  if (book) choose(book, event.target as HTMLInputElement);
}

function close(): void {
  isOpen.value = false;
  query.value = current.value?.name ?? '';
}

function cancel(event: KeyboardEvent): void {
  close();
  (event.target as HTMLInputElement).blur();
}
</script>

<template>
  <div class="combobox">
    <input
      v-model="query"
      role="combobox"
      aria-label="Book"
      aria-autocomplete="list"
      autocomplete="off"
      spellcheck="false"
      :aria-expanded="isOpen"
      :aria-controls="listId"
      :aria-activedescendant="activeOptionId"
      :disabled="props.isDisabled"
      data-testid="bible-book"
      @focus="open"
      @input="onInput"
      @blur="close"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter.prevent="onEnter"
      @keydown.esc.prevent="cancel"
    />
    <ul v-show="isOpen" :id="listId" role="listbox" class="combobox-list">
      <li
        v-for="(book, index) in matches"
        :id="`${listId}-${index}`"
        :key="book.code"
        role="option"
        :aria-selected="index === activeIndex"
        :data-testid="`bible-book-option-${book.code}`"
        @mousedown.prevent="choose(book)"
        @mousemove="activeIndex = index"
      >
        {{ book.name }}
      </li>
      <li v-if="matches.length === 0" class="combobox-none" role="presentation">
        No book matches.
      </li>
    </ul>
  </div>
</template>
