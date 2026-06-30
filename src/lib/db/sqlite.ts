// src/lib/db/sqlite.ts
import Database from '@tauri-apps/plugin-sql';
import type { SqliteCardBase, CardBase, CardPrint, AppVersion } from './types';

let dbInstance: Database | null = null;

export async function getLocalDb(): Promise<Database> {
    if (!dbInstance) {
        dbInstance = await Database.load('sqlite:tcg_cards.db');
        await initTables(dbInstance);
    }
    return dbInstance;
}

async function initTables(db: Database) {
    // SQLite 不支持原生数组，使用 TEXT 存储 JSON 字符串
    await db.execute(`
    CREATE TABLE IF NOT EXISTS cards_base (
      id TEXT PRIMARY KEY,
      card_no TEXT UNIQUE,
      card_name_cn TEXT, card_name_en TEXT,
      card_color_list TEXT, region TEXT, tag TEXT, keyword TEXT, advanced_tag TEXT,
      energy INTEGER, power INTEGER, rarity_name TEXT, series_name TEXT,
      is_banned INTEGER DEFAULT 0, updated_at TEXT
    );
  `);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS card_prints (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      card_no_extend TEXT,
      language TEXT,
      img_cdn TEXT,
      is_default INTEGER DEFAULT 0,
      FOREIGN KEY(card_id) REFERENCES cards_base(id) ON DELETE CASCADE
    );
  `);

    await db.execute(`
    CREATE TABLE IF NOT EXISTS version (
      id INTEGER PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    );
  `);
}

// 适配器：将 PG 数据模型转换为 SQLite 存储模型
function toSqliteModel(card: CardBase): SqliteCardBase {
    return {
        ...card,
        card_color_list: card.card_color_list ? JSON.stringify(card.card_color_list) : null,
        region: card.region ? JSON.stringify(card.region) : null,
        tag: card.tag ? JSON.stringify(card.tag) : null,
        keyword: card.keyword ? JSON.stringify(card.keyword) : null,
        advanced_tag: card.advanced_tag ? JSON.stringify(card.advanced_tag) : null,
        is_banned: card.is_banned ? 1 : 0
    };
}

export async function saveCards(cards: CardBase[]) {
    const db = await getLocalDb();
    await db.execute('BEGIN TRANSACTION;');
    try {
        for (const card of cards) {
            const s = toSqliteModel(card);
            await db.execute(
                `INSERT OR REPLACE INTO cards_base 
         (id, card_no, card_name_cn, card_name_en, card_color_list, region, tag, keyword, advanced_tag, energy, power, rarity_name, series_name, is_banned, updated_at) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15);`,
                [s.id, s.card_no, s.card_name_cn, s.card_name_en, s.card_color_list, s.region, s.tag, s.keyword, s.advanced_tag, s.energy, s.power, s.rarity_name, s.series_name, s.is_banned, s.updated_at]
            );
        }
        await db.execute('COMMIT;');
    } catch (e) {
        await db.execute('ROLLBACK;');
        throw e;
    }
}

export async function savePrints(prints: CardPrint[]) {
    const db = await getLocalDb();
    await db.execute('BEGIN TRANSACTION;');
    try {
        for (const p of prints) {
            await db.execute(
                `INSERT OR REPLACE INTO card_prints (id, card_id, card_no_extend, language, img_cdn, is_default) VALUES ($1,$2,$3,$4,$5,$6);`,
                [p.id, p.card_id, p.card_no_extend, p.language, p.img_cdn, p.is_default ? 1 : 0]
            );
        }
        await db.execute('COMMIT;');
    } catch (e) {
        await db.execute('ROLLBACK;');
        throw e;
    }
}

export async function getLocalVersion(): Promise<AppVersion | null> {
    const db = await getLocalDb();
    const result = await db.select<AppVersion[]>('SELECT * FROM version ORDER BY id DESC LIMIT 1;');
    return result.length > 0 ? result[0] : null;
}

export async function saveVersion(version: AppVersion) {
    const db = await getLocalDb();
    await db.execute(
        `INSERT OR REPLACE INTO version (id, name, updated_at) VALUES ($1, $2, $3);`,
        [version.id, version.name, version.updated_at]
    );
}