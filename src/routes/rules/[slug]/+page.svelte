<script lang="ts">
  import { onMount, tick } from 'svelte'
  import { page } from '$app/state'
  import { getRulesByDocName } from '$lib/db'
  import type { Rule, TreeNode } from '$lib/db/types'
  import { buildTree, getDisplayText, renderContent, scrollToRule } from '$lib/services/rules'
  import {
    rules,
    ruleMap,
    tree,
    lang,
    activeRule,
    expandedRules,
    type Lang,
  } from '$lib/stores/rules'
  import {  ChevronLeft, Menu } from '@lucide/svelte'
  import { isMobile } from '$lib/services/os-serives'
  import { longpress } from '$lib/services/longpress'
  import { writeText } from '@tauri-apps/plugin-clipboard-manager'
  import { goto } from '$app/navigation'

  let loading = $state(true)
  let searchQuery = $state('')
  let sidebarOpen = $state(false)
  let isMobileInit = $state(false)

  // 搜索结果
  let searchResults = $derived.by(() => {
    if (!searchQuery.trim()) return []
    const q = searchQuery.trim().toLowerCase()
    return $rules
      .filter(
        (r) =>
          r.rule_number.toLowerCase().includes(q) ||
          (r.text_zh || '').toLowerCase().includes(q) ||
          (r.text_en || '').toLowerCase().includes(q)
      )
      .slice(0, 50)
  })

  // 过滤后的树（用于搜索时）
  let filteredTree = $derived.by(() => {
    if (!searchQuery.trim()) return $tree
    const q = searchQuery.trim().toLowerCase()

    function filterNode(node: TreeNode): TreeNode | null {
      const matches =
        node.rule_number.toLowerCase().includes(q) ||
        (node.text_zh || '').toLowerCase().includes(q) ||
        (node.text_en || '').toLowerCase().includes(q)

      const filteredChildren = node.children
        .map(filterNode)
        .filter((n): n is TreeNode => n !== null)

      if (matches || filteredChildren.length > 0) {
        return { ...node, children: filteredChildren }
      }
      return null
    }

    return $tree.map(filterNode).filter((n): n is TreeNode => n !== null)
  })

  function toggleLang() {
    const langs: Lang[] = ['zh', 'en', 'both']
    const idx = langs.indexOf($lang)
    lang.set(langs[(idx + 1) % langs.length])
  }

  function handleRuleClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (target.classList.contains('rule-ref')) {
      const ruleNum = target.dataset.rule
      if (ruleNum) scrollToRule(ruleNum)
    }
  }

  function toggleExpand(nodeNum: string) {
    const newSet = new Set($expandedRules)
    if (newSet.has(nodeNum)) {
      newSet.delete(nodeNum)
    } else {
      newSet.add(nodeNum)
    }
    expandedRules.set(newSet)
  }

  function isExpanded(num: string) {
    return $expandedRules.has(num)
  }

  onMount(() => {
    isMobile().then((is) => {
      isMobileInit = is
    })

    const loadRules = async () => {
      try {
        const data = await getRulesByDocName(page.params.slug || 'core')

        rules.set(data)

        const map: Record<string, Rule> = {}
        data.forEach((r) => (map[r.rule_number] = r))

        ruleMap.set(map)
        tree.set(buildTree(data))

        loading = false
      } catch (error) {
        console.error(error)
        loading = false
      }
    }

    loadRules()

    const main = document.getElementById('main')
    if (!main) return

    // ScrollSpy - 滚动时同步
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        const mainEl = document.getElementById('main')
        if (!mainEl) {
          ticking = false
          return
        }

        // 计算主容器的垂直中线（相对于视口）
        const mainRect = mainEl.getBoundingClientRect()
        const middleY = mainRect.top + mainRect.height / 2

        const items = document.querySelectorAll('[data-rn]')
        let current: string | null = null

        // 找到横跨中线的元素：顶部在中线之上，底部在中线之下
        for (const el of items) {
          const rect = el.getBoundingClientRect()
          if (el.getBoundingClientRect().top < 180) {
            current = (el as HTMLElement).dataset.rn || null
          }
        }

        // Fallback：如果滚动到最顶部，所有元素都在中线下方
        // 此时取第一个 top 最接近中线的元素
        if (!current && items.length > 0) {
          const firstRect = items[0].getBoundingClientRect()
          if (firstRect.top > middleY) {
            current = (items[0] as HTMLElement).dataset.rn || null
          }
        }

        if (current && current !== $activeRule) {
          updateActiveRule(current)
        }
        ticking = false
      })
    }

    // Click - 点击时同步
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const ruleEl = target.closest('[data-rn]')
      if (ruleEl) {
        const ruleNum = (ruleEl as HTMLElement).dataset.rn
        if (ruleNum) {
          updateActiveRule(ruleNum)
        }
      }
    }

    function updateActiveRule(ruleNum: string) {
      activeRule.set(ruleNum)

      const map: Record<string, TreeNode> = {}
      function walk(nodes: TreeNode[]) {
        nodes.forEach((n) => {
          map[n.rule_number] = n
          walk(n.children)
        })
      }
      walk($tree)

      const newExpanded = new Set($expandedRules)
      let cur: string | null = ruleNum
      while (cur && map[cur]) {
        newExpanded.add(cur)
        cur = map[cur].parent_number
      }
      expandedRules.set(newExpanded)

      tick().then(() => {
        const activeItem = document.querySelector('.toc-item.active')
        if (activeItem) {
          activeItem.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
          })
        }
      })
    }

    main.addEventListener('scroll', onScroll)
    main.addEventListener('click', onClick)

    // ======================
    // Cleanup
    // ======================
    return () => {
      if (main) {
        main.removeEventListener('scroll', onScroll)
        main.removeEventListener('click', onClick)
      }
    }
  })

  let toastMsg = $state('')

  async function triggerAction(rule: Rule, lang: Lang) {
    let text: string | null = `${rule.rule_number}. `
    try {
      if (lang === 'zh') {
        text += rule.text_zh?.trim()
      } else if (lang === 'en') {
        text += rule.text_en?.trim()
      } else {
        text += `${rule.text_zh?.trim()} \n${rule.text_en?.trim()}`
      }

      await writeText(text)

      // 显示 Toast 提示
      showToast(`已复制规则 ${rule.rule_number}`)
    } catch (error) {
      console.error('复制失败', error)
      showToast('复制失败')
    }
  }

  function showToast(msg: string) {
    toastMsg = msg
    setTimeout(() => {
      toastMsg = ''
    }, 2000)
  }
</script>

<div class="page">
  <!-- Sidebar -->
  {#if !isMobileInit}
    <div
      style="cursor: pointer ;position: fixed; top: calc(env(safe-area-inset-top) + 16px); left: 16px;  width: 56px;
         height: 56px;display: flex; justify-content: center; align-items: center;z-index: 1;"
    >
      <ChevronLeft size={32} onclick={() => goto('/rules')} />
    </div>
  {/if}
  <aside class="sidebar" class:collapsed={!sidebarOpen}>
    <div class="search-box">
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input type="text" bind:value={searchQuery} placeholder="搜索规则…" class="search-input" />
    </div>

    <div class="toc">
      {#if searchQuery.trim()}
        <!-- 搜索模式 -->
        <div class="toc-section">
          <div class="toc-label">搜索结果 ({searchResults.length})</div>
          {#each searchResults as r}
            <button class="toc-item" onclick={() => scrollToRule(r.rule_number)}>
              <span class="toc-num">{r.rule_number}</span>
              <span class="toc-title" class:heading={r.is_heading}>
                {$lang === 'en' ? r.text_en : r.text_zh}
              </span>
            </button>
          {/each}
        </div>
      {:else}
        <!-- 正常目录模式 -->
        {#each filteredTree as node}
          {@render tocNode(node, 0)}
        {/each}
      {/if}
    </div>
  </aside>

  <!-- Main Content -->
  <main class="main" id="main">
    {#if loading}
      <div class="loading">加载中...</div>
    {:else}
      <div class="content-wrap">
        <div class="book">
          <header class="book-header">
            <h1 class="book-title">符文战场</h1>
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
                  use:longpress={{ duration: 800, onLongPress: () => triggerAction(rule, $lang) }}
                >
                  <div class="chapter-num">Chapter {rule.rule_number}</div>
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
                  use:longpress={{ duration: 800, onLongPress: () => triggerAction(rule, $lang) }}
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
                <div
                  class="rule-row rule-anchor"
                  id="r-{rule.rule_number}"
                  data-rn={rule.rule_number}
                  use:longpress={{ duration: 800, onLongPress: () => triggerAction(rule, $lang) }}
                >
                  <div class="rule-num">{rule.rule_number}</div>
                  <div class="rule-body">
                    {@html renderContent(rule, $lang)}
                  </div>
                </div>
              {/if}
            {/each}
          </div>

          <footer class="book-footer">— 完 —</footer>
        </div>
      </div>
    {/if}
  </main>

  <!-- FAB - Language Switcher -->
  <button class="fab" onclick={toggleLang} title="切换语言">
    {#if $lang === 'zh'}
      中
    {:else if $lang === 'en'}
      EN
    {:else}
      双语
    {/if}
  </button>

  <!-- Mobile Sidebar Toggle -->
  <!-- svelte-ignore a11y_consider_explicit_label -->
  <button class="mobile-toggle" onclick={() => (sidebarOpen = !sidebarOpen)}>
    <Menu size={24} />
  </button>

  {#if toastMsg}
    <div class="toast">{toastMsg}</div>
  {/if}
</div>

{#snippet tocNode(node: TreeNode, depth: number)}
  <div class="tree-node">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="toc-item"
      class:active={$activeRule === node.rule_number}
      class:heading={node.is_heading}
      style="padding-left: {depth * 12 + 8}px"
      onclick={(e) => {
        if ((e.target as HTMLElement).closest('.toggle-btn')) {
          toggleExpand(node.rule_number)
        } else {
          scrollToRule(node.rule_number)
        }
      }}
    >
      <button class="toggle-btn">
        {#if node.children.length > 0}
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            style="transform: rotate({isExpanded(node.rule_number)
              ? '0deg'
              : '-90deg'}); transition: transform 0.15s;"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        {:else}
          <span class="dot"></span>
        {/if}
      </button>
      <span class="toc-num">{node.rule_number}</span>
      <span class="toc-title" title="{node.text_zh}\n{node.text_en}">
        {$lang === 'en' ? node.text_en : node.text_zh}
      </span>
    </div>
    {#if node.children.length > 0 && isExpanded(node.rule_number)}
      <div class="toc-children">
        {#each node.children as child}
          {@render tocNode(child, depth + 1)}
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  .page {
    display: flex;
    min-height: 100vh;
    position: relative;
  }

  /* Sidebar */
  .sidebar {
    padding-top: env(safe-area-inset-top);
    width: 280px;
    background: #d7c8b4;
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    z-index: 40;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.08);
  }

  .sidebar.collapsed {
    transform: translateX(-100%);
  }

  @media (max-width: 767.99px) {
    .sidebar {
      width: 85vw;
      max-width: 320px;
      box-shadow: 4px 0 16px rgba(0, 0, 0, 0.08);
    }
  }

  /* Search */
  .search-box {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    background: #d7c8b4;
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: var(--text-sm);
    color: var(--text-primary);
  }

  .search-input::placeholder {
    color: var(--text-secondary);
  }

  /* TOC */
  .toc {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }

  .toc-section {
    padding: 0 8px;
  }

  .toc-label {
    padding: 8px 8px 4px;
    font-size: var(--text-xs);
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
  }

  .toc-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    cursor: pointer;
    border-left: 2px solid transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    transition: all 0.3s;
    user-select: none;
    width: 100%;
    text-align: left;
    background: #ffffff00;
    border: none;
    border-left: 2px solid transparent;
  }

  .toc-item:hover {
    background: #5f3100;
    color: var(--bg-primary);
  }

  .toc-item.heading .toc-title {
    font-weight: 600;
    color: var(--text-primary);
  }

  .toc-item:hover .toc-title {
    color: var(--bg-primary);
  }

  .toc-item.active {
    border-left-color: var(--accent-color);
    background: #5f3100;
    color: var(--bg-primary);
  }

  .toc-item.heading.active .toc-title {
    color: var(--bg-primary);
  }

  .toggle-btn {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
  }

  .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--text-tertiary);
  }

  .toc-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    color: var(--text-primary);
    flex-shrink: 0;
  }

  .toc-item.active .toc-num {
    color: var(--bg-primary);
  }

  .toc-item:hover .toc-num {
    color: var(--bg-primary);
  }

  .toc-title {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .toc-children {
    overflow: hidden;
  }

  /* Main */
  .main {
    flex: 1;
    transform: translateX(280px);
    overflow-y: auto;
    height: 100vh;
    background: #d7c8b4;
    transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    will-change: transform;
  }

  .sidebar.collapsed ~ .main {
    transform: translateX(0);
  }

  @media (max-width: 767.99px) {
    .main {
      transform: translateX(0);
    }
  }

  .loading {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--text-tertiary);
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
    max-width: 820px;
    margin: 0 auto;
    background: #d7c8b4;
    border: 1px solid var(--border-color);
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
    border-bottom: 1px solid var(--border-color);
    margin-bottom: 32px;
  }

  .book-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: 0.08em;
    margin: 0 0 6px 0;
    color: #5f3100;
  }

  .book-sub {
    font-size: var(--text-sm);
    color: #5f3100;
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
    color: #5f3100;
    letter-spacing: 0.2em;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  .chapter-title {
    font-size: var(--text-2xl);
    font-weight: 700;
    letter-spacing: 0.05em;
    margin: 0 0 4px 0;
  }

  .chapter-title-en {
    font-size: var(--text-md);
    color: var(--text-secondary);
    font-style: italic;
    margin-top: 4px;
  }

  .chapter-divider {
    width: 120px;
    height: 1px;
    margin: 16px auto 0;
    background: linear-gradient(90deg, transparent, var(--border-color), transparent);
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
  }

  .section-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: #5f3100;
  }

  .section-title-en {
    display: block;
    font-size: var(--text-sm);
    color: #5f3100;
    font-style: italic;
    margin-top: 4px;
  }

  /*.rules-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px;
  }*/

  .rule-row {
    display: flex;
    flex-direction: row;
    gap: 4px;
    padding: 12px;
    border-radius: var(--radius-sm);
    border-bottom: none;
    transition: background 0.15s;
    white-space: break-spaces;
  }

  @media (hover: hover) and (pointer: fine) {
    .rule-row:hover {
      background: var(--bg-hover);
    }
  }

  @media (hover: none) {
    .rule-row:active {
      background: var(--bg-hover);
    }
  }

  .rule-row:last-child {
    border-bottom: none;
  }

  .rule-num {
    font-family: 'JetBrains Mono', monospace;
    font-size: var(--text-xs);
    color: #5f3100;
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
    /* margin-top: 8px; */
    padding-top: 8px;
    /* border-top: 1px dashed var(--border-color); */
    color: #50381f;
    /* font-style: italic; */
    font-size: var(--text-base);
    line-height: 1.8;
  }

  .rule-body :global(.rule-ref) {
    color: var(--accent-color);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
    cursor: pointer;
    border-bottom: 1px dashed var(--accent-color);
    padding: 0 2px;
    transition: all 0.15s;
  }

  .rule-body :global(.rule-ref:hover) {
    border-bottom-style: solid;
    background: rgba(18, 131, 120, 0.08);
  }

  .book-footer {
    text-align: center;
    margin-top: 48px;
    padding-top: 24px;
    border-top: 1px solid var(--border-color);
    color: var(--text-tertiary);
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
      background: rgba(18, 131, 120, 0.12);
    }
  }

  /* FAB */
  .fab {
    position: fixed;
    top: calc(env(safe-area-inset-top) + 16px);
    right: 82px;
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: #af7f08;
    color: white;
    border: none;
    font-size: var(--text-sm);
    font-weight: 600;
    cursor: pointer;
    box-shadow: 0 4px 12px rgba(18, 131, 120, 0.3);
    transition: all 0.5s;
    z-index: 50;
  }

  .fab:hover {
    transform: scale(1.05);
    box-shadow: 0 6px 16px rgba(18, 131, 120, 0.4);
  }

  @media (max-width: 767.99px) {
    .fab {
      top: auto;

      right: 16px;
      bottom: 16px;
      width: 48px;
      height: 48px;
    }
  }

  /* Mobile Toggle */
  .mobile-toggle {
    display: flex;
    position: fixed;
    top: calc(env(safe-area-inset-top) + 16px);
    right: 16px;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-md);
    background: #af7f08;
    color: white;
    border: 1px solid var(--border-color);
    cursor: pointer;
    z-index: 45;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 767.99px) {
    .mobile-toggle {
      top: auto;
      right: 16px;
      bottom: 72px;
      width: 48px;
      height: 48px;
    }
  }

  /* Toast 提示 */
  .toast {
    position: fixed;
    bottom: 10%; /* 避开底部的 FAB 按钮 */
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent-color);
    color: var(--bg-primary);
    padding: 10px 20px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    animation: fadeInOut 2s ease-in-out;
    pointer-events: none;
  }

  @keyframes fadeInOut {
    0% {
      opacity: 0;
      transform: translateX(-50%) translateY(10px);
    }
    15% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    85% {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
    100% {
      opacity: 0;
      transform: translateX(-50%) translateY(-10px);
    }
  }
</style>
