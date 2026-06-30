// import { searchCards as searchCardsRemote } from "./supabase"; // 假设你把之前的搜索函数放在这里
import { searchCardsLocal } from "./sqlite";
import type { CardSearchParams, CardSearchResult } from "./types";
import { isTauri } from "./env";

export { isTauri, isWeb } from "./env";
export { initializeDatabase } from "./sync";
export { getLocalCardBaseCount, getFilterOptions } from "./sqlite";

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
    throw new Error("Supabase 搜索暂未实现");
    // return searchCardsRemote(params);
  }
}
