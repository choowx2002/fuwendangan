// src/lib/db/sqlite.ts
import Database from "@tauri-apps/plugin-sql";
import type {
  SqliteCardBase,
  CardBase,
  CardPrint,
  AppVersion,
  CardSearchResult,
  CardSearchParams,
} from "./types";
import { mapRowToCard } from "./helper";

let dbInstance: Database | null = null;

export async function getLocalDb(): Promise<Database> {
  if (!dbInstance) {
    dbInstance = await Database.load("sqlite:tcg_cards.db");
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
    card_color_list: card.card_color_list
      ? JSON.stringify(card.card_color_list)
      : null,
    region: card.region ? JSON.stringify(card.region) : null,
    tag: card.tag ? JSON.stringify(card.tag) : null,
    keyword: card.keyword ? JSON.stringify(card.keyword) : null,
    advanced_tag: card.advanced_tag ? JSON.stringify(card.advanced_tag) : null,
    is_banned: card.is_banned ? 1 : 0,
  };
}

export async function saveCards(cards: CardBase[]) {
  const db = await getLocalDb();
  await db.execute("BEGIN TRANSACTION;");
  try {
    for (const card of cards) {
      const s = toSqliteModel(card);
      await db.execute(
        `INSERT OR REPLACE INTO cards_base
         (id, card_no, card_name_cn, card_name_en, card_color_list, region, tag, keyword, advanced_tag, energy, power, rarity_name, series_name, is_banned, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15);`,
        [
          s.id,
          s.card_no,
          s.card_name_cn,
          s.card_name_en,
          s.card_color_list,
          s.region,
          s.tag,
          s.keyword,
          s.advanced_tag,
          s.energy,
          s.power,
          s.rarity_name,
          s.series_name,
          s.is_banned,
          s.updated_at,
        ],
      );
    }
    await db.execute("COMMIT;");
  } catch (e) {
    await db.execute("ROLLBACK;");
    throw e;
  }
}

export async function savePrints(prints: CardPrint[]) {
  const db = await getLocalDb();
  await db.execute("BEGIN TRANSACTION;");
  try {
    for (const p of prints) {
      await db.execute(
        `INSERT OR REPLACE INTO card_prints (id, card_id, card_no_extend, language, img_cdn, is_default) VALUES ($1,$2,$3,$4,$5,$6);`,
        [
          p.id,
          p.card_id,
          p.card_no_extend,
          p.language,
          p.img_cdn,
          p.is_default ? 1 : 0,
        ],
      );
    }
    await db.execute("COMMIT;");
  } catch (e) {
    await db.execute("ROLLBACK;");
    throw e;
  }
}

export async function getLocalVersion(): Promise<AppVersion | null> {
  const db = await getLocalDb();
  const result = await db.select<AppVersion[]>(
    "SELECT * FROM version ORDER BY id DESC LIMIT 1;",
  );
  return result.length > 0 ? result[0] : null;
}

export async function saveVersion(version: AppVersion) {
  const db = await getLocalDb();
  await db.execute(
    `INSERT OR REPLACE INTO version (id, name, updated_at) VALUES ($1, $2, $3);`,
    [version.id, version.name, version.updated_at],
  );
}

export async function getLocalCardBaseCount(): Promise<number> {
  const db = await getLocalDb();
  const result = await db.select<number[]>("SELECT COUNT(*) FROM cards_base;");
  return result.length;
}

/**
 * 本地 SQLite 卡牌搜索函数 (对标 Supabase 的 searchCards)
 */
export async function searchCardsLocal(
  params: CardSearchParams,
): Promise<CardSearchResult> {
  const db = await getLocalDb();
  const {
    page = 1,
    pageSize = 30,
    searchText,
    is_banned = false,
    ...filters
  } = params;

  const whereClauses: string[] = [];
  const queryParams: any[] = [];

  // 1. 禁卡过滤
  whereClauses.push("cards_base.is_banned = ?");
  queryParams.push(is_banned ? 1 : 0);

  // 2. 模糊搜索 (中英文名称、效果)
  if (searchText && searchText.trim() !== "") {
    const safeText = `%${searchText.trim()}%`;
    whereClauses.push(`(
      cards_base.card_name_cn LIKE ? OR cards_base.card_name_en LIKE ? OR
      cards_base.effect_cn LIKE ? OR cards_base.champion_tag LIKE ? OR cards_base.effect_en LIKE ?
    )`);
    queryParams.push(safeText, safeText, safeText, safeText, safeText);
  }

  // 3. 数组字段过滤 (使用 SQLite 的 json_each 函数)
  const arrayFields = [
    "region",
    "tag",
    "keyword",
    "advanced_tag",
    "card_color_list",
  ];
  for (const field of arrayFields) {
    const val = (filters as any)[field];
    if (val && Array.isArray(val) && val.length > 0) {
      // 逻辑：包含数组中的任意一个标签 (OR 逻辑)
      const placeholders = val.map(() => "?").join(",");
      whereClauses.push(
        `EXISTS (SELECT 1 FROM json_each(cards_base.${field}) WHERE value IN (${placeholders}))`,
      );
      queryParams.push(...val);
    }
  }

  // 4. 文本字段精确过滤
  const textFields = ["card_category", "series_name", "rarity_name"];
  for (const field of textFields) {
    const val = (filters as any)[field];
    if (val && typeof val === "string" && val.trim() !== "") {
      whereClauses.push(`cards_base.${field} = ?`);
      queryParams.push(val.trim());
    }
  }

  // 5. 数值范围过滤 (支持精确数字或 {min, max} 对象)
  const numberFields = ["power", "energy", "return_energy"];
  for (const field of numberFields) {
    const val = (filters as any)[field];
    if (val !== undefined && val !== null) {
      if (typeof val === "number") {
        whereClauses.push(`cards_base.${field} = ?`);
        queryParams.push(val);
      } else if (typeof val === "object") {
        if (val.min !== undefined) {
          whereClauses.push(`cards_base.${field} >= ?`);
          queryParams.push(val.min);
        }
        if (val.max !== undefined) {
          whereClauses.push(`cards_base.${field} <= ?`);
          queryParams.push(val.max);
        }
      }
    }
  }

  const whereStr =
    whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  // 6. 获取总数 (用于分页)
  const countSql = `SELECT COUNT(*) as total FROM cards_base ${whereStr}`;
  const countResult = await db.select<{ total: number }[]>(
    countSql,
    queryParams,
  );
  const total = countResult[0]?.total || 0;

  // 7. 获取分页数据 (使用 LEFT JOIN 关联默认卡图，以实现按 print_order 排序)
  const offset = (page - 1) * pageSize;
  const dataSql = `
    SELECT cards_base.*
    FROM cards_base
    LEFT JOIN card_prints ON cards_base.id = card_prints.card_id AND card_prints.is_default = 1
    ${whereStr}
    ORDER BY card_prints.print_order ASC, cards_base.card_no ASC
    LIMIT ? OFFSET ?
  `;
  const dataParams = [...queryParams, pageSize, offset];
  const rows = await db.select<any[]>(dataSql, dataParams);

  // 反序列化主表数据
  let cards = rows.map(mapRowToCard);

  // 8. 获取关联的 card_prints (分步查询，JS层组装，避免复杂的 SQL JSON 聚合)
  if (cards.length > 0) {
    const idPlaceholders = cards.map(() => "?").join(",");
    const printsSql = `SELECT * FROM card_prints WHERE card_id IN (${idPlaceholders}) ORDER BY print_order ASC`;
    const printsRows = await db.select<any[]>(
      printsSql,
      cards.map((c) => c.id),
    );

    // 反序列化卡图数据
    const prints = printsRows.map((p) => ({
      ...p,
      is_default: p.is_default === 1,
    }));

    // 在 JS 层将卡图挂载到卡牌上
    const printsMap = new Map<string, CardPrint[]>();
    for (const p of prints) {
      if (!printsMap.has(p.card_id!)) printsMap.set(p.card_id!, []);
      printsMap.get(p.card_id!)!.push(p);
    }

    cards = cards.map((c) => ({
      ...c,
      card_prints: printsMap.get(c.id) || [],
    }));
  }

  return {
    data: cards,
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}
