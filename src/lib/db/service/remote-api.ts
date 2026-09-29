/**
 * 远程 API 服务层
 * 封装与 Supabase 的交互逻辑
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppVersion, CardBase, CardPrint, IconDB, Rule, Series } from '../types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

let client: SupabaseClient | null = null

/**
 * 获取 Supabase 客户端实例（单例模式）
 */
function getSupabaseClient(): SupabaseClient {
  if (!client) {
    client = createClient(supabaseUrl, supabaseKey)
  }
  return client
}

/**
 * 获取全部同步表的版本信息（每张同步表一行，name = 表标识，updated_at = 最后发布时间）
 */
export async function fetchAllVersions(): Promise<AppVersion[]> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase.from('version').select('*')

  if (error) throw new Error(`获取版本失败：${error.message}`)
  return (data ?? []) as AppVersion[]
}

/**
 * 分页拉取整表（不请求 count：按返回行数 < pageSize 判断结束，省掉每页 COUNT(*)）。
 * pageSize 不得超过 Supabase PostgREST 的 max-rows（默认 1000），否则会提前截断丢数据。
 */
async function fetchAllPaged<T>(table: string, label: string): Promise<T[]> {
  const supabase = getSupabaseClient()
  const pageSize = 1000
  const totalData: T[] = []
  let page = 0

  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) throw new Error(`获取${label}失败：${error.message}`)
    const rows = (data ?? []) as T[]
    totalData.push(...rows)
    if (rows.length < pageSize) break
    page++
  }

  return totalData
}

/**
 * 获取全部卡牌数据（分页拉取）
 */
export function fetchAllCards(): Promise<CardBase[]> {
  return fetchAllPaged<CardBase>('cards_base', '卡牌')
}

/**
 * 获取所有卡图数据（分页拉取，整表全量）
 */
export function fetchAllPrints(): Promise<CardPrint[]> {
  return fetchAllPaged<CardPrint>('card_prints', '卡图')
}

/**
 * 获取所有图标数据（分页拉取）
 */
export function fetchAllIcons(): Promise<IconDB[]> {
  return fetchAllPaged<IconDB>('card_icons', '图标数据')
}

/**
 * 获取所有系列数据（分页拉取）
 * series 表未在远端创建时容错返回空数组，避免阻塞整体同步
 */
export async function fetchAllSeries(): Promise<Series[]> {
  try {
    return await fetchAllPaged<Series>('series', '系列数据')
  } catch (err) {
    console.warn('[remote] series 拉取失败（可能尚未建表），跳过：', err)
    return []
  }
}

/**
 * 获取所有RULES数据（分页拉取）
 */
export function fetchAllRules(): Promise<Rule[]> {
  return fetchAllPaged<Rule>('rules', 'RULES数据')
}
