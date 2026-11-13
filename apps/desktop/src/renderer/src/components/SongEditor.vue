<script setup lang="ts">
import { computed, reactive, ref } from 'vue';

import type { Song, SongInput } from '../../../shared/ipc-contract';
import { focusFirstEnabled, moveItem, useDragReorder } from '../drag-reorder';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';

type SectionKind = SongInput['sections'][number]['kind'];

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
  })) ?? [{ key: nextKey(), kind: 'verse', label: 'Verse 1', lyrics: '' }],
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
    label: `Section ${sections.length + 1}`,
    lyrics: '',
  };
  sections.push(section);
  arrangements[defaultIndex.value]?.sectionKeys.push(section.key);
}

function removeSection(index: number): void {
  const [removed] = sections.splice(index, 1);
  if (!removed) return;
  for (const arrangement of arrangements) {
    arrangement.sectionKeys = arrangement.sectionKeys.filter(
      (key) => key !== removed.key,
    );
  }
}

function move<Value>(list: Value[], index: number, offset: number): void {
  const target = index + offset;
  if (target < 0 || target >= list.length) return;
  const [moved] = list.splice(index, 1);
  list.splice(target, 0, moved!);
}

// Read out after every chip move, by drag or by button.
const moveAnnouncement = ref('');

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
      </div>
      <fieldset
        v-for="(section, index) in sections"
        :key="section.key"
        class="sheet section"
      >
        <div class="section-head">
          <select v-model="section.kind" class="kind" aria-label="Section kind">
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
            class="ghost icon-only"
            aria-label="Move section up"
            title="Move up"
            :disabled="index === 0"
            @click="move(sections, index, -1)"
          >
            <AppIcon name="arrow-up" />
          </button>
          <button
            type="button"
            class="ghost icon-only"
            aria-label="Move section down"
            title="Move down"
            :disabled="index === sections.length - 1"
            @click="move(sections, index, 1)"
          >
            <AppIcon name="arrow-down" />
          </button>
          <button
            type="button"
            class="ghost danger icon-only"
            aria-label="Remove section"
            title="Remove"
            @click="removeSection(index)"
          >
            <AppIcon name="trash" />
          </button>
        </div>
        <textarea
          v-model="section.lyrics"
          :data-testid="`section-lyrics-${index}`"
          aria-label="Lyrics"
          rows="5"
          maxlength="10000"
        ></textarea>
      </fieldset>
      <button type="button" class="add" @click="addSection">
        <AppIcon name="plus" />
        Add section
      </button>
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
