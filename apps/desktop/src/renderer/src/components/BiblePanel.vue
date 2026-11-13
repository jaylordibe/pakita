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

async function onImported(): Promise<void> {
  isImportShown.value = false;
  await loadTranslations();
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
  <div class="bible">
    <aside class="picker">
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
      <div class="row">
        <select
          v-model="bookCode"
          aria-label="Book"
          class="grow"
          data-testid="bible-book"
        >
          <option v-for="item in books" :key="item.code" :value="item.code">
            {{ item.name }}
          </option>
        </select>
        <select
          v-model="chapter"
          aria-label="Chapter"
          data-testid="bible-chapter"
        >
          <option v-for="number in chapters" :key="number" :value="number">
            {{ number }}
          </option>
        </select>
      </div>
      <input
        v-model="search"
        type="search"
        placeholder="Search this translation"
        data-testid="bible-search"
        :disabled="translations.length === 0"
      />
      <ul class="results">
        <li
          v-for="result in results"
          :key="`${result.bookCode}-${result.chapter}-${result.verse}`"
          :data-testid="`bible-result-${result.bookCode}-${result.chapter}-${result.verse}`"
          @click="openResult(result)"
        >
          <strong
            >{{ result.bookName }} {{ result.chapter }}:{{
              result.verse
            }}</strong
          >
          <span class="muted">{{ result.text }}</span>
        </li>
      </ul>
      <button data-testid="bible-import-open" @click="isImportShown = true">
        Import a translation…
      </button>
    </aside>

    <main class="content">
      <BibleImport
        v-if="isImportShown"
        @imported="onImported"
        @close="isImportShown = false"
      />
      <template v-else-if="translations.length > 0">
        <div class="row">
          <h2 class="grow">
            {{ selectionLabel ?? `${book?.name ?? ''} ${chapter}` }}
          </h2>
          <span class="muted"
            >Click a verse; shift-click to select a range.</span
          >
          <AddToPlaylist :entry="passageEntry" />
          <button
            class="live"
            data-testid="bible-go-live"
            :disabled="selection.length === 0"
            @click="goLive"
          >
            Go live
          </button>
        </div>
        <ol class="verses">
          <li
            v-for="verse in verses"
            :key="verse.verse"
            :class="{ selected: selection.includes(verse) }"
            :data-testid="`bible-verse-${verse.verse}`"
            @click="chooseVerse(verse.verse, $event.shiftKey)"
          >
            <sup>{{ verse.verse }}</sup> {{ verse.text }}
          </li>
        </ol>
      </template>
      <p v-else class="muted" data-testid="bible-empty">
        There is no Bible on this laptop yet. Once a translation is imported on
        the church server, it arrives with the next synchronisation.
      </p>
      <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
    </main>
  </div>
</template>

<style scoped>
.bible {
  display: grid;
  grid-template-columns: 18rem 1fr;
  height: 100%;
  min-height: 0;
}

.picker {
  display: grid;
  grid-template-rows: auto auto auto 1fr auto;
  gap: 0.5rem;
  padding: 0.75rem;
  border-right: 1px solid var(--border);
  overflow: hidden;
}

.grow {
  flex: 1;
}

.results,
.verses {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow: auto;
}

.results li {
  display: grid;
  gap: 0.15rem;
  padding: 0.45rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
}

.results li span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  padding: 1rem 1.5rem;
  overflow: auto;
}

.verses li {
  padding: 0.35rem 0.5rem;
  border-radius: 6px;
  cursor: pointer;
  line-height: 1.5;
}

.verses li.selected,
.results li:hover {
  background: #e3ebf3;
}
</style>
