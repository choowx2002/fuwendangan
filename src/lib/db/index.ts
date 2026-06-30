// src/lib/db/index.ts
export { initializeDatabase } from "./sync";
// 后续可以在此处导出供 UI 层调用的查询方法，例如：
// export { getCardsFromLocal } from './sqlite';

import { searchCards as searchCardsRemote } from "./supabase"; // 假设你把之前的搜索函数放在这里
import { searchCardsLocal } from "./sqlite";
import type { CardSearchParams, CardSearchResult } from "./types";
export { isTauri, isWeb } from "./env";

/**
 * 统一的卡牌搜索入口
 * 自动根据运行环境选择 Supabase 或 SQLite
 */
export async function searchCards(
  params: CardSearchParams,
): Promise<CardSearchResult> {
  if (isTauri) {
    console.log("[DB] 使用本地 SQLite 进行搜索");
    return searchCardsLocal(params);
  } else {
    console.log("[DB] 使用 Supabase 进行搜索");
    return searchCardsRemote(params);
  }
}
