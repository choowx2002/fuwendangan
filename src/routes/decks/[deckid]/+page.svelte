<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckVersions,
    getDeckVersionCards,
    getLatestDeckCards,
    type Deck,
    type DeckCardDetail,
    type DeckVersionCard,
  } from '$lib/db/index.js'
  import {
    computeVersionDiff,
    computeTotalCards,
    type VersionDiffItem,
  } from '$lib/decks/version-diff'
  import { getRelativeTime } from '$lib/services/time-helper'
  import { ZONE_CONFIG, type ZoneKey } from '$lib/db/constants'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { onMount } from 'svelte'
  import { getCodeFromDeck } from '@piltoverarchive/riftbound-deck-codes'
  import type { Deck as RiftboundDeck } from '@piltoverarchive/riftbound-deck-codes'
  import CostCurveChart from '$lib/components/cards/CostCurveChart.svelte'
  import {
    History,
    ChartPie,
    Dices,
    Copy,
    Zap,
    Sword,
    Star,
    Tag,
    Check,
    FileCode,
    Pencil,
    Image as ImageIcon,
    Type as TypeIcon,
  } from '@lucide/svelte'

  interface DeckVersion {
    id: string
    version_number: number
    note: string | null
    created_at: string
  }

  interface VersionRow {
    version: DeckVersion
    totalCards: number
    isInitial: boolean
    diff: VersionDiffItem[]
  }

  let expandedVersions = $state<Set<string>>(new Set())

  function toggleVersionExpand(versionId: string) {
    const next = new Set(expandedVersions)
    if (next.has(versionId)) {
      next.delete(versionId)
    } else {
      next.add(versionId)
    }
    expandedVersions = next
  }

  let imageModeItems = $state<Set<string>>(new Set())

  function toggleDiffImage(key: string) {
    const next = new Set(imageModeItems)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
    }
    imageModeItems = next
  }

  const versionRows = $derived.by(() => {
    const asc = [...versions].sort((a, b) => a.version_number - b.version_number)
    const rows: VersionRow[] = []
    let prevCards: DeckVersionCard[] = []

    asc.forEach((version, index) => {
      const versionCardsList = versionCards.filter((c) => c.deck_version_id === version.id)
      const diff = index === 0 ? [] : computeVersionDiff(prevCards, versionCardsList)
      rows.push({
        version,
        totalCards: computeTotalCards(versionCardsList),
        isInitial: index === 0,
        diff,
      })
      prevCards = versionCardsList
    })

    return rows.reverse()
  })

  let deck = $state<Deck>()
  let cards = $state<DeckCardDetail[]>([])
  let versions = $state<DeckVersion[]>([])
  let versionCards = $state<DeckVersionCard[]>([])
  let copied = $state(false)
  let codeCopied = $state(false)

  const init = async (deckId: string) => {
    const data = await getDeckById(deckId)
    if (!data) {
      goto('/decks')
      return
    }
    deck = data
    cards = await getLatestDeckCards(deckId)
    versions = await getDeckVersions(deckId)
    versionCards = await getDeckVersionCards(deckId)
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto('/decks')
  })

  onMount(() => {
    if (page.params.deckid) init(page.params.deckid)
  })

  const legendCards = $derived(cards.filter((c) => c.zone === 'legend'))
  const championCards = $derived(cards.filter((c) => c.zone === 'champion'))
  const mainCards = $derived(cards.filter((c) => c.zone === 'mainDeck'))
  const battlefieldCards = $derived(cards.filter((c) => c.zone === 'battlefields'))
  const runeCards = $derived(cards.filter((c) => c.zone === 'runes'))
  const sideboardCards = $derived(cards.filter((c) => c.zone === 'sideboard'))

  const totalCardCount = $derived(cards.reduce((sum, c) => sum + c.quantity, 0))

  const zoneCards: Record<ZoneKey, typeof cards> = $derived({
    legend: legendCards,
    champion: championCards,
    mainDeck: mainCards,
    battlefields: battlefieldCards,
    runes: runeCards,
    sideboard: sideboardCards,
  })

  const zoneCounts: Record<ZoneKey, number> = $derived({
    legend: legendCards.reduce((s, c) => s + c.quantity, 0),
    champion: championCards.reduce((s, c) => s + c.quantity, 0),
    mainDeck: mainCards.reduce((s, c) => s + c.quantity, 0),
    battlefields: battlefieldCards.reduce((s, c) => s + c.quantity, 0),
    runes: runeCards.reduce((s, c) => s + c.quantity, 0),
    sideboard: sideboardCards.reduce((s, c) => s + c.quantity, 0),
  })

  function displayName(card: DeckCardDetail): string {
    return card.sub_title_cn ? `${card.card_name_cn} - ${card.sub_title_cn}` : card.card_name_cn
  }

  const compositionStats = $derived.by(() => {
    const mainTotal = zoneCounts.mainDeck
    const sideTotal = zoneCounts.sideboard
    const legendTotal = zoneCounts.legend
    const championTotal = zoneCounts.champion
    const battlefieldTotal = zoneCounts.battlefields
    const runeTotal = zoneCounts.runes
    return {
      mainTotal,
      sideTotal,
      legendTotal,
      championTotal,
      battlefieldTotal,
      runeTotal,
      total: mainTotal + sideTotal + legendTotal + championTotal + battlefieldTotal + runeTotal,
    }
  })

  // ===== 起手模拟状态机 =====
  // idle ──抽4──▶ initial ──调度2──▶ draw ──抽1(可重复)──▶ draw
  //  ▲____________________________________重置________________│
  type SimPhase = 'idle' | 'initial' | 'draw'

  interface SimCardInstance {
    uid: number
    card: DeckCardDetail
  }

  let simPhase = $state<SimPhase>('idle')
  let simHand = $state<SimCardInstance[]>([])
  let simDeck = $state<DeckCardDetail[]>([])
  let mulliganSelection = $state<Set<number>>(new Set())
  let uidCounter = 0

  const PHASE_LABEL: Record<SimPhase, string> = {
    idle: '',
    initial: '调度阶段',
    draw: '抽牌阶段',
  }

  const simHint = $derived(
    simPhase === 'idle'
      ? '抽取 4 张起手牌。'
      : simPhase === 'initial'
        ? '点选最多 2 张要调度的牌（放回重抽），然后确认。'
        : `可继续抽牌（每次 1 张），牌库剩余 ${simDeck.length} 张。`
  )

  function buildPool(): DeckCardDetail[] {
    const pool: DeckCardDetail[] = []
    mainCards.forEach((c) => {
      for (let i = 0; i < c.quantity; i++) pool.push(c)
    })
    return pool
  }

  function drawFromPool(
    pool: DeckCardDetail[],
    n: number
  ): { drawn: DeckCardDetail[]; rest: DeckCardDetail[] } {
    const copy = [...pool]
    const drawn: DeckCardDetail[] = []
    for (let i = 0; i < n && copy.length > 0; i++) {
      const idx = Math.floor(Math.random() * copy.length)
      drawn.push(copy.splice(idx, 1)[0])
    }
    return { drawn, rest: copy }
  }

  function toInstances(list: DeckCardDetail[]): SimCardInstance[] {
    return list.map((card) => ({ uid: ++uidCounter, card }))
  }

  function drawFour() {
    const { drawn, rest } = drawFromPool(buildPool(), 4)
    simHand = toInstances(drawn)
    simDeck = rest
    mulliganSelection = new Set()
    simPhase = 'initial'
  }

  function toggleMulligan(uid: number) {
    if (simPhase !== 'initial') return
    const next = new Set(mulliganSelection)
    if (next.has(uid)) {
      next.delete(uid)
    } else if (next.size < 2) {
      next.add(uid)
    }
    mulliganSelection = next
  }

  function confirmMulligan() {
    if (simPhase !== 'initial') return
    const putBack = simHand.filter((c) => mulliganSelection.has(c.uid)).map((c) => c.card)
    const kept = simHand.filter((c) => !mulliganSelection.has(c.uid))

    const { drawn, rest } = drawFromPool([...simDeck, ...putBack], putBack.length)
    simHand = [...kept, ...toInstances(drawn)]
    simDeck = rest
    mulliganSelection = new Set()
    simPhase = 'draw'
  }

  function drawOne() {
    if (simPhase !== 'draw' || simDeck.length === 0) return
    const { drawn, rest } = drawFromPool(simDeck, 1)
    simHand = [...simHand, ...toInstances(drawn)]
    simDeck = rest
  }

  function resetSim() {
    simHand = []
    simDeck = []
    mulliganSelection = new Set()
    simPhase = 'idle'
  }

  const EXPORT_ZONE_ORDER: ZoneKey[] = [
    'legend',
    'champion',
    'mainDeck',
    'battlefields',
    'runes',
    'sideboard',
  ]

  function sortForExport(list: DeckCardDetail[]): DeckCardDetail[] {
    return [...list].sort((a, b) => {
      if (b.quantity !== a.quantity) return b.quantity - a.quantity
      const ac = a.print_code ?? ''
      const bc = b.print_code ?? ''
      return ac < bc ? -1 : ac > bc ? 1 : 0
    })
  }

  const exportText = $derived.by(() => {
    const blocks: string[] = []

    for (const zone of EXPORT_ZONE_ORDER) {
      const list = zoneCards[zone]
      if (list.length === 0) continue

      const lines = [`${ZONE_CONFIG[zone].name}:`]
      for (const c of sortForExport(list)) {
        const name = c.sub_title_en ? `${c.card_name_en} - ${c.sub_title_en}` : c.card_name_en
        lines.push(`${c.quantity} ${name} [${c.print_code}]`)
      }
      blocks.push(lines.join('\n'))
    }

    return blocks.join('\n\n')
  })

  function copyToClipboard() {
    navigator.clipboard.writeText(exportText)
    copied = true
    setTimeout(() => {
      copied = false
    }, 2000)
  }

  const deckCodeResult = $derived.by((): { code: string | null; error: string | null } => {
    if (cards.length === 0) return { code: null, error: null }
    try {
      const toCodeList = (list: DeckCardDetail[]): RiftboundDeck =>
        list.map((c) => ({ cardCode: c.print_code, count: c.quantity }))

      const main = toCodeList([
        ...legendCards,
        ...mainCards,
        ...runeCards,
        ...battlefieldCards,
        ...championCards,
      ])
      const side = toCodeList(sideboardCards)
      const champion = championCards[0]?.print_code
      const code = getCodeFromDeck(main, side, champion)
      return { code, error: null }
    } catch (e) {
      return { code: null, error: e instanceof Error ? e.message : '生成失败' }
    }
  })

  function copyDeckCode() {
    if (!deckCodeResult.code) return
    navigator.clipboard.writeText(deckCodeResult.code)
    codeCopied = true
    setTimeout(() => {
      codeCopied = false
    }, 2000)
  }
</script>

<div class="deck-builder-container">
  <header class="deck-header">
    <div class="deck-info">
      <div class="title-row">
        <h1>{deck?.name || '加载中...'}</h1>
        {#if deck?.format}
          <span class="badge format-badge"><Tag size={14} /> {deck.format}</span>
        {/if}
        {#if deck?.is_favorite}
          <span class="badge favorite-badge"><Star size={14} fill="currentColor" /> 收藏</span>
        {/if}
      </div>
      <p class="deck-description">{deck?.description || '暂无描述'}</p>
      <div class="deck-meta">
        <span>总卡牌数: <strong>{totalCardCount}</strong></span>
        <span class="divider">•</span>
        <span
          >创建时间: {deck?.created_at
            ? new Date(deck.created_at).toLocaleDateString()
            : '未知'}</span
        >
        {#if deck?.updated_at}
          <span class="divider">•</span>
          <span>更新时间: {getRelativeTime(deck.updated_at)}</span>
        {/if}
      </div>
    </div>

    <div class="deck-actions">
      <button
        class="button button-secondary"
        onclick={() => goto(`/decks/builder?deckId=${page.params.deckid}`)}
      >
        <Pencil size={14} />
        编辑卡组
      </button>
      <button class="button button-ghost">复制套牌</button>
      <button class="button button-primary">保存新版本</button>
    </div>
  </header>

  <section class="analysis-dashboard">
    <div class="analysis-card curve-card">
      <CostCurveChart cards={mainCards} />
    </div>

    <div class="analysis-card">
      <div class="analysis-card-header">
        <ChartPie size={18} />
        <h3>卡牌构成</h3>
      </div>
      <div class="stat-list">
        {#each Object.entries(ZONE_CONFIG) as [key, config]}
          <div class="stat-row">
            <span class="stat-label">{config.label}</span>
            <span class="stat-value">{zoneCounts[key as ZoneKey]} / {config.maxCount}</span>
          </div>
        {/each}
        <div class="progress-bar-bg">
          <div
            class="progress-bar-fill"
            style="width: {compositionStats.total > 0
              ? (compositionStats.mainTotal / compositionStats.total) * 100
              : 0}%"
          ></div>
        </div>
      </div>
    </div>

    <div class="analysis-card sim-card">
      <div class="analysis-card-header">
        <Dices size={18} />
        <h3>起手模拟</h3>
        {#if simPhase !== 'idle'}
          <span class="sim-phase-badge">{PHASE_LABEL[simPhase]}</span>
        {/if}
      </div>

      <p class="sim-hint">{simHint}</p>

      {#if simHand.length > 0}
        <div class="sim-hand-cards">
          {#each simHand as instance, i (instance.uid)}
            <button
              type="button"
              class="sim-card-face"
              class:selectable={simPhase === 'initial'}
              class:selected={mulliganSelection.has(instance.uid)}
              disabled={simPhase !== 'initial'}
              style="animation-delay: {i * 60}ms"
              onclick={() => toggleMulligan(instance.uid)}
            >
              <CardSimpleImage
                url={instance.card.img_cdn}
                name={`${instance.card.card_id}-${instance.card.print_code}`}
                isLandscape={false}
              />
              {#if mulliganSelection.has(instance.uid)}
                <span class="sim-check">调度</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="sim-empty">点击下方「抽4」开始模拟</div>
      {/if}

      <div class="sim-actions">
        <button
          class="button button-primary"
          disabled={simPhase !== 'idle' || mainCards.length === 0}
          onclick={drawFour}
        >
          抽4
        </button>
        <button
          class="button button-secondary"
          disabled={simPhase !== 'initial'}
          onclick={confirmMulligan}
        >
          调度2{mulliganSelection.size > 0 ? ` · ${mulliganSelection.size}` : ''}
        </button>
        <button
          class="button button-secondary"
          disabled={simPhase !== 'draw' || simDeck.length === 0}
          onclick={drawOne}
        >
          抽1
        </button>
        <button class="button button-ghost" disabled={simPhase === 'idle'} onclick={resetSim}>
          重置
        </button>
      </div>
    </div>

    <div class="analysis-card export-card">
      <div class="analysis-card-header">
        <Copy size={18} />
        <h3>导出套牌</h3>
      </div>

      <p class="export-hint">复制标准纯文本格式，便于分享或导入外部工具。</p>
      <button class="button button-secondary full-width" class:copied onclick={copyToClipboard}>
        {#if copied}
          <Check size={16} /> 已复制！
        {:else}
          <Copy size={16} /> 复制纯文本
        {/if}
      </button>

      <div class="export-divider"></div>

      <p class="export-hint">
        <FileCode size={12} style="vertical-align: -1px;" />
        Riftbound 卡组代码（含主牌堆、符文、备牌与选定英雄），可导入 Piltover Archive 等工具。
      </p>

      {#if deckCodeResult.code}
        <div class="deck-code-box">
          <code class="deck-code-text">{deckCodeResult.code}</code>
        </div>
        <button
          class="button button-secondary full-width"
          class:copied={codeCopied}
          onclick={copyDeckCode}
        >
          {#if codeCopied}
            <Check size={16} /> 已复制代码！
          {:else}
            <Copy size={16} /> 复制卡组代码
          {/if}
        </button>
      {:else if deckCodeResult.error}
        <p class="export-error">无法生成卡组代码：{deckCodeResult.error}</p>
      {:else}
        <p class="export-empty">添加卡牌后自动生成卡组代码。</p>
      {/if}
    </div>
  </section>

  <div class="builder-layout">
    <main class="card-list-section">
      {#each Object.entries(ZONE_CONFIG) as [zoneKey, config]}
        {@const zoneCardList = zoneCards[zoneKey as ZoneKey]}
        {@const isLandscapeZone = zoneKey === 'battlefields'}

        {#if zoneCardList.length > 0}
          <section class="card-zone">
            <h3>
              {config.label}
              <span class="count-badge">
                {zoneCounts[zoneKey as ZoneKey]} / {config.maxCount}
              </span>
            </h3>

            {#if zoneKey === 'legend' || zoneKey === 'champion'}
              <ul class="card-grid">
                {#each zoneCardList as card}
                  <li class="card-item">
                    <div class="card-img-wrapper">
                      <CardSimpleImage
                        url={card.img_cdn}
                        name={`${card.card_id}-${card.print_code}`}
                        isLandscape={false}
                      />
                    </div>
                    <div class="card-details">
                      <div class="card-name">{displayName(card)}</div>
                      <div class="card-stats">
                        <span class="stat energy"><Zap size={14} /> {card.energy ?? '-'}</span>
                        <span class="stat power"><Sword size={14} /> {card.power ?? '-'}</span>
                      </div>
                      <div class="card-meta">x{card.quantity} • {card.rarity_name}</div>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else if isLandscapeZone}
              <ul class="card-grid landscape-grid">
                {#each zoneCardList as card}
                  <li class="card-item landscape-item">
                    <div class="card-img-wrapper landscape">
                      <CardSimpleImage
                        url={card.img_cdn}
                        name={`${card.card_id}-${card.print_code}`}
                        isLandscape={true}
                      />
                    </div>
                    <div class="card-details">
                      <div class="card-name">{displayName(card)}</div>
                      <div class="card-meta">x{card.quantity} • {card.rarity_name}</div>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else}
              <ul class="card-list">
                {#each zoneCardList as card}
                  <li class="card-row">
                    <span class="qty">x{card.quantity}</span>
                    <div class="card-thumb">
                      <CardSimpleImage
                        url={card.img_cdn}
                        name={`${card.card_id}-${card.print_code}`}
                        isLandscape={false}
                      />
                    </div>
                    <div class="card-info">
                      <div class="name">{displayName(card)}</div>
                      <div class="sub">{card.card_name_en} • {card.print_code}</div>
                    </div>
                    <div class="card-stats-inline">
                      <span class="stat-mini"><Zap size={14} /> {card.energy ?? '-'}</span>
                      <span class="stat-mini"><Sword size={14} /> {card.power ?? '-'}</span>
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/if}
      {/each}
    </main>

    <aside class="version-sidebar">
      <h3><History size={18} /> 版本历史</h3>
      <ul class="version-list">
        {#each versionRows as row (row.version.id)}
          {@const expanded = expandedVersions.has(row.version.id)}
          {@const visibleDiff = expanded ? row.diff : row.diff.slice(0, 5)}
          <li class="version-item">
            <div class="version-top">
              <span class="version-number">v{row.version.version_number}</span>
              <span class="version-date"
                >{new Date(row.version.created_at).toLocaleDateString()}</span
              >
            </div>
            <div class="version-note">{row.version.note || '无备注'}</div>
            <div class="version-stats">总卡数: <strong>{row.totalCards}</strong></div>
            {#if row.isInitial}
              <div class="version-diff version-diff-initial">初始版本</div>
            {:else if row.diff.length === 0}
              <div class="version-diff version-diff-empty">无卡牌变化</div>
            {:else}
              <ul class="version-diff">
                {#each visibleDiff as item (row.version.id + item.kind + item.card_id)}
                  {@const itemKey = `${row.version.id}:${item.kind}:${item.card_id}`}
                  {@const imageMode = imageModeItems.has(itemKey)}
                  <li
                    class="diff-item"
                    class:diff-add={item.kind === 'added' || item.kind === 'increased'}
                    class:diff-remove={item.kind === 'removed' || item.kind === 'decreased'}
                  >
                    <button
                      class="diff-image-toggle"
                      type="button"
                      title={imageMode ? '显示文字' : '显示卡图'}
                      onclick={() => toggleDiffImage(itemKey)}
                    >
                      {#if imageMode}
                        <TypeIcon size={12} />
                      {:else}
                        <ImageIcon size={12} />
                      {/if}
                    </button>
                    {#if imageMode}
                      <div class="diff-image">
                        <CardSimpleImage
                          url={item.img_cdn}
                          name={`${item.card_id}-${item.print_code}`}
                          isLandscape={item.isLandscape}
                        />
                      </div>
                    {:else}
                      <span class="diff-text">
                        {#if item.kind === 'added'}
                          新增 {item.name} x{item.qty}
                        {:else if item.kind === 'removed'}
                          移除 {item.name} x{item.qty}
                        {:else if item.kind === 'increased'}
                          {item.name} +{item.delta}
                        {:else}
                          {item.name} -{item.delta}
                        {/if}
                      </span>
                    {/if}
                  </li>
                {/each}
              </ul>
              {#if row.diff.length > 5}
                <button
                  class="button button-text button-sm"
                  type="button"
                  onclick={() => toggleVersionExpand(row.version.id)}
                >
                  {expanded ? '收起' : `…共 ${row.diff.length} 项变化`}
                </button>
              {/if}
            {/if}
          </li>
        {:else}
          <li class="empty-hint">暂无版本历史</li>
        {/each}
      </ul>
    </aside>
  </div>
</div>

<style>
  .deck-builder-container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  .deck-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    background: #ffffff;
    padding: 24px;
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    margin-bottom: 24px;
    border: 1px solid var(--border-color);
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }

  .deck-info h1 {
    margin: 0;
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .format-badge {
    background: color-mix(in oklab, var(--accent-color) 10%, transparent);
    color: var(--accent-color);
  }

  .favorite-badge {
    background: rgba(234, 179, 8, 0.15);
    color: #b45309;
  }

  .deck-description {
    color: var(--text-secondary);
    margin: 8px 0 16px 0;
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .deck-meta {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
  }

  .deck-meta strong {
    color: var(--accent-color);
  }

  .divider {
    color: var(--border-color);
  }

  .deck-actions {
    display: flex;
    gap: 12px;
  }

  .full-width {
    width: 100%;
    margin-top: 12px;
  }

  .copied {
    background: color-mix(in oklab, var(--accent-color) 10%, white) !important;
    border-color: var(--accent-color) !important;
  }

  .analysis-dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px;
    margin-bottom: 32px;
  }

  .analysis-card {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .analysis-card-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 16px;
    color: var(--text-secondary);
  }

  .analysis-card-header h3 {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  /* ===== 曲线卡片 ===== */
  .curve-card {
    grid-column: span 2;
  }

  /* ===== 起手模拟 ===== */
  .sim-card {
    display: flex;
    flex-direction: column;
    grid-column: span 2;
  }

  .sim-phase-badge {
    margin-left: auto;
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 2px 9px;
    border-radius: 9999px;
    background: color-mix(in oklab, var(--accent-color) 12%, transparent);
    color: var(--accent-color);
  }

  .sim-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0 0 14px 0;
    line-height: 1.5;
    min-height: 2.9em;
  }

  .sim-hand-cards {
    display: grid;
    justify-content: center;
    align-items: flex-start;
    align-content: flex-start;
    margin-bottom: 16px;
    min-height: 116px;
    max-height: 250px;
    overflow-y: auto;
    padding: 2px;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    justify-items: center;
  }

  .sim-card-face {
    position: relative;
    width: 78px;
    padding: 0;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
    cursor: default;
    flex-shrink: 0;
    transition:
      transform 0.18s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.18s ease,
      border-color 0.18s ease;
    animation: simDealIn 0.4s cubic-bezier(0.22, 1, 0.36, 1) backwards;
  }

  .sim-card-face.selectable {
    cursor: pointer;
  }

  .sim-card-face.selectable:hover {
    transform: translateY(-5px);
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.14);
    border-color: var(--text-tertiary);
  }

  .sim-card-face.selected {
    border-color: var(--card-color-red);
    transform: translateY(-7px);
    box-shadow: 0 10px 22px color-mix(in oklab, var(--card-color-red) 40%, transparent);
  }

  :global(.sim-card-face img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    image-rendering: optimizeQuality;
  }

  .sim-check {
    position: absolute;
    top: 4px;
    left: 4px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.3px;
    padding: 1px 5px;
    border-radius: 4px;
    background: var(--card-color-red);
    color: #ffffff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  }

  .sim-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 116px;
    margin-bottom: 16px;
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    font-style: italic;
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
  }

  .sim-actions {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    margin-top: auto;
  }

  .sim-actions .button {
    min-height: 34px;
    padding: 4px 6px;
    font-size: var(--text-xs);
  }

  @keyframes simDealIn {
    from {
      opacity: 0;
      transform: translateY(14px) scale(0.88);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  /* ===== 构成 / 导出 ===== */
  .stat-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
  }

  .stat-label {
    color: var(--text-secondary);
  }

  .stat-value {
    font-weight: 600;
    color: var(--text-primary);
  }

  .progress-bar-bg {
    height: 6px;
    background: var(--bg-hover);
    border-radius: 9999px;
    overflow: hidden;
    margin-top: 4px;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent-color);
    border-radius: 9999px;
    transition: width 0.4s ease;
  }

  .export-card {
    display: flex;
    flex-direction: column;
  }

  .export-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.4;
  }

  .export-divider {
    height: 1px;
    background: var(--border-color);
    margin: 16px 0;
  }

  .deck-code-box {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 10px 12px;
    margin-top: 10px;
    max-height: 104px;
    overflow-y: auto;
  }

  .deck-code-text {
    font-family: ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.55;
    word-break: break-all;
    color: var(--text-primary);
    user-select: text;
    -webkit-user-select: text;
  }

  .export-error {
    font-size: var(--text-xs);
    color: var(--card-color-red, #e5484d);
    margin: 10px 0 0 0;
    line-height: 1.4;
    word-break: break-word;
  }

  .export-empty {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    font-style: italic;
    margin: 10px 0 0 0;
  }

  .builder-layout {
    display: grid;
    grid-template-columns: 1fr 300px;
    gap: 24px;
  }

  .card-zone {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .card-zone h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-color);
  }

  .count-badge {
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 9999px;
    font-weight: 600;
    margin-left: auto;
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 16px;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .landscape-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  }

  .card-item {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #ffffff;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }

  .card-item:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
  }

  .card-img-wrapper {
    width: 100%;
    aspect-ratio: 744 / 1040;
    overflow: hidden;
    background: var(--bg-secondary);
  }

  .card-img-wrapper.landscape {
    aspect-ratio: 1040 / 744;
  }

  :global(.card-img-wrapper img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-details {
    padding: 10px;
  }

  .card-name {
    font-weight: 600;
    font-size: var(--text-sm);
    margin-bottom: 6px;
    line-height: 1.3;
  }

  .card-stats {
    display: flex;
    gap: 8px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin-bottom: 6px;
  }

  .stat {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .stat.energy {
    color: #d97706;
  }

  .stat.power {
    color: #dc2626;
  }

  .card-meta {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .card-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .card-row {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid var(--bg-secondary);
    gap: 12px;
    transition: background 0.15s;
    border-radius: var(--radius-md);
  }

  .card-row:hover {
    background: var(--bg-hover);
  }

  .card-row:last-child {
    border-bottom: none;
  }

  .qty {
    font-weight: 700;
    color: var(--accent-color);
    width: 32px;
    text-align: center;
    font-size: var(--text-base);
    flex-shrink: 0;
  }

  .card-thumb {
    width: 36px;
    height: 50px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border-color);
    overflow: hidden;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  :global(.card-thumb img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .card-info {
    flex: 1;
    min-width: 0;
  }

  .card-info .name {
    font-weight: 600;
    font-size: var(--text-base);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-info .sub {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 2px;
  }

  .card-stats-inline {
    display: flex;
    gap: 12px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .stat-mini {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .version-sidebar {
    background: #ffffff;
    padding: 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    height: fit-content;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    position: sticky;
    top: 24px;
  }

  .version-sidebar h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 0 0 16px 0;
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  .version-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .version-item {
    padding: 12px 0;
    border-bottom: 1px solid var(--bg-secondary);
  }

  .version-item:last-child {
    border-bottom: none;
  }

  .version-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 4px;
  }

  .version-number {
    font-weight: 700;
    color: var(--accent-color);
    font-size: var(--text-sm);
  }

  .version-date {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .version-note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .version-stats {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 4px;
  }

  .version-stats strong {
    color: var(--accent-color);
    font-weight: 600;
  }

  .version-diff {
    list-style: none;
    padding: 0;
    margin: 8px 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .version-diff-initial,
  .version-diff-empty {
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--text-tertiary);
    margin-top: 8px;
  }

  .diff-item {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--text-xs);
    line-height: 1.4;
    word-break: break-word;
  }

  .diff-image-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 20px;
    height: 20px;
    margin-top: 1px;
    padding: 0;
    color: var(--text-tertiary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 5px;
    cursor: pointer;
    transition:
      color 0.15s,
      border-color 0.15s,
      background 0.15s;
  }

  .diff-image-toggle:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, transparent);
  }

  .diff-text {
    flex: 1;
    min-width: 0;
  }

  .diff-image {
    flex: 1;
    min-width: 0;
    max-width: 96px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .diff-add {
    color: #16a34a;
  }

  .diff-remove {
    color: #dc2626;
  }

  .empty-hint {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--text-sm);
    padding: 12px 0;
  }

  @media (max-width: 900px) {
    .builder-layout {
      grid-template-columns: 1fr;
    }
    .version-sidebar {
      order: 2;
      position: static;
    }
    .curve-card {
      grid-column: span 1;
    }
  }

  @media (max-width: 640px) {
    .deck-builder-container {
      padding: 16px;
    }
    .deck-header {
      flex-direction: column;
      gap: 16px;
    }
    .deck-actions {
      width: 100%;
    }
    .deck-actions .button {
      flex: 1;
    }
    .analysis-dashboard {
      grid-template-columns: 1fr;
    }
    .card-stats-inline {
      display: none;
    }
    .landscape-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
