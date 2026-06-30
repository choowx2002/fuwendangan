// src/lib/db/types.ts

// 基础卡牌模型 (与 Supabase 保持一致)
export interface CardBase {
  id: string;
  card_no: string;
  card_name_cn: string | null;
  card_name_en: string | null;
  card_color_list: string[] | null;
  region: string[] | null;
  tag: string[] | null;
  keyword: string[] | null;
  advanced_tag: string[] | null;
  energy: number | null;
  power: number | null;
  rarity_name: string | null;
  series_name: string | null;
  is_banned: boolean | null;
  updated_at: string | null;
}

// 卡图/版本模型
export interface CardPrint {
  id: string;
  card_id: string | null;
  card_no_extend: string;
  language: string;
  img_cdn: string | null;
  is_default: boolean | null;
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

export interface CardSearchResult {
  data: CardBase[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface CardSearchParams {
  page?: number;
  pageSize?: number;
  search?: string;
}
