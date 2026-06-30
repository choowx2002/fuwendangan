// src/lib/db/sqlite.ts
import Database from "@tauri-apps/plugin-sql";
import type {
  SqliteCardBase,
  CardBase,
  CardPrint,
  AppVersion,
  CardSearchResult,
  CardSearchParams,
  FilterOptions,
  ArrayFilterParam,
  CategoryKey,
  ArrayFieldKey,
  NumberRange,
} from "./types";
import { mapRowToCard, mapRowToPrint, toSqliteModel } from "./helper";

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
        sub_title_cn TEXT, sub_title_en TEXT,
        card_category TEXT,
        card_color_list TEXT, region TEXT, tag TEXT, keyword TEXT, advanced_tag TEXT,
        champion_tag TEXT,
        effect_cn TEXT, effect_en TEXT,
        energy INTEGER, return_energy INTEGER, power INTEGER,
        rarity_name TEXT, series_name TEXT,
        flavor_text_cn TEXT, flavor_text_en TEXT,
        is_banned INTEGER DEFAULT 0,
        created_at TEXT, updated_at TEXT
      );
    `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS card_prints (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      card_no_extend TEXT NOT NULL,
      rarity_name TEXT,
      extend_rarity_name TEXT,
      back_image TEXT,
      language TEXT NOT NULL,
      img_cdn TEXT,
      tts_cdn TEXT,
      artist TEXT,
      print_order INTEGER,
      is_default INTEGER,
      created_at TEXT,
      FOREIGN KEY(card_id) REFERENCES cards_base(id) ON DELETE CASCADE
    );
  `);

  await db.execute(`
    CREATE TABLE IF NOT EXISTS filter_options (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      regions TEXT, tags TEXT, keywords TEXT, advanced_tags TEXT, colors TEXT,
      categories TEXT, series TEXT, rarities TEXT, champions TEXT,
      energy_min INTEGER, energy_max INTEGER,
      power_min INTEGER, power_max INTEGER,
      return_energy_min INTEGER, return_energy_max INTEGER,
      updated_at TEXT
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

export async function saveCards(cards: CardBase[]) {
  const db = await getLocalDb();
  await db.execute("BEGIN TRANSACTION;");
  try {
    for (const card of cards) {
      const s = toSqliteModel(card);
      await db.execute(
        `INSERT OR REPLACE INTO cards_base
         (id, card_no, card_name_cn, card_name_en, sub_title_cn, sub_title_en, card_category,
          card_color_list, region, tag, keyword, advanced_tag, champion_tag, effect_cn, effect_en,
          energy, return_energy, power, rarity_name, series_name, flavor_text_cn, flavor_text_en,
          is_banned, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25);`,
        [
          s.id,
          s.card_no,
          s.card_name_cn,
          s.card_name_en,
          s.sub_title_cn,
          s.sub_title_en,
          s.card_category,
          s.card_color_list,
          s.region,
          s.tag,
          s.keyword,
          s.advanced_tag,
          s.champion_tag,
          s.effect_cn,
          s.effect_en,
          s.energy,
          s.return_energy,
          s.power,
          s.rarity_name,
          s.series_name,
          s.flavor_text_cn,
          s.flavor_text_en,
          s.is_banned,
          s.created_at,
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
      // 处理 boolean 到 int 的转换 (如果是 null 则存 null，如果是 true/false 则存 1/0)
      const isDefaultInt = p.is_default === null ? null : p.is_default ? 1 : 0;

      await db.execute(
        `INSERT OR REPLACE INTO card_prints
         (id, card_id, card_no_extend, rarity_name, extend_rarity_name, back_image,
          language, img_cdn, tts_cdn, artist, print_order, is_default, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);`,
        [
          p.id,
          p.card_id,
          p.card_no_extend,
          p.rarity_name,
          p.extend_rarity_name,
          p.back_image,
          p.language,
          p.img_cdn,
          p.tts_cdn,
          p.artist,
          p.print_order,
          isDefaultInt,
          p.created_at,
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

export async function getLocalCardBaseCount(): Promise<{
  cardsBaseCount: number;
  cardsPrintCount: number;
}> {
  const db = await getLocalDb();
  const cardsBaseCount = await db.select<number[]>(
    "SELECT COUNT(*) FROM cards_base;",
  );
  const cardsPrintCount = await db.select<number[]>(
    "SELECT COUNT(*) FROM cards_print;",
  );
  return {
    cardsBaseCount: cardsBaseCount[0],
    cardsPrintCount: cardsPrintCount[0],
  };
}

export async function searchCardsLocal(
  params: CardSearchParams,
): Promise<CardSearchResult> {
  const db = await getLocalDb();

  const { page = 1, pageSize = 30, searchText, is_banned = false } = params;
  const whereClauses: string[] = [];
  const queryParams: any[] = [];

  console.log("params", params);

  // 1. 禁卡过滤
  // whereClauses.push("cards_base.is_banned = ?");
  // queryParams.push(is_banned ? 1 : 0);

  // 2. 模糊搜索
  if (searchText && searchText.trim() !== "") {
    const safeText = `%${searchText.trim()}%`;
    whereClauses.push(`(
      cards_base.card_name_cn LIKE ? OR cards_base.card_name_en LIKE ? OR
      cards_base.effect_cn LIKE ? OR cards_base.champion_tag LIKE ? OR cards_base.effect_en LIKE ?
    )`);
    queryParams.push(safeText, safeText, safeText, safeText, safeText);
  }

  // 3. 数组字段过滤 (你的完美逻辑)
  const arrayFields: ArrayFieldKey[] = [
    "region",
    "tag",
    "keyword",
    "advanced_tag",
    "card_color_list",
  ];

  for (const field of arrayFields) {
    const filterParam = params[field] as ArrayFilterParam | undefined;
    if (!filterParam) continue;

    if (filterParam.include && filterParam.include.length > 0) {
      const placeholders = filterParam.include.map(() => "?").join(",");
      whereClauses.push(
        `EXISTS (SELECT 1 FROM json_each(cards_base.${field}) WHERE value IN (${placeholders}))`,
      );
      queryParams.push(...filterParam.include);
    }

    if (filterParam.must && filterParam.must.length > 0) {
      for (const val of filterParam.must) {
        whereClauses.push(
          `EXISTS (SELECT 1 FROM json_each(cards_base.${field}) WHERE value = ?)`,
        );
        queryParams.push(val);
      }
    }

    if (filterParam.exclude && filterParam.exclude.length > 0) {
      for (const val of filterParam.exclude) {
        whereClauses.push(
          `NOT EXISTS (SELECT 1 FROM json_each(cards_base.${field}) WHERE value = ?)`,
        );
        queryParams.push(val);
      }
    }
  }

  // 4. 文本字段精确过滤 (补充了 champion_tag)
  const textFields: (keyof CardSearchParams)[] = [
    "card_category",
    "series_name",
    "rarity_name",
    "champion_tag",
  ];
  for (const field of textFields) {
    const val = params[field];
    if (val && typeof val === "string" && val.trim() !== "") {
      whereClauses.push(`cards_base.${field} = ?`);
      queryParams.push(val.trim());
    }
  }

  // 5. 数值范围过滤 (保持原样)
  const numberFields = ["power", "energy", "return_energy"];
  for (const field of numberFields) {
    const val = params[field as keyof CardSearchParams] as number | NumberRange;
    if (val !== undefined && val !== null) {
      if (typeof val === "number") {
        whereClauses.push(`cards_base.${field} = ?`);
        queryParams.push(val);
      } else {
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

    // 【修正】：使用 mapRowToPrint 进行反序列化
    const prints = printsRows.map(mapRowToPrint);

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

export async function updateFilterOptions(db: Database) {
  console.log("[SQLite] 开始计算 Filter Options...");

  // 1. 获取所有数组和文本类的去重选项
  // 利用 SQLite 的标量子查询和 json_group_array 一次性查出
  const optionsSql = `
    SELECT
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM cards_base, json_each(region) WHERE value IS NOT NULL)) as regions,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM cards_base, json_each(tag) WHERE value IS NOT NULL)) as tags,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM cards_base, json_each(keyword) WHERE value IS NOT NULL)) as keywords,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM cards_base, json_each(advanced_tag) WHERE value IS NOT NULL)) as advanced_tags,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT value as val FROM cards_base, json_each(card_color_list) WHERE value IS NOT NULL)) as colors,

      (SELECT json_group_array(val) FROM (SELECT DISTINCT card_category as val FROM cards_base WHERE card_category IS NOT NULL)) as categories,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT series_name as val FROM cards_base WHERE series_name IS NOT NULL)) as series,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT rarity_name as val FROM cards_base WHERE rarity_name IS NOT NULL)) as rarities,
      (SELECT json_group_array(val) FROM (SELECT DISTINCT champion_tag as val FROM cards_base WHERE champion_tag IS NOT NULL)) as champions
    ;
  `;
  const optionsRow = await db.select<any[]>(optionsSql);
  const opts = optionsRow[0] || {};

  // 2. 获取数值字段的极值
  const rangeSql = `
    SELECT
      COALESCE(min(energy), 0) as energy_min, COALESCE(max(energy), 0) as energy_max,
      COALESCE(min(power), 0) as power_min, COALESCE(max(power), 0) as power_max,
      COALESCE(min(return_energy), 0) as return_energy_min, COALESCE(max(return_energy), 0) as return_energy_max
    FROM cards_base;
  `;
  const rangeRow = await db.select<any[]>(rangeSql);
  const ranges = rangeRow[0] || {};

  // 3. 组装并写入数据库 (INSERT OR REPLACE 实现单例更新)
  await db.execute(
    `INSERT OR REPLACE INTO filter_options
     (id, regions, tags, keywords, advanced_tags, colors, categories, series, rarities, champions,
      energy_min, energy_max, power_min, power_max, return_energy_min, return_energy_max, updated_at)
     VALUES (1, $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16);`,
    [
      opts.regions || "[]",
      opts.tags || "[]",
      opts.keywords || "[]",
      opts.advanced_tags || "[]",
      opts.colors || "[]",
      opts.categories || "[]",
      opts.series || "[]",
      opts.rarities || "[]",
      opts.champions || "[]",
      ranges.energy_min,
      ranges.energy_max,
      ranges.power_min,
      ranges.power_max,
      ranges.return_energy_min,
      ranges.return_energy_max,
      new Date().toISOString(),
    ],
  );
  console.log("[SQLite] Filter Options 更新完成");
}

/**
 * 读取 Filter Options (供前端 UI 渲染筛选器使用)
 */
export async function getFilterOptions(): Promise<FilterOptions | null> {
  const db = await getLocalDb();
  const rows = await db.select<any[]>(
    "SELECT * FROM filter_options WHERE id = 1;",
  );
  if (rows.length === 0) return null;

  const row = rows[0];
  // 将 JSON 字符串解析回数组
  return {
    id: row.id,
    regions: JSON.parse(row.regions || "[]"),
    tags: JSON.parse(row.tags || "[]"),
    keywords: JSON.parse(row.keywords || "[]"),
    advanced_tags: JSON.parse(row.advanced_tags || "[]"),
    colors: JSON.parse(row.colors || "[]"),
    categories: JSON.parse(row.categories || "[]"),
    series: JSON.parse(row.series || "[]"),
    rarities: JSON.parse(row.rarities || "[]"),
    champions: JSON.parse(row.champions || "[]"),
    energy_range: { min: row.energy_min, max: row.energy_max },
    power_range: { min: row.power_min, max: row.power_max },
    return_energy_range: {
      min: row.return_energy_min,
      max: row.return_energy_max,
    },
    updated_at: row.updated_at,
  };
}
