import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { migrate } from './migrations.js';
export function openDatabase(dataDir: string): DatabaseSync {
  const file = dataDir === ':memory:' ? dataDir : join(dataDir, 'crewbus.sqlite');
  if (dataDir !== ':memory:')
    mkdirSync(dataDir, {
      recursive: true, mode: 0o700
    });
  const db = new DatabaseSync(file);
  try {
    if (dataDir !== ':memory:')
      chmodSync(file, 0o600);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    if (dataDir !== ':memory:')
      db.exec('PRAGMA journal_mode=WAL');
    migrate(db);
    return db;
  }
  catch (e) {
    db.close();
    throw e;
  }
}
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  // Repository operations can join a caller-owned transaction without nested BEGIN.
  if (db.isTransaction)
    return synchronous(fn);
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = synchronous(fn);
    db.exec('COMMIT');
    return result;
  }
  catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
function synchronous<T>(fn: () => T): T {
  const result = fn();
  if (result !== null && (typeof result === 'object' || typeof result === 'function') && 'then' in result)
    throw new Error('SQLite transaction must be synchronous');
  return result;
}
