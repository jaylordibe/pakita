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
  sectionsInSungOrder,
  type SectionKind,
} from '../../../shared/song-sections';
import { focusFirstEnabled, moveItem, useDragReorder } from '../drag-reorder';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

// The editor shows a song the way it is sung: the strip is the order of one
// version (an arrangement; the default one unless another is picked), so
// what the operator arranges here is what goes live. A section sung more
// than once appears once per time, and every copy edits the same lyrics.
// The song's own list of sections is derived from that order on save.

interface EditableSection {
  key: string;
  kind: SectionKind;
  label: string;
  lyrics: string;
}
interface EditableVersion {
  name: string;
  sectionKeys: string[];
}
/** The card being edited: a place in the order, or a section it leaves out. */
interface Selection {
  key: string;
  position: number | null;
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

// Existing sections keep their server ids as keys, so versions that refer to
// them survive the edit.
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
const versions = reactive<EditableVersion[]>(
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
const activeIndex = ref(defaultIndex.value);
const active = computed(() => versions[activeIndex.value]!);
const errorMessage = ref<string | null>(null);
const isSaving = ref(false);

const sectionOf = (key: string) =>
  sections.find((section) => section.key === key);
const labelOf = (key: string) => sectionOf(key)?.label || 'Unnamed';
const slidesOf = (section: EditableSection) => splitIntoSlides(section.lyrics);
const isIncomplete = (section: EditableSection) =>
  !section.label.trim() || !section.lyrics.trim();
const slideCount = (section: EditableSection) => {
  const count = slidesOf(section).length;
  return count === 1 ? '1 slide' : `${count} slides`;
};

/** The sung order of the version on screen, one entry per card. */
const sung = computed(() =>
  active.value.sectionKeys.flatMap((key, position) => {
    const section = sectionOf(key);
    return section ? [{ section, position }] : [];
  }),
);
/** Sections this version leaves out (sung only in another, or nowhere). */
const unsung = computed(() =>
  sections.filter((section) => !active.value.sectionKeys.includes(section.key)),
);
/** Every section once, as this version first sings it: "All lyrics". */
const orderedSections = computed(() =>
  sectionsInSungOrder(sections, active.value.sectionKeys),
);
const timesSung = (key: string) =>
  active.value.sectionKeys.filter((other) => other === key).length;
const isSungInAnotherVersion = (key: string) =>
  versions.some(
    (version, index) =>
      index !== activeIndex.value && version.sectionKeys.includes(key),
  );

// The strip picks the card being edited; "All lyrics" shows every section at
// once, for reading a song through.
const firstSelection = (): Selection =>
  active.value.sectionKeys[0]
    ? { key: active.value.sectionKeys[0], position: 0 }
    : { key: sections[0]!.key, position: null };
const selection = ref<Selection>(firstSelection());
const showsAllLyrics = ref(false);
/** The section waiting for "Delete section?" to be answered. */
const pendingDeletion = ref<string | null>(null);

const isSelected = (position: number | null, key: string) =>
  selection.value.position === position && selection.value.key === key;

/** Edits this card: in "All lyrics", brings its section into view instead. */
async function select(key: string, position: number | null): Promise<void> {
  selection.value = { key, position };
  pendingDeletion.value = null;
  if (!showsAllLyrics.value) return;
  await nextTick();
  document
    .querySelector(`[data-section-sheet="${key}"]`)
    ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

async function focusLyrics(key: string): Promise<void> {
  await nextTick();
  document
    .querySelector<HTMLTextAreaElement>(
      `[data-section-sheet="${key}"] textarea`,
    )
    ?.focus();
}

function chooseVersion(index: number): void {
  activeIndex.value = index;
  selection.value = firstSelection();
  pendingDeletion.value = null;
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

// Keep the selected card in view as cards are added and moved.
watch(
  () => [selection.value, active.value.sectionKeys.length] as const,
  async () => {
    await nextTick();
    measureStrip();
    document
      .querySelector('.section-card[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
);

const canSave = computed(
  () =>
    title.value.trim().length > 0 &&
    sections.length > 0 &&
    sections.every((section) => !isIncomplete(section)) &&
    versions.every(
      (version) => version.name.trim() && version.sectionKeys.length > 0,
    ),
);

/** A new section, sung last in the version on screen. */
function addSection(): void {
  const section: EditableSection = {
    key: nextKey(),
    kind: 'verse',
    label: automaticLabel('verse', sections),
    lyrics: '',
  };
  sections.push(section);
  active.value.sectionKeys.push(section.key);
  void select(section.key, active.value.sectionKeys.length - 1).then(() =>
    focusLyrics(section.key),
  );
}

/**
 * Sings the selected section once more, straight after this card; a section
 * the version leaves out is added at the end.
 */
function repeatSelected(): void {
  const { key, position } = selection.value;
  const keys = active.value.sectionKeys;
  const at = position === null ? keys.length : position + 1;
  keys.splice(at, 0, key);
  selection.value = { key, position: at };
  moveAnnouncement.value = `${labelOf(key)} is now sung ${timesSung(key)} ${timesSung(key) === 1 ? 'time' : 'times'}.`;
}

/** Whether removing this card would leave its section sung nowhere. */
const removalDeletesSection = computed(() => {
  const { key, position } = selection.value;
  if (position === null) return true;
  return timesSung(key) === 1 && !isSungInAnotherVersion(key);
});

/**
 * Takes the selected card out of the order. Its section stays while it is
 * sung elsewhere; the last place it is sung asks before deleting it.
 */
function removeSelected(): void {
  const { key, position } = selection.value;
  if (removalDeletesSection.value) {
    pendingDeletion.value = key;
    return;
  }
  if (position === null) return;
  active.value.sectionKeys.splice(position, 1);
  selectNear(position);
}

function deleteSection(key: string): void {
  if (sections.length === 1) return;
  const index = sections.findIndex((section) => section.key === key);
  if (index < 0) return;
  const position = selection.value.position;
  sections.splice(index, 1);
  for (const version of versions) {
    version.sectionKeys = version.sectionKeys.filter((other) => other !== key);
  }
  pendingDeletion.value = null;
  selectNear(position ?? active.value.sectionKeys.length);
}

/** After a removal: the card now at `position`, else the one before it. */
function selectNear(position: number): void {
  const keys = active.value.sectionKeys;
  const near = Math.min(position, keys.length - 1);
  selection.value =
    near >= 0
      ? { key: keys[near]!, position: near }
      : { key: sections[0]!.key, position: null };
}

// Read out after every move, by drag or by button.
const moveAnnouncement = ref('');

function moveCard(keys: string[], from: number, to: number): void {
  if (from === to) return;
  const positions = moveItem(
    keys.map((_, position) => position),
    from,
    to,
  );
  active.value.sectionKeys = moveItem(keys, from, to);
  // The selection stays on the same card wherever it now sits.
  const selected = selection.value.position;
  if (selected !== null) {
    selection.value = {
      key: selection.value.key,
      position: positions.indexOf(selected),
    };
  }
  moveAnnouncement.value = `Moved ${labelOf(keys[from] ?? '')} to position ${to + 1} of ${keys.length}.`;
}

async function moveCardByButton(
  position: number,
  offset: -1 | 1,
): Promise<void> {
  const to = position + offset;
  if (to < 0 || to >= active.value.sectionKeys.length) return;
  moveCard(active.value.sectionKeys, position, to);
  // Keep focus on the card that moved, so the next press moves it again.
  const at = (step: string) => `[data-section-move="${to}-${step}"]`;
  const direction = offset < 0 ? 'earlier' : 'later';
  const opposite = offset < 0 ? 'later' : 'earlier';
  await focusFirstEnabled(at(direction), at(opposite));
}

const cardReorder = useDragReorder<string[]>({
  axis: 'horizontal',
  onMove: moveCard,
});

/** Another order for the same sections, starting as a copy of this one. */
function addVersion(): void {
  versions.push({
    name: `Version ${versions.length + 1}`,
    sectionKeys: [...active.value.sectionKeys],
  });
  chooseVersion(versions.length - 1);
}

function removeVersion(index: number): void {
  if (versions.length === 1) return;
  versions.splice(index, 1);
  if (defaultIndex.value === index) defaultIndex.value = 0;
  else if (defaultIndex.value > index) defaultIndex.value -= 1;
  chooseVersion(
    activeIndex.value === index
      ? defaultIndex.value
      : activeIndex.value > index
        ? activeIndex.value - 1
        : activeIndex.value,
  );
}

async function save(): Promise<void> {
  isSaving.value = true;
  errorMessage.value = null;
  const defaultOrder = versions[defaultIndex.value]?.sectionKeys ?? [];
  const input: SongInput = {
    title: title.value.trim(),
    artist: artist.value.trim() || null,
    sections: sectionsInSungOrder(sections, defaultOrder).map((section) => ({
      key: section.key,
      kind: section.kind,
      label: section.label.trim(),
      lyrics: section.lyrics,
    })),
    arrangements: versions.map((version, index) => ({
      name: version.name.trim(),
      isDefault: index === defaultIndex.value,
      sectionKeys: [...version.sectionKeys],
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
        <p class="muted">In the order they are shown live.</p>
        <span class="grow"></span>
        <label v-if="versions.length > 1" class="version-pick">
          <span class="visually-hidden">Version</span>
          <select
            :value="activeIndex"
            data-testid="version-select"
            @change="
              chooseVersion(Number(($event.target as HTMLSelectElement).value))
            "
          >
            <option
              v-for="(version, index) in versions"
              :key="index"
              :value="index"
            >
              {{ version.name || 'Unnamed version'
              }}{{ index === defaultIndex ? ' (default)' : '' }}
            </option>
          </select>
        </label>
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
        :aria-label="`${active.name}: sections in the order they are sung`"
        @scroll.passive="measureStrip"
        @dragleave="cardReorder.leave"
      >
        <li
          v-for="{ section, position } in sung"
          :key="`${section.key}-${position}`"
          class="strip-item"
          :class="{
            dragged: cardReorder.isDragged(active.sectionKeys, position),
            [`drop-${cardReorder.markerAt(active.sectionKeys, position)}`]:
              cardReorder.markerAt(active.sectionKeys, position),
          }"
          draggable="true"
          @dragstart="cardReorder.start(active.sectionKeys, position, $event)"
          @dragend="cardReorder.end"
          @dragover="cardReorder.over(active.sectionKeys, position, $event)"
          @drop="cardReorder.drop(active.sectionKeys, $event)"
        >
          <button
            type="button"
            class="slide section-card"
            :class="{
              incomplete: isIncomplete(section),
              linked:
                section.key === selection.key &&
                !isSelected(position, section.key),
            }"
            :aria-current="
              isSelected(position, section.key) ? 'true' : undefined
            "
            :data-testid="`section-card-${position}`"
            title="Edit this section · drag to reorder"
            @click="select(section.key, position)"
          >
            <span class="slide-label">
              <span class="card-name">
                <AppIcon
                  v-if="timesSung(section.key) > 1"
                  name="sync"
                  class="linked-mark"
                />
                {{ section.label || 'Unnamed' }}
                <span v-if="timesSung(section.key) > 1" class="visually-hidden">
                  (sung {{ timesSung(section.key) }} times)
                </span>
              </span>
              <span class="slide-number">{{ position + 1 }}</span>
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
              :data-section-move="`${position}-earlier`"
              :disabled="position === 0"
              @click="moveCardByButton(position, -1)"
            >
              <AppIcon name="chevron-left" />
            </button>
            <button
              type="button"
              class="chip-button"
              :aria-label="`Move ${section.label || 'section'} later`"
              title="Later"
              :data-section-move="`${position}-later`"
              :disabled="position === active.sectionKeys.length - 1"
              @click="moveCardByButton(position, 1)"
            >
              <AppIcon name="chevron-right" />
            </button>
          </span>
        </li>
        <li
          v-for="(section, index) in unsung"
          :key="`unsung-${section.key}`"
          class="strip-item"
        >
          <button
            type="button"
            class="slide section-card unsung"
            :aria-current="isSelected(null, section.key) ? 'true' : undefined"
            :data-testid="`section-card-unsung-${index}`"
            title="Not sung in this version"
            @click="select(section.key, null)"
          >
            <span class="slide-label">
              <span class="card-name">{{ section.label || 'Unnamed' }}</span>
            </span>
            <span class="slide-text">Not sung in this version</span>
          </button>
        </li>
      </ol>
      <p v-if="sung.length === 0" class="warning-note" role="status">
        <AppIcon name="alert" />
        Nothing is sung in {{ active.name || 'this version' }} yet. Pick a
        section and choose “Sing in this version”.
      </p>

      <fieldset
        v-for="(section, index) in orderedSections"
        v-show="showsAllLyrics || section.key === selection.key"
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
          <template v-if="!showsAllLyrics && section.key === selection.key">
            <button
              type="button"
              class="sm"
              data-testid="section-repeat"
              @click="repeatSelected"
            >
              <AppIcon :name="selection.position === null ? 'plus' : 'copy'" />
              {{
                selection.position === null ? 'Sing in this version' : 'Repeat'
              }}
            </button>
            <button
              type="button"
              class="sm ghost danger"
              v-if="pendingDeletion !== section.key"
              data-testid="section-remove"
              :disabled="removalDeletesSection && sections.length === 1"
              @click="removeSelected"
            >
              <AppIcon name="trash" />
              {{ removalDeletesSection ? 'Delete section' : 'Remove here' }}
            </button>
          </template>
        </div>

        <p
          v-if="pendingDeletion === section.key && !showsAllLyrics"
          class="confirm"
          role="alert"
        >
          <span class="grow">
            Delete “{{ section.label || 'Unnamed' }}”? It is not sung anywhere
            else, so its lyrics go too.
          </span>
          <button
            type="button"
            class="sm danger"
            data-testid="section-delete-confirm"
            @click="deleteSection(section.key)"
          >
            Delete section
          </button>
          <button type="button" class="sm" @click="pendingDeletion = null">
            Keep
          </button>
        </p>
        <p
          v-else-if="!showsAllLyrics && timesSung(section.key) > 1"
          class="linked-note"
        >
          <AppIcon name="sync" />
          Sung {{ timesSung(section.key) }} times in this version. A change here
          shows in every one.
        </p>

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
              Type the lyrics to see this section's slides. A blank line starts
              a new slide.
            </p>
          </div>
        </div>
      </fieldset>
      <p class="visually-hidden" aria-live="polite">{{ moveAnnouncement }}</p>
    </section>

    <details class="versions" :open="versions.length > 1">
      <summary>
        <AppIcon name="chevron-right" class="disclosure" />
        <span class="versions-title">Versions</span>
        <span class="muted">
          A different order of the same sections, such as a short version.
        </span>
      </summary>
      <div class="versions-body">
        <div
          v-for="(version, index) in versions"
          :key="index"
          class="version-row"
          :class="{ active: index === activeIndex }"
        >
          <input
            v-model="version.name"
            class="grow"
            aria-label="Version name"
            :data-testid="`version-name-${index}`"
            maxlength="60"
          />
          <label class="inline">
            <input v-model="defaultIndex" type="radio" :value="index" />
            Default
          </label>
          <button
            type="button"
            class="sm"
            :disabled="index === activeIndex"
            @click="chooseVersion(index)"
          >
            {{ index === activeIndex ? 'Showing' : 'Show' }}
          </button>
          <button
            type="button"
            class="ghost danger icon-only sm"
            aria-label="Remove version"
            title="Remove"
            :disabled="versions.length === 1"
            @click="removeVersion(index)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
        <button
          type="button"
          class="add"
          data-testid="version-add"
          @click="addVersion"
        >
          <AppIcon name="plus" />
          Add a version
        </button>
      </div>
    </details>

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

/* Another card of the section being edited: the same lyrics, sung again. */
.section-card.linked {
  border-color: rgb(139 108 255 / 0.45);
}

.linked-mark {
  width: 0.75rem;
  height: 0.75rem;
  margin-right: 0.2rem;
  vertical-align: -0.1em;
  color: var(--accent-hover);
}

/* A section this version leaves out: kept, but plainly not on the screen. */
.section-card.unsung {
  border-style: dashed;
  background: transparent;
}

.section-card.unsung .slide-text {
  color: var(--text-faint);
  font-style: italic;
  font-weight: 400;
}

.section-card.unsung:hover:not(:disabled) {
  background: var(--accent-softer);
}

.warning-note,
.linked-note,
.confirm {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 0.8rem;
}

.warning-note {
  color: var(--warning);
}

.linked-note {
  color: var(--text-muted);
}

.linked-note .icon {
  width: 0.85rem;
  height: 0.85rem;
  color: var(--accent-hover);
}

.confirm {
  padding: 0.55rem 0.6rem 0.55rem 0.8rem;
  border: 1px solid rgb(255 118 134 / 0.35);
  border-radius: var(--radius);
  background: var(--danger-soft);
  color: var(--text);
}

.version-pick select {
  --control-height: 1.9rem;
  font-size: 0.8rem;
}

/* ---------- Versions ---------- */

.versions {
  display: grid;
  gap: 0.75rem;
}

.versions summary {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
  width: fit-content;
  cursor: pointer;
  list-style: none;
}

.versions summary::-webkit-details-marker {
  display: none;
}

.versions summary .muted {
  font-size: 0.8rem;
}

.versions-title {
  font-size: 0.95rem;
  font-weight: 600;
}

.disclosure {
  align-self: center;
  width: 0.9rem;
  height: 0.9rem;
  color: var(--text-muted);
  transition: transform 160ms var(--ease-out);
}

.versions[open] .disclosure {
  transform: rotate(90deg);
}

.versions-body {
  display: grid;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.version-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.version-row.active {
  border-color: rgb(139 108 255 / 0.45);
}

.version-row .inline {
  white-space: nowrap;
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
