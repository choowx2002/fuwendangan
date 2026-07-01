// src/lib/db/types.ts

// 基础卡牌模型 (与 Supabase 保持一致)
export interface CardBase {
  id: string;
  card_no: string;
  card_name_cn: string | null;
  card_name_en: string | null;
  sub_title_cn: string | null;
  sub_title_en: string | null;
  card_category: string | null;
  card_color_list: string[] | null;
  region: string[] | null;
  tag: string[] | null;
  keyword: string[] | null;
  advanced_tag: string[] | null;
  champion_tag: string | null;
  effect_cn: string | null;
  effect_en: string | null;
  energy: number | null;
  return_energy: number | null;
  power: number | null;
  rarity_name: string | null;
  series_name: string | null;
  flavor_text_cn: string | null;
  flavor_text_en: string | null;
  is_banned: boolean | null;
  created_at: string | null;
  updated_at: string | null;
}

// 卡图/版本模型
export interface CardPrint {
  id: string;
  card_id: string | null;
  card_no_extend: string;
  rarity_name: string | null;
  extend_rarity_name: string | null;
  back_image: string | null;
  language: string;
  img_cdn: string | null;
  tts_cdn: string | null;
  artist: string | null;
  print_order: number | null;
  is_default: boolean | null;
  created_at: string | null;
}

// 版本控制模型
export interface AppVersion {
  id: number;
  name: string | null;
  updated_at: string; // ISO 8601 时间字符串
}

// SQLite 存储模型 (将 PG 的数组转为 JSON 字符串，布尔值转为 0/1)
export interface SqliteCardBase extends Omit<
  CardBase,
  | "card_color_list"
  | "region"
  | "tag"
  | "keyword"
  | "advanced_tag"
  | "is_banned"
> {
  card_color_list: string | null;
  region: string | null;
  tag: string | null;
  keyword: string | null;
  advanced_tag: string | null;
  is_banned: number;
}

export interface SqliteCardPrint extends Omit<CardPrint, "is_default"> {
  is_default: number | null;
}

export interface CardSearchResult {
  data: CardBase[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type FilterStatus = "unselected" | "include" | "must" | "exclude";

// 数值字段过滤模型 (适用于 power, energy, return_energy)
export interface NumberRange {
  min?: number; // 大于等于 (>=)
  max?: number; // 小于等于 (<=)
}

// 数组过滤参数结构
export interface ArrayFilterParam {
  include?: string[]; // OR 逻辑
  must?: string[]; // AND 逻辑
  exclude?: string[]; // NOT 逻辑
}

export interface FilterOptions {
  id: number; // 固定为 1
  regions: string[];
  tags: string[];
  keywords: string[];
  advanced_tags: string[];
  colors: string[];
  categories: string[];
  series: string[];
  rarities: string[];
  champions: string[];
  energy_range: { min: number; max: number };
  power_range: { min: number; max: number };
  return_energy_range: { min: number; max: number };
  updated_at: string;
}

export interface CardSearchParams {
  page?: number;
  pageSize?: number;
  searchText?: string;
  is_banned?: boolean;

  // 数组类字段 (使用嵌套对象)
  region?: ArrayFilterParam;
  tag?: ArrayFilterParam;
  keyword?: ArrayFilterParam;
  advanced_tag?: ArrayFilterParam;
  card_color_list?: ArrayFilterParam;

  // 文本类精确过滤
  card_category?: ArrayFilterParam;
  series_name?: ArrayFilterParam;
  rarity_name?: ArrayFilterParam;
  champion_tag?: string;

  // 数值范围过滤
  power?: number | NumberRange;
  energy?: number | NumberRange;
  return_energy?: number | NumberRange;
}

export type FilterMode = "include" | "require" | "exclude";

export type FilterType =
  | "tag"
  | "keyword"
  | "card_color_list"
  | "region"
  | "advanced_tag"
  | "card_category"
  | "series_name"
  | "series"
  | "rarity"
  | "rarity_name"
  | "champion_tag";

export interface ActiveFilter {
  value: string;
  mode: FilterMode;
  type: FilterType;
}

export type ArrayFieldKey =
  "region" | "tag" | "keyword" | "advanced_tag" | "card_color_list";
