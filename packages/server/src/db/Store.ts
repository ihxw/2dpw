import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import {
  CLASSES,
  DEFAULT_MANIFEST,
  Dir,
  HAIR_COLORS,
  getHeadStylesForBase,
  isValidClassGender,
  type CharacterSummary,
  type ClassId,
  type Gender,
  type InventoryItem,
  type Race,
} from '@2dpw/shared';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const USERNAME_RE = /^[a-zA-Z0-9_\u4e00-\u9fa5]{3,18}$/;

const CLASS_BASE_STATS: Record<ClassId, { hp: number; mp: number }> = {
  blademaster: { hp: 130, mp: 80 },
  wizard: { hp: 95, mp: 140 },
  archer: { hp: 110, mp: 90 },
  cleric: { hp: 95, mp: 145 },
  barbarian: { hp: 160, mp: 60 },
  venomancer: { hp: 105, mp: 120 },
};

function createStarterBag(): InventoryItem[] {
  return [
    { slot: 0, itemId: 'potion_hp_s', name: '止血草（小）', count: 5, desc: '恢复 50 生命' },
    { slot: 1, itemId: 'potion_mp_s', name: '回灵散（小）', count: 5, desc: '恢复 50 真气' },
    { slot: 2, itemId: 'scroll_exp', name: '修真秘卷', count: 3, desc: '升 1 级并 +100 经验' },
    { slot: 3, itemId: 'coin_pouch', name: '新手钱袋', count: 1, desc: '打开获得 200 金币' },
  ];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, hexHash] = parts;
  if (!salt || !hexHash) return false;
  const expected = Buffer.from(hexHash, 'hex');
  const derived = scryptSync(password, salt, 64);
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function parseBagJson(raw: unknown): InventoryItem[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as InventoryItem[]) : [];
  } catch {
    return [];
  }
}

function rowToCharacter(row: Record<string, unknown>): CharacterSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    race: String(row.race) as Race,
    classId: String(row.class_id) as ClassId,
    gender: String(row.gender) as Gender,
    presetId: String(row.preset_id),
    headStyle: String(row.head_style),
    hairColor: String(row.hair_color),
    level: Number(row.level),
    exp: Number(row.exp),
    hp: Number(row.hp),
    maxHp: Number(row.max_hp),
    mp: Number(row.mp),
    maxMp: Number(row.max_mp),
    gold: Number(row.gold),
    mapId: String(row.map_id),
    x: Number(row.x),
    y: Number(row.y),
    dir: Number(row.dir) as Dir,
    bag: parseBagJson(row.bag_json),
  };
}

export type AuthResult =
  | {
      ok: true;
      accountId: string;
      username: string;
      token: string;
      characters: CharacterSummary[];
    }
  | { ok: false; message: string };

export type CreateCharacterResult =
  { ok: true; character: CharacterSummary } | { ok: false; message: string };

/**
 * SQLite persistence store (via built-in `node:sqlite`) managing user accounts,
 * session tokens, and character creation/state snapshots.
 */
export class Store {
  private readonly db: SqliteDatabase;

  constructor(
    dbPath = process.env.DB_PATH ||
      path.resolve(import.meta.dirname, '../../../../data/2dpw.sqlite'),
  ) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema(dbPath === ':memory:');
  }

  private initSchema(isMemory: boolean): void {
    if (!isMemory) {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        name TEXT UNIQUE NOT NULL,
        race TEXT NOT NULL,
        class_id TEXT NOT NULL,
        gender TEXT NOT NULL,
        preset_id TEXT NOT NULL,
        head_style TEXT NOT NULL,
        hair_color TEXT NOT NULL,
        level INTEGER NOT NULL,
        exp INTEGER NOT NULL,
        hp INTEGER NOT NULL,
        max_hp INTEGER NOT NULL,
        mp INTEGER NOT NULL,
        max_mp INTEGER NOT NULL,
        gold INTEGER NOT NULL,
        map_id TEXT NOT NULL,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        dir INTEGER NOT NULL,
        bag_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  /** Register a new account, hash its password with scrypt, and issue a session token. */
  register(rawUsername: string, password: string): AuthResult {
    const username = rawUsername.trim();
    if (!USERNAME_RE.test(username)) {
      return { ok: false, message: '账号需为 3~18 位字母、数字、下划线或中文' };
    }
    if (password.length < 4) {
      return { ok: false, message: '密码长度至少为 4 位' };
    }

    const existing = this.db.prepare('SELECT id FROM accounts WHERE username = ?').get(username) as
      Record<string, unknown> | undefined;
    if (existing) {
      return { ok: false, message: '该账号已存在' };
    }

    const accountId = randomUUID();
    const now = Date.now();
    this.db
      .prepare('INSERT INTO accounts (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(accountId, username, hashPassword(password), now);

    const token = this.issueSession(accountId, now);
    return { ok: true, accountId, username, token, characters: [] };
  }

  /** Authenticate an existing account and return its token + character list. */
  login(rawUsername: string, password: string): AuthResult {
    const username = rawUsername.trim();
    const row = this.db
      .prepare('SELECT id, username, password_hash FROM accounts WHERE username = ?')
      .get(username) as Record<string, unknown> | undefined;

    if (!row || !verifyPassword(password, String(row.password_hash))) {
      return { ok: false, message: '账号或密码错误' };
    }

    const accountId = String(row.id);
    const token = this.issueSession(accountId);
    return {
      ok: true,
      accountId,
      username: String(row.username),
      token,
      characters: this.listCharacters(accountId),
    };
  }

  /** Validate an active session token. */
  verifyToken(token: string): { accountId: string; username: string } | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        `SELECT a.id AS account_id, a.username AS username, s.expires_at AS expires_at
         FROM sessions s
         JOIN accounts a ON a.id = s.account_id
         WHERE s.token = ?`,
      )
      .get(token) as Record<string, unknown> | undefined;

    if (!row) return null;
    if (Number(row.expires_at) <= Date.now()) {
      this.revokeToken(token);
      return null;
    }
    return { accountId: String(row.account_id), username: String(row.username) };
  }

  /** Invalidate a session token on logout. */
  revokeToken(token: string): void {
    if (!token) return;
    this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  /** List all characters belonging to `accountId`. */
  listCharacters(accountId: string): CharacterSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM characters WHERE account_id = ? ORDER BY created_at ASC')
      .all(accountId) as Record<string, unknown>[];
    return rows.map(rowToCharacter);
  }

  /** Fetch one character by ID (optionally enforcing ownership by `accountId`). */
  getCharacter(charId: string, accountId?: string): CharacterSummary | null {
    const row = accountId
      ? (this.db
          .prepare('SELECT * FROM characters WHERE id = ? AND account_id = ?')
          .get(charId, accountId) as Record<string, unknown> | undefined)
      : (this.db.prepare('SELECT * FROM characters WHERE id = ?').get(charId) as
          Record<string, unknown> | undefined);
    return row ? rowToCharacter(row) : null;
  }

  /** Create a new character after validating class gender locks, appearance, and unique name. */
  createCharacter(
    accountId: string,
    input: {
      name: string;
      classId: ClassId;
      gender: Gender;
      headStyle?: string;
      hairColor?: string;
    },
    defaultSpawn: { mapId: string; x: number; y: number },
  ): CreateCharacterResult {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 12) {
      return { ok: false, message: '角色名需为 2~12 个字符' };
    }

    const classDef = CLASSES[input.classId];
    if (!classDef) {
      return { ok: false, message: '无效的职业' };
    }
    if (!isValidClassGender(input.classId, input.gender)) {
      const only = classDef.genders[0] === 'male' ? '男' : '女';
      return { ok: false, message: `${classDef.name}仅限${only}性创建` };
    }

    const presetId = `${input.classId}.${input.gender}`;
    const preset = DEFAULT_MANIFEST.classes[presetId];
    if (!preset) {
      return { ok: false, message: '缺少对应的职业外观预设' };
    }

    const existingName = this.db.prepare('SELECT id FROM characters WHERE name = ?').get(name) as
      Record<string, unknown> | undefined;
    if (existingName) {
      return { ok: false, message: '角色名已被使用' };
    }

    const validHeads = getHeadStylesForBase(preset.base);
    const defaultHead = preset.layers.head ?? validHeads[0]?.id ?? 'head_short';
    const headStyle = validHeads.some((h) => h.id === input.headStyle)
      ? input.headStyle!
      : defaultHead;
    const hairColor = HAIR_COLORS.some((c) => c.id === input.hairColor)
      ? input.hairColor!
      : 'natural';

    const stats = CLASS_BASE_STATS[input.classId];
    const now = Date.now();
    const character: CharacterSummary = {
      id: randomUUID(),
      name,
      race: classDef.race,
      classId: input.classId,
      gender: input.gender,
      presetId,
      headStyle,
      hairColor,
      level: 1,
      exp: 0,
      hp: stats.hp,
      maxHp: stats.hp,
      mp: stats.mp,
      maxMp: stats.mp,
      gold: 500,
      mapId: defaultSpawn.mapId,
      x: defaultSpawn.x,
      y: defaultSpawn.y,
      dir: Dir.S,
      bag: createStarterBag(),
    };

    this.db
      .prepare(
        `INSERT INTO characters (
          id, account_id, name, race, class_id, gender, preset_id, head_style, hair_color,
          level, exp, hp, max_hp, mp, max_mp, gold, map_id, x, y, dir, bag_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        character.id,
        accountId,
        character.name,
        character.race,
        character.classId,
        character.gender,
        character.presetId,
        character.headStyle,
        character.hairColor,
        character.level,
        character.exp,
        character.hp,
        character.maxHp,
        character.mp,
        character.maxMp,
        character.gold,
        character.mapId,
        character.x,
        character.y,
        character.dir,
        JSON.stringify(character.bag),
        now,
        now,
      );

    return { ok: true, character };
  }

  /** Delete an owned character. Returns true if a row was removed. */
  deleteCharacter(accountId: string, charId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM characters WHERE id = ? AND account_id = ?')
      .run(charId, accountId);
    return Number(res.changes) > 0;
  }

  /** Persist a character's mutable gameplay snapshot (location, stats, bag, preset). */
  saveCharacterState(char: CharacterSummary): void {
    this.db
      .prepare(
        `UPDATE characters
         SET preset_id = ?, head_style = ?, hair_color = ?,
             level = ?, exp = ?, hp = ?, max_hp = ?, mp = ?, max_mp = ?, gold = ?,
             map_id = ?, x = ?, y = ?, dir = ?, bag_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        char.presetId,
        char.headStyle,
        char.hairColor,
        char.level,
        char.exp,
        char.hp,
        char.maxHp,
        char.mp,
        char.maxMp,
        char.gold,
        char.mapId,
        char.x,
        char.y,
        char.dir,
        JSON.stringify(char.bag),
        Date.now(),
        char.id,
      );
  }

  /** Close the SQLite database connection. */
  close(): void {
    this.db.close();
  }

  private issueSession(accountId: string, now = Date.now()): string {
    const token = randomBytes(24).toString('hex');
    this.db
      .prepare(
        'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(token, accountId, now, now + TOKEN_TTL_MS);
    return token;
  }
}
