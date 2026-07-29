/**
 * 远程 API 服务层
 * 封装与 Supabase 的交互逻辑
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppVersion, CardBase, CardPrint, IconDB, Rule } from '../types'
import { getLatestUpdateCardTime } from '../repository/card-repository'
import { getLatestUpdatePrintTime } from '../repository/print-repository'

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
 * 获取最新版本信息
 */
export async function fetchLatestVersion(): Promise<AppVersion | null> {
  const supabase = getSupabaseClient()
  const { data, error } = await supabase
    .from('version')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
    .single()

  if (error) throw new Error(`获取版本失败：${error.message}`)
  return data
}

/**
 * 获取所有卡牌数据（分页拉取）
 */
export async function fetchAllCards(): Promise<CardBase[]> {
  const supabase = getSupabaseClient()
  const totalData: CardBase[] = []
  let page = 0
  const pageSize = 500
  let hasMore = true

  while (hasMore) {
    const { data, count, error } = await supabase
      .from('cards_base')
      .select('*', { count: 'exact' })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) throw new Error(`获取卡牌失败：${error.message}`)
    if (data) totalData.push(...data)
    if (count && data && data.length < pageSize) hasMore = false
    page++
  }

  return totalData
}

export async function fetchUpdatedCards(): Promise<CardBase[]> {
  const supabase = getSupabaseClient()
  const totalData: CardBase[] = []
  let page = 0
  const pageSize = 500
  let hasMore = true
  let latestAt = await getLatestUpdateCardTime()
  console.log("Latest At Cards", latestAt);
  // let latestAt = null

  while (hasMore) {
    if (latestAt) {
      const { data, count, error } = await supabase
        .from('cards_base')
        .select('*', { count: 'exact' })
        .gt('updated_at', latestAt)
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw new Error(`获取卡图失败：${error.message}`)
      if (data) totalData.push(...data)
      if (count && data && data.length < pageSize) hasMore = false
    } else {
      const { data, count, error } = await supabase
        .from('cards_base')
        .select('*', { count: 'exact' })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw new Error(`获取卡牌失败：${error.message}`)
      if (data) totalData.push(...data)
      if (count && data && data.length < pageSize) hasMore = false
    }
    page++
  }

  return totalData
}

/**
 * 获取所有卡图数据（分页拉取）
 */
export async function fetchAllPrints(): Promise<CardPrint[]> {
  const supabase = getSupabaseClient()
  const totalData: CardPrint[] = []
  let page = 0
  const pageSize = 1000
  let hasMore = true
  let latestAt = await getLatestUpdatePrintTime()
  console.log("Latest At", latestAt);
  // let latestAt = null
  while (hasMore) {
    if (latestAt) {
      const { data, count, error } = await supabase
        .from('card_prints')
        .select('*', { count: 'exact' })
        .gt('updated_at', latestAt)
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw new Error(`获取卡图失败：${error.message}`)
      if (data) totalData.push(...data)
      if (count && data && data.length < pageSize) hasMore = false
    } else {
      const { data, count, error } = await supabase
        .from('card_prints')
        .select('*', { count: 'exact' })
        .range(page * pageSize, (page + 1) * pageSize - 1)
      if (error) throw new Error(`获取卡图失败：${error.message}`)
      if (data) totalData.push(...data)
      if (count && data && data.length < pageSize) hasMore = false
    }

    page++
  }

  return totalData
}

/**
 * 获取所有图标数据（分页拉取）
 */
export async function fetchAllIcons(): Promise<IconDB[]> {
  const supabase = getSupabaseClient()
  const totalData: IconDB[] = []
  let page = 0
  const pageSize = 100
  let hasMore = true

  while (hasMore) {
    const { data, count, error } = await supabase
      .from('card_icons')
      .select('*', { count: 'exact' })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) throw new Error(`获取图标数据失败：${error.message}`)
    if (data) totalData.push(...data)
    if (count && data && data.length < pageSize) hasMore = false
    page++
  }

  return totalData
}

/**
 * 获取所有RULES数据（分页拉取）
 */
export async function fetchAllRules(): Promise<Rule[]> {
  const supabase = getSupabaseClient()
  const totalData: Rule[] = []
  let page = 0
  const pageSize = 100
  let hasMore = true

  while (hasMore) {
    const { data, count, error } = await supabase
      .from('rules')
      .select('*', { count: 'exact' })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (error) throw new Error(`获取RULES数据失败：${error.message}`)
    if (data) totalData.push(...data)
    if (count && data && data.length < pageSize) hasMore = false
    page++
  }

  return totalData
}
