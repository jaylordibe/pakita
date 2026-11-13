<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import type {
  IssuedPassword,
  ManagedAccount,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';
import IssuedSecret from './IssuedSecret.vue';

// The church server's accounts, for its administrator: Pakita has no public
// sign-up, so every account is created here, with a one-time password the
// person replaces at their first sign-in. A forgotten password is replaced
// the same way.

const limits = apiConstraints.CreateUserDto;

const accounts = ref<ManagedAccount[]>([]);
const search = ref('');
const selectedId = ref<string | null>(null);
const isCreating = ref(false);
const isBusy = ref(false);
const errorMessage = ref<string | null>(null);
const issued = ref<IssuedPassword | null>(null);

const blank = () => ({ email: '', username: '', firstName: '', lastName: '' });
const form = reactive(blank());

const visibleAccounts = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return accounts.value;
  return accounts.value.filter((account) =>
    [account.displayName, account.email, account.username ?? '']
      .join(' ')
      .toLowerCase()
      .includes(term),
  );
});

const selected = computed(
  () =>
    accounts.value.find((account) => account.id === selectedId.value) ?? null,
);

async function load(): Promise<void> {
  try {
    accounts.value = await window.pakita.accounts.list();
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

function startNew(): void {
  Object.assign(form, blank());
  selectedId.value = null;
  issued.value = null;
  errorMessage.value = null;
  isCreating.value = true;
}

function open(accountId: string): void {
  selectedId.value = accountId;
  isCreating.value = false;
  issued.value = null;
  errorMessage.value = null;
}

async function create(): Promise<void> {
  errorMessage.value = null;
  isBusy.value = true;
  try {
    issued.value = await window.pakita.accounts.create({
      email: form.email.trim(),
      username: form.username.trim() || null,
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
    });
    isCreating.value = false;
    selectedId.value = issued.value.account.id;
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function resetPassword(): Promise<void> {
  if (!selected.value) return;
  errorMessage.value = null;
  isBusy.value = true;
  try {
    issued.value = await window.pakita.accounts.resetPassword(
      selected.value.id,
    );
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="panel">
    <aside class="panel-list">
      <div class="panel-head">
        <h1>People</h1>
        <button class="sm primary" data-testid="account-new" @click="startNew">
          <AppIcon name="plus" />
          New account
        </button>
      </div>
      <div class="search-field">
        <AppIcon name="search" />
        <input
          v-model="search"
          type="search"
          placeholder="Search people"
          aria-label="Search people"
        />
      </div>
      <ul class="list">
        <li v-for="account in visibleAccounts" :key="account.id">
          <button
            class="list-item"
            :aria-current="account.id === selectedId ? 'true' : undefined"
            :data-testid="`account-${account.email}`"
            @click="open(account.id)"
          >
            <span class="item-title">{{ account.displayName }}</span>
            <span class="item-sub">{{ account.email }}</span>
          </button>
        </li>
        <li v-if="visibleAccounts.length === 0" class="list-empty">
          {{ search ? 'Nobody matches.' : 'No accounts yet.' }}
        </li>
      </ul>
    </aside>

    <main class="panel-content">
      <form v-if="isCreating" class="editor" @submit.prevent="create">
        <div class="page-head">
          <div class="titles">
            <h2>New account</h2>
            <p class="muted">
              Pakita makes a one-time password for you to pass on. The person
              chooses their own when they first sign in.
            </p>
          </div>
          <button
            class="primary"
            type="submit"
            :disabled="isBusy"
            data-testid="account-create"
          >
            <AppIcon name="check" />
            {{ isBusy ? 'Creating…' : 'Create account' }}
          </button>
        </div>
        <div class="fields">
          <label>
            First name
            <input
              v-model="form.firstName"
              data-testid="account-first-name"
              :maxlength="limits.firstName.maxLength"
              required
            />
          </label>
          <label>
            Last name
            <input
              v-model="form.lastName"
              data-testid="account-last-name"
              :maxlength="limits.lastName.maxLength"
              required
            />
          </label>
          <label>
            Email
            <input
              v-model="form.email"
              data-testid="account-email"
              type="email"
              spellcheck="false"
              required
            />
          </label>
          <label>
            Username <span class="faint">(optional)</span>
            <input
              v-model="form.username"
              data-testid="account-username"
              spellcheck="false"
              :minlength="limits.username.minLength"
              :maxlength="limits.username.maxLength"
              :pattern="limits.username.pattern"
              title="Letters, numbers, dot, underscore and dash"
            />
          </label>
        </div>
      </form>

      <template v-else-if="selected">
        <div class="page-head">
          <div class="titles">
            <h2>{{ selected.displayName }}</h2>
            <p>
              {{ selected.email
              }}<template v-if="selected.username">
                · {{ selected.username }}</template
              >
            </p>
          </div>
          <button
            :disabled="isBusy"
            data-testid="account-reset-password"
            @click="resetPassword"
          >
            <AppIcon name="key" />
            {{ isBusy ? 'Resetting…' : 'Reset password' }}
          </button>
        </div>
        <p class="muted">
          <template v-if="!selected.isActive"
            >This account is disabled.
          </template>
          <template v-if="selected.isPasswordChangeRequired">
            Has not yet chosen their own password.
          </template>
          <template v-else-if="selected.isActive">
            Resetting the password signs this person out everywhere and gives
            them a one-time password to replace.
          </template>
        </p>
      </template>

      <div v-else-if="!issued" class="empty">
        <span class="empty-mark"><AppIcon name="people" /></span>
        <p>Choose a person, or create an account for someone new.</p>
      </div>

      <IssuedSecret
        v-if="issued"
        :label="`One-time password for ${issued.account.displayName}`"
        :secret="issued.temporaryPassword"
        :instructions="`Give it to them with their email (${issued.account.email}). They sign in with it, then choose their own password.`"
        @done="issued = null"
      />

      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>
    </main>
  </div>
</template>

<style scoped>
.editor {
  display: grid;
  gap: 1.2rem;
}

.fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: 0.9rem 1.2rem;
}

.fields input {
  width: 100%;
}
</style>
