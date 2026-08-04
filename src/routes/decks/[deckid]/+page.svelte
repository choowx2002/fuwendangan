<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckVersions,
    getDeckVersionCards,
    getLatestDeckCards,
    getCardByPrintId,
    getPrintsByCardId,
    type Deck,
    type DeckCardDetail,
    type DeckVersionCard,
    type CardBase,
    type CardPrint,
  } from '$lib/db/index.js'
  import {
    computeVersionDiff,
    computeTotalCards,
    type VersionDiffItem,
  } from '$lib/decks/version-diff'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { ZONE_CONFIG, type ZoneKey } from '$lib/decks/zone'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { onMount } from 'svelte'
  import { formatDeckExport } from '$lib/decks/deck-export'
  import { buildDeckCode } from '$lib/decks/deck-code'
  import CostCurveChart from '$lib/components/cards/CostCurveChart.svelte'
  import { parseColorList } from '$lib/cards/utils/cost-curve-utils'
  import { isTauri, isWeb } from '$lib/db'
  import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager'
  import { save, open } from '@tauri-apps/plugin-dialog'
  import { writeTextFile, readImageFileAsDataUrl } from '$lib/services/db-file-service'
  import {
    buildProxyPdf,
    writePdfToPath,
    downloadPdfInWeb,
  } from '$lib/services/proxy-export-service'
  import {
    buildDeckImage,
    downloadImageInWeb,
    writeImageToPath,
    DECK_IMAGE_SORT_FIELDS,
  } from '$lib/services/deck-image-service'
  import SortModal from '$lib/components/cards/SortModal.svelte'
  import type { SortKeyItem } from '$lib/db/types'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import LoadingModal from '$lib/components/ui/LoadingModal.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import {
    History,
    ChartPie,
    Dices,
    Copy,
    Star,
    Tag,
    Pencil,
    Download,
    Check,
    Square,
    Image as ImageIcon,
    Type as TypeIcon,
    X,
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
  let showShareModal = $state<'copy' | 'export' | null>(null)
  let shareFormat = $state<'text' | 'code' | 'pdf' | 'image'>('text')
  let exporting = $state(false)
  let exportProgress = $state(0)
  let pdfZones = $state<Record<ZoneKey, boolean>>({
    legend: true,
    champion: true,
    mainDeck: true,
    battlefields: true,
    runes: true,
    sideboard: true,
  })

  let imageSortList = $state<SortKeyItem[]>([
    { id: 1, name: 'card_color_list', isAsc: true, order: 1 },
    { id: 2, name: 'energy', isAsc: true, order: 2 },
    { id: 3, name: 'print_code', isAsc: true, order: 3 },
  ])

  const IMAGE_BG_PRESETS = ['#ffffff', '#f3f4f6', '#1f2937', '#111827']
  let imageBgColor = $state('#ffffff')
  let imageBgImage = $state<string | null>(null)
  let imageBgOverlay = $state(55)
  let bgFileInput = $state<HTMLInputElement | null>(null)

  async function pickBackgroundImage() {
    if (isTauri) {
      const src = await open({
        title: '选择背景图片',
        multiple: false,
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      })
      if (!src || Array.isArray(src)) return
      try {
        imageBgImage = await readImageFileAsDataUrl(src)
      } catch (error) {
        console.error('[DeckImage] 读取背景图片失败:', error)
      }
      return
    }
    bgFileInput?.click()
  }

  function onBgFileChange(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      imageBgImage = typeof reader.result === 'string' ? reader.result : null
    }
    reader.readAsDataURL(file)
    input.value = ''
  }

  let selectedCard = $state<(CardBase & { card_prints?: CardPrint[] }) | null>(null)
  const cardModalCache = new Map<string, CardBase & { card_prints?: CardPrint[] }>()

  async function openCardModal(card: DeckCardDetail) {
    const cached = cardModalCache.get(card.card_id)
    if (cached) {
      selectedCard = cached
      return
    }
    const base = await getCardByPrintId(card.card_id)
    if (!base) return
    const prints = await getPrintsByCardId(base.id)
    const full = { ...base, card_prints: prints }
    cardModalCache.set(card.card_id, full)
    selectedCard = full
  }

  function togglePdfZone(zone: ZoneKey) {
    pdfZones = { ...pdfZones, [zone]: !pdfZones[zone] }
  }

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

  function runeColorName(card: DeckCardDetail | null): string {
    if (!card) return 'neutral'
    const colors = parseColorList(card.card_color_list)
    return colors[0] ?? 'neutral'
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

  const exportText = $derived(formatDeckExport(zoneCards))
  const deckCodeResult = $derived(buildDeckCode(zoneCards))

  const shareFormats = $derived([
    { id: 'text', label: '纯文本', description: '标准格式，便于分享或导入外部工具。' },
    {
      id: 'code',
      label: 'Riftbound 卡组代码',
      description: '含主牌堆、符文、备牌与选定英雄，可导入 Piltover Archive 等工具。',
    },
    {
      id: 'pdf',
      label: 'PROXY 打印 PDF',
      description: 'A4 竖版 3×3 代牌，含主牌堆、战场、符文与备牌，可打印裁剪。',
    },
    {
      id: 'image',
      label: '卡组图案',
      description: '生成卡组清单图片（英雄、符文与主/备牌），可导出 PNG 或复制到剪贴板。',
    },
  ])

  function currentShareText(): string {
    if (shareFormat === 'code') return deckCodeResult.code ?? ''
    return exportText
  }

  const selectedPdfZones = $derived(
    (Object.keys(ZONE_CONFIG) as ZoneKey[]).filter((zone) => pdfZones[zone])
  )

  const selectedPdfZoneCount = $derived(
    selectedPdfZones.reduce((sum, zone) => sum + (zoneCounts[zone] || 0), 0)
  )

  function currentShareTextAvailable(): boolean {
    if (shareFormat === 'code') return !!deckCodeResult.code
    if (shareFormat === 'pdf') return selectedPdfZoneCount > 0
    if (shareFormat === 'image') return cards.length > 0
    return exportText.length > 0
  }

  async function buildDeckImageDataUrl(): Promise<string> {
    return await buildDeckImage({
      deckName: deck?.name,
      cards,
      sortRules: imageSortList,
      background: {
        color: imageBgColor,
        imageUrl: imageBgImage ?? undefined,
        overlay: imageBgImage ? imageBgOverlay / 100 : undefined,
      },
      onProgress: (p) => (exportProgress = p),
    })
  }

  async function copyDeckImage(dataUrl: string): Promise<void> {
    if (isTauri) {
      await writeImage(dataUrl)
      return
    }
    const blob = await (await fetch(dataUrl)).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  async function confirmCopy() {
    if (shareFormat === 'image') {
      exporting = true
      exportProgress = 0
      try {
        const dataUrl = await buildDeckImageDataUrl()
        await copyDeckImage(dataUrl)
        showShareModal = null
      } catch (error) {
        console.error('[DeckImage] 复制卡组图案失败:', error)
      } finally {
        exporting = false
      }
      return
    }
    const text = currentShareText()
    if (!text) return
    if (isTauri) {
      await writeText(text)
    } else {
      await navigator.clipboard.writeText(text)
    }
    showShareModal = null
  }

  async function confirmExport() {
    if (shareFormat === 'pdf') {
      exporting = true
      exportProgress = 0
      try {
        const bytes = await buildProxyPdf(cards, {
          deckName: deck?.name,
          zones: selectedPdfZones,
          onProgress: (p) => (exportProgress = p),
        })
        if (isWeb) {
          downloadPdfInWeb(bytes, `${deck?.name || 'deck'}-proxy.pdf`)
          showShareModal = null
          return
        }
        const dest = await save({
          title: '导出 PROXY PDF',
          defaultPath: `${deck?.name || 'deck'}-proxy.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (!dest) return
        await writePdfToPath(bytes, dest)
        showShareModal = null
      } catch (error) {
        console.error('[ProxyExport] 导出 PDF 失败:', error)
      } finally {
        exporting = false
      }
      return
    }

    if (shareFormat === 'image') {
      exporting = true
      exportProgress = 0
      try {
        const dataUrl = await buildDeckImageDataUrl()
        if (isWeb) {
          downloadImageInWeb(dataUrl, `${deck?.name || 'deck'}.png`)
          showShareModal = null
          return
        }
        const dest = await save({
          title: '导出卡组图案',
          defaultPath: `${deck?.name || 'deck'}.png`,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }],
        })
        if (!dest) return
        await writeImageToPath(dataUrl, dest)
        showShareModal = null
      } catch (error) {
        console.error('[DeckImage] 导出卡组图案失败:', error)
      } finally {
        exporting = false
      }
      return
    }

    const text = currentShareText()
    if (!text) return
    if (isWeb) {
      if (navigator.clipboard) await navigator.clipboard.writeText(text)
      showShareModal = null
      return
    }

    const isCode = shareFormat === 'code'
    const dest = await save({
      title: '导出卡组',
      defaultPath: `${deck?.name || 'deck'}${isCode ? '.code' : '.txt'}`,
      filters: isCode
        ? [{ name: 'Deck Code', extensions: ['code'] }]
        : [{ name: 'Text', extensions: ['txt'] }],
    })
    if (!dest) return
    await writeTextFile(dest, text)
    showShareModal = null
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
        class="button button-ghost"
        title="复制套牌"
        onclick={() => {
          shareFormat = 'text'
          showShareModal = 'copy'
        }}
      >
        <Copy size={16} />
      </button>
      <button
        class="button button-ghost"
        onclick={() => {
          shareFormat = 'text'
          showShareModal = 'export'
        }}
      >
        <Download size={16} />
        导出
      </button>
      <button
        class="button button-primary"
        onclick={() => goto(`/decks/builder?deckId=${page.params.deckid}`)}
      >
        <Pencil size={14} />
        编辑卡组
      </button>
    </div>
  </header>

  <section class="hero-strip">
    <div class="hero-cards">
      <div class="hero-card-slot">
        <h3>
          {ZONE_CONFIG.legend.label}
          <span class="count-badge">1 / {ZONE_CONFIG.legend.maxCount}</span>
        </h3>
        {#if legendCards[0]}
          <button
            type="button"
            class="hero-card"
            title={displayName(legendCards[0])}
            onclick={() => openCardModal(legendCards[0])}
          >
            <div class="hero-card-img">
              <CardSimpleImage
                url={legendCards[0].img_cdn}
                name={`${legendCards[0].card_base_id}-${legendCards[0].print_id}`}
                isLandscape={false}
              />
            </div>
          </button>
        {:else}
          <div class="hero-card hero-placeholder">该卡位为空</div>
        {/if}
      </div>

      <div class="hero-card-slot">
        <h3>
          {ZONE_CONFIG.champion.label}
          <span class="count-badge">1 / {ZONE_CONFIG.champion.maxCount}</span>
        </h3>
        {#if championCards[0]}
          <button
            type="button"
            class="hero-card"
            title={displayName(championCards[0])}
            onclick={() => openCardModal(championCards[0])}
          >
            <div class="hero-card-img">
              <CardSimpleImage
                url={championCards[0].img_cdn}
                name={`${championCards[0].card_base_id}-${championCards[0].print_id}`}
                isLandscape={false}
              />
            </div>
          </button>
        {:else}
          <div class="hero-card hero-placeholder">该卡位为空</div>
        {/if}
      </div>

      <div class="runes-zone">
        <h3>
          {ZONE_CONFIG.runes.label}
          <span class="count-badge">{runeCards.length} / {ZONE_CONFIG.runes.maxCount}</span>
        </h3>
        {#if runeCards.length > 0}
          <ul class="rune-list">
            {#each runeCards as slot, i (slot.card_id)}
              {@const color = runeColorName(slot)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li class="rune-row" onclick={() => openCardModal(slot)}>
                {#if color === 'neutral'}
                  <span class="rune-icon-fallback" title={displayName(slot)}></span>
                {:else}
                  <img
                    src={`/runes/${color}.svg`}
                    alt={color}
                    title={displayName(slot)}
                    width="36"
                    height="36"
                  />
                {/if}
                <span class="rune-count">×{slot.quantity}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="hero-placeholder rune-placeholder">暂无符文</div>
        {/if}
      </div>
    </div>
  </section>

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
                name={`${instance.card.card_base_id}-${instance.card.print_id}`}
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
  </section>

  <div class="builder-layout">
    <main class="card-list-section">
      {#if mainCards.length > 0}
        <section class="card-zone">
          <h3>
            {ZONE_CONFIG.mainDeck.label}
            <span class="count-badge">
              {zoneCounts.mainDeck} / {ZONE_CONFIG.mainDeck.maxCount}
            </span>
          </h3>
          <ul class="card-grid maindeck-grid">
            {#each mainCards as card}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li class="card-item maindeck-item" onclick={() => openCardModal(card)}>
                <div class="qty-badge">x{card.quantity}</div>
                <div class="card-img-wrapper">
                  <CardSimpleImage
                    url={card.img_cdn}
                    name={`${card.card_base_id}-${card.print_id}`}
                    isLandscape={false}
                  />
                </div>
                <div class="card-details">
                  <span class="card-name">{card.card_name_cn}</span>
                  {#if card.sub_title_cn}
                    <span class="card-subtitle"> {card.sub_title_cn}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if battlefieldCards.length > 0}
        <section class="card-zone">
          <h3>
            {ZONE_CONFIG.battlefields.label}
            <span class="count-badge">
              {zoneCounts.battlefields} / {ZONE_CONFIG.battlefields.maxCount}
            </span>
          </h3>
          <ul class="card-grid landscape-grid">
            {#each battlefieldCards as card}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li class="card-item landscape-item" onclick={() => openCardModal(card)}>
                <div class="qty-badge">x{card.quantity}</div>
                <div class="card-img-wrapper landscape">
                  <CardSimpleImage
                    url={card.img_cdn}
                    name={`${card.card_base_id}-${card.print_id}`}
                    isLandscape={true}
                  />
                </div>
                <div class="card-details">
                  <span class="card-name">{card.card_name_cn}</span>
                  {#if card.sub_title_cn}
                    <span class="card-subtitle"> {card.sub_title_cn}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if sideboardCards.length > 0}
        <section class="card-zone">
          <h3>
            {ZONE_CONFIG.sideboard.label}
            <span class="count-badge">
              {zoneCounts.sideboard} / {ZONE_CONFIG.sideboard.maxCount}
            </span>
          </h3>
          <ul class="card-grid maindeck-grid">
            {#each sideboardCards as card}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li class="card-item maindeck-item" onclick={() => openCardModal(card)}>
                <div class="qty-badge">x{card.quantity}</div>
                <div class="card-img-wrapper">
                  <CardSimpleImage
                    url={card.img_cdn}
                    name={`${card.card_base_id}-${card.print_id}`}
                    isLandscape={false}
                  />
                </div>
                <div class="card-details">
                  <span class="card-name">{card.card_name_cn}</span>
                  {#if card.sub_title_cn}
                    <span class="card-subtitle"> {card.sub_title_cn}</span>
                  {/if}
                </div>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
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
                          name={`${item.card_base_id}-${item.print_id}`}
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

<CommonModal
  open={showShareModal !== null}
  title={showShareModal === 'export' ? '导出套牌' : '复制套牌'}
  subtitle="选择要导出/复制的格式"
  onclose={() => (showShareModal = null)}
>
  <div class="share-format-list">
    {#each shareFormats as format (format.id)}
      <button
        type="button"
        class="share-format-option"
        class:selected={shareFormat === format.id}
        onclick={() => {
          shareFormat = format.id as 'text' | 'code' | 'pdf' | 'image'
          if (format.id === 'pdf') {
            pdfZones = {
              legend: true,
              champion: true,
              mainDeck: true,
              battlefields: true,
              runes: true,
              sideboard: true,
            }
          }
        }}
      >
        <span class="share-format-label">{format.label}</span>
        <span class="share-format-desc">{format.description}</span>
      </button>
    {/each}
  </div>

  {#if shareFormat === 'pdf'}
    <div class="pdf-zone-select">
      <div class="pdf-zone-title">选择要导出的区域（{selectedPdfZoneCount} 张）</div>
      <div class="pdf-zone-grid">
        {#each Object.keys(ZONE_CONFIG) as zone (zone)}
          {@const zoneKey = zone as ZoneKey}
          <button
            type="button"
            class="pdf-zone-option"
            class:selected={pdfZones[zoneKey]}
            onclick={() => togglePdfZone(zoneKey)}
          >
            <span class="pdf-zone-check">
              {#if pdfZones[zoneKey]}
                <Check size={14} />
              {:else}
                <Square size={14} />
              {/if}
            </span>
            <span class="pdf-zone-label">{ZONE_CONFIG[zoneKey].label}</span>
            <span class="pdf-zone-count">{zoneCounts[zoneKey]} 张</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if shareFormat === 'image'}
    <div class="image-sort-section">
      <div class="image-sort-title">背景</div>
      <div class="image-bg-color-row">
        {#each IMAGE_BG_PRESETS as preset (preset)}
          <button
            type="button"
            class="bg-swatch"
            class:selected={imageBgColor === preset}
            style={`background: ${preset}`}
            aria-label={preset}
            onclick={() => (imageBgColor = preset)}
          ></button>
        {/each}
        <input
          type="color"
          class="bg-color-picker"
          bind:value={imageBgColor}
          title="自定义背景色"
        />
      </div>
      <div class="image-bg-image-row">
        <button type="button" class="button button-ghost button-sm" onclick={pickBackgroundImage}>
          <ImageIcon size={14} />
          {imageBgImage ? '更换背景图' : '选择本地背景图'}
        </button>
        {#if imageBgImage}
          <div class="bg-image-preview">
            <img src={imageBgImage} alt="背景预览" />
            <button
              type="button"
              class="icon-btn bg-image-remove"
              title="移除背景图"
              onclick={() => (imageBgImage = null)}
            >
              <X size={14} />
            </button>
          </div>
        {/if}
      </div>
      {#if imageBgImage}
        <div class="image-bg-overlay-row">
          <span class="overlay-label">白色遮罩 {imageBgOverlay}%</span>
          <input type="range" min="0" max="100" step="5" bind:value={imageBgOverlay} />
        </div>
      {/if}
      <input
        bind:this={bgFileInput}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
        class="hidden-file-input"
        onchange={onBgFileChange}
      />
    </div>

    <div class="image-sort-section">
      <div class="image-sort-title">卡牌排序</div>
      <p class="image-sort-desc">调整主牌堆与备牌在图案中的排列顺序（可多级排序）。</p>
      <SortModal bind:sortByList={imageSortList} fields={DECK_IMAGE_SORT_FIELDS} />
    </div>
  {/if}

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showShareModal = null)}>取消</button>
    <button
      class="button button-primary"
      disabled={!currentShareTextAvailable() || exporting}
      onclick={showShareModal === 'export' ? confirmExport : confirmCopy}
    >
      {showShareModal === 'export' ? '导出' : '复制'}
    </button>
  {/snippet}
</CommonModal>

{#if exporting}
  <LoadingModal
    status="downloading"
    text={shareFormat === 'image' ? '正在生成卡组图案...' : '正在生成 PROXY PDF...'}
    subtext="正在加载卡图并排版"
    progress={exportProgress}
  />
{/if}

<CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

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
    font-size: var(--text-xs);
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

  .builder-layout {
    display: grid;
    grid-template-columns: 1fr;
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

  /* ===== 英雄区 (传奇 / 选定英雄 / 符文) ===== */
  .hero-strip {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 24px;
  }

  .hero-cards {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 20px;
  }

  .hero-card-slot {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .hero-card-slot h3 {
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

  .hero-card {
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .hero-card-img {
    width: 160px;
    flex-shrink: 0;
    aspect-ratio: 744 / 1040;
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    transition:
      transform 0.15s,
      box-shadow 0.15s;
  }

  .hero-card:hover .hero-card-img {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  :global(.hero-card-img img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .hero-placeholder {
    min-height: 180px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px dashed var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    font-style: italic;
    background: var(--bg-secondary);
  }

  /* ===== 符文 ===== */
  .runes-zone {
    background: #ffffff;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .runes-zone h3 {
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

  .rune-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rune-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    margin: 0 -8px;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background 0.15s;
  }

  .rune-row:hover {
    background: var(--bg-hover);
  }

  .rune-row img {
    display: block;
    flex-shrink: 0;
  }

  .rune-icon-fallback {
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    border-radius: 50%;
    background: var(--card-color-neutral);
    opacity: 0.35;
  }

  .rune-count {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .rune-placeholder {
    min-height: 80px;
  }

  /* ===== 主牌堆卡图 + 数量角标 ===== */
  .qty-badge {
    position: absolute;
    bottom: 8px;
    right: 8px;
    z-index: 2;
    min-width: 36px;
    height: 28px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-lg);
    font-weight: 700;
    color: #ffffff;
    background: var(--accent-color);
    border-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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
    position: relative;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: #ffffff;
    cursor: pointer;
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
    padding: 8px 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-name {
    display: inline;
    font-weight: 600;
    font-size: var(--text-sm);
    line-height: 1.3;
  }

  .card-subtitle {
    display: inline;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .version-sidebar {
    background: #ffffff;
    padding: 20px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
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
    flex: none;
    width: 56px;
    height: 78px;
    border-radius: var(--radius-sm);
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  :global(.diff-image img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  :global(.diff-image .landscape-container) {
    width: 100%;
    height: 100%;
    aspect-ratio: auto;
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
    .curve-card {
      grid-column: span 1;
    }
    .hero-cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .runes-zone {
      grid-column: 1 / -1;
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
    .landscape-grid {
      grid-template-columns: 1fr;
    }
    .hero-cards {
      grid-template-columns: 1fr;
    }
    .runes-zone {
      grid-column: auto;
    }
    .hero-card {
      flex-direction: column;
      align-items: stretch;
    }
    .hero-card-img {
      width: 100%;
      max-width: 160px;
      align-self: center;
    }
    .hero-placeholder {
      min-height: 120px;
    }
    .card-grid:not(.landscape-grid) {
      grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
    }
  }

  /* ===== 分享 / 导出格式弹窗 ===== */
  .share-format-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .share-format-option {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    width: 100%;
    padding: 12px 14px;
    text-align: left;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      box-shadow 0.15s;
  }

  .share-format-option:hover {
    border-color: var(--accent-color);
  }

  .share-format-option.selected {
    border-color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, white);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-color) 20%, transparent);
  }

  .share-format-label {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .share-format-desc {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    line-height: 1.4;
  }

  /* ===== PROXY PDF 区域选择 ===== */
  .pdf-zone-select {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .pdf-zone-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 10px;
  }

  .pdf-zone-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  .pdf-zone-option {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    text-align: left;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    cursor: pointer;
    transition:
      border-color 0.15s,
      background 0.15s,
      box-shadow 0.15s;
  }

  .pdf-zone-option:hover {
    border-color: var(--accent-color);
  }

  .pdf-zone-option.selected {
    border-color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, white);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-color) 20%, transparent);
  }

  .pdf-zone-check {
    display: inline-flex;
    align-items: center;
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  .pdf-zone-option.selected .pdf-zone-check {
    color: var(--accent-color);
  }

  .pdf-zone-label {
    font-size: var(--text-sm);
    font-weight: 600;
    flex: 1;
  }

  .pdf-zone-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    flex-shrink: 0;
  }

  /* ===== 卡组图案排序 ===== */
  .image-sort-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .image-sort-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .image-sort-desc {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-bottom: 10px;
  }

  .image-sort-section :global(.trigger) {
    margin-left: 0;
  }

  /* ===== 卡组图案背景 ===== */
  .image-bg-color-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }

  .bg-swatch {
    width: 26px;
    height: 26px;
    border-radius: 6px;
    border: 2px solid var(--border-color);
    cursor: pointer;
    transition:
      transform 0.12s,
      border-color 0.12s;
  }

  .bg-swatch:hover {
    transform: scale(1.1);
  }

  .bg-swatch.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-color) 30%, transparent);
  }

  .bg-color-picker {
    width: 26px;
    height: 26px;
    padding: 0;
    border: 2px solid var(--border-color);
    border-radius: 6px;
    background: none;
    cursor: pointer;
    overflow: hidden;
  }

  .image-bg-image-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 10px;
  }

  .bg-image-preview {
    position: relative;
    width: 64px;
    height: 40px;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-color);
  }

  .bg-image-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .bg-image-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 18px;
    height: 18px;
    background: rgba(0, 0, 0, 0.55);
    color: #fff;
    border-radius: 50%;
  }

  .image-bg-overlay-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 4px;
  }

  .overlay-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .image-bg-overlay-row input[type='range'] {
    flex: 1;
    accent-color: var(--accent-color);
  }

  .hidden-file-input {
    display: none;
  }
</style>
