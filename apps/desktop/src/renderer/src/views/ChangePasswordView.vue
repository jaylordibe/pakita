<script setup lang="ts">
import { computed, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import type { AccountSummary } from '../../../shared/ipc-contract';
import pakitaMark from '../assets/pakita-mark.png';
import AppIcon from '../components/AppIcon.vue';
import { messageOf } from '../errors';

// Shown right after signing in with a password an administrator chose (a new
// account, or a reset): the server answers nothing else until the person
// picks their own, so the administrator does not keep knowing it.
defineProps<{ account: AccountSummary }>();
const emit = defineEmits<{ changed: []; signedOut: [] }>();

// The server's own rule for a new password, generated from the API.
const rule = apiConstraints.UpdateAuthUserPasswordDto.newPassword;
const rulePattern = new RegExp(rule.pattern);

const currentPassword = ref('');
const newPassword = ref('');
const confirmation = ref('');
const errorMessage = ref<string | null>(null);
const isBusy = ref(false);

const problem = computed(() => {
  if (!newPassword.value) return null;
  if (newPassword.value.length < rule.minLength) {
    return `Use at least ${rule.minLength} characters.`;
  }
  if (!rulePattern.test(newPassword.value)) {
    return 'Use at least one letter and one digit.';
  }
  if (newPassword.value === currentPassword.value) {
    return 'Choose a password different from the one you were given.';
  }
  if (confirmation.value && confirmation.value !== newPassword.value) {
    return 'The two new passwords differ.';
  }
  return null;
});

async function change(): Promise<void> {
  if (problem.value || confirmation.value !== newPassword.value) return;
  isBusy.value = true;
  errorMessage.value = null;
  try {
    await window.pakita.account.changePassword(
      currentPassword.value,
      newPassword.value,
    );
    currentPassword.value = '';
    newPassword.value = '';
    confirmation.value = '';
    emit('changed');
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function signOut(): Promise<void> {
  await window.pakita.account.signOut();
  emit('signedOut');
}
</script>

<template>
  <div class="auth">
    <form class="card" @submit.prevent="change">
      <img class="card-mark" :src="pakitaMark" alt="" width="48" height="48" />
      <div class="card-head">
        <h1>Choose your own password</h1>
        <p class="muted">
          {{ account.displayName }}, you signed in with a password your
          administrator gave you. Choose one only you know to continue.
        </p>
      </div>
      <label>
        Password you were given
        <input
          v-model="currentPassword"
          data-testid="change-password-current"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <label>
        New password
        <input
          v-model="newPassword"
          data-testid="change-password-new"
          type="password"
          autocomplete="new-password"
          :maxlength="rule.maxLength"
          required
        />
      </label>
      <label>
        New password again
        <input
          v-model="confirmation"
          data-testid="change-password-confirmation"
          type="password"
          autocomplete="new-password"
          :maxlength="rule.maxLength"
          required
        />
      </label>
      <p v-if="problem" class="muted" role="status">{{ problem }}</p>
      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
      <div class="actions">
        <button
          class="primary"
          type="submit"
          data-testid="change-password-submit"
          :disabled="isBusy || problem !== null"
        >
          {{ isBusy ? 'Saving…' : 'Save password' }}
        </button>
        <button type="button" @click="signOut">Sign out</button>
      </div>
    </form>
  </div>
</template>
