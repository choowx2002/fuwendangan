<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckVersions,
    getLatestDeckCards,
    type Deck,
    type DeckCardDetail,
  } from '$lib/db/index.js'
  import { getRelativeTime } from '$lib/services/time-helper'
  import { ZONE_CONFIG, type ZoneKey } from '$lib/db/constants'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { onMount } from 'svelte'
  import { getCodeFromDeck } from '@piltoverarchive/riftbound-deck-codes'
  import type { Deck as RiftboundDeck } from '@piltoverarchive/riftbound-deck-codes'
  import {
    History,
    ChartBar,
    ChartPie,
    Dices,
    Copy,
    Zap,
    Sword,
    Star,
    Tag,
    Check,
    FileCode,
  } from '@lucide/svelte'

  interface DeckVersion {
    id: string
    version_number: number
    note: string | null
    created_at: string
  }

  let deck = $state<Deck>()
  let cards = $state<DeckCardDetail[]>([])
  let versions = $state<DeckVersion[]>([])
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

  // ===== 颜色解析 =====
  const COLOR_ORDER = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'neutral']

  const COLOR_VARS: Record<string, string> = {
    red: 'var(--card-color-red)',
    orange: 'var(--card-color-orange)',
    yellow: 'var(--card-color-yellow)',
    green: 'var(--card-color-green)',
    blue: 'var(--card-color-blue)',
    purple: 'var(--card-color-purple)',
    neutral: 'var(--card-color-neutral)',
  }

  const COLOR_LABELS: Record<string, string> = {
    red: '红',
    orange: '橙',
    yellow: '黄',
    green: '绿',
    blue: '蓝',
    purple: '紫',
    neutral: '无色',
  }

  function normalizeColor(raw: string): string {
    const map: Record<string, string> = {
      red: 'red',
      红: 'red',
      红色: 'red',
      orange: 'orange',
      橙: 'orange',
      橙色: 'orange',
      yellow: 'yellow',
      黄: 'yellow',
      黄色: 'yellow',
      green: 'green',
      绿: 'green',
      绿色: 'green',
      blue: 'blue',
      蓝: 'blue',
      蓝色: 'blue',
      purple: 'purple',
      紫: 'purple',
      紫色: 'purple',
    }
    return map[raw.toLowerCase()] ?? 'neutral'
  }

  function parseColorList(raw: string | null | undefined): string[] {
    if (!raw) return ['neutral']
    let str = raw.trim()
    if (!str) return ['neutral']

    if (str.startsWith('[')) {
      try {
        const arr = JSON.parse(str.replace(/'/g, '"'))
        if (Array.isArray(arr) && arr.length > 0) {
          return arr.map((c) => normalizeColor(String(c).trim()))
        }
      } catch {
        // fall through to split
      }
    }

    const parts = str
      .split(/[,，、|;]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return parts.length > 0 ? parts.map(normalizeColor) : ['neutral']
  }

  function fmt(n: number): string {
    return n % 1 === 0 ? String(n) : n.toFixed(1)
  }

  // ===== 双模式曲线（法力 / 符能）=====
  type CurveMode = 'energy' | 'return_energy'
  let curveMode = $state<CurveMode>('energy')

  const costCurve = $derived.by(() => {
    const buckets: Record<number, Record<string, number>> = {}

    mainCards.forEach((c) => {
      const value = curveMode === 'energy' ? (c.energy ?? 0) : (c.return_energy ?? 0)
      if (!buckets[value]) buckets[value] = {}

      const colors = parseColorList(c.card_color_list)
      const share = c.quantity / colors.length

      colors.forEach((color) => {
        buckets[value][color] = (buckets[value][color] || 0) + share
      })
    })

    return Object.entries(buckets)
      .map(([key, colors]) => ({
        value: Number(key),
        total: Object.values(colors).reduce((s, n) => s + n, 0),
        colors,
      }))
      .sort((a, b) => a.value - b.value)
  })

  const maxCurveTotal = $derived(Math.max(...costCurve.map((p) => p.total), 1))

  const colorTotals = $derived.by(() => {
    const totals: Record<string, number> = {}
    mainCards.forEach((c) => {
      const colors = parseColorList(c.card_color_list)
      const share = c.quantity / colors.length
      colors.forEach((color) => {
        totals[color] = (totals[color] || 0) + share
      })
    })
    return totals
  })

  const colorLegend = $derived(
    Object.entries(colorTotals)
      .map(([color, count]) => ({ color, count }))
      .sort((a, b) => b.count - a.count)
  )

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

  // TODO add subtitle
  const exportText = $derived.by(() => {
    const blocks: string[] = []

    for (const zone of EXPORT_ZONE_ORDER) {
      const list = zoneCards[zone]
      if (list.length === 0) continue

      const lines = [`${ZONE_CONFIG[zone].name}:`]
      for (const c of sortForExport(list)) {
        lines.push(`${c.quantity} ${c.card_name_en} [${c.print_code}]`)
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
      <button class="button button-ghost">复制套牌</button>
      <button class="button button-primary">保存新版本</button>
    </div>
  </header>

  <section class="analysis-dashboard">
    <div class="analysis-card curve-card">
      <div class="analysis-card-header">
        <ChartBar size={18} />
        <h3>{curveMode === 'energy' ? '法力曲线' : '符能曲线'}</h3>
        <div class="button-group curve-toggle">
          <button
            class="button button-secondary"
            class:active={curveMode === 'energy'}
            onclick={() => (curveMode = 'energy')}
          >
            法力
          </button>
          <button
            class="button button-secondary"
            class:active={curveMode === 'return_energy'}
            onclick={() => (curveMode = 'return_energy')}
          >
            符能
          </button>
        </div>
      </div>

      <div class="chart-container">
        {#if costCurve.length === 0}
          <span class="empty-text">主卡组暂无卡牌</span>
        {:else}
          {#each costCurve as point (point.value)}
            <div
              class="bar-wrapper"
              title="{curveMode === 'energy' ? '法力' : '符能'} {point.value}：共 {fmt(
                point.total
              )} 张"
            >
              <div class="bar-track">
                <div class="bar-stack" style="height: {(point.total / maxCurveTotal) * 100}%">
                  <span class="bar-value">{fmt(point.total)}</span>
                  {#each COLOR_ORDER.filter((c) => point.colors[c]) as color (color)}
                    <div
                      class="bar-segment"
                      style="height: {(point.colors[color] / point.total) *
                        100}%; background: {COLOR_VARS[color]}"
                    ></div>
                  {/each}
                </div>
              </div>
              <span class="bar-label">{point.value}</span>
            </div>
          {/each}
        {/if}
      </div>

      {#if colorLegend.length > 0}
        <div class="color-legend">
          {#each colorLegend as item (item.color)}
            <span class="legend-item">
              <span class="legend-dot" style="background: {COLOR_VARS[item.color]}"></span>
              {COLOR_LABELS[item.color]}
              <strong>{fmt(item.count)}</strong>
            </span>
          {/each}
        </div>
      {/if}
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
                      <div class="card-name">{card.card_name_cn}</div>
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
                      <div class="card-name">{card.card_name_cn}</div>
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
                      <div class="name">{card.card_name_cn}</div>
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
        {#each versions as version}
          <li class="version-item">
            <div class="version-top">
              <span class="version-number">v{version.version_number}</span>
              <span class="version-date">{new Date(version.created_at).toLocaleDateString()}</span>
            </div>
            <div class="version-note">{version.note || '无备注'}</div>
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

  .curve-toggle {
    margin-left: auto;
  }

  .curve-toggle .button {
    min-height: 26px;
    padding: 3px 12px;
    font-size: var(--text-xs);
    gap: 4px;
  }

  .chart-container {
    display: flex;
    align-items: flex-end;
    height: 150px;
    gap: 6px;
    padding-top: 24px;
    border-bottom: 1px solid var(--border-color);
  }

  .bar-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 100%;
    cursor: default;
  }

  .bar-track {
    flex: 1;
    width: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }

  .bar-stack {
    position: relative;
    width: 100%;
    max-width: 34px;
    display: flex;
    flex-direction: column-reverse;
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
    overflow: visible;
    transform-origin: bottom center;
    transition:
      height 0.45s cubic-bezier(0.22, 1, 0.36, 1),
      transform 0.15s ease;
  }

  .bar-segment {
    width: 100%;
    min-height: 2px;
    opacity: 0.9;
    transition:
      height 0.45s cubic-bezier(0.22, 1, 0.36, 1),
      opacity 0.15s ease;
  }

  .bar-segment:first-of-type {
    border-radius: 0 0 1px 1px;
  }

  .bar-segment:last-of-type {
    border-radius: var(--radius-sm) var(--radius-sm) 0 0;
  }

  .bar-wrapper:hover .bar-segment {
    opacity: 1;
  }

  .bar-wrapper:hover .bar-stack {
    transform: scaleX(1.12);
  }

  .bar-value {
    position: absolute;
    top: -20px;
    left: 50%;
    transform: translateX(-50%);
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--accent-color);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .bar-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-top: 6px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .color-legend {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 16px;
    margin-top: 14px;
  }

  .legend-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .legend-item strong {
    color: var(--text-primary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .legend-dot {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
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

  .empty-hint {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--text-sm);
    padding: 12px 0;
  }

  .empty-text {
    color: var(--text-tertiary);
    font-size: var(--text-xs);
    width: 100%;
    text-align: center;
    align-self: center;
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
