<script setup lang="ts">
import { computed, onMounted, ref, useTemplateRef } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import {
  DEFAULT_LINES_PER_SLIDE,
  importLyrics,
  LINES_PER_SLIDE_CHOICES,
  longLinesOf,
  MAX_PASTE_LENGTH,
  type LinesPerSlide,
  type LyricsImport,
} from '../../../shared/lyrics-import';
import { splitIntoSlides } from '../../../shared/slides';
import { lyricsWithStanzaBreaks } from '../clipboard-lyrics';
import { messageOf } from '../errors';
import { vFitSlideText } from '../fit-slide-text';
import AppIcon from './AppIcon.vue';

// The first step of a new song: paste the lyrics, see the sections and slides
// Pakita reads from them, then continue to the song editor to name and save
// it. Nothing is saved here, and the pasted text is never changed: the
// preview is read from it again whenever it or the slide size changes.

const emit = defineEmits<{
  continue: [draft: LyricsImport];
  blank: [];
  cancel: [];
}>();

const MAX_SECTION_LENGTH =
  apiConstraints.SongSectionInputDto.lyrics.maxLength ?? Infinity;

const text = ref('');
const linesPerSlide = ref<LinesPerSlide>(DEFAULT_LINES_PER_SLIDE);
const keepsMetadata = ref(false);
const errorMessage = ref<string | null>(null);
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea');

const result = computed(() =>
  importLyrics(text.value, {
    linesPerSlide: linesPerSlide.value,
    keepsMetadata: keepsMetadata.value,
  }),
);

/** The song in sung order; a section sung again is shown once, then named. */
const entries = computed(() => {
  const seen = new Set<string>();
  return result.value.sequence.flatMap((key, position) => {
    const section = result.value.sections.find(
      (candidate) => candidate.key === key,
    );
    if (!section) return [];
    const isRepeat = seen.has(key);
    seen.add(key);
    return [
      {
        position,
        section,
        isRepeat,
        slides: splitIntoSlides(section.lyrics),
        longLines: longLinesOf(section.lyrics),
        isTooLong: section.lyrics.length > MAX_SECTION_LENGTH,
      },
    ];
  });
});
const slideTotal = computed(() =>
  entries.value.reduce((total, entry) => total + entry.slides.length, 0),
);
const metadata = computed(() =>
  result.value.notices.filter((notice) => notice.reason === 'metadata'),
);
const emptyHeadings = computed(() =>
  result.value.notices.filter((notice) => notice.reason === 'no-lyrics'),
);
// Only lines set aside right now are listed, so the box stays while kept.
const hasMetadata = computed(
  () =>
    keepsMetadata.value ||
    importLyrics(text.value, {
      linesPerSlide: linesPerSlide.value,
    }).notices.some((notice) => notice.reason === 'metadata'),
);
const canContinue = computed(
  () =>
    result.value.sections.length > 0 &&
    entries.value.every((entry) => !entry.isTooLong),
);

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

async function pasteFromClipboard(): Promise<void> {
  errorMessage.value = null;
  try {
    const copy = await window.pakita.app.readClipboard();
    if (!copy.text.trim()) {
      errorMessage.value = 'The clipboard has no text. Copy the lyrics first.';
      return;
    }
    text.value = lyricsWithStanzaBreaks(copy.text, copy.html) ?? copy.text;
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

/**
 * A keyboard paste from a web page that lost its stanza breaks in the text
 * copy gets them back from the HTML copy; any other paste is left to the
 * browser.
 */
function pasteWithStanzaBreaks(event: ClipboardEvent): void {
  const box = event.currentTarget;
  if (!event.clipboardData || !(box instanceof HTMLTextAreaElement)) return;
  const lyrics = lyricsWithStanzaBreaks(
    event.clipboardData.getData('text/plain'),
    event.clipboardData.getData('text/html'),
  );
  const replaced = box.selectionEnd - box.selectionStart;
  if (
    lyrics === null ||
    box.value.length - replaced + lyrics.length > MAX_PASTE_LENGTH
  ) {
    return;
  }
  event.preventDefault();
  box.setRangeText(lyrics, box.selectionStart, box.selectionEnd, 'end');
  text.value = box.value;
}

function proceed(): void {
  if (canContinue.value) emit('continue', result.value);
}

onMounted(() => textarea.value?.focus());
</script>

<template>
  <form class="paste" @submit.prevent="proceed">
    <div class="page-head">
      <div class="titles">
        <h2>New song</h2>
        <p>Paste the lyrics. Pakita finds the sections and cuts the slides.</p>
      </div>
      <button
        type="button"
        class="ghost"
        data-testid="song-start-blank"
        @click="emit('blank')"
      >
        Start blank
      </button>
    </div>

    <div class="columns">
      <section class="sheet source">
        <div class="source-head">
          <label for="lyrics-paste-text">Lyrics</label>
          <button
            type="button"
            class="sm"
            data-testid="lyrics-paste-clipboard"
            @click="pasteFromClipboard"
          >
            <AppIcon name="copy" />
            Paste from clipboard
          </button>
        </div>
        <textarea
          id="lyrics-paste-text"
          ref="textarea"
          v-model="text"
          data-testid="lyrics-paste-text"
          rows="18"
          :maxlength="MAX_PASTE_LENGTH"
          spellcheck="false"
          :placeholder="'[Verse 1]\nAmazing grace, how sweet the sound\n…\n\n[Chorus]\n…'"
          @paste="pasteWithStanzaBreaks"
        ></textarea>
        <p class="field-help">
          Headings such as <span class="kbd">[Verse 1]</span>,
          <span class="kbd">Chorus:</span> or
          <span class="kbd">BRIDGE</span> start a section. Without headings,
          each verse separated by a blank line becomes a section, and one sung
          again becomes the chorus.
        </p>

        <fieldset class="sizes">
          <legend>Lines per slide</legend>
          <div class="segmented">
            <label
              v-for="size in LINES_PER_SLIDE_CHOICES"
              :key="size"
              :class="{ chosen: linesPerSlide === size }"
            >
              <input
                v-model="linesPerSlide"
                type="radio"
                name="lines-per-slide"
                :value="size"
                :data-testid="`lines-per-slide-${size}`"
              />
              {{ size }}
            </label>
          </div>
          <p class="field-help">
            Only for this paste. In the editor, a blank line starts a new slide,
            so you can move any break yourself.
          </p>
        </fieldset>

        <p v-if="errorMessage" class="error" role="alert">
          <AppIcon name="alert" />
          {{ errorMessage }}
        </p>
      </section>

      <section class="preview" aria-labelledby="paste-preview-title">
        <div class="preview-head">
          <h3 id="paste-preview-title">Preview</h3>
          <span
            v-if="entries.length"
            class="muted"
            data-testid="lyrics-paste-summary"
          >
            {{ plural(result.sections.length, 'section', 'sections') }} ·
            {{ plural(slideTotal, 'slide', 'slides') }} live
          </span>
        </div>

        <p v-if="!entries.length" class="preview-empty">
          Paste lyrics to see the sections and slides here.
        </p>

        <div
          v-if="hasMetadata || emptyHeadings.length"
          class="notices"
          data-testid="lyrics-paste-notices"
        >
          <p class="notices-title">
            <AppIcon name="info" />
            Not imported as lyrics
          </p>
          <ul v-if="metadata.length">
            <li v-for="notice in metadata" :key="notice.text">
              {{ notice.text }}
            </li>
          </ul>
          <label v-if="hasMetadata" class="inline">
            <input
              v-model="keepsMetadata"
              type="checkbox"
              data-testid="lyrics-paste-keep-metadata"
            />
            Keep these lines as lyrics
          </label>
          <ul v-if="emptyHeadings.length">
            <li v-for="notice in emptyHeadings" :key="notice.text">
              {{ notice.text }} has no lyrics, so it is left out.
            </li>
          </ul>
        </div>

        <ol class="entries">
          <li
            v-for="entry in entries"
            :key="entry.position"
            class="entry"
            :data-testid="`lyrics-paste-entry-${entry.position}`"
          >
            <p class="entry-head">
              <span class="entry-name">{{ entry.section.label }}</span>
              <span v-if="entry.isRepeat" class="faint">sung again</span>
              <span v-else class="faint">{{
                plural(entry.slides.length, 'slide', 'slides')
              }}</span>
            </p>
            <template v-if="!entry.isRepeat">
              <ol class="slides">
                <li
                  v-for="(slide, index) in entry.slides"
                  :key="index"
                  class="slide"
                >
                  <span class="slide-label">
                    <span>{{ entry.section.label }}</span>
                    <span class="slide-number">{{ index + 1 }}</span>
                  </span>
                  <span v-fit-slide-text class="slide-text">{{ slide }}</span>
                </li>
              </ol>
              <p v-if="entry.isTooLong" class="error">
                <AppIcon name="alert" />
                This section is longer than
                {{ MAX_SECTION_LENGTH.toLocaleString('en') }} characters. Add a
                heading inside it to split it.
              </p>
              <div v-if="entry.longLines.length" class="long-lines">
                <AppIcon name="alert" />
                <div>
                  <p>May wrap on screen:</p>
                  <ul>
                    <li v-for="line in entry.longLines" :key="line">
                      {{ line }}
                    </li>
                  </ul>
                </div>
              </div>
            </template>
          </li>
        </ol>
      </section>
    </div>

    <div class="action-bar">
      <span class="grow"></span>
      <button type="button" @click="emit('cancel')">Cancel</button>
      <button
        type="submit"
        class="primary"
        :disabled="!canContinue"
        data-testid="lyrics-paste-continue"
      >
        Continue
        <AppIcon name="arrow-right" />
      </button>
    </div>
  </form>
</template>

<style scoped>
.paste {
  display: grid;
  gap: 1.25rem;
}

.paste .page-head {
  margin-bottom: 0;
}

.columns {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.25rem;
  align-items: start;
}

.source-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.source textarea {
  min-height: 22rem;
  resize: vertical;
  line-height: 1.5;
}

.sizes {
  display: grid;
  gap: 0.45rem;
  margin: 0;
  padding: 0;
  border: 0;
}

.sizes legend {
  margin-bottom: 0.45rem;
  padding: 0;
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-muted);
}

.segmented {
  display: inline-flex;
  justify-self: start;
  padding: 0.2rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--field);
}

.segmented label {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 2.6rem;
  min-height: calc(var(--control-height) - 0.4rem);
  border-radius: var(--radius-sm);
  font-size: 0.85rem;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  cursor: pointer;
  transition:
    background-color 160ms var(--ease-out),
    color 160ms var(--ease-out);
}

.segmented label:hover {
  color: var(--text);
}

.segmented label.chosen {
  background: var(--accent-soft);
  color: var(--text);
}

.segmented input {
  position: absolute;
  inset: 0;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}

.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--focus);
  outline-offset: 1px;
}

.preview {
  display: grid;
  gap: 0.85rem;
  min-width: 0;
}

.preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
}

.preview-head span {
  font-size: 0.8rem;
  font-variant-numeric: tabular-nums;
}

.preview-empty {
  margin: 0;
  padding: 2.5rem 1rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 0.85rem;
  color: var(--text-faint);
  text-align: center;
}

.notices {
  display: grid;
  gap: 0.5rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
  font-size: 0.82rem;
}

.notices-title {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin: 0;
  font-weight: 600;
  color: var(--text-muted);
}

.notices ul,
.long-lines ul {
  display: grid;
  gap: 0.2rem;
  margin: 0;
  padding-left: 1.1rem;
  color: var(--text-muted);
}

.entries {
  display: grid;
  gap: 1rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.entry {
  display: grid;
  gap: 0.5rem;
}

.entry-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  margin: 0;
  font-size: 0.8rem;
}

.entry-name {
  font-weight: 600;
  color: var(--text);
}

.slides {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.5rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.long-lines {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  font-size: 0.78rem;
  color: var(--warning);
}

.long-lines p {
  margin: 0 0 0.2rem;
}

.long-lines ul {
  color: var(--text-muted);
}

@media (max-width: 62rem) {
  .columns {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
