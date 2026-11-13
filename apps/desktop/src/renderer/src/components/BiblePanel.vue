<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  BibleBook,
  BibleSearchHit,
  BibleTranslation,
  BibleVerse,
  PlaylistItemInput,
  SyncStatus,
} from '../../../shared/ipc-contract';
import { readReference } from '../../../shared/bible-reference';
import { formatReference } from '../../../shared/slides';
import { messageOf } from '../errors';
import AddToPlaylist from './AddToPlaylist.vue';
import AppIcon from './AppIcon.vue';
import BookPicker from './BookPicker.vue';

const translations = ref<BibleTranslation[]>([]);
const translationId = ref<string | null>(null);
const books = ref<BibleBook[]>([]);
const bookCode = ref<string | null>(null);
const chapter = ref(1);
const verses = ref<BibleVerse[]>([]);
/** The selected verses: from `start` to `end` in this chapter. */
const start = ref<number | null>(null);
const end = ref<number | null>(null);
const search = ref('');
const results = ref<BibleSearchHit[]>([]);
const errorMessage = ref<string | null>(null);
/** A typed reference ("jn 3:16-18"), read against this translation's books. */
const referenceText = ref('');
/** Why the last reference could not be opened; shown once Enter is pressed. */
const referenceProblem = ref<string | null>(null);

const book = computed(
  () =>
    books.value.find((candidate) => candidate.code === bookCode.value) ?? null,
);
/** What the reference box would open, said while it is typed. */
const referencePreview = computed(() => {
  if (!referenceText.value.trim()) return null;
  const reading = readReference(books.value, referenceText.value);
  if (!reading.isFound) return null;
  const {
    book: found,
    chapter: number,
    startVerse,
    endVerse,
  } = reading.reference;
  const verses =
    startVerse === undefined
      ? ''
      : `:${startVerse}${endVerse === undefined ? '' : `–${endVerse}`}`;
  return `${found.name} ${number}${verses}`;
});
const selection = computed(() => {
  if (start.value === null) return [];
  const last = end.value ?? start.value;
  const [low, high] = [
    Math.min(start.value, last),
    Math.max(start.value, last),
  ];
  return verses.value.filter(
    (verse) => verse.verse >= low && verse.verse <= high,
  );
});
const passageEntry = computed(() => {
  const first = selection.value[0];
  const last = selection.value.at(-1);
  if (!translationId.value || !bookCode.value || !first || !last) return null;
  return {
    kind: 'passage' as const,
    bibleTranslationId: translationId.value,
    bookCode: bookCode.value as NonNullable<PlaylistItemInput['bookCode']>,
    startChapter: first.chapter,
    startVerse: first.verse,
    endChapter: last.chapter,
    endVerse: last.verse,
  };
});
const selectionLabel = computed(() =>
  book.value && selection.value.length > 0
    ? formatReference(book.value.name, selection.value)
    : null,
);

async function loadTranslations(): Promise<void> {
  translations.value = await window.pakita.bible.listTranslations();
  const isStillHere = translations.value.some(
    (translation) => translation.id === translationId.value,
  );
  if (!isStillHere) {
    translationId.value = translations.value[0]?.id ?? null;
  }
}

async function loadBooks(): Promise<void> {
  books.value = translationId.value
    ? await window.pakita.bible.listBooks(translationId.value)
    : [];
  const current = books.value.find(
    (candidate) => candidate.code === bookCode.value,
  );
  if (!current) {
    bookCode.value = books.value[0]?.code ?? null;
    chapter.value = 1;
  } else if (chapter.value > current.chapterCount) {
    // The same book can have fewer chapters in another translation.
    chapter.value = 1;
  }
}

async function loadChapter(): Promise<void> {
  verses.value =
    translationId.value && bookCode.value
      ? await window.pakita.bible.getChapter(
          translationId.value,
          bookCode.value,
          chapter.value,
        )
      : [];
}

function chooseVerse(verse: number, isExtending: boolean): void {
  if (isExtending && start.value !== null) {
    end.value = verse;
  } else {
    start.value = verse;
    end.value = null;
  }
}

/** Commits a typed chapter number; anything outside the book puts back the current one. */
function setChapter(event: Event): void {
  const input = event.target as HTMLInputElement;
  const typed = Number(input.value);
  const last = book.value?.chapterCount ?? 0;
  if (Number.isInteger(typed) && typed >= 1 && typed <= last) {
    chapter.value = typed;
  } else {
    input.value = String(chapter.value);
  }
}

/** Opens the typed reference and selects its verses. */
async function goToReference(): Promise<void> {
  const reading = readReference(books.value, referenceText.value);
  if (!reading.isFound) {
    referenceProblem.value = reading.problem;
    return;
  }
  const {
    book: found,
    chapter: number,
    startVerse,
    endVerse,
  } = reading.reference;
  referenceProblem.value = null;
  // A new reference replaces the selection, even in the chapter already open.
  start.value = null;
  end.value = null;
  bookCode.value = found.code;
  chapter.value = number;
  await loadChapter();
  if (startVerse === undefined) {
    referenceText.value = '';
    return;
  }
  const last = verses.value.at(-1)?.verse ?? 0;
  if (startVerse > last || (endVerse ?? startVerse) > last) {
    referenceProblem.value = `${found.name} ${number} has ${last} verses.`;
    return;
  }
  chooseVerse(startVerse, false);
  if (endVerse !== undefined) chooseVerse(endVerse, true);
  referenceText.value = '';
  await nextTick();
  document
    .querySelector(`[data-testid="bible-verse-${startVerse}"]`)
    ?.scrollIntoView({ block: 'center' });
}

async function openResult(result: BibleSearchHit): Promise<void> {
  bookCode.value = result.bookCode;
  chapter.value = result.chapter;
  await loadChapter();
  chooseVerse(result.verse, false);
}

/** Double-click: that verse alone, live at once. */
async function goLiveWith(verse: number): Promise<void> {
  chooseVerse(verse, false);
  await goLive();
}

async function goLive(): Promise<void> {
  const first = selection.value[0];
  const last = selection.value.at(-1);
  if (!translationId.value || !bookCode.value || !first || !last) return;
  errorMessage.value = null;
  try {
    await window.pakita.live.startPassage({
      translationId: translationId.value,
      bookCode: bookCode.value,
      start: { chapter: first.chapter, verse: first.verse },
      end: { chapter: last.chapter, verse: last.verse },
    });
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

watch(translationId, async () => {
  await loadBooks();
  await loadChapter();
  results.value = [];
  search.value = '';
});
watch([bookCode, chapter], async () => {
  start.value = null;
  end.value = null;
  await loadChapter();
});
watch(search, async (term) => {
  const found =
    translationId.value && term.trim().length > 1
      ? await window.pakita.bible.search(translationId.value, term)
      : [];
  // A slower, older search never replaces a newer one's results.
  if (term === search.value) results.value = found;
});
watch(bookCode, () => {
  if (chapter.value > (book.value?.chapterCount ?? 1)) chapter.value = 1;
});

let unsubscribe: (() => void) | null = null;
onMounted(async () => {
  unsubscribe = window.pakita.sync.onStatus((status: SyncStatus) => {
    if (status.state === 'idle') void loadTranslations();
  });
  await loadTranslations();
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Bible</h1>
      </div>
      <select
        v-model="translationId"
        aria-label="Translation"
        data-testid="bible-translation"
        :disabled="translations.length === 0"
      >
        <option
          v-for="translation in translations"
          :key="translation.id"
          :value="translation.id"
        >
          {{ translation.code }} — {{ translation.name }}
        </option>
      </select>
      <form class="go-to" @submit.prevent="goToReference">
        <div class="search-field">
          <AppIcon name="bible" />
          <input
            v-model="referenceText"
            placeholder="Go to, e.g. jn 3:16-18"
            aria-label="Go to a reference"
            spellcheck="false"
            autocomplete="off"
            data-testid="bible-reference"
            :disabled="books.length === 0"
            @input="referenceProblem = null"
          />
        </div>
        <p
          v-if="referenceProblem"
          class="reference-note problem"
          role="alert"
          data-testid="bible-reference-problem"
        >
          {{ referenceProblem }}
        </p>
        <p
          v-else-if="referencePreview"
          class="reference-note"
          data-testid="bible-reference-preview"
        >
          Enter opens {{ referencePreview }}
        </p>
      </form>
      <div class="reference">
        <BookPicker
          v-model="bookCode"
          :books="books"
          :is-disabled="books.length === 0"
        />
        <input
          :value="chapter"
          type="number"
          inputmode="numeric"
          min="1"
          :max="book?.chapterCount"
          aria-label="Chapter"
          :title="book ? `${book.name} has ${book.chapterCount} chapters` : ''"
          data-testid="bible-chapter"
          :disabled="books.length === 0"
          @change="setChapter"
          @keydown.enter.prevent="setChapter"
        />
      </div>
      <div class="search-field">
        <AppIcon name="search" />
        <input
          v-model="search"
          type="search"
          placeholder="Search this translation"
          aria-label="Search this translation"
          data-testid="bible-search"
          :disabled="translations.length === 0"
        />
      </div>
      <ul class="list">
        <li
          v-for="result in results"
          :key="`${result.bookCode}-${result.chapter}-${result.verse}`"
        >
          <button
            class="list-item"
            :data-testid="`bible-result-${result.bookCode}-${result.chapter}-${result.verse}`"
            @click="openResult(result)"
          >
            <span class="item-title"
              >{{ result.bookName }} {{ result.chapter }}:{{
                result.verse
              }}</span
            >
            <span class="item-sub">{{ result.text }}</span>
          </button>
        </li>
      </ul>
    </aside>

    <main class="panel-content">
      <template v-if="translations.length > 0">
        <div class="page-head passage-head">
          <div class="titles">
            <h2>
              {{ selectionLabel ?? `${book?.name ?? ''} ${chapter}` }}
            </h2>
            <p>
              Click a verse; shift-click to select a range; double-click to put
              a verse live.
            </p>
          </div>
          <AddToPlaylist :entry="passageEntry" />
          <button
            class="go-live"
            data-testid="bible-go-live"
            :disabled="selection.length === 0"
            @click="goLive"
          >
            <AppIcon name="play" />
            Go live
          </button>
        </div>
        <p v-if="errorMessage" class="error" role="alert">
          <AppIcon name="alert" />
          <span>{{ errorMessage }}</span>
        </p>
        <ol class="verses">
          <li v-for="verse in verses" :key="verse.verse">
            <button
              class="verse"
              :aria-pressed="selection.includes(verse)"
              :data-testid="`bible-verse-${verse.verse}`"
              @click="chooseVerse(verse.verse, $event.shiftKey)"
              @dblclick="goLiveWith(verse.verse)"
            >
              <sup>{{ verse.verse }}</sup>
              <span>{{ verse.text }}</span>
            </button>
          </li>
        </ol>
      </template>
      <div v-else class="empty">
        <span class="empty-mark"><AppIcon name="bible" /></span>
        <p data-testid="bible-empty">
          There is no Bible on this laptop yet. Once a translation is imported
          on the church server, it arrives with the next synchronisation.
        </p>
      </div>
      <p
        v-if="errorMessage && translations.length === 0"
        class="error"
        role="alert"
      >
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.reference {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.75rem;
  gap: 0.5rem;
}

/* Stays in reach while the verses scroll beneath it: the passage's name,
   "Add to playlist" and "Go live". */
.passage-head {
  position: sticky;
  top: -1.6rem;
  z-index: 1;
  margin: -1.6rem -2rem 1rem;
  padding: 1.6rem 2rem 0.9rem;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
}

.go-to {
  display: grid;
  gap: 0.3rem;
}

.reference-note {
  margin: 0;
  padding: 0 0.2rem;
  font-size: 0.78rem;
  color: var(--text-muted);
}

.reference-note.problem {
  color: var(--danger);
}

.list .item-sub {
  white-space: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.error {
  margin-bottom: 1rem;
}

.verses {
  display: grid;
  gap: 1px;
  max-width: 46rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.verse {
  display: block;
  width: 100%;
  min-height: 0;
  padding: 0.45rem 0.75rem;
  border: 1px solid transparent;
  border-radius: var(--radius);
  background: transparent;
  color: var(--text);
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.7;
  text-align: left;
  white-space: normal;
}

.verse:hover:not(:disabled) {
  background: var(--surface);
  border-color: transparent;
}

.verse:active:not(:disabled) {
  transform: none;
}

.verse[aria-pressed='true'] {
  background: var(--accent-soft);
  border-color: rgb(139 108 255 / 0.3);
}

.verse sup {
  margin-right: 0.35rem;
  font-size: 0.68rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--accent);
  vertical-align: 0.45em;
  line-height: 0;
}

.verse[aria-pressed='true'] sup {
  color: #c9bcff;
}
</style>
