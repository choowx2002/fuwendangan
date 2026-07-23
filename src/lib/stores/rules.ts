import { writable } from 'svelte/store'
import type { Rule, TreeNode } from '$lib/db/types'

export type Lang = 'zh' | 'en' | 'both'

export const rules = writable<Rule[]>([])
export const ruleMap = writable<Record<string, Rule>>({})
export const tree = writable<TreeNode[]>([])

export const lang = writable<Lang>('zh')
export const activeRule = writable<string | null>(null)
export const searchOpen = writable(false)
export const sidebarOpen = writable(true)
export const expandedRules = writable<Set<string>>(new Set())
