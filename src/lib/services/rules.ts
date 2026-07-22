import type { Rule, TreeNode } from '$lib/db/types'
import { ruleMap, lang, type Lang } from '$lib/stores/rules'
import { get } from 'svelte/store'

export function buildTree(rules: Rule[]): TreeNode[] {
  const map: Record<string, TreeNode> = {}
  const roots: TreeNode[] = []
  rules.forEach((r) => (map[r.rule_number] = { ...r, children: [] }))
  rules.forEach((r) => {
    const node = map[r.rule_number]
    if (r.parent_number && map[r.parent_number]) {
      map[r.parent_number].children.push(node)
    } else {
      roots.push(node)
    }
  })
  return roots
}

export function parseRuleRefs(text: string): string {
  if (!text) return ''
  const map = get(ruleMap)
  const regex = /\b(?:(?:rule|规则)\s+)?(\d{3}(?:\.\w+)*)(?:\.?(?=\s|[，。,.!！?？;；：:]|$))/gi
  let result = '',
    lastIndex = 0,
    match
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) result += esc(text.slice(lastIndex, match.index))
    const ruleNum = match[1]
    if (map[ruleNum]) {
      result += `<a class="rule-ref" data-rule="${ruleNum}">${esc(match[0])}</a>`
    } else {
      result += esc(match[0])
    }
    lastIndex = regex.lastIndex
  }
  return result + esc(text.slice(lastIndex))
}

export function getDisplayText(rule: Rule, lang: Lang): string {
  return lang === 'en' ? (rule.text_en ?? '') : (rule.text_zh ?? '')
}

export function renderContent(rule: Rule, lang: Lang): string {
  const l = lang
  if (l === 'en') return `<div>${parseRuleRefs(rule.text_en ?? '')}</div>`
  if (l === 'zh') return `<div>${parseRuleRefs(rule.text_zh ?? '')}</div>`
  return `<div>${parseRuleRefs(rule.text_zh ?? '')}</div><div class="bilingual-en">${parseRuleRefs(rule.text_en ?? '')}</div>`
}

export function highlightText(text: string, query: string): string {
  if (!text || !query) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  return escaped.replace(regex, '<span class="search-hl">$1</span>')
}

export function escapeHtml(s: string): string {
  if (!s) return ''
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function scrollToRule(ruleNumber: string) {
  const el = document.getElementById(`r-${ruleNumber}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('rule-flash')
  void el.offsetWidth
  el.classList.add('rule-flash')
}
