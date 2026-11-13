<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import type {
  InvitableRole,
  InvitationSummary,
  IssuedInvitation,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';
import IssuedSecret from './IssuedSecret.vue';

// Inviting people into the open church. An invitation names an existing
// account (by email or username) and gives a one-time code to pass on; only
// that account can use it, so a code that goes astray opens nothing.

const identifierLimits = apiConstraints.CreateWorkspaceInvitationDto.identifier;

const roles = ref<InvitableRole[]>([]);
const invitations = ref<InvitationSummary[]>([]);
const identifier = ref('');
const roleId = ref<string | null>(null);
const isBusy = ref(false);
const errorMessage = ref<string | null>(null);
const issued = ref<IssuedInvitation | null>(null);

const roleLabel = (name: string) =>
  name.replace(/^workspace_/, '').replace(/_/g, ' ');

async function load(): Promise<void> {
  try {
    const [loadedRoles, loadedInvitations] = await Promise.all([
      window.pakita.invitations.listRoles(),
      window.pakita.invitations.list(),
    ]);
    roles.value = loadedRoles;
    invitations.value = loadedInvitations;
    // The least privileged role is the safe default.
    roleId.value ??= loadedRoles[loadedRoles.length - 1]?.id ?? null;
  } catch (error) {
    errorMessage.value = messageOf(error);
  }
}

async function invite(): Promise<void> {
  if (!roleId.value || !identifier.value.trim()) return;
  errorMessage.value = null;
  isBusy.value = true;
  try {
    issued.value = await window.pakita.invitations.create(
      identifier.value.trim(),
      roleId.value,
    );
    identifier.value = '';
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function reissue(invitationId: string): Promise<void> {
  errorMessage.value = null;
  isBusy.value = true;
  try {
    issued.value = await window.pakita.invitations.reissue(invitationId);
    await load();
  } catch (error) {
    errorMessage.value = messageOf(error);
  } finally {
    isBusy.value = false;
  }
}

async function revoke(invitationId: string): Promise<void> {
  errorMessage.value = null;
  isBusy.value = true;
  try {
    await window.pakita.invitations.revoke(invitationId);
    if (issued.value?.invitation.id === invitationId) issued.value = null;
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
  <div class="panel single">
    <main class="panel-content">
      <div class="page-head">
        <div class="titles">
          <h2>Invite people</h2>
          <p class="muted">
            Invite someone who already has an account on this server. Your
            server's administrator creates accounts.
          </p>
        </div>
      </div>

      <form class="invite" @submit.prevent="invite">
        <label class="grow">
          Email or username
          <input
            v-model="identifier"
            data-testid="invite-identifier"
            spellcheck="false"
            autocomplete="off"
            :minlength="identifierLimits.minLength"
            :maxlength="identifierLimits.maxLength"
            required
          />
        </label>
        <label>
          Role
          <select v-model="roleId" data-testid="invite-role" required>
            <option v-for="role in roles" :key="role.id" :value="role.id">
              {{ roleLabel(role.name) }}
            </option>
          </select>
        </label>
        <button
          class="primary"
          type="submit"
          :disabled="isBusy || !roleId"
          data-testid="invite-create"
        >
          <AppIcon name="plus" />
          Invite
        </button>
      </form>

      <IssuedSecret
        v-if="issued"
        :label="`Invitation code for ${issued.invitation.invitee}`"
        :secret="issued.code"
        :instructions="`Give it to them: signed in to Pakita, they choose “Change church” and enter it. It works only for their account, and expires ${new Date(issued.invitation.expiresAt).toLocaleDateString()}.`"
        @done="issued = null"
      />

      <p v-if="errorMessage" class="error" role="alert">
        <AppIcon name="alert" />
        <span>{{ errorMessage }}</span>
      </p>

      <section aria-labelledby="pending-heading">
        <h3 id="pending-heading">Waiting to join</h3>
        <ul class="pending">
          <li
            v-for="invitation in invitations"
            :key="invitation.id"
            :data-testid="`invitation-${invitation.id}`"
          >
            <span class="grow">
              <span class="item-title">{{ invitation.invitee }}</span>
              <span class="item-sub">
                {{ roleLabel(invitation.roleName) }} · expires
                {{ new Date(invitation.expiresAt).toLocaleDateString() }}
              </span>
            </span>
            <button
              class="sm"
              :disabled="isBusy"
              title="A new code; the old one stops working"
              @click="reissue(invitation.id)"
            >
              <AppIcon name="sync" />
              New code
            </button>
            <button
              class="sm ghost danger"
              :disabled="isBusy"
              @click="revoke(invitation.id)"
            >
              <AppIcon name="x" />
              Withdraw
            </button>
          </li>
          <li v-if="invitations.length === 0" class="list-empty">
            No invitations waiting.
          </li>
        </ul>
      </section>
    </main>
  </div>
</template>

<style scoped>
.single {
  grid-template-columns: 1fr;
}

.panel-content {
  display: grid;
  align-content: start;
  gap: 1.2rem;
}

.invite {
  display: flex;
  align-items: flex-end;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.invite input {
  width: 100%;
}

.pending {
  display: grid;
  gap: 0.4rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
}

.pending li {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.55rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.pending .grow {
  display: grid;
  min-width: 0;
}
</style>
