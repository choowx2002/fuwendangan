import type {
  ActiveFilter,
  ArrayFilterParam,
  CardBase,
  CardPrint,
  CardSearchParams,
  SqliteCardBase,
} from "./types";

/**
 * 辅助函数：将 SQLite 行数据反序列化为前端使用的 CardBase 模型
 */
export function mapRowToCard(row: any): CardBase {
  return {
    ...row,
    card_color_list: row.card_color_list
      ? JSON.parse(row.card_color_list)
      : null,
    region: row.region ? JSON.parse(row.region) : null,
    tag: row.tag ? JSON.parse(row.tag) : null,
    keyword: row.keyword ? JSON.parse(row.keyword) : null,
    advanced_tag: row.advanced_tag ? JSON.parse(row.advanced_tag) : null,
    // 将 0/1 转回 boolean
    is_banned: row.is_banned === 1,
  };
}

export function mapRowToPrint(row: any): CardPrint {
  return {
    ...row,
    // 将 0/1/null 转回 boolean/null
    is_default: row.is_default === null ? null : row.is_default === 1,
  };
}

// 适配器：将 PG 数据模型转换为 SQLite 存储模型
export function toSqliteModel(card: CardBase): SqliteCardBase {
  return {
    ...card, // 直接展开，保留所有普通文本和数字字段
    // 仅覆盖需要序列化的数组字段
    card_color_list: card.card_color_list
      ? JSON.stringify(card.card_color_list)
      : null,
    region: card.region ? JSON.stringify(card.region) : null,
    tag: card.tag ? JSON.stringify(card.tag) : null,
    keyword: card.keyword ? JSON.stringify(card.keyword) : null,
    advanced_tag: card.advanced_tag ? JSON.stringify(card.advanced_tag) : null,
    // 覆盖布尔值字段
    is_banned: card.is_banned ? 1 : 0,
  };
}

export interface BestPrint {
  url: string;
  fallbackUrl: string | null;
}

/**
 * 获取卡牌的最佳展示卡图
 * 逻辑：1. is_default -> 2. 中文且 print_order 最小 -> 3. 第一张
 */
export function getBestPrint(
  card: CardBase & { card_prints?: CardPrint[] },
): BestPrint | null {
  if (!card.card_prints || card.card_prints.length === 0) return null;

  const prints = card.card_prints;

  // 1. 优先找 is_default
  let best = prints.find((p) => p.is_default);

  // 2. 如果没有，找中文里 print_order 最小的
  if (!best) {
    const zhPrints = prints.filter(
      (p) => p.language === "中文" || p.language === "zh",
    );
    if (zhPrints.length > 0) {
      zhPrints.sort((a, b) => (a.print_order || 0) - (b.print_order || 0));
      best = zhPrints[0];
    }
  }

  // 3. 兜底：第一张
  if (!best) best = prints[0];

  return {
    url: best.img_cdn || "",
    fallbackUrl: best.tts_cdn || null,
  };
}

const typeToFieldMap: Record<string, keyof CardSearchParams> = {
  // UI 常用别名
  tag: "tag",
  keyword: "keyword",
  color: "card_color_list",
  region: "region",
  advanced_tag: "advanced_tag",
  category: "card_category",
  series: "series_name",
  rarity: "rarity_name",
  champion: "champion_tag",

  // 真实 DB 字段名 (防止 UI 层直接传字段名导致映射失败)
  card_color_list: "card_color_list",
  card_category: "card_category",
  series_name: "series_name",
  rarity_name: "rarity_name",
  champion_tag: "champion_tag",
};

export function buildSearchParams(
  activeFilters: ActiveFilter[] | any, // 放宽类型以接收 Svelte Proxy
  searchText: string,
  page: number = 1,
  pageSize: number = 60,
): CardSearchParams {
  const params: CardSearchParams = {
    page,
    pageSize,
    searchText,
    is_banned: false,
  };

  const rawFilters = activeFilters;

  // 2. 防御性兼容：如果 Svelte 把它变成了 {0: {...}} 这样的对象，用 Object.values 转回数组
  const filtersArray = Array.isArray(rawFilters)
    ? rawFilters
    : Object.values(rawFilters || {});

  for (const filter of filtersArray) {
    if (!filter || !filter.type) continue;

    const dbField = typeToFieldMap[filter.type];
    if (!dbField) {
      console.warn(`[buildSearchParams] 未知的 filter type: ${filter.type}`);
      continue;
    }

    const arrayFields = [
      "tag",
      "keyword",
      "card_color_list",
      "region",
      "advanced_tag",
      "rarity_name",
      "series_name",
      "card_category"
    ];
    if (arrayFields.includes(dbField as string)) {
      if (!params[dbField as keyof CardSearchParams]) {
        (params as any)[dbField] = {} as ArrayFilterParam;
      }
      const paramObj = (params as any)[dbField] as ArrayFilterParam;

      // UI 的 'require' 对应底层 SQL 的 'must'
      const modeKey = filter.mode === "require" ? "must" : filter.mode;

      if (!paramObj[modeKey as keyof ArrayFilterParam]) {
        (paramObj as any)[modeKey] = [];
      }
      (paramObj as any)[modeKey].push(filter.value);
    }
    // 处理文本类字段 (精确匹配，如 category, rarity)
    else {
      (params as any)[dbField] = filter.value;
    }
  }

  console.log("[buildSearchParams] 最终生成的 params:", params);
  return params;
}
