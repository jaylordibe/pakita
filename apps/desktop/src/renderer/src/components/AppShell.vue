<script setup lang="ts" generic="TabId extends string">
import { computed } from 'vue';

import pakitaMark from '../assets/pakita-mark.png';
import AppIcon, { type IconName } from './AppIcon.vue';

// The operator window's frame: the sidebar (brand, navigation, whatever the
// view puts above the account, the account row) beside the view's content.
// The church library and the Server screen share it, so it is drawn once.

const props = defineProps<{
  /** Under the wordmark: the open church, or what this screen is. */
  subtitle: string | null;
  tabs: ReadonlyArray<{ id: TabId; label: string; icon: IconName }>;
  activeTab: TabId;
  displayName: string;
}>();
const emit = defineEmits<{ select: [tab: TabId] }>();

const initials = computed(() =>
  props.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join(''),
);
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <img :src="pakitaMark" alt="" width="30" height="30" />
        <span class="brand-text">
          <span class="wordmark">Pakita</span>
          <span v-if="subtitle" class="subtitle">{{ subtitle }}</span>
        </span>
      </div>

      <nav class="nav" aria-label="Content">
        <button
          v-for="item in tabs"
          :key="item.id"
          class="nav-item"
          :aria-current="activeTab === item.id ? 'page' : undefined"
          :data-testid="`tab-${item.id}`"
          :title="item.label"
          @click="emit('select', item.id)"
        >
          <AppIcon :name="item.icon" />
          <span class="label">{{ item.label }}</span>
        </button>
      </nav>

      <span class="grow"></span>

      <slot name="status" />

      <div class="account">
        <span class="avatar" aria-hidden="true">{{ initials }}</span>
        <span class="who label">{{ displayName }}</span>
        <slot name="account-actions" />
      </div>
    </aside>

    <div class="content">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: grid;
  grid-template-columns: 14.5rem minmax(0, 1fr);
  height: 100%;
}

.sidebar {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-height: 0;
  padding: 1rem 0.75rem 0.75rem;
  background: var(--bg);
  border-right: 1px solid var(--border);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: none;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0 0.35rem 1.1rem;
}

.brand img {
  flex: none;
  filter: drop-shadow(0 6px 14px rgb(98 72 255 / 0.5));
}

.brand-text {
  display: grid;
  min-width: 0;
}

.wordmark {
  font-family: var(--font-brand);
  font-weight: 800;
  font-size: 1.25rem;
  letter-spacing: -0.01em;
  line-height: 1.1;
}

.subtitle {
  font-size: 0.75rem;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nav {
  display: grid;
  gap: 0.2rem;
}

.nav-item {
  justify-content: flex-start;
  gap: 0.75rem;
  min-height: 2.5rem;
  padding: 0 0.75rem;
  border-color: transparent;
  background: transparent;
  color: var(--text-muted);
  font-size: 0.9rem;
}

.nav-item:hover:not(:disabled) {
  background: var(--surface);
  border-color: transparent;
  color: var(--text);
}

.nav-item .icon {
  width: 1.15rem;
  height: 1.15rem;
}

.nav-item[aria-current='page'] {
  color: #fff;
  background: linear-gradient(
    135deg,
    rgb(122 77 255 / 0.9),
    rgb(77 98 255 / 0.75)
  );
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.14),
    0 8px 20px -10px rgb(98 72 255 / 0.95);
}

.account {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.65rem 0.1rem 0 0.25rem;
  border-top: 1px solid var(--border);
}

.avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  margin-right: 0.35rem;
  border-radius: 50%;
  font-size: 0.72rem;
  font-weight: 700;
  color: #fff;
  background: var(--brand-gradient);
}

.who {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.content {
  min-width: 0;
  min-height: 0;
}

/* A narrow window keeps every control and drops the words beside them —
   including the words in what a view puts in the sidebar (`.label`). */
@media (max-width: 1100px) {
  .layout {
    grid-template-columns: 4.25rem minmax(0, 1fr);
  }

  .sidebar {
    align-items: center;
    padding-inline: 0.5rem;
  }

  .brand {
    padding-inline: 0;
  }

  .sidebar :deep(.label),
  .brand-text {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .nav-item {
    width: 2.6rem;
    padding: 0;
    justify-content: center;
  }

  .account {
    flex-direction: column;
    padding-inline: 0;
  }

  .avatar {
    margin: 0 0 0.3rem;
  }
}
</style>
