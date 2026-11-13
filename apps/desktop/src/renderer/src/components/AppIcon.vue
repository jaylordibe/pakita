<script setup lang="ts">
import { computed } from 'vue';

// Pakita's interface icons: drawn on a 24-unit grid with one 1.75 stroke,
// round caps and joins. Decorative only (aria-hidden): the button or label
// around an icon carries its name.
type Shape =
  | { readonly path: string; readonly fill?: boolean }
  | {
      readonly circle: readonly [number, number, number];
      readonly fill?: boolean;
    }
  | { readonly rect: readonly [number, number, number, number, number] };

const ICONS = {
  songs: [
    { path: 'M9 18V5.5l11-2.5v12.5' },
    { circle: [6, 18, 3] },
    { circle: [17, 15.5, 3] },
  ],
  bible: [
    { path: 'M2.5 4.5H8a4 4 0 0 1 4 4V21a3 3 0 0 0-3-3H2.5z' },
    { path: 'M21.5 4.5H16a4 4 0 0 0-4 4V21a3 3 0 0 1 3-3h6.5z' },
  ],
  playlists: [
    { path: 'M3 6h13M3 12h13M3 18h7' },
    { path: 'M15 14.5v6l5-3z', fill: true },
  ],
  themes: [
    {
      path: 'M12 3a9 9 0 1 0 0 18c1.2 0 1.7-.8 1.7-1.6 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.6 1.6-1.6h2A4.7 4.7 0 0 0 21 10.7C21 6.4 17 3 12 3z',
    },
    { circle: [7.5, 11.5, 1.1], fill: true },
    { circle: [10.5, 7.2, 1.1], fill: true },
    { circle: [15.3, 7.8, 1.1], fill: true },
  ],
  search: [{ circle: [11, 11, 7] }, { path: 'M20.5 20.5 16 16' }],
  plus: [{ path: 'M12 5v14M5 12h14' }],
  play: [
    {
      path: 'M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.3-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z',
      fill: true,
    },
  ],
  stop: [{ rect: [6, 6, 12, 12, 2] }],
  'chevron-left': [{ path: 'M15 18l-6-6 6-6' }],
  'chevron-right': [{ path: 'M9 18l6-6-6-6' }],
  grip: [
    { circle: [9, 6, 1.4], fill: true },
    { circle: [15, 6, 1.4], fill: true },
    { circle: [9, 12, 1.4], fill: true },
    { circle: [15, 12, 1.4], fill: true },
    { circle: [9, 18, 1.4], fill: true },
    { circle: [15, 18, 1.4], fill: true },
  ],
  'arrow-up': [{ path: 'M12 19V5M5.5 11.5 12 5l6.5 6.5' }],
  'arrow-down': [{ path: 'M12 5v14M18.5 12.5 12 19l-6.5-6.5' }],
  'arrow-left': [{ path: 'M19 12H5M11.5 5.5 5 12l6.5 6.5' }],
  'arrow-right': [{ path: 'M5 12h14M12.5 5.5 19 12l-6.5 6.5' }],
  x: [{ path: 'M17.5 6.5l-11 11M6.5 6.5l11 11' }],
  sync: [
    { path: 'M20.5 11A8.5 8.5 0 0 0 5.8 6.2L3.5 8.5' },
    { path: 'M3.5 4v4.5H8' },
    { path: 'M3.5 13a8.5 8.5 0 0 0 14.7 4.8l2.3-2.3' },
    { path: 'M20.5 20v-4.5H16' },
  ],
  download: [{ path: 'M12 3.5v11.5M7 10l5 5 5-5M4.5 20.5h15' }],
  upload: [{ path: 'M12 20.5V9M7 14l5-5 5 5M4.5 3.5h15' }],
  'log-out': [
    { path: 'M9.5 20.5h-4a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2h4' },
    { path: 'M16 16.5 20.5 12 16 7.5M20.5 12H9.5' },
  ],
  church: [
    { path: 'M12 2.5v4M10 4.5h4' },
    { path: 'M5 21V12l7-5.5 7 5.5v9' },
    { path: 'M3 21h18M10 21v-4.5a2 2 0 0 1 4 0V21' },
  ],
  pencil: [
    { path: 'M4 20h4L19.3 8.7a2.8 2.8 0 0 0-4-4L4 16z' },
    { path: 'M13.5 6.5l4 4' },
  ],
  eye: [
    {
      path: 'M2.5 12C4 8.5 7.5 5.5 12 5.5s8 3 9.5 6.5c-1.5 3.5-5 6.5-9.5 6.5S4 15.5 2.5 12z',
    },
    { circle: [12, 12, 2.8] },
  ],
  'eye-off': [
    { path: 'M3.5 3.5l17 17' },
    {
      path: 'M10.4 5.7c.5-.1 1-.2 1.6-.2 4.5 0 8 3 9.5 6.5-.5 1.1-1.1 2.1-1.9 3',
    },
    {
      path: 'M6.7 6.8C4.8 8 3.4 9.9 2.5 12c1.5 3.5 5 6.5 9.5 6.5 1.8 0 3.4-.5 4.8-1.3',
    },
    { path: 'M10 10a2.8 2.8 0 0 0 4 4' },
  ],
  monitor: [{ rect: [2.5, 4, 19, 12.5, 2] }, { path: 'M8 20.5h8M12 16.5v4' }],
  check: [{ path: 'M20 6.5 9.5 17 4 11.5' }],
  alert: [
    {
      path: 'M10.3 4.2 2.6 17.5a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z',
    },
    { path: 'M12 9.5v4M12 17h.01' },
  ],
  trash: [
    { path: 'M3.5 6.5h17M9 6.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' },
    {
      path: 'M5.5 6.5l1 13a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5l1-13',
    },
  ],
  folder: [
    {
      path: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
    },
  ],
  copy: [
    { rect: [8.5, 8.5, 12.5, 12.5, 2] },
    { path: 'M15.5 8.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h3.5' },
  ],
  'list-plus': [{ path: 'M3 6h13M3 12h13M3 18h8M18.5 15v6M15.5 18h6' }],
  star: [
    {
      path: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    },
  ],
  info: [{ circle: [12, 12, 9] }, { path: 'M12 11v5.5M12 7.5h.01' }],
  people: [
    { circle: [9, 8, 3.5] },
    { path: 'M2.5 20a6.5 6.5 0 0 1 13 0' },
    { path: 'M15.5 4.8a3.5 3.5 0 0 1 0 6.4M17.5 14.2a6.5 6.5 0 0 1 4 5.8' },
  ],
  key: [
    { circle: [8, 15.5, 4.5] },
    { path: 'M11.2 12.3 20 3.5M16.5 7l2.5 2.5M14 9.5l2 2' },
  ],
  sparkle: [
    {
      path: 'M12 3.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5z',
    },
    {
      path: 'M19 15.5c.2 1.4.9 2.1 2.3 2.3-1.4.2-2.1.9-2.3 2.3-.2-1.4-.9-2.1-2.3-2.3 1.4-.2 2.1-.9 2.3-2.3z',
    },
  ],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof ICONS;

const props = defineProps<{ name: IconName }>();
const shapes = computed<readonly Shape[]>(() => ICONS[props.name]);
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <template v-for="(shape, index) in shapes" :key="index">
      <path
        v-if="'path' in shape"
        :d="shape.path"
        :fill="shape.fill ? 'currentColor' : 'none'"
      />
      <circle
        v-else-if="'circle' in shape"
        :cx="shape.circle[0]"
        :cy="shape.circle[1]"
        :r="shape.circle[2]"
        :fill="shape.fill ? 'currentColor' : 'none'"
        :stroke="shape.fill ? 'none' : 'currentColor'"
      />
      <rect
        v-else
        :x="shape.rect[0]"
        :y="shape.rect[1]"
        :width="shape.rect[2]"
        :height="shape.rect[3]"
        :rx="shape.rect[4]"
      />
    </template>
  </svg>
</template>
