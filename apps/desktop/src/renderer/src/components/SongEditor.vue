<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  useTemplateRef,
  watch,
} from 'vue';

import type { Song, SongInput } from '../../../shared/ipc-contract';
import { splitIntoSlides } from '../../../shared/slides';
import {
  automaticLabel,
  followSectionOrder,
  type SectionKind,
} from '../../../shared/song-sections';
import { focusFirstEnabled, moveItem, useDragReorder } from '../drag-reorder';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

interface EditableSection {
  key: string;
  kind: SectionKind;
  label: string;
  lyrics: string;
}
interface EditableArrangement {
  name: string;
  sectionKeys: string[];
}

const SECTION_KINDS: SectionKind[] = [
  'verse',
  'chorus',
  'bridge',
  'intro',
  'outro',
  'custom',
];

const props = defineProps<{ song: Song | null }>();
const emit = defineEmits<{ saved: [song: Song]; cancel: [] }>();

let newKeyCount = 0;
const nextKey = () => `new-${(newKeyCount += 1)}`;

// Existing sections keep their server ids as keys, so arrangements that refer
// to them survive the edit.
const title = ref(props.song?.title ?? '');
const artist = ref(props.song?.artist ?? '');
const sections = reactive<EditableSection[]>(
  props.song?.sections.map((section) => ({
    key: section.id,
    kind: section.kind,
    label: section.label,
    lyrics: section.lyrics,
  })) ?? [
    {
      key: nextKey(),
      kind: 'verse',
      label: automaticLabel('verse', []),
      lyrics: '',
    },
  ],
);
const arrangements = reactive<EditableArrangement[]>(
  props.song?.arrangements.map((arrangement) => ({
    name: arrangement.name,
    sectionKeys: [...arrangement.sectionIds],
  })) ?? [{ name: 'Default', sectionKeys: [sections[0]!.key] }],
);
const defaultIndex = ref(
  Math.max(
    0,
    props.song?.arrangements.findIndex(
      (arrangement) => arrangement.isDefault,
    ) ?? 0,
  ),
);
const errorMessage = ref<string | null>(null);
const isSaving = ref(false);

// The strip of section cards picks the one section being edited; "All
// lyrics" shows every section at once, for reading a song through.
const selectedKey = ref(sections[0]!.key);
const showsAllLyrics = ref(false);

const slidesOf = (section: EditableSection) => splitIntoSlides(section.lyrics);
const isIncomplete = (section: EditableSection) =>
  !section.label.trim() || !section.lyrics.trim();
const slideCount = (section: EditableSection) => {
  const count = slidesOf(section).length;
  return count === 1 ? '1 slide' : `${count} slides`;
};

/** Edits this section: in "All lyrics", brings it into view instead. */
async function selectSection(key: string): Promise<void> {
  selectedKey.value = key;
  if (!showsAllLyrics.value) return;
  await nextTick();
  document
    .querySelector(`[data-section-sheet="${key}"]`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// Which ends of the strip have cards scrolled out of view, so those edges
// fade and the strip reads as scrollable.
const strip = useTemplateRef<HTMLOListElement>('strip');
const stripEdges = reactive({ before: false, after: false });
function measureStrip(): void {
  const element = strip.value;
  if (!element) return;
  stripEdges.before = element.scrollLeft > 1;
  stripEdges.after =
    element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
}
const stripResize = new ResizeObserver(measureStrip);
onMounted(() => {
  if (strip.value) stripResize.observe(strip.value);
});
onBeforeUnmount(() => stripResize.disconnect());
watch(
  () => sections.length,
  () => nextTick(measureStrip),
);

// Keep the selected card in view as sections are added and moved.
watch(
  () => [selectedKey.value, sections.length] as const,
  async () => {
    await nextTick();
    document
      .querySelector(`[data-section-card="${selectedKey.value}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
);

const labelOf = (key: string) =>
  sections.find((section) => section.key === key)?.label ?? '?';

const canSave = computed(
  () =>
    title.value.trim().length > 0 &&
    sections.length > 0 &&
    sections.every(
      (section) => section.label.trim() && section.lyrics.trim(),
    ) &&
    arrangements.every(
      (arrangement) =>
        arrangement.name.trim() && arrangement.sectionKeys.length > 0,
    ),
);

function addSection(): void {
  const section: EditableSection = {
    key: nextKey(),
    kind: 'verse',
    label: automaticLabel('verse', sections),
    lyrics: '',
  };
  sections.push(section);
  arrangements[defaultIndex.value]?.sectionKeys.push(section.key);
  void selectSection(section.key).then(async () => {
    await nextTick();
    document
      .querySelector<HTMLTextAreaElement>(
        `[data-section-sheet="${section.key}"] textarea`,
      )
      ?.focus();
  });
}

function removeSection(index: number): void {
  if (sections.length === 1) return;
  const [removed] = sections.splice(index, 1);
  if (!removed) return;
  if (selectedKey.value === removed.key) {
    selectedKey.value = (sections[index] ?? sections[index - 1])!.key;
  }
  for (const arrangement of arrangements) {
    arrangement.sectionKeys = arrangement.sectionKeys.filter(
      (key) => key !== removed.key,
    );
  }
}

// Read out after every section or chip move, by drag or by button.
const moveAnnouncement = ref('');

/**
 * Moves a section to a new place. Arrangements that play the sections in
 * their listed order move with it, so the song is still sung in the order
 * shown.
 */
function moveSection(_list: EditableSection[], from: number, to: number): void {
  if (from === to) return;
  const before = sections.map((section) => section.key);
  const after = moveItem(before, from, to);
  sections.splice(0, sections.length, ...moveItem(sections, from, to));
  for (const arrangement of arrangements) {
    arrangement.sectionKeys = followSectionOrder(
      arrangement.sectionKeys,
      before,
      after,
    );
  }
  moveAnnouncement.value = `Moved ${labelOf(after[to] ?? '')} to position ${to + 1} of ${sections.length}.`;
}

async function moveSectionByButton(
  position: number,
  offset: -1 | 1,
): Promise<void> {
  const to = position + offset;
  if (to < 0 || to >= sections.length) return;
  moveSection(sections, position, to);
  // Keep focus on the card that moved, so the next press moves it again.
  const at = (step: string) => `[data-section-move="${to}-${step}"]`;
  const direction = offset < 0 ? 'earlier' : 'later';
  const opposite = offset < 0 ? 'later' : 'earlier';
  await focusFirstEnabled(at(direction), at(opposite));
}

const sectionReorder = useDragReorder<EditableSection[]>({
  axis: 'horizontal',
  onMove: moveSection,
});

function moveChip(
  arrangement: EditableArrangement,
  from: number,
  to: number,
): void {
  if (from === to) return;
  arrangement.sectionKeys = moveItem(arrangement.sectionKeys, from, to);
  const label = labelOf(arrangement.sectionKeys[to] ?? '');
  moveAnnouncement.value = `Moved ${label} to position ${to + 1} of ${arrangement.sectionKeys.length} in ${arrangement.name}.`;
}

async function moveChipByButton(
  arrangementIndex: number,
  position: number,
  offset: -1 | 1,
): Promise<void> {
  const arrangement = arrangements[arrangementIndex];
  if (!arrangement) return;
  const to = position + offset;
  if (to < 0 || to >= arrangement.sectionKeys.length) return;
  moveChip(arrangement, position, to);
  // Keep focus on the chip that moved, so the next press moves it again.
  const at = (step: string) =>
    `[data-move="${arrangementIndex}-${to}-${step}"]`;
  const direction = offset < 0 ? 'earlier' : 'later';
  const opposite = offset < 0 ? 'later' : 'earlier';
  await focusFirstEnabled(at(direction), at(opposite));
}

const reorder = useDragReorder<EditableArrangement>({
  axis: 'horizontal',
  onMove: moveChip,
});

function addArrangement(): void {
  arrangements.push({
    name: `Arrangement ${arrangements.length + 1}`,
    sectionKeys: sections.map((section) => section.key),
  });
}

function removeArrangement(index: number): void {
  if (arrangements.length === 1) return;
  arrangements.splice(index, 1);
  if (defaultIndex.value >= arrangements.length) defaultIndex.value = 0;
}

async function save(): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  const input: SongInput = {
    title: title.value.trim(),
    artist: artist.value.trim() || null,
    sections: sections.map((section) => ({
      key: section.key,
      kind: section.kind,
      label: section.label.trim(),
      lyrics: section.lyrics,
    })),
    arrangements: arrangements.map((arrangement, index) => ({
      name: arrangement.name.trim(),
      isDefault: index === defaultIndex.value,
      sectionKeys: [...arrangement.sectionKeys],
    })),
  };
  try {
    const song = props.song
      ? await window.pakita.songs.update(props.song.id, input)
      : await window.pakita.songs.create(input);
    emit('saved', song);
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isSaving.value = false;
  }
}
</script>

<template>
  <form class="editor" @submit.prevent="save">
    <div class="page-head">
      <div class="titles">
        <h2>{{ song ? 'Edit song' : 'New song' }}</h2>
      </div>
    </div>

    <div class="field-grid">
      <label>
        Title
        <input v-model="title" data-testid="song-title" maxlength="200" />
      </label>
      <label>
        Artist
        <input v-model="artist" data-testid="song-artist" maxlength="200" />
      </label>
    </div>

    <section class="group">
      <div class="group-head">
        <h3>Sections</h3>
        <p class="muted">A blank line in the lyrics starts a new slide.</p>
        <span class="grow"></span>
        <button
          type="button"
          class="ghost sm"
          :aria-pressed="showsAllLyrics"
          data-testid="section-view-toggle"
          @click="showsAllLyrics = !showsAllLyrics"
        >
          <AppIcon name="eye" />
          All lyrics
        </button>
        <button type="button" class="sm" @click="addSection">
          <AppIcon name="plus" />
          Add section
        </button>
      </div>

      <ol
        ref="strip"
        class="strip"
        :class="{
          'more-before': stripEdges.before,
          'more-after': stripEdges.after,
        }"
        @scroll.passive="measureStrip"
        aria-label="Sections, in order"
        @dragleave="sectionReorder.leave"
      >
        <li
          v-for="(section, index) in sections"
          :key="section.key"
          class="strip-item"
          :class="{
            dragged: sectionReorder.isDragged(sections, index),
            [`drop-${sectionReorder.markerAt(sections, index)}`]:
              sectionReorder.markerAt(sections, index),
          }"
          draggable="true"
          @dragstart="sectionReorder.start(sections, index, $event)"
          @dragend="sectionReorder.end"
          @dragover="sectionReorder.over(sections, index, $event)"
          @drop="sectionReorder.drop(sections, $event)"
        >
          <button
            type="button"
            class="slide section-card"
            :class="{ incomplete: isIncomplete(section) }"
            :aria-current="section.key === selectedKey ? 'true' : undefined"
            :data-section-card="section.key"
            :data-testid="`section-card-${index}`"
            title="Edit this section · drag to reorder"
            @click="selectSection(section.key)"
          >
            <span class="slide-label">
              <span class="card-name">{{ section.label || 'Unnamed' }}</span>
              <span class="slide-number">{{ slideCount(section) }}</span>
            </span>
            <span class="slide-text">{{
              slidesOf(section)[0] ?? 'No lyrics yet'
            }}</span>
          </button>
          <span class="card-moves">
            <button
              type="button"
              class="chip-button"
              :aria-label="`Move ${section.label || 'section'} earlier`"
              title="Earlier"
              :data-section-move="`${index}-earlier`"
              :disabled="index === 0"
              @click="moveSectionByButton(index, -1)"
            >
              <AppIcon name="chevron-left" />
            </button>
            <button
              type="button"
              class="chip-button"
              :aria-label="`Move ${section.label || 'section'} later`"
              title="Later"
              :data-section-move="`${index}-later`"
              :disabled="index === sections.length - 1"
              @click="moveSectionByButton(index, 1)"
            >
              <AppIcon name="chevron-right" />
            </button>
          </span>
        </li>
      </ol>

      <fieldset
        v-for="(section, index) in sections"
        v-show="showsAllLyrics || section.key === selectedKey"
        :key="section.key"
        class="sheet section"
        :class="{ 'in-all': showsAllLyrics }"
        :data-section-sheet="section.key"
      >
        <div class="section-head">
          <select
            v-model="section.kind"
            class="kind"
            aria-label="Section kind"
            :data-testid="`section-kind-${index}`"
          >
            <option v-for="kind in SECTION_KINDS" :key="kind" :value="kind">
              {{ kind }}
            </option>
          </select>
          <input
            v-model="section.label"
            class="grow"
            :data-testid="`section-label-${index}`"
            aria-label="Section label"
            maxlength="60"
          />
          <button
            type="button"
            class="ghost danger icon-only"
            aria-label="Remove section"
            title="Remove"
            :disabled="sections.length === 1"
            @click="removeSection(index)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
        <div class="section-body">
          <textarea
            v-model="section.lyrics"
            :data-testid="`section-lyrics-${index}`"
            aria-label="Lyrics"
            rows="5"
            maxlength="10000"
          ></textarea>
          <div v-if="!showsAllLyrics" class="preview">
            <p class="preview-head">
              Preview <span>{{ slideCount(section) }}</span>
            </p>
            <ol v-if="slidesOf(section).length" class="preview-slides">
              <li
                v-for="(text, position) in slidesOf(section)"
                :key="position"
                class="slide"
              >
                <span class="slide-label">
                  <span>{{ section.label }}</span>
                  <span class="slide-number">{{ position + 1 }}</span>
                </span>
                <span class="slide-text">{{ text }}</span>
              </li>
            </ol>
            <p v-else class="preview-empty">
              Type the lyrics to see this section's slides.
            </p>
          </div>
        </div>
      </fieldset>
    </section>

    <section class="group">
      <div class="group-head">
        <h3>Arrangements</h3>
        <p class="muted">The order the sections are sung in.</p>
      </div>
      <fieldset
        v-for="(arrangement, index) in arrangements"
        :key="index"
        class="sheet section"
      >
        <div class="section-head">
          <input
            v-model="arrangement.name"
            class="grow"
            aria-label="Arrangement name"
            maxlength="60"
          />
          <label class="inline">
            <input v-model="defaultIndex" type="radio" :value="index" />
            Default
          </label>
          <button
            type="button"
            class="ghost danger icon-only"
            aria-label="Remove arrangement"
            title="Remove"
            :disabled="arrangements.length === 1"
            @click="removeArrangement(index)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
        <ol class="sequence" @dragleave="reorder.leave">
          <li
            v-for="(key, position) in arrangement.sectionKeys"
            :key="position"
            class="chip"
            :class="{
              dragged: reorder.isDragged(arrangement, position),
              [`drop-${reorder.markerAt(arrangement, position)}`]:
                reorder.markerAt(arrangement, position),
            }"
            draggable="true"
            title="Drag to reorder"
            :data-testid="`arrangement-${index}-chip-${position}`"
            @dragstart="reorder.start(arrangement, position, $event)"
            @dragend="reorder.end"
            @dragover="reorder.over(arrangement, position, $event)"
            @drop="reorder.drop(arrangement, $event)"
          >
            <AppIcon name="grip" class="chip-grip" />
            <span class="chip-label">{{ labelOf(key) }}</span>
            <button
              type="button"
              class="chip-button reorder"
              aria-label="Earlier"
              title="Earlier"
              :data-move="`${index}-${position}-earlier`"
              :disabled="position === 0"
              @click="moveChipByButton(index, position, -1)"
            >
              <AppIcon name="chevron-left" />
            </button>
            <button
              type="button"
              class="chip-button reorder"
              aria-label="Later"
              title="Later"
              :data-move="`${index}-${position}-later`"
              :disabled="position === arrangement.sectionKeys.length - 1"
              @click="moveChipByButton(index, position, 1)"
            >
              <AppIcon name="chevron-right" />
            </button>
            <button
              type="button"
              class="chip-button"
              aria-label="Remove from arrangement"
              @click="arrangement.sectionKeys.splice(position, 1)"
            >
              <AppIcon name="x" />
            </button>
          </li>
          <li class="add-chip">
            <select
              aria-label="Add a section to this arrangement"
              @change="
                (event) => {
                  const select = event.target as HTMLSelectElement;
                  if (select.value) arrangement.sectionKeys.push(select.value);
                  select.value = '';
                }
              "
            >
              <option value="">Add section…</option>
              <option
                v-for="section in sections"
                :key="section.key"
                :value="section.key"
              >
                {{ section.label }}
              </option>
            </select>
          </li>
        </ol>
      </fieldset>
      <button type="button" class="add" @click="addArrangement">
        <AppIcon name="plus" />
        Add arrangement
      </button>
      <p class="visually-hidden" aria-live="polite">{{ moveAnnouncement }}</p>
    </section>

    <div class="actions">
      <p v-if="errorMessage" class="error grow" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
      <span v-else class="grow"></span>
      <button type="button" @click="emit('cancel')">Cancel</button>
      <button
        class="primary"
        type="submit"
        data-testid="song-save"
        :disabled="!canSave || isSaving"
      >
        <AppIcon name="check" />
        {{ isSaving ? 'Saving…' : 'Save' }}
      </button>
    </div>
  </form>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 1.5rem;
}

.editor > :not(.actions) {
  max-width: 52rem;
}

.editor .page-head {
  margin-bottom: -0.4rem;
}

.group {
  display: grid;
  gap: 0.75rem;
}

.group-head {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.group-head p {
  font-size: 0.8rem;
}

.section {
  gap: 0.7rem;
  padding: 0.85rem;
}

.section-head {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.kind {
  width: 8rem;
  text-transform: capitalize;
}

textarea {
  width: 100%;
  min-height: 7.5rem;
}

/* ---------- The section strip ---------- */

/* "All lyrics" while it is on: a selection, so it takes the accent. */
.group-head button[aria-pressed='true'] {
  border-color: rgb(139 108 255 / 0.35);
  background: var(--accent-soft);
  color: var(--text);
}

.strip {
  display: flex;
  gap: 0.6rem;
  margin: 0 0 0.15rem;
  padding: 0.2rem 0.2rem 0.6rem;
  list-style: none;
  overflow-x: auto;
  scroll-padding-inline: 0.2rem;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.strip-item {
  position: relative;
  flex: none;
  width: 10.5rem;
}

.section-card {
  min-height: 0;
  padding: 1.75rem 0.75rem 0.7rem;
  cursor: pointer;
}

.section-card .slide-label {
  inset: 0.5rem 0.6rem auto;
  gap: 0.5rem;
}

.card-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-card .slide-number {
  flex: none;
}

.section-card .slide-text {
  font-size: 0.78rem;
  -webkit-line-clamp: 3;
}

.section-card[aria-current='true'] {
  border-color: var(--accent);
  box-shadow:
    inset 0 0 0 1px var(--accent),
    0 6px 18px -8px rgb(122 77 255 / 0.55);
}

.section-card[aria-current='true'] .slide-label {
  color: var(--text);
}

/* A section that would block saving says so on its card. */
.section-card.incomplete .slide-text {
  color: var(--warning);
  font-style: italic;
  font-weight: 400;
}

.strip-item.dragged {
  opacity: 0.45;
}

.strip-item.drop-before::before,
.strip-item.drop-after::after {
  content: '';
  position: absolute;
  top: 0.3rem;
  bottom: 0.3rem;
  width: 2px;
  border-radius: 999px;
  background: var(--accent);
  pointer-events: none;
}

.strip-item.drop-before::before {
  left: calc(-0.3rem - 1px);
}

.strip-item.drop-after::after {
  right: calc(-0.3rem - 1px);
}

/* The step buttons sit on the card's lower corners, shown on hover or focus;
   they are the keyboard path for reordering. */
.card-moves {
  position: absolute;
  inset: auto 0.3rem 0.3rem;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
  opacity: 0;
  transition: opacity 120ms var(--ease-out);
}

.strip-item:hover .card-moves,
.strip-item:focus-within .card-moves {
  opacity: 1;
}

.card-moves .chip-button {
  pointer-events: auto;
  background: rgb(23 22 46 / 0.9);
}

.card-moves .chip-button:disabled {
  visibility: hidden;
}

/* Cards scrolled out of view fade at that edge. */
.strip.more-before,
.strip.more-after {
  --fade: 3.5rem;
  mask-image: linear-gradient(
    to right,
    transparent,
    #000 var(--fade-before, 0),
    #000 calc(100% - var(--fade-after, 0)),
    transparent
  );
}

.strip.more-before {
  --fade-before: var(--fade);
}

.strip.more-after {
  --fade-after: var(--fade);
}

/* ---------- The section being edited ---------- */

.section-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 12.5rem;
  gap: 0.85rem;
  align-items: start;
}

.section:not(.in-all) textarea {
  min-height: 15rem;
}

.section.in-all .section-body {
  grid-template-columns: minmax(0, 1fr);
}

.preview {
  display: grid;
  gap: 0.5rem;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  margin: 0;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--text-muted);
}

.preview-head span {
  font-weight: 500;
  color: var(--text-faint);
  font-variant-numeric: tabular-nums;
}

.preview-slides {
  display: grid;
  gap: 0.5rem;
  max-height: 15rem;
  margin: 0;
  padding: 0 0.2rem 0 0;
  list-style: none;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.preview .slide {
  padding: 1.6rem 0.7rem 0.7rem;
}

.preview .slide-label {
  inset: 0.45rem 0.55rem auto;
  font-size: 0.65rem;
}

.preview .slide-text {
  font-size: 0.72rem;
  -webkit-line-clamp: 4;
}

.preview-empty {
  margin: 0;
  padding: 1rem 0.75rem;
  border: 1px dashed var(--border);
  border-radius: var(--radius);
  font-size: 0.78rem;
  color: var(--text-faint);
  text-align: center;
}

@media (max-width: 62rem) {
  .section-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .preview-slides {
    grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
    max-height: none;
  }
}

.add {
  justify-self: start;
  border-style: dashed;
  background: transparent;
  color: var(--text-muted);
}

.add:hover:not(:disabled) {
  color: var(--text);
  border-style: dashed;
}

.sequence {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sequence .chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.05rem;
  height: 2rem;
  padding: 0 0.2rem 0 0.45rem;
  cursor: grab;
  user-select: none;
  border: 1px solid rgb(139 108 255 / 0.3);
  border-radius: 999px;
  background: var(--accent-softer);
  font-size: 0.82rem;
  font-weight: 500;
}

.chip:active {
  cursor: grabbing;
}

.chip-grip {
  width: 0.8rem;
  height: 0.8rem;
  margin-right: 0.2rem;
  color: var(--text-faint);
}

.chip:hover .chip-grip {
  color: var(--text-muted);
}

.chip.dragged {
  opacity: 0.45;
}

/* Where the chip will land: a violet bar in the gap. */
.chip.drop-before::before,
.chip.drop-after::after {
  content: '';
  position: absolute;
  top: 0.15rem;
  bottom: 0.15rem;
  width: 2px;
  border-radius: 999px;
  background: var(--accent);
  pointer-events: none;
}

.chip.drop-before::before {
  left: calc(-0.2rem - 2px);
}

.chip.drop-after::after {
  right: calc(-0.2rem - 2px);
}

.chip-label {
  margin-right: 0.2rem;
}

/* The step buttons stay for keyboard and for anyone who cannot drag, but
   only show on the chip being pointed at or focused. */
.chip-button.reorder {
  opacity: 0;
  transition: opacity 120ms var(--ease-out);
}

.chip:hover .reorder,
.chip:focus-within .reorder {
  opacity: 1;
}

.chip-button {
  min-height: 0;
  width: 1.5rem;
  height: 1.5rem;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
}

.chip-button:hover:not(:disabled) {
  background: var(--surface-hover);
  color: var(--text);
}

.chip-button .icon {
  width: 0.85rem;
  height: 0.85rem;
}

.add-chip select {
  --control-height: 2rem;
  border-radius: 999px;
  border-style: dashed;
  background-color: transparent;
  font-size: 0.82rem;
}

.actions {
  position: sticky;
  bottom: -2rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 -2rem -2rem;
  padding: 1rem 2rem 1.25rem;
  border-top: 1px solid var(--border);
  background: rgb(11 10 24 / 0.92);
  backdrop-filter: blur(10px);
}

.actions .error {
  margin: 0;
}
</style>
