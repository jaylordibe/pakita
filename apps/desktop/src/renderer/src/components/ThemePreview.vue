<script setup lang="ts">
import { computed } from 'vue';

import { stageStyle, type ThemeLook } from '../../../shared/theme-look';

// The same drawing as the projector (stageStyle), at any size: the text is
// sized from the preview's own width, so a thumbnail and a full preview
// keep the projector's proportions.
const props = defineProps<{
  look: ThemeLook;
  text?: string;
  caption?: string;
  isDark?: boolean;
  testId?: string;
}>();

const style = computed(() => {
  const stage = stageStyle(props.look);
  return {
    background: props.isDark ? '#000' : stage.background,
    color: stage.color,
    fontFamily: stage.fontFamily,
    textAlign: stage.textAlign,
    fontSize: `${(4.6 * props.look.textScale) / 100}cqw`,
  };
});
</script>

<template>
  <div class="frame">
    <div
      class="preview"
      :style="style"
      :data-testid="props.testId ?? 'theme-preview'"
    >
      <p v-if="!props.isDark">
        {{
          props.text ??
          'Amazing grace, how sweet the sound\nThat saved a wretch like me'
        }}
      </p>
      <p v-if="props.caption && !props.isDark" class="caption">
        {{ props.caption }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.frame {
  container-type: inline-size;
}

.preview {
  position: relative;
  aspect-ratio: 16 / 9;
  display: grid;
  place-items: center;
  padding: 5cqw 6cqw;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  overflow: hidden;
}

.preview p {
  margin: 0;
  width: 100%;
  font-weight: 600;
  line-height: 1.25;
  white-space: pre-line;
  text-shadow: 0 0.04em 0.12em rgb(0 0 0 / 0.6);
}

.preview .caption {
  position: absolute;
  inset: auto 6cqw 4cqw;
  width: auto;
  font-size: 2cqw;
  opacity: 0.85;
  text-align: center;
}
</style>
