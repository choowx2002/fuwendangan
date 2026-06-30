import type { AppVersion, CardBase, CardPrint } from "./types";
import { createClient } from "@supabase/supabase-js";
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(supabaseUrl, supabaseKey);

export async function fetchLatestVersion(): Promise<AppVersion | null> {
  const { data, error } = await supabase
    .from("version")
    .select("*")
    .order("id", { ascending: false })
    .limit(1)
    .single();

  if (error) throw new Error(`获取版本失败: ${error.message}`);
  return data;
}

export async function fetchAllCards(): Promise<CardBase[]> {
  const totalData: CardBase[] = [];
  let page = 0;
  const pageSize = 1000;
  let hasMore = true;
  while (hasMore) {
    const { data, count, error } = await supabase
      .from("cards_base")
      .select("*", { count: "exact" })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`获取卡牌失败: ${error.message}`);
    if (data) totalData.push(...data);
    if (count && data && data.length < pageSize) hasMore = false;
    page++;
  }
  return totalData;
}

export async function fetchAllPrints(): Promise<CardPrint[]> {
  const totalData: CardPrint[] = [];
  let page = 0;
  const pageSize = 100;
  let hasMore = true;
  while (hasMore) {
    const { data, count, error } = await supabase
      .from("card_prints")
      .select("*", { count: "exact" })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw new Error(`获取卡图失败: ${error.message}`);
    if (data) totalData.push(...data);
    if (count && data && data.length < pageSize) hasMore = false;
    page++;
  }
  return totalData;
}
