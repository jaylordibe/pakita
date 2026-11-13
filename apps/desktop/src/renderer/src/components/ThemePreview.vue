<script setup lang="ts">
import { computed } from 'vue';

import { stageStyle, type ThemeLook } from '../../../shared/theme-look';

// The same drawing as the projector (stageStyle), at preview size.
const props = defineProps<{ look: ThemeLook; text?: string }>();

const style = computed(() => {
  const stage = stageStyle(props.look);
  return {
    background: stage.background,
    color: stage.color,
    fontFamily: stage.fontFamily,
    textAlign: stage.textAlign,
    fontSize: `${(1.4 * props.look.textScale) / 100}rem`,
  };
});
</script>

<template>
  <div class="preview" :style="style" data-testid="theme-preview">
    <p>
      {{
        props.text ??
        'Amazing grace, how sweet the sound\nThat saved a wretch like me'
      }}
    </p>
  </div>
</template>

<style scoped>
.preview {
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  padding: 1rem 1.5rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  overflow: hidden;
}

.preview p {
  margin: 0;
  width: 100%;
  font-weight: 600;
  line-height: 1.25;
  white-space: pre-line;
}
</style>
