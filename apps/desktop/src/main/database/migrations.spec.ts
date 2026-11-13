import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

import { type MigratableDatabase, migrateDatabase } from './migrations';

// A stand-in for a better-sqlite3 connection: records executed SQL and keeps
// `user_version`, and rolls a failed transaction back the way SQLite does.
function createFakeDatabase(initialVersion = 0) {
  const state = { userVersion: initialVersion, executed: [] as string[] };
  const database: MigratableDatabase = {
    pragma(source) {
      const assignment = /^user_version = (\d+)$/.exec(source);
      if (assignment) {
        state.userVersion = Number(assignment[1]);
        return undefined;
      }
      return state.userVersion;
    },
    exec(source) {
      if (source === 'FAIL') {
        throw new Error('migration failed');
      }
      state.executed.push(source);
      return undefined;
    },
    transaction(run) {
      return (...runArguments) => {
        const snapshot = {
          userVersion: state.userVersion,
          executed: [...state.executed],
        };
        try {
          run(...runArguments);
        } catch (error) {
          state.userVersion = snapshot.userVersion;
          state.executed = snapshot.executed;
          throw error;
        }
      };
    },
  };
  return { database, state };
}

describe('migrateDatabase', () => {
  it('applies every migration in order to a new database', () => {
    const { database, state } = createFakeDatabase();
    expect(migrateDatabase(database, ['A', 'B', 'C'])).toBe(3);
    expect(state.executed).toEqual(['A', 'B', 'C']);
    expect(state.userVersion).toBe(3);
  });

  it('applies only the migrations a database has not run', () => {
    const { database, state } = createFakeDatabase(2);
    migrateDatabase(database, ['A', 'B', 'C']);
    expect(state.executed).toEqual(['C']);
    expect(state.userVersion).toBe(3);
  });

  it('does nothing to an up-to-date database', () => {
    const { database, state } = createFakeDatabase(2);
    migrateDatabase(database, ['A', 'B']);
    expect(state.executed).toEqual([]);
  });

  it('leaves the version at the last migration that succeeded', () => {
    const { database, state } = createFakeDatabase();
    expect(() => migrateDatabase(database, ['A', 'FAIL', 'C'])).toThrow(
      'migration failed',
    );
    expect(state.executed).toEqual(['A']);
    expect(state.userVersion).toBe(1);
  });

  it('refuses a database written by a newer app version', () => {
    const { database, state } = createFakeDatabase(5);
    expect(() => migrateDatabase(database, ['A'])).toThrow('newer Pakita');
    expect(state.executed).toEqual([]);
  });
});

describe('migrateDatabase against SQLite', () => {
  it('runs migrations in transactions and records the schema version', () => {
    const database = new Database(':memory:');
    migrateDatabase(database, [
      'CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT',
      'CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT',
    ]);
    expect(database.pragma('user_version', { simple: true })).toBe(2);
    const tables = database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      )
      .pluck()
      .all();
    expect(tables).toEqual(['first', 'second']);
  });

  it('rolls a failing migration back completely', () => {
    const database = new Database(':memory:');
    expect(() =>
      migrateDatabase(database, [
        'CREATE TABLE first (id INTEGER PRIMARY KEY) STRICT',
        'CREATE TABLE second (id INTEGER PRIMARY KEY) STRICT; NOT VALID SQL',
      ]),
    ).toThrow();
    expect(database.pragma('user_version', { simple: true })).toBe(1);
    const tables = database
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .pluck()
      .all();
    expect(tables).toEqual(['first']);
  });
});
