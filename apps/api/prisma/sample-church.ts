import '../src/config/app-timezone';
import 'dotenv/config';
import { expand } from 'dotenv-expand';
import * as dotenv from 'dotenv';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { BibleBookCode } from '../src/common/constants/bible-books';
import { PlaylistItemKind } from '../src/common/enums/playlist-item-kind.enum';
import { RoleScope } from '../src/common/enums/role-scope.enum';
import { SeededRoleName } from '../src/common/enums/seeded-role-name.enum';
import { SongSectionKind } from '../src/common/enums/song-section-kind.enum';
import {
  ThemeBackground,
  ThemeFont,
  ThemeTextAlign,
} from '../src/common/enums/theme.enum';
import type { CreateBibleTranslationDto } from '../src/modules/bible/dto/create-bible-translation.dto';
import type { PutBibleChapterDto } from '../src/modules/bible/dto/put-bible-chapter.dto';
import type { CreatePlaylistDto } from '../src/modules/playlists/dto/create-playlist.dto';
import type { CreateSongDto } from '../src/modules/songs/dto/create-song.dto';
import type { CreateThemeDto } from '../src/modules/themes/dto/create-theme.dto';
import type { CreateWorkspaceDto } from '../src/modules/workspaces/dto/create-workspace.dto';
import { assertAccountPassword, upsertSeedUser } from './seed-user';

// ─────────────────────────────────────────────────────────────────────────
// A sample church for trying Pakita end to end on a developer's machine.
//
//   pnpm --filter @pakita/api prisma:seed     (roles and the platform admin)
//   pnpm --filter @pakita/api start:dev       (the API must be running)
//   pnpm --filter @pakita/api seed:sample
//
// Two levels of account, kept apart as they are in production:
// - The church's own people, one per church role (owner, admin, manager,
//   staff), all members of Grace Community Church and of nothing else. The
//   owner creates the church and its library.
// - The platform admin (SEED_ADMIN_*), installation staff who belong to no
//   church. It only publishes the sample Bible passages, because a Bible is
//   shared by every church on the server.
//
// The church's people are created in the database the way `prisma:seed`
// creates its accounts (an account is not synchronised content). Everything
// else goes through the running API: content must be stamped with the
// church's sync version, or the desktop never receives it. Every step looks
// for what it would create first, so the script can be re-run.
//
// Development only. It is NOT part of `prisma:seed`, which a church server
// runs (deploy/create-admin.sh), and it refuses NODE_ENV=production.
// Lyrics are public-domain hymns; the passages are the World English Bible
// (public domain).
// ─────────────────────────────────────────────────────────────────────────

expand(dotenv.config({ override: false }));

const CHURCH: CreateWorkspaceDto = {
  name: 'Grace Community Church',
  slug: 'grace-community',
  description: 'Sample church for local development.',
};

/** Every sample person's password: fixture data for a local server only. */
const SAMPLE_PASSWORD = 'grace-church-1';

interface ChurchPerson {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly role: SeededRoleName;
}

const OWNER: ChurchPerson = {
  email: 'owner@gracechurch.example.com',
  firstName: 'Olivia',
  lastName: 'Owner',
  role: SeededRoleName.WORKSPACE_OWNER,
};

/** Added by the owner, each with their church role. */
const MEMBERS: readonly ChurchPerson[] = [
  {
    email: 'admin@gracechurch.example.com',
    firstName: 'Adam',
    lastName: 'Admin',
    role: SeededRoleName.WORKSPACE_ADMIN,
  },
  {
    email: 'manager@gracechurch.example.com',
    firstName: 'Maria',
    lastName: 'Manager',
    role: SeededRoleName.WORKSPACE_MANAGER,
  },
  {
    email: 'staff@gracechurch.example.com',
    firstName: 'Sam',
    lastName: 'Staff',
    role: SeededRoleName.WORKSPACE_STAFF,
  },
];

const TRANSLATION: CreateBibleTranslationDto = {
  code: 'WEBSAMPLE',
  name: 'World English Bible (sample passages)',
  languageCode: 'en',
  licence:
    'Public domain. A handful of passages for local development, not a complete Bible.',
  attribution: 'World English Bible (public domain)',
  sourceUrl: 'https://ebible.org/web/',
};

interface SampleChapter extends PutBibleChapterDto {
  readonly bookCode: BibleBookCode;
  readonly chapter: number;
}

const CHAPTERS: readonly SampleChapter[] = [
  {
    bookCode: 'PSA',
    chapter: 23,
    bookName: 'Psalms',
    verses: [
      { number: 1, text: 'Yahweh is my shepherd: I shall lack nothing.' },
      {
        number: 2,
        text: 'He makes me lie down in green pastures. He leads me beside still waters.',
      },
      {
        number: 3,
        text: 'He restores my soul. He guides me in the paths of righteousness for his name’s sake.',
      },
      {
        number: 4,
        text: 'Even though I walk through the valley of the shadow of death, I will fear no evil, for you are with me. Your rod and your staff, they comfort me.',
      },
      {
        number: 5,
        text: 'You prepare a table before me in the presence of my enemies. You anoint my head with oil. My cup runs over.',
      },
      {
        number: 6,
        text: 'Surely goodness and loving kindness shall follow me all the days of my life, and I will dwell in Yahweh’s house forever.',
      },
    ],
  },
  {
    bookCode: 'JHN',
    chapter: 3,
    bookName: 'John',
    verses: [
      {
        number: 16,
        text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.',
      },
      {
        number: 17,
        text: 'For God didn’t send his Son into the world to judge the world, but that the world should be saved through him.',
      },
    ],
  },
  {
    bookCode: 'ROM',
    chapter: 8,
    bookName: 'Romans',
    verses: [
      {
        number: 28,
        text: 'We know that all things work together for good for those who love God, for those who are called according to his purpose.',
      },
    ],
  },
  {
    bookCode: 'PHP',
    chapter: 4,
    bookName: 'Philippians',
    verses: [
      {
        number: 6,
        text: 'In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.',
      },
      {
        number: 7,
        text: 'And the peace of God, which surpasses all understanding, will guard your hearts and your thoughts in Christ Jesus.',
      },
    ],
  },
];

const { VERSE, CHORUS, CUSTOM } = SongSectionKind;
const verse = (number: number, lyrics: string) => ({
  key: `v${number}`,
  kind: VERSE,
  label: `Verse ${number}`,
  lyrics,
});

const SONGS: readonly CreateSongDto[] = [
  {
    title: 'Amazing Grace',
    artist: 'John Newton',
    sections: [
      verse(
        1,
        'Amazing grace! How sweet the sound\nThat saved a wretch like me!\n\nI once was lost, but now am found,\nWas blind, but now I see.',
      ),
      verse(
        2,
        '’Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\n\nHow precious did that grace appear\nThe hour I first believed.',
      ),
      verse(
        3,
        'Through many dangers, toils and snares,\nI have already come;\n\n’Tis grace hath brought me safe thus far,\nAnd grace will lead me home.',
      ),
      verse(
        4,
        'When we’ve been there ten thousand years,\nBright shining as the sun,\n\nWe’ve no less days to sing God’s praise\nThan when we’d first begun.',
      ),
    ],
    arrangements: [
      {
        name: 'Default',
        isDefault: true,
        sectionKeys: ['v1', 'v2', 'v3', 'v4'],
      },
      { name: 'Short', isDefault: false, sectionKeys: ['v1', 'v4'] },
    ],
  },
  {
    title: 'It Is Well with My Soul',
    artist: 'Horatio Spafford',
    sections: [
      verse(
        1,
        'When peace like a river attendeth my way,\nWhen sorrows like sea billows roll;\n\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.',
      ),
      {
        key: 'c',
        kind: CHORUS,
        label: 'Chorus',
        lyrics:
          'It is well with my soul,\nIt is well, it is well with my soul.',
      },
      verse(
        2,
        'Though Satan should buffet, though trials should come,\nLet this blest assurance control,\n\nThat Christ has regarded my helpless estate,\nAnd hath shed His own blood for my soul.',
      ),
      verse(
        3,
        'My sin, oh, the bliss of this glorious thought!\nMy sin, not in part but the whole,\n\nIs nailed to the cross, and I bear it no more,\nPraise the Lord, praise the Lord, O my soul!',
      ),
      verse(
        4,
        'And Lord, haste the day when my faith shall be sight,\nThe clouds be rolled back as a scroll;\n\nThe trump shall resound, and the Lord shall descend,\nEven so, it is well with my soul.',
      ),
    ],
    arrangements: [
      {
        name: 'Default',
        isDefault: true,
        sectionKeys: ['v1', 'c', 'v2', 'c', 'v3', 'c', 'v4', 'c'],
      },
      { name: 'Short', isDefault: false, sectionKeys: ['v1', 'c', 'v4', 'c'] },
    ],
  },
  {
    title: 'Holy, Holy, Holy',
    artist: 'Reginald Heber',
    sections: [
      verse(
        1,
        'Holy, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\n\nHoly, holy, holy! Merciful and mighty!\nGod in three Persons, blessed Trinity!',
      ),
      verse(
        2,
        'Holy, holy, holy! All the saints adore Thee,\nCasting down their golden crowns around the glassy sea;\n\nCherubim and seraphim falling down before Thee,\nWhich wert, and art, and evermore shalt be.',
      ),
      verse(
        3,
        'Holy, holy, holy! Though the darkness hide Thee,\nThough the eye of sinful man Thy glory may not see;\n\nOnly Thou art holy; there is none beside Thee,\nPerfect in power, in love, and purity.',
      ),
      verse(
        4,
        'Holy, holy, holy! Lord God Almighty!\nAll Thy works shall praise Thy name, in earth, and sky, and sea;\n\nHoly, holy, holy! Merciful and mighty!\nGod in three Persons, blessed Trinity!',
      ),
    ],
  },
  {
    title: 'Be Thou My Vision',
    artist: 'Traditional Irish, tr. Mary Byrne',
    sections: [
      verse(
        1,
        'Be Thou my Vision, O Lord of my heart;\nNaught be all else to me, save that Thou art.\n\nThou my best Thought, by day or by night,\nWaking or sleeping, Thy presence my light.',
      ),
      verse(
        2,
        'Be Thou my Wisdom, and Thou my true Word;\nI ever with Thee and Thou with me, Lord;\n\nThou my great Father, I Thy true son;\nThou in me dwelling, and I with Thee one.',
      ),
      verse(
        3,
        'Riches I heed not, nor man’s empty praise,\nThou mine Inheritance, now and always:\n\nThou and Thou only, first in my heart,\nHigh King of Heaven, my Treasure Thou art.',
      ),
      verse(
        4,
        'High King of Heaven, my victory won,\nMay I reach Heaven’s joys, O bright Heaven’s Sun!\n\nHeart of my own heart, whatever befall,\nStill be my Vision, O Ruler of all.',
      ),
    ],
  },
  {
    title: 'Doxology',
    artist: 'Thomas Ken',
    sections: [
      {
        key: 'doxology',
        kind: CUSTOM,
        label: 'Doxology',
        lyrics:
          'Praise God, from whom all blessings flow;\nPraise Him, all creatures here below;\n\nPraise Him above, ye heavenly host;\nPraise Father, Son, and Holy Ghost. Amen.',
      },
    ],
  },
];

const THEMES: readonly CreateThemeDto[] = [
  {
    name: 'Evening',
    background: ThemeBackground.DUSK,
    backgroundColor: '#000000',
    textColor: '#ffffff',
    font: ThemeFont.SERIF,
    textScale: 100,
    textAlign: ThemeTextAlign.CENTER,
    isDefault: true,
  },
  {
    name: 'Clean',
    background: ThemeBackground.SOLID,
    backgroundColor: '#000000',
    textColor: '#ffffff',
    font: ThemeFont.SANS,
    textScale: 110,
    textAlign: ThemeTextAlign.CENTER,
  },
];

const PLAYLIST_NAME = 'Sunday Service';

// ── HTTP ─────────────────────────────────────────────────────────────────

interface Page<Row> {
  readonly data: Row[];
}
interface Named {
  readonly id: string;
  readonly name: string;
}

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`${key} is not set (see .env.example).`);
  }
  return value;
}

function apiOrigin(): string {
  return (
    process.env.SAMPLE_API_URL ??
    `http://localhost:${process.env.PORT ?? '3000'}`
  ).replace(/\/$/, '');
}

class Api {
  private token: string | null = null;

  constructor(private readonly origin: string) {}

  async signIn(identifier: string, password: string): Promise<void> {
    const login = await this.send<{ accessToken: string }>(
      'POST',
      '/api/auth/login',
      { identifier, password },
    );
    this.token = login.accessToken;
  }

  async send<Result>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<Result> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `Cannot reach the API at ${this.origin}. Start it first: pnpm --filter @pakita/api start:dev`,
      );
    }
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`${method} ${path} → ${response.status}: ${text}`);
    }
    return (text ? JSON.parse(text) : undefined) as Result;
  }

  list<Row>(path: string): Promise<Row[]> {
    const separator = path.includes('?') ? '&' : '?';
    return this.send<Page<Row>>('GET', `${path}${separator}perPage=100`).then(
      (page) => page.data,
    );
  }
}

/** The coming Sunday (today, if it is Sunday), as YYYY-MM-DD. */
function nextSunday(): string {
  const date = new Date();
  date.setDate(date.getDate() + ((7 - date.getDay()) % 7));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ── Steps ────────────────────────────────────────────────────────────────

async function ensureChurch(api: Api): Promise<string> {
  const existing = (
    await api.list<Named & { slug: string }>('/api/workspaces')
  ).find((workspace) => workspace.slug === CHURCH.slug);
  if (existing) {
    console.log(`[sample] church: ${existing.name} already exists`);
    return existing.id;
  }
  const created = await api.send<Named>('POST', '/api/workspaces', CHURCH);
  console.log(`[sample] church: created ${created.name}`);
  return created.id;
}

/** The church's people as accounts: verified, with no platform role. */
async function ensurePeople(): Promise<void> {
  assertAccountPassword(SAMPLE_PASSWORD, 'SAMPLE_PASSWORD');
  const adapter = new PrismaPg({
    connectionString: requireEnv('DATABASE_URL'),
  });
  const prisma = new PrismaClient({ adapter });
  try {
    for (const person of [OWNER, ...MEMBERS]) {
      await upsertSeedUser(prisma, {
        label: `sample ${person.role}`,
        email: person.email,
        password: SAMPLE_PASSWORD,
        firstName: person.firstName,
        lastName: person.lastName,
        platformRoles: [],
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function ensureMembers(api: Api, churchId: string): Promise<void> {
  const path = `/api/workspaces/${churchId}/memberships`;
  const memberEmails = new Set(
    (await api.list<{ user: { email: string } }>(path)).map((member) =>
      member.user.email.toLowerCase(),
    ),
  );
  const roles = await api.list<{ id: string; name: SeededRoleName }>(
    `/api/roles?scope=${RoleScope.WORKSPACE}`,
  );
  let added = 0;
  for (const person of MEMBERS) {
    if (memberEmails.has(person.email)) continue;
    const role = roles.find((candidate) => candidate.name === person.role);
    if (!role) throw new Error(`The ${person.role} role is missing.`);
    await api.send('POST', path, { email: person.email, roleId: role.id });
    added += 1;
  }
  console.log(
    `[sample] members: ${added} added, ${MEMBERS.length - added} already there`,
  );
}

async function ensureSongs(
  api: Api,
  churchId: string,
): Promise<Map<string, string>> {
  const path = `/api/workspaces/${churchId}/songs`;
  const ids = new Map(
    (await api.list<{ id: string; title: string }>(path)).map((song) => [
      song.title,
      song.id,
    ]),
  );
  let created = 0;
  for (const song of SONGS) {
    if (ids.has(song.title)) continue;
    const saved = await api.send<{ id: string }>('POST', path, song);
    ids.set(song.title, saved.id);
    created += 1;
  }
  console.log(
    `[sample] songs: ${created} created, ${SONGS.length - created} already there`,
  );
  return ids;
}

async function ensureThemes(
  api: Api,
  churchId: string,
): Promise<Map<string, string>> {
  const path = `/api/workspaces/${churchId}/themes`;
  const ids = new Map(
    (await api.list<Named>(path)).map((theme) => [theme.name, theme.id]),
  );
  let created = 0;
  for (const theme of THEMES) {
    if (ids.has(theme.name)) continue;
    const saved = await api.send<Named>('POST', path, theme);
    ids.set(theme.name, saved.id);
    created += 1;
  }
  console.log(
    `[sample] themes: ${created} created, ${THEMES.length - created} already there`,
  );
  return ids;
}

async function ensureTranslation(api: Api): Promise<string> {
  const existing = (
    await api.send<Array<{ id: string; code: string; isPublished: boolean }>>(
      'GET',
      '/api/bible-translations',
    )
  ).find((translation) => translation.code === TRANSLATION.code);
  if (existing?.isPublished) {
    console.log(`[sample] bible: ${TRANSLATION.code} already published`);
    return existing.id;
  }
  // An unpublished draft is what an interrupted run leaves: replace it.
  if (existing) {
    await api.send('DELETE', `/api/bible-translations/${existing.id}`);
  }
  const draft = await api.send<{ id: string }>(
    'POST',
    '/api/bible-translations',
    TRANSLATION,
  );
  for (const { bookCode, chapter, ...content } of CHAPTERS) {
    await api.send(
      'PUT',
      `/api/bible-translations/${draft.id}/books/${bookCode}/chapters/${chapter}`,
      content,
    );
  }
  await api.send('POST', `/api/bible-translations/${draft.id}/publish`);
  console.log(
    `[sample] bible: published ${TRANSLATION.code} (${CHAPTERS.length} passages)`,
  );
  return draft.id;
}

async function ensurePlaylist(
  api: Api,
  churchId: string,
  songs: Map<string, string>,
  themes: Map<string, string>,
  translationId: string,
): Promise<void> {
  const path = `/api/workspaces/${churchId}/playlists`;
  const playlists = await api.list<Named>(path);
  if (playlists.some((playlist) => playlist.name === PLAYLIST_NAME)) {
    console.log(`[sample] playlist: ${PLAYLIST_NAME} already exists`);
    return;
  }
  const song = (title: string, arrangementName?: string) => ({
    kind: PlaylistItemKind.SONG,
    songId: songs.get(title)!,
    ...(arrangementName ? { arrangementName } : {}),
  });
  const passage = (
    bookCode: BibleBookCode,
    chapter: number,
    startVerse: number,
    endVerse: number,
  ) => ({
    kind: PlaylistItemKind.PASSAGE,
    bibleTranslationId: translationId,
    bookCode,
    startChapter: chapter,
    startVerse,
    endChapter: chapter,
    endVerse,
  });
  const playlist: CreatePlaylistDto = {
    name: PLAYLIST_NAME,
    serviceDate: nextSunday(),
    themeId: themes.get('Evening') ?? null,
    items: [
      song('Holy, Holy, Holy'),
      passage('PSA', 23, 1, 6),
      song('Amazing Grace'),
      song('It Is Well with My Soul', 'Short'),
      passage('JHN', 3, 16, 17),
      song('Be Thou My Vision'),
      song('Doxology'),
    ],
  };
  await api.send('POST', path, playlist);
  console.log(
    `[sample] playlist: created ${PLAYLIST_NAME} for ${playlist.serviceDate}`,
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Refusing to add sample content with NODE_ENV=production. It is for local development only.',
    );
  }
  await ensurePeople();

  // The church and its library, as its owner.
  const owner = new Api(apiOrigin());
  await owner.signIn(OWNER.email, SAMPLE_PASSWORD);
  console.log(`[sample] signed in to ${apiOrigin()} as ${OWNER.email}`);
  const churchId = await ensureChurch(owner);
  await ensureMembers(owner, churchId);
  const songs = await ensureSongs(owner, churchId);
  const themes = await ensureThemes(owner, churchId);

  // The Bible is the installation's, so the platform admin publishes it.
  const platformAdmin = new Api(apiOrigin());
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');
  await platformAdmin.signIn(adminEmail, requireEnv('SEED_ADMIN_PASSWORD'));
  console.log(`[sample] signed in as ${adminEmail} (platform admin)`);
  const translationId = await ensureTranslation(platformAdmin);

  await ensurePlaylist(owner, churchId, songs, themes, translationId);
  console.log('[sample] done');
}

main().catch((error: unknown) => {
  console.error(
    '[sample] failed:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
