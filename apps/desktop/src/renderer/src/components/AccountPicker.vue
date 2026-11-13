<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue';

import type { ListedAccount } from '../../../shared/ipc-contract';
import { affiliationLabel } from '../../../shared/role-labels';
import { messageOf } from '../errors';

// Chooses one existing account by typing part of its name, email or username:
// an editable combobox (the WAI-ARIA combobox pattern) whose suggestions come
// from the server, searched as the person types, never from a list loaded
// once. Only a suggested account can be chosen, so a form using it never sends
// an address the server does not know. To clear it, a parent remounts it (a
// new `key`).

/** Waits for a pause in typing before asking the server. */
const SEARCH_DELAY_MILLISECONDS = 200;

const props = defineProps<{
  label: string;
  /** Searches the server for the accounts that may be chosen. */
  search: (term: string) => Promise<ListedAccount[]>;
  /** Leaves out accounts that may not be chosen here (e.g. the current owner). */
  isExcluded?: (account: ListedAccount) => boolean;
  /** Prefixes the input's and each suggestion's `data-testid`. */
  testId: string;
  /** Said when nothing matches what was typed. */
  noMatchHint: string;
  isRequired?: boolean;
}>();
const chosen = defineModel<ListedAccount | null>({ required: true });

const inputId = useId();
const listId = useId();
const query = ref(chosen.value?.email ?? '');
const results = ref<ListedAccount[]>([]);
const isOpen = ref(false);
const isSearching = ref(false);
const searchError = ref<string | null>(null);
const activeIndex = ref(-1);
let searchTimer: ReturnType<typeof setTimeout> | undefined;
/** Numbers each search, so an answer overtaken by a newer one is ignored. */
let latestSearch = 0;

const matches = computed(() =>
  results.value.filter((account) => !props.isExcluded?.(account)),
);

const activeOptionId = computed(() =>
  isOpen.value && activeIndex.value >= 0
    ? `${listId}-${activeIndex.value}`
    : undefined,
);

function scheduleSearch(): void {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void runSearch(), SEARCH_DELAY_MILLISECONDS);
}

async function runSearch(): Promise<void> {
  const searchNumber = ++latestSearch;
  const term = query.value.trim();
  isSearching.value = true;
  try {
    const found = await props.search(term);
    if (searchNumber !== latestSearch) return;
    results.value = found;
    searchError.value = null;
    activeIndex.value = matches.value.length > 0 ? 0 : -1;
    // Typing a whole address chooses its account, as picking it would.
    const typed = term.toLowerCase();
    const exact = matches.value.find(
      (account) => account.email.toLowerCase() === typed,
    );
    if (exact) chosen.value = exact;
  } catch (error) {
    if (searchNumber !== latestSearch) return;
    results.value = [];
    searchError.value = messageOf(error);
  } finally {
    if (searchNumber === latestSearch) isSearching.value = false;
  }
}

function open(): void {
  isOpen.value = true;
  scheduleSearch();
}

function onInput(): void {
  // What was chosen no longer matches what is typed.
  chosen.value = null;
  open();
}

function choose(account: ListedAccount): void {
  clearTimeout(searchTimer);
  latestSearch += 1;
  chosen.value = account;
  query.value = account.email;
  isOpen.value = false;
}

function move(step: number): void {
  if (!isOpen.value) {
    open();
    return;
  }
  const count = matches.value.length;
  if (count === 0) return;
  activeIndex.value = (activeIndex.value + step + count) % count;
}

function onEnter(event: KeyboardEvent): void {
  const account = isOpen.value ? matches.value[activeIndex.value] : undefined;
  if (!account) return;
  // Choosing a suggestion must not also submit the form.
  event.preventDefault();
  choose(account);
}

function close(): void {
  isOpen.value = false;
}

onBeforeUnmount(() => clearTimeout(searchTimer));
</script>

<template>
  <div class="picker">
    <label :for="inputId">{{ props.label }}</label>
    <input
      :id="inputId"
      v-model="query"
      role="combobox"
      autocomplete="off"
      spellcheck="false"
      placeholder="Type a name or email"
      aria-autocomplete="list"
      :aria-expanded="isOpen"
      :aria-controls="listId"
      :aria-activedescendant="activeOptionId"
      :aria-busy="isSearching"
      :required="props.isRequired"
      :data-testid="props.testId"
      @input="onInput"
      @focus="open"
      @blur="close"
      @keydown.down.prevent="move(1)"
      @keydown.up.prevent="move(-1)"
      @keydown.enter="onEnter"
      @keydown.esc="close"
    />
    <ul v-show="isOpen" :id="listId" role="listbox" class="suggestions">
      <li
        v-for="(account, index) in matches"
        :id="`${listId}-${index}`"
        :key="account.id"
        role="option"
        :aria-selected="index === activeIndex"
        :data-testid="`${props.testId}-option`"
        @mousedown.prevent="choose(account)"
        @mousemove="activeIndex = index"
      >
        <span class="item-title">{{ account.displayName }}</span>
        <span class="item-sub"
          >{{ account.email }} · {{ affiliationLabel(account) }}</span
        >
      </li>
      <li v-if="searchError" class="none" role="presentation">
        {{ searchError }}
      </li>
      <li v-else-if="matches.length === 0" class="none" role="presentation">
        {{ isSearching ? 'Searching…' : props.noMatchHint }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picker {
  position: relative;
  display: grid;
  gap: 0.35rem;
}

.picker input {
  width: 100%;
}

.suggestions {
  position: absolute;
  top: 100%;
  right: 0;
  left: 0;
  z-index: 10;
  display: grid;
  gap: 0.1rem;
  max-height: 18rem;
  margin: 0.3rem 0 0;
  padding: 0.3rem;
  overflow-y: auto;
  list-style: none;
  background: var(--surface-raised);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.suggestions [role='option'] {
  display: grid;
  gap: 0.1rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  cursor: pointer;
}

.suggestions [aria-selected='true'] {
  background: var(--surface-hover);
}

.none {
  padding: 0.45rem 0.6rem;
  color: var(--text-muted);
  font-size: 0.82rem;
}
</style>
