<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { page } from '$app/state'
  import { getRulesByDocName } from '$lib/db'
  import type { Rule } from '$lib/db/types'
  import { getDisplayText, renderContent, scrollToRule, highlightText } from '$lib/services/rules'
  import { rules, ruleMap, lang, type Lang } from '$lib/stores/rules'
  import { rulesTheme } from '$lib/stores/settings'
  import { ChevronLeft, Palette, Search, X, Copy, Check, CheckSquare } from '@lucide/svelte'
  import { longpress } from '$lib/utils/longpress'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { goto } from '$app/navigation'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  const THEMES = [
    { id: 'parchment', labelKey: 'rules.themeParchment', color: '#d7c8b4', text: '#3f2d1a' },
    { id: 'paper', labelKey: 'rules.themePaper', color: '#ffffff', text: '#333333' },
    { id: 'dark', labelKey: 'rules.themeDark', color: '#21252e', text: '#d6d8de' },
    { id: 'ink', labelKey: 'rules.themeInk', color: '#2a3a4d', text: '#d8e0ea' },
    { id: 'forest', labelKey: 'rules.themeForest', color: '#f5f7ec', text: '#2f3a25' },
  ]

  let loading = $state(true)
  let searchQuery = $state('')
  let effectiveQuery = $state('')
  let searchOpen = $state(false)
  let searchInput = $state<HTMLInputElement | null>(null)
  let copyMode = $state(false)
  let selectedRules = $state<Set<string>>(new Set())
  let themeMenuOpen = $state(false)
  let searchTimer: ReturnType<typeof setTimeout> | null = null

  const selectedCount = $derived(selectedRules.size)

  let suppressClickUntil = 0

  // 搜索结果（防抖后的查询词）
  const searchResults = $derived.by(() => {
    if (!effectiveQuery.trim()) return []
    const q = effectiveQuery.trim().toLowerCase()
    return $rules.filter(
      (r) =>
        r.rule_number.toLowerCase().includes(q) ||
        (r.text_zh || '').toLowerCase().includes(q) ||
        (r.text_en || '').toLowerCase().includes(q)
    )
  })

  function scheduleSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchTimer = setTimeout(() => {
      effectiveQuery = searchQuery
    }, 250)
  }

  onDestroy(() => {
    if (searchTimer) clearTimeout(searchTimer)
  })

  function setLang(l: Lang) {
    lang.set(l)
  }

  function goBack() {
    goto('/rules')
  }

  function toggleThemeMenu() {
    themeMenuOpen = !themeMenuOpen
  }

  function applyTheme(id: string) {
    rulesTheme.set(id)
    themeMenuOpen = false
  }

  function clearSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchQuery = ''
    effectiveQuery = ''
  }

  function openSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchQuery = ''
    effectiveQuery = ''
    searchOpen = true
    tick().then(() => {
      const el = searchInput
      if (el) {
        el.focus()
      }
    })
  }

  function closeSearch() {
    if (searchTimer) clearTimeout(searchTimer)
    searchOpen = false
  }

  function toggleCopyMode() {
    copyMode = !copyMode
    selectedRules = new Set()
  }

  function toggleSelect(ruleNumber: string) {
    const next = new Set(selectedRules)
    if (next.has(ruleNumber)) {
      next.delete(ruleNumber)
    } else {
      next.add(ruleNumber)
    }
    selectedRules = next
  }

  function longpressSelect(ruleNumber: string) {
    suppressClickUntil = Date.now() + 600
    if (!copyMode) copyMode = true
    toggleSelect(ruleNumber)
  }

  function buildCopyText(list: Rule[]): string {
    return list
      .map((r) => {
        let text = `${r.rule_number}. `
        if ($lang === 'zh') text += r.text_zh?.trim() ?? ''
        else if ($lang === 'en') text += r.text_en?.trim() ?? ''
        else text += `${r.text_zh?.trim() ?? ''}\n${r.text_en?.trim() ?? ''}`
        return text
      })
      .join('\n')
  }

  async function copyRulesText(list: Rule[]) {
    if (list.length === 0) return
    const text = buildCopyText(list)
    try {
      await writeText(text)
      showToast(get(t)('rules.copiedCount', { values: { count: list.length } }), 'success')
      if (list.length > 1) {
        selectedRules = new Set()
      }
    } catch (error) {
      console.error('复制失败', error)
      showToast(get(t)('rules.copyFailed'), 'error')
    }
  }

  function copySelected() {
    const toCopy = $rules.filter((r) => selectedRules.has(r.rule_number))
    copyRulesText(toCopy)
  }

  function handleRuleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.classList.contains('rule-ref')) {
      const ruleNum = target.dataset.rule
      if (ruleNum) scrollToRule(ruleNum)
    }
  }

  onMount(() => {
    const loadRules = async () => {
      try {
        const data = await getRulesByDocName(page.params.slug || 'core')

        rules.set(data)

        const map: Record<string, Rule> = {}
        data.forEach((r) => (map[r.rule_number] = r))

        ruleMap.set(map)

        loading = false
      } catch (error) {
        console.error(error)
        loading = false
      }
    }

    loadRules()
  })
</script>

<div class="page" data-theme={$rulesTheme}>
  <!-- 顶部阅读工具栏 -->
  <header class="toolbar">
    <button class="tb-btn" onclick={goBack} aria-label={$t('common.back')} title={$t('common.back')}>
      <ChevronLeft size={18} />
    </button>
    <span class="tb-title">{page.params.slug}</span>
    <span class="tb-spacer"></span>

    <button class="tb-btn" onclick={openSearch} aria-label={$t('common.search')} title={$t('common.search')}>
      <Search size={18} />
    </button>

    <div class="lang-seg" role="group" aria-label={$t('rules.language')}>
      <button class:active={$lang === 'zh'} onclick={() => setLang('zh')}>中</button>
      <button class:active={$lang === 'en'} onclick={() => setLang('en')}>EN</button>
      <button class:active={$lang === 'both'} onclick={() => setLang('both')}>{$t('rules.bothLang')}</button>
    </div>

    <button
      class="tb-btn"
      class:active={themeMenuOpen}
      onclick={toggleThemeMenu}
      aria-label={$t('rules.backgroundTheme')}
      title={$t('rules.backgroundTheme')}
    >
      <Palette size={18} />
    </button>

    <button
      class="tb-btn"
      class:active={copyMode}
      onclick={toggleCopyMode}
      aria-label={$t('rules.multiCopy')}
      title={$t('rules.multiCopy')}
    >
      <CheckSquare size={18} />
    </button>
  </header>

  <!-- 主题选择 -->
  {#if themeMenuOpen}
    <div class="theme-menu">
      <div class="theme-menu-label">{$t('rules.backgroundTheme')}</div>
      <div class="theme-grid">
        {#each THEMES as theme (theme.id)}
          <button
            class="theme-option"
            class:active={$rulesTheme === theme.id}
            onclick={() => applyTheme(theme.id)}
          >
            <span class="theme-swatch" style="background: {theme.color}; color: {theme.text}">Aa</span>
            <span class="theme-name">{$t(theme.labelKey)}</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- 正文 -->
  <main class="main" id="main">
    {#if loading}
      <div class="loading">{$t('common.loading')}</div>
    {:else}
      <div class="content-wrap">
        <div class="book">
          <header class="book-header">
            <h1 class="book-title">{$t('rules.bookTitle')}</h1>
            <div class="book-sub">{page.params.slug}</div>
          </header>

          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="rules-list" onclick={handleRuleClick}>
            {#each $rules as rule, index (index)}
              {#if rule.level === 1 && rule.is_heading}
                <section
                  class="chapter rule-anchor"
                  id="r-{rule.rule_number}"
                  data-rn={rule.rule_number}
                  use:longpress={{ duration: 800, onLongPress: () => longpressSelect(rule.rule_number) }}
                >
                  <div class="chapter-num">{$t('rules.chapterLabel', { values: { number: rule.rule_number } })}</div>
                  <h2 class="chapter-title">{getDisplayText(rule, $lang)}</h2>
                  {#if $lang === 'both'}
                    <div class="chapter-title-en">{rule.text_en}</div>
                  {/if}
                  <div class="chapter-divider"></div>
                </section>
              {:else if rule.is_heading}
                <section
                  class="section rule-anchor"
                  id="r-{rule.rule_number}"
                  data-rn={rule.rule_number}
                  use:longpress={{ duration: 800, onLongPress: () => longpressSelect(rule.rule_number) }}
                >
                  <h3 class="section-title">
                    <div class="section-num">{rule.rule_number}</div>
                    {getDisplayText(rule, $lang)}
                  </h3>
                  {#if $lang === 'both'}
                    <div class="section-title-en">{rule.text_en}</div>
                  {/if}
                </section>
              {:else}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="rule-row rule-anchor"
                  class:selected={copyMode && selectedRules.has(rule.rule_number)}
                  id="r-{rule.rule_number}"
                  data-rn={rule.rule_number}
                  use:longpress={{ duration: 800, onLongPress: () => longpressSelect(rule.rule_number) }}
                  onclick={() => {
                    if (Date.now() < suppressClickUntil) return
                    if (copyMode) toggleSelect(rule.rule_number)
                  }}
                >
                  {#if copyMode}
                    <span class="row-check" class:checked={selectedRules.has(rule.rule_number)}>
                      {#if selectedRules.has(rule.rule_number)}
                        <Check size={12} strokeWidth={4} />
                      {/if}
                    </span>
                  {/if}
                  <div class="rule-num">{rule.rule_number}</div>
                  <div class="rule-body selectable">
                    {@html renderContent(rule, $lang)}
                  </div>
                </div>
              {/if}
            {/each}
          </div>

          <footer class="book-footer">{$t('rules.endOfBook')}</footer>
        </div>
      </div>
    {/if}
  </main>

  <!-- 多选复制浮动条 -->
  {#if copyMode && selectedCount > 0}
    <div class="multi-bar">
      <span class="multi-count">{$t('rules.selectedCount', { values: { count: selectedCount } })}</span>
      <button class="multi-copy" onclick={copySelected}>
        <Copy size={14} /> {$t('rules.copyAll')}
      </button>
      <button class="multi-cancel" onclick={toggleCopyMode}>{$t('common.cancel')}</button>
    </div>
  {/if}

  <!-- 搜索浮层 -->
  <CommonModal open={searchOpen} onclose={closeSearch} width="min(560px, 100%)">
    {#snippet header()}
      <div class="search-modal-header">
        <Search size={16} class="search-bar-icon" />
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          oninput={scheduleSearch}
          placeholder={$t('rules.searchPlaceholder')}
          class="search-bar-input"
        />
        {#if searchQuery}
          <button class="search-modal-clear" onclick={clearSearch} aria-label={$t('rules.clearSearch')}>
            <X size={14} />
          </button>
        {/if}
      </div>
    {/snippet}

    <div class="search-results">
      {#if !effectiveQuery.trim()}
        <div class="search-empty">{$t('rules.searchHint')}</div>
      {:else if searchResults.length === 0}
        <div class="search-empty">{$t('rules.noMatches')}</div>
      {:else}
        {#each searchResults as r (r.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <button
            class="search-result"
            onclick={() => {
              scrollToRule(r.rule_number)
              closeSearch()
            }}
          >
            <span class="search-result-num">{r.rule_number}</span>
            <span class="search-result-text">
              {@html highlightText(
                $lang === 'en' ? (r.text_en ?? '') : (r.text_zh ?? ''),
                effectiveQuery.trim()
              )}
            </span>
          </button>
        {/each}
      {/if}
    </div>
  </CommonModal>
</div>

<style>
  /* ===================== 主题变量 ===================== */
  .page {
    --rules-toolbar: 48px;
    --rules-toolbar-h: calc(48px + env(safe-area-inset-top));
    min-height: 100vh;
    position: relative;
    background: var(--rules-bg);
    color: var(--rules-text);
  }

  .page[data-theme='parchment'] {
    --rules-bg: #d7c8b4;
    --rules-book: #e5dbc8;
    --rules-text: #3a2c18;
    --rules-muted: #5f3100;
    --rules-weak: #6b4a2b;
    --rules-border: #c9b48f;
    --rules-accent: #af7f08;
    --rules-on-accent: #ffffff;
    --rules-hl: rgba(175, 127, 8, 0.25);
  }

  .page[data-theme='paper'] {
    --rules-bg: #eef1f5;
    --rules-book: #ffffff;
    --rules-text: #333333;
    --rules-muted: #4a5568;
    --rules-weak: #64748b;
    --rules-border: #d7dce2;
    --rules-accent: #2f6feb;
    --rules-on-accent: #ffffff;
    --rules-hl: rgba(47, 111, 235, 0.18);
  }

  .page[data-theme='dark'] {
    --rules-bg: #1a1d24;
    --rules-book: #21252e;
    --rules-text: #d6d8de;
    --rules-muted: #a6adb8;
    --rules-weak: #8b93a1;
    --rules-border: #333947;
    --rules-accent: #e0a64b;
    --rules-on-accent: #14161c;
    --rules-hl: rgba(224, 166, 75, 0.28);
  }

  .page[data-theme='ink'] {
    --rules-bg: #22303f;
    --rules-book: #2a3a4d;
    --rules-text: #d8e0ea;
    --rules-muted: #a9b6c4;
    --rules-weak: #8fa1b3;
    --rules-border: #3b4d63;
    --rules-accent: #6fb1e8;
    --rules-on-accent: #0f1b26;
    --rules-hl: rgba(111, 177, 232, 0.3);
  }

  .page[data-theme='forest'] {
    --rules-bg: #edf1e2;
    --rules-book: #f5f7ec;
    --rules-text: #2f3a25;
    --rules-muted: #56613f;
    --rules-weak: #6a7354;
    --rules-border: #cfd6b6;
    --rules-accent: #5c7a3a;
    --rules-on-accent: #ffffff;
    --rules-hl: rgba(92, 122, 58, 0.2);
  }

  /* ===================== 工具栏 ===================== */
  .toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--rules-toolbar-h);
    padding: env(safe-area-inset-top) 12px 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 6px;
    background: color-mix(in srgb, var(--rules-bg) 96%, transparent);
    border-bottom: 1px solid var(--rules-border);
    overflow-x: auto;
    scrollbar-width: none;
  }
  .toolbar::-webkit-scrollbar {
    display: none;
  }

  .tb-btn {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--rules-muted);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }
  .tb-btn:hover {
    background: color-mix(in srgb, var(--rules-text) 10%, transparent);
  }
  .tb-btn.active {
    background: color-mix(in srgb, var(--rules-accent) 18%, transparent);
    color: var(--rules-accent);
  }

  .tb-title {
    font-size: var(--text-sm);
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--rules-muted);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex-shrink: 0;
  }

  .tb-spacer {
    flex: 1;
  }

  @media (max-width: 767.99px) {
    .tb-title {
      display: none;
    }
  }

  .lang-seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: color-mix(in srgb, var(--rules-text) 8%, transparent);
    flex-shrink: 0;
  }
  .lang-seg button {
    border: none;
    background: transparent;
    color: var(--rules-muted);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .lang-seg button:hover {
    color: var(--rules-text);
  }
  .lang-seg button.active {
    background: var(--rules-accent);
    color: var(--rules-on-accent);
  }

  /* ===================== 主题菜单 ===================== */
  .theme-menu {
    position: fixed;
    top: calc(var(--rules-toolbar-h) + 8px);
    right: 12px;
    z-index: 59;
    width: 220px;
    background: var(--rules-book);
    border: 1px solid var(--rules-border);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.18);
    padding: 12px;
  }
  .theme-menu-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--rules-muted);
    margin-bottom: 8px;
  }
  .theme-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
  }
  .theme-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s;
  }
  .theme-option:hover {
    background: color-mix(in srgb, var(--rules-text) 10%, transparent);
  }
  .theme-option.active {
    outline: 2px solid var(--rules-accent);
    outline-offset: -1px;
  }
  .theme-swatch {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 1px solid rgba(0, 0, 0, 0.15);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .theme-name {
    font-size: var(--text-xs);
    color: var(--rules-text);
  }

  /* ===================== 主内容 ===================== */
  .main {
    height: calc(100vh - var(--rules-toolbar-h));
    margin-top: var(--rules-toolbar-h);
    overflow-y: auto;
    background: var(--rules-bg);
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--rules-weak);
  }

  .content-wrap {
    padding: 32px 40px 80px;
  }

  @media (max-width: 767.99px) {
    .content-wrap {
      padding: 16px 16px 80px;
    }
  }

  .book {
    max-width: 900px;
    margin: 0 auto;
    background: var(--rules-book);
    border: 1px solid var(--rules-border);
    border-radius: var(--radius-lg);
    padding: 40px 48px;
  }

  @media (max-width: 767.99px) {
    .book {
      padding: 24px 10px;
    }
  }

  .book-header {
    text-align: center;
    padding-bottom: 24px;
    border-bottom: 1px solid var(--rules-border);
    margin-bottom: 32px;
  }

  .book-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: 0.08em;
    margin: 0 0 6px 0;
    color: var(--rules-muted);
  }

  .book-sub {
    font-size: var(--text-sm);
    color: var(--rules-muted);
    letter-spacing: 0.15em;
  }

  .chapter {
    margin: 48px 0 32px;
    text-align: center;
  }

  .chapter:first-child {
    margin-top: 0;
  }

  .chapter-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: var(--rules-muted);
    letter-spacing: 0.2em;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .chapter-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: 0.05em;
    margin: 0 0 4px 0;
    color: var(--rules-text);
  }

  .chapter-title-en {
    font-size: var(--text-md);
    color: var(--rules-weak);
    font-style: italic;
    margin-top: 4px;
  }

  .chapter-divider {
    width: 120px;
    height: 1px;
    margin: 16px auto 0;
    background: linear-gradient(90deg, transparent, var(--rules-border), transparent);
  }

  .section {
    margin: 28px 0 16px;
    text-align: center;
  }

  .section-title {
    font-size: var(--text-lg);
    font-weight: 600;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 0;
    color: var(--rules-text);
  }

  .section-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: var(--rules-muted);
  }

  .section-title-en {
    display: block;
    font-size: var(--text-sm);
    color: var(--rules-muted);
    font-style: italic;
    margin-top: 4px;
  }

  .rule-row {
    position: relative;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 6px;
    padding: 10px 12px;
    border-radius: 8px;
    transition: background 0.15s;
    white-space: break-spaces;
  }

  @media (hover: hover) and (pointer: fine) {
    .rule-row:hover {
      background: color-mix(in srgb, var(--rules-text) 6%, transparent);
    }
  }

  @media (hover: none) {
    .rule-row:active {
      background: color-mix(in srgb, var(--rules-text) 6%, transparent);
    }
  }

  .rule-row.selected {
    background: color-mix(in srgb, var(--rules-accent) 16%, transparent);
  }

  .rule-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: var(--rules-muted);
    flex-shrink: 0;
    min-width: 72px;
    padding-top: 3px;
    user-select: all;
  }

  @media (max-width: 767.99px) {
    .rule-num {
      min-width: 32px;
    }
  }

  .rule-body {
    flex: 1;
    font-size: var(--text-base);
    line-height: 1.9;
    text-align: justify;
    font-weight: 600;
  }

  .rule-body :global(.bilingual-en) {
    padding-top: 8px;
    color: var(--rules-weak);
    font-size: var(--text-base);
    line-height: 1.8;
  }

  .rule-body :global(.rule-ref) {
    color: var(--rules-accent);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
    cursor: pointer;
    border-bottom: 1px dashed var(--rules-accent);
    padding: 0 2px;
    transition: all 0.15s;
  }

  .rule-body :global(.rule-ref:hover) {
    border-bottom-style: solid;
    background: var(--rules-hl);
  }

  :global(.search-hl) {
    background: var(--rules-hl);
    color: var(--rules-text);
    border-radius: 2px;
    padding: 0 1px;
    font-weight: 700;
  }

  .book-footer {
    text-align: center;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--rules-border);
    color: var(--rules-weak);
    font-size: var(--text-sm);
    letter-spacing: 0.2em;
  }

  .rule-anchor {
    scroll-margin-top: 16px;
    user-select: none;
  }

  :global(.rule-flash) {
    animation: flash 1.8s ease;
  }

  @keyframes flash {
    0%,
    100% {
      background: transparent;
    }
    30%,
    70% {
      background: var(--rules-hl);
    }
  }

  /* ===================== 多选勾选 ===================== */
  .row-check {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    margin-top: 3px;
    border-radius: 5px;
    border: 1.5px solid var(--rules-border);
    background: var(--rules-book);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
  }
  .row-check.checked {
    background: var(--rules-accent);
    border-color: var(--rules-accent);
  }

  /* ===================== 多选浮动条 ===================== */
  .multi-bar {
    position: fixed;
    left: 50%;
    bottom: max(16px, env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 70;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border-radius: 999px;
    background: var(--rules-text);
    color: var(--rules-bg);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    white-space: nowrap;
  }
  .multi-count {
    font-size: var(--text-sm);
    font-weight: 600;
  }
  .multi-copy {
    display: flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 999px;
    padding: 6px 14px;
    background: var(--rules-accent);
    color: var(--rules-on-accent);
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
  }
  .multi-cancel {
    border: none;
    background: transparent;
    color: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    padding: 6px 8px;
  }

  /* ===================== 搜索浮层 ===================== */
  .page :global(.modal-overlay .modal) {
    background: var(--rules-book);
    border-color: var(--rules-border);
    color: var(--rules-text);
  }

  .search-modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 16px 20px;
    border-bottom: 1px solid var(--rules-border);
    font-size: var(--text-base);
    --text-primary: var(--rules-text);
    --text-tertiary: var(--rules-muted);
    --accent-color: var(--rules-accent);
  }
  .search-modal-clear {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, var(--rules-text) 10%, transparent);
    color: var(--rules-muted);
    cursor: pointer;
  }

  .search-results {
    display: flex;
    flex-direction: column;
    gap: 4px;
    height: min(420px, 45vh);
    overflow-y: auto;
  }

  .search-empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px 8px;
    text-align: center;
    font-size: var(--text-sm);
    color: var(--rules-weak);
  }

  .search-result {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    cursor: pointer;
    transition: background 0.15s;
  }
  .search-result:hover {
    background: color-mix(in srgb, var(--rules-text) 8%, transparent);
  }
  .search-result-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: var(--rules-muted);
    flex-shrink: 0;
    padding-top: 2px;
  }
  .search-result-text {
    flex: 1;
    min-width: 0;
    font-size: var(--text-sm);
    line-height: 1.6;
    color: var(--rules-text);
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
</style>
