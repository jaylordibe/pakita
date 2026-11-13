<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import type { DisplayInfo, LiveState } from '../../../shared/ipc-contract';
import { messageOf } from '../errors';

const props = defineProps<{ state: LiveState }>();
const live = window.pakita.live;

const displays = ref<DisplayInfo[]>([]);
const errorMessage = ref<string | null>(null);

const PROJECTOR_NOTES: Record<LiveState['projector'], string> = {
  off: '',
  showing: 'On the projector.',
  'display-missing':
    'The projector display is disconnected. Reconnect it: the presentation continues where it is.',
  windowed: 'No second display: showing in a window.',
};

async function refreshDisplays(): Promise<void> {
  displays.value = await window.pakita.displays.list();
}

async function chooseDisplay(event: Event): Promise<void> {
  const select = event.target as HTMLSelectElement;
  // Let go of focus, so the presenter keys never change the display.
  select.blur();
  const value = select.value === '' ? null : Number(select.value);
  if (value === null || Number.isInteger(value)) {
    await window.pakita.displays.choose(value);
    await refreshDisplays();
  }
}

async function run(action: () => Promise<unknown>): Promise<void> {
  errorMessage.value = null;
  try {
    await action();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

// Presenter keys work everywhere while live, except while typing in a text
// field. A focused drop-down would otherwise take the arrow keys itself and
// change the projector display or the arrangement mid-service.
function onKeydown(event: KeyboardEvent): void {
  if (!props.state.isLive) return;
  const target = event.target as HTMLElement | null;
  if (target && ['INPUT', 'TEXTAREA'].includes(target.tagName)) {
    return;
  }
  const actions: Record<string, () => Promise<unknown>> = {
    ArrowRight: () => window.pakita.live.next(),
    ArrowDown: () => window.pakita.live.next(),
    PageDown: () => window.pakita.live.next(),
    ' ': () => window.pakita.live.next(),
    ArrowLeft: () => window.pakita.live.previous(),
    ArrowUp: () => window.pakita.live.previous(),
    PageUp: () => window.pakita.live.previous(),
    b: () => window.pakita.live.toggleBlackout(),
    B: () => window.pakita.live.toggleBlackout(),
    '.': () => window.pakita.live.toggleBlackout(),
  };
  const action = actions[event.key];
  if (action) {
    event.preventDefault();
    void run(action);
  }
}

let unsubscribe: (() => void) | null = null;
onMounted(() => {
  void refreshDisplays();
  unsubscribe = window.pakita.displays.onChanged(() => void refreshDisplays());
  window.addEventListener('keydown', onKeydown);
});
onUnmounted(() => {
  unsubscribe?.();
  window.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <section class="live" :class="{ 'is-live': state.isLive }">
    <div class="row">
      <strong data-testid="live-title">
        {{ state.isLive ? `Live: ${state.title}` : 'Not presenting' }}
      </strong>
      <span class="muted" data-testid="projector-status">
        {{ PROJECTOR_NOTES[state.projector] }}
      </span>
      <span class="grow"></span>
      <label class="inline">
        Projector
        <select data-testid="display-select" @change="chooseDisplay">
          <option value="" :selected="!displays.some((d) => d.isChosen)">
            Automatic
          </option>
          <option
            v-for="display in displays"
            :key="display.id"
            :value="display.id"
            :selected="display.isChosen"
          >
            {{ display.label }} ({{ display.width }}×{{ display.height
            }}{{ display.isPrimary ? ', this screen' : '' }})
          </option>
        </select>
      </label>
    </div>

    <template v-if="state.isLive">
      <div class="row">
        <button data-testid="live-previous" @click="run(() => live.previous())">
          ← Previous
        </button>
        <button
          class="primary"
          data-testid="live-next"
          @click="run(() => live.next())"
        >
          Next →
        </button>
        <button
          :class="{ live: state.isBlackout }"
          data-testid="live-blackout"
          @click="run(() => live.toggleBlackout())"
        >
          {{ state.isBlackout ? 'Show' : 'Blackout' }} (B)
        </button>
        <button data-testid="live-stop" @click="run(() => live.stop())">
          Stop
        </button>
      </div>
      <ol class="slides">
        <li
          v-for="(slide, index) in state.slides"
          :key="index"
          :class="{ current: index === state.index }"
          :data-testid="`live-slide-${index}`"
          @click="run(() => live.goTo(index))"
        >
          <span class="muted">{{ slide.sectionLabel }}</span>
          <span class="text">{{ slide.text }}</span>
        </li>
      </ol>
    </template>
    <p v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</p>
  </section>
</template>

<style scoped>
.live {
  border-top: 3px solid var(--border);
  padding: 0.75rem 1rem;
  background: var(--surface);
  display: grid;
  gap: 0.6rem;
}

.live.is-live {
  border-top-color: var(--live);
}

.grow {
  flex: 1;
}

.inline {
  display: flex;
  gap: 0.4rem;
  align-items: center;
  font-weight: 400;
}

.slides {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(12rem, 1fr));
  gap: 0.5rem;
  max-height: 14rem;
  overflow: auto;
  padding: 0;
  margin: 0;
  list-style: none;
}

.slides li {
  border: 2px solid var(--border);
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
  cursor: pointer;
  display: grid;
  gap: 0.2rem;
  font-size: 0.85rem;
}

.slides li.current {
  border-color: var(--live);
  background: #fbeeec;
}

.text {
  white-space: pre-line;
}
</style>
