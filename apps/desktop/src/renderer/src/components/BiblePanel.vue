<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';

import type {
  BibleBook,
  BibleSearchHit,
  BibleTranslation,
  BibleVerse,
  PlaylistItemInput,
  SyncStatus,
} from '../../../shared/ipc-contract';
import { formatReference } from '../../../shared/slides';
import { messageOf } from '../errors';
import AddToPlaylist from './AddToPlaylist.vue';
import AppIcon from './AppIcon.vue';
import BibleImport from './BibleImport.vue';

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
const isImportShown = ref(false);
// Only the platform administrator may import; nobody else is offered it.
const canImport = ref(false);
const errorMessage = ref<string | null>(null);

const book = computed(
  () =>
    books.value.find((candidate) => candidate.code === bookCode.value) ?? null,
);
const chapters = computed(() =>
  Array.from(
    { length: book.value?.chapterCount ?? 0 },
    (_, index) => index + 1,
  ),
);
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

async function openResult(result: BibleSearchHit): Promise<void> {
  bookCode.value = result.bookCode;
  chapter.value = result.chapter;
  await loadChapter();
  chooseVerse(result.verse, false);
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

const importedNotice = ref<string | null>(null);
const existingCodes = computed(() =>
  translations.value.map((translation) => translation.code),
);

// Each opening starts a fresh form, even over one already open.
const importFormKey = ref(0);
const isImportRunning = ref(false);

function openImport(): void {
  importedNotice.value = null;
  importFormKey.value += 1;
  isImportShown.value = true;
}

async function onImported(imported: {
  code: string;
  name: string;
}): Promise<void> {
  isImportShown.value = false;
  isImportRunning.value = false;
  await loadTranslations();
  const added = translations.value.find(
    (translation) => translation.code === imported.code,
  );
  if (added) translationId.value = added.id;
  importedNotice.value = added
    ? `${added.name} is imported and published: ${added.verseCount.toLocaleString()} verses. Everyone in this church receives it when their laptop next synchronises.`
    : `${imported.name} is imported and published. It appears here once this laptop has synchronised.`;
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
  canImport.value = await window.pakita.bible.canImport();
});
onUnmounted(() => unsubscribe?.());
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>Bible</h1>
      </div>
      <p
        v-if="importedNotice"
        class="imported"
        role="status"
        data-testid="bible-imported"
      >
        <AppIcon name="check" class="imported-icon" />
        <span class="grow">{{ importedNotice }}</span>
        <button
          class="ghost sm"
          aria-label="Dismiss"
          @click="importedNotice = null"
        >
          <AppIcon name="x" />
        </button>
      </p>
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
      <div class="reference">
        <select
          v-model="bookCode"
          aria-label="Book"
          data-testid="bible-book"
          :disabled="books.length === 0"
        >
          <option v-for="item in books" :key="item.code" :value="item.code">
            {{ item.name }}
          </option>
        </select>
        <select
          v-model="chapter"
          aria-label="Chapter"
          data-testid="bible-chapter"
          :disabled="chapters.length === 0"
        >
          <option v-for="number in chapters" :key="number" :value="number">
            {{ number }}
          </option>
        </select>
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
      <button
        v-if="canImport"
        class="import-open"
        data-testid="bible-import-open"
        :disabled="isImportRunning"
        @click="openImport"
      >
        <AppIcon name="upload" />
        Import a translation…
      </button>
    </aside>

    <main class="panel-content">
      <BibleImport
        v-if="isImportShown && canImport"
        :key="importFormKey"
        :existing-codes="existingCodes"
        @importing="isImportRunning = $event"
        @imported="onImported"
        @close="isImportShown = false"
      />
      <template v-else-if="translations.length > 0">
        <div class="page-head">
          <div class="titles">
            <h2>
              {{ selectionLabel ?? `${book?.name ?? ''} ${chapter}` }}
            </h2>
            <p>Click a verse; shift-click to select a range.</p>
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
.imported {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  margin: 0;
  padding: 0.6rem 0.4rem 0.6rem 0.75rem;
  border: 1px solid color-mix(in srgb, var(--success) 30%, transparent);
  border-radius: var(--radius);
  background: var(--success-soft);
  font-size: 0.82rem;
  line-height: 1.45;
}

.imported-icon {
  margin-top: 0.15rem;
  color: var(--success);
}

.import-open {
  border-style: dashed;
  background: transparent;
  color: var(--text-muted);
}

.import-open:hover:not(:disabled) {
  border-style: dashed;
  color: var(--text);
}

.reference {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 4.75rem;
  gap: 0.5rem;
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
