<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';

import { apiConstraints } from '../../../shared/api/constraints';
import { roleLabel } from '../../../shared/role-labels';
import type {
  InvitableRole,
  InvitationSummary,
  IssuedInvitation,
  IssuedPassword,
} from '../../../shared/ipc-contract';
import { messageOf } from '../errors';
import AppIcon from './AppIcon.vue';
import IssuedSecret from './IssuedSecret.vue';

// Bringing people into the open church. Someone who already has an account
// is invited: the invitation names it (by email or username) and gives a
// one-time code to pass on; only that account can use it, so a code that goes
// astray opens nothing. Someone new gets an account here, from an owner or
// administrator, with a one-time password they replace at first sign-in.

const identifierLimits = apiConstraints.CreateWorkspaceInvitationDto.identifier;
const accountLimits = apiConstraints.CreateUserDto;

/** Only the church's owner and administrators may create accounts. */
const canCreateAccounts = ref(false);
const newPerson = reactive({
  firstName: '',
  lastName: '',
  email: '',
  roleId: null as string | null,
});
const issuedPassword = ref<IssuedPassword | null>(null);

const roles = ref<InvitableRole[]>([]);
const invitations = ref<InvitationSummary[]>([]);
const identifier = ref('');
const roleId = ref<string | null>(null);
const isBusy = ref(false);
const errorMessage = ref<string | null>(null);
const issued = ref<IssuedInvitation | null>(null);

async function load(): Promise<void> {
  try {
    const [loadedRoles, loadedInvitations] = await Promise.all([
      window.pakita.invitations.listRoles(),
      window.pakita.invitations.list(),
    ]);
    roles.value = loadedRoles;
    invitations.value = loadedInvitations;
    // The least privileged role is the safe default: the list comes in rank
    // order, lowest first (`listInvitableRoles`).
    roleId.value ??= loadedRoles[0]?.id ?? null;
    newPerson.roleId ??= roleId.value;
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

async function createAccount(): Promise<void> {
  if (!newPerson.roleId) return;
  errorMessage.value = null;
  isBusy.value = true;
  try {
    issuedPassword.value = await window.pakita.members.createAccount({
      email: newPerson.email.trim(),
      username: null,
      firstName: newPerson.firstName.trim(),
      lastName: newPerson.lastName.trim(),
      roleId: newPerson.roleId,
    });
    Object.assign(newPerson, { firstName: '', lastName: '', email: '' });
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

onMounted(async () => {
  await load();
  canCreateAccounts.value = (
    await window.pakita.account.getCapabilities()
  ).canCreateMemberAccounts;
});
</script>

<template>
  <div class="panel single">
    <main class="panel-content">
      <div class="page-head">
        <div class="titles">
          <h2>Invite people</h2>
          <p class="muted">
            Invite someone who already has an account on this server.
            <template v-if="canCreateAccounts"
              >For someone new, create their account below.</template
            >
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

      <section v-if="canCreateAccounts" aria-labelledby="new-person-heading">
        <h3 id="new-person-heading">Create an account</h3>
        <p class="muted">
          For someone who has no account yet. Pakita makes a one-time password
          for you to pass on; they choose their own when they first sign in, and
          they are already in this church.
        </p>
        <form class="invite new-person" @submit.prevent="createAccount">
          <label class="grow">
            First name
            <input
              v-model="newPerson.firstName"
              data-testid="member-first-name"
              :maxlength="accountLimits.firstName.maxLength"
              required
            />
          </label>
          <label class="grow">
            Last name
            <input
              v-model="newPerson.lastName"
              data-testid="member-last-name"
              :maxlength="accountLimits.lastName.maxLength"
              required
            />
          </label>
          <label class="grow">
            Email
            <input
              v-model="newPerson.email"
              data-testid="member-email"
              type="email"
              spellcheck="false"
              required
            />
          </label>
          <label>
            Role
            <select
              v-model="newPerson.roleId"
              data-testid="member-role"
              required
            >
              <option v-for="role in roles" :key="role.id" :value="role.id">
                {{ roleLabel(role.name) }}
              </option>
            </select>
          </label>
          <button
            class="primary"
            type="submit"
            :disabled="isBusy || !newPerson.roleId"
            data-testid="member-create"
          >
            <AppIcon name="plus" />
            Create account
          </button>
        </form>
        <IssuedSecret
          v-if="issuedPassword"
          :label="`One-time password for ${issuedPassword.account.displayName}`"
          :secret="issuedPassword.temporaryPassword"
          :instructions="`Give it to them with their email (${issuedPassword.account.email}). They sign in with it, choose their own password, and find this church open.`"
          @done="issuedPassword = null"
        />
      </section>

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
