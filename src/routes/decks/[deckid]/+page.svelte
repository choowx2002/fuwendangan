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
    updateDeck,
    updateDeckVersionNote,
    deleteDeck,
    type Deck,
    type DeckCardDetail,
    type DeckVersionCard,
    type CardBase,
    type CardPrint,
    checkDeckOwnership,
    type OwnershipCheckRow,
    type OwnershipMatchMode,
    generatePurchaseListFromDeck,
    getDeckMatchStats,
    getMatchesByDeck,
    deleteMatch,
    gameResult,
    type MatchSummary,
    type MatchWithGames,
    printCacheName,
  } from '$lib/db/index.js'
  import { DECK_FORMATS, FORMAT_LABEL_KEYS } from '$lib/decks/format'
  import {
    computeVersionDiff,
    computeTotalCards,
    type VersionDiffItem,
  } from '$lib/decks/version-diff'
  import { getRelativeTime } from '$lib/utils/time-helper'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { playerName } from '$lib/stores/settings'
  import { ZONE_CONFIG, getZoneConfig, resolveFormat, type ZoneKey } from '$lib/decks/zone'
  import {
    buildOwnershipText,
    buildOwnershipCsv,
    saveOwnershipExport,
    type OwnershipExportFormat,
    type OwnershipExportRow,
  } from '$lib/decks/ownership-export'
  import { getDeckTokenSuggestions, type TokenSuggestion } from '$lib/decks/token-suggestion'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { onMount } from 'svelte'
  import { formatDeckExport, formatOfficialDeckExport } from '$lib/decks/deck-export'
  import { buildDeckCode } from '$lib/decks/deck-code'
  import { buildDeckQrDataUrl, serializeDeckPayload, QR_PAYLOAD_VERSION } from '$lib/decks/deck-qr'
  import CostCurveChart from '$lib/components/cards/CostCurveChart.svelte'
  import { parseColorList } from '$lib/cards/utils/cost-curve-utils'
  import { isTauri, isWeb } from '$lib/db'
  import { isMobile } from '$lib/utils/os'
  import { writeText, writeImage } from '@tauri-apps/plugin-clipboard-manager'
  import { shareFile } from '@choochmeque/tauri-plugin-sharekit-api'
  import { save, open, ask } from '@tauri-apps/plugin-dialog'
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
    dataUrlToBytes,
    jpegDataUrlToPngBytes,
    DECK_IMAGE_SORT_FIELDS,
  } from '$lib/services/deck-image-service'
  import SortModal from '$lib/components/cards/SortModal.svelte'
  import type { SortKeyItem } from '$lib/db/types'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import LoadingModal from '$lib/components/ui/LoadingModal.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import MatchRecordModal from '$lib/components/decks/MatchRecordModal.svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'
  import {
    History,
    ChartPie,
    Dices,
    Pencil,
    Download,
    Settings2,
    Check,
    Square,
    Image as ImageIcon,
    X,
    Swords,
    Plus,
    ChevronRight,
    Trash2,
    PencilLine,
    CircleCheck,
    LoaderCircle,
    Info,
    CircleAlert,
    Upload,
    QrCode,
    FileText,
    Shapes,
    ShoppingCart,
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

  function diffBadgeLabel(item: VersionDiffItem): string {
    if (item.kind === 'increased') return `+${item.delta}`
    if (item.kind === 'decreased') return `-${item.delta}`
    return `+${item.qty}`
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
  let tokenSuggestions = $state<TokenSuggestion[]>([])
  let loadingTokens = $state(false)
  let showShareModal = $state(false)
  let shareFormat = $state<'text' | 'code' | 'pdf' | 'image' | 'official' | 'qr'>('text')
  let textLang = $state<'en' | 'cn'>('en')
  let exporting = $state(false)
  let exportProgress = $state(0)
  let showEditInfoModal = $state(false)
  let editName = $state('')
  let editDescription = $state('')
  let editFormat = $state('')
  let editFavorite = $state(false)
  let editTags = $state<string[]>([])
  let editTagInput = $state('')
  let savingInfo = $state(false)
  let editingNoteVersionId = $state<string | null>(null)
  let editNoteValue = $state('')
  let savingNote = $state(false)
  let pdfZones = $state<Record<ZoneKey, boolean>>({
    legend: true,
    champion: true,
    mainDeck: true,
    battlefields: true,
    runes: true,
    sideboard: true,
  })

  let matchRecords = $state<MatchWithGames[]>([])
  let matchStats = $state<MatchSummary | null>(null)
  let showMatchModal = $state(false)
  let editingMatch = $state<MatchWithGames | null>(null)
  let expandedMatchIds = $state<Set<string>>(new Set())

  function toggleMatchExpand(id: string) {
    const next = new Set(expandedMatchIds)
    if (next.has(id)) {
      next.delete(id)
    } else {
      next.add(id)
    }
    expandedMatchIds = next
  }

  function matchSummaryText(match: MatchWithGames): string {
    const results = match.games.map((g) => gameResult(g))
    const wins = results.filter((r) => r === 'win').length
    const losses = results.filter((r) => r === 'loss').length
    const draws = results.filter((r) => r === 'draw').length
    if (draws > 0) return get(t)('records.summary', { values: { wins, losses, draws } })
    return `${wins} : ${losses}`
  }

  let imageSortList = $state<SortKeyItem[]>([
    { id: 1, name: 'card_color_list', isAsc: true, order: 1 },
    { id: 2, name: 'energy', isAsc: true, order: 2 },
    { id: 3, name: 'print_code', isAsc: true, order: 3 },
  ])

  const IMAGE_BG_PRESETS = ['#ffffff', '#f3f4f6', '#1f2937', '#111827']
  const IMAGE_MASK_PRESETS = ['#1e3a8a', '#1d4ed8', '#111827', '#ffffff']
  const IMAGE_TEXT_PRESETS = ['', '#111827', '#f9fafb', '#6b7280']
  let imageBgColor = $state('#ffffff')
  let imageBgImage = $state<string | null>(null)
  let imageBgOverlay = $state(55)
  let imageMaskColor = $state('#1e3a8a')
  let imageTextColor = $state('')
  let imagePreviewUrl = $state<string | null>(null)
  let imagePreviewing = $state(false)
  let previewGenerated = false
  let previewRegenTimer: ReturnType<typeof setTimeout> | undefined
  let bgFileInput = $state<HTMLInputElement | null>(null)
  let qrDataUrl = $state<string | null>(null)
  let qrGenerating = $state(false)
  let qrTimer: ReturnType<typeof setTimeout> | undefined

  async function pickBackgroundImage() {
    if (isTauri) {
      const src = await open({
        title: get(t)('deckDetail.pickBgImage'),
        multiple: false,
        filters: [
          {
            name: get(t)('decks.imageFilter'),
            extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
          },
        ],
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

  async function openCardModalForBase(card: CardBase) {
    const cached = cardModalCache.get(card.id)
    if (cached) {
      selectedCard = cached
      return
    }
    const prints = await getPrintsByCardId(card.id)
    const full = { ...card, card_prints: prints }
    cardModalCache.set(card.id, full)
    selectedCard = full
  }

  function togglePdfZone(zone: ZoneKey) {
    pdfZones = { ...pdfZones, [zone]: !pdfZones[zone] }
  }

  const editFormatOptions = $derived(() => {
    const options: string[] = [...DECK_FORMATS]
    if (deck?.format && !options.includes(deck.format)) {
      options.unshift(deck.format)
    }
    return options
  })

  function openEditInfo() {
    if (!deck) return
    editName = deck.name
    editDescription = deck.description ?? ''
    editFormat = deck.format ?? ''
    editFavorite = deck.is_favorite
    editTags = deck.tags ? [...deck.tags] : []
    editTagInput = ''
    showEditInfoModal = true
  }

  function addEditTag() {
    const tag = editTagInput.trim().replace(/^#/, '')
    if (!tag) {
      editTagInput = ''
      return
    }
    if (!editTags.includes(tag)) {
      editTags = [...editTags, tag]
    }
    editTagInput = ''
  }

  function removeEditTag(tag: string) {
    editTags = editTags.filter((t) => t !== tag)
  }

  async function saveEditInfo() {
    if (!deck || !editName.trim()) return
    savingInfo = true
    try {
      await updateDeck(deck.id, {
        name: editName.trim(),
        description: editDescription.trim() || null,
        format: editFormat.trim() || null,
        tags: editTags,
        is_favorite: editFavorite ? 1 : 0,
      })
      const updated = await getDeckById(deck.id)
      if (updated) deck = updated
      showEditInfoModal = false
    } catch (error) {
      console.error('[DeckInfo] 保存卡组信息失败:', error)
    } finally {
      savingInfo = false
    }
  }

  function openEditNote(version: DeckVersion) {
    editingNoteVersionId = version.id
    editNoteValue = version.note ?? ''
    savingNote = false
  }

  async function saveEditNote() {
    if (!editingNoteVersionId) return
    savingNote = true
    try {
      await updateDeckVersionNote(editingNoteVersionId, editNoteValue.trim() || null)
      versions = versions.map((v) =>
        v.id === editingNoteVersionId ? { ...v, note: editNoteValue.trim() || null } : v
      )
      editingNoteVersionId = null
    } catch (error) {
      console.error('[DeckInfo] 保存版本备注失败:', error)
    } finally {
      savingNote = false
    }
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
    await loadMatches(deckId)
    await Promise.all([loadTokenSuggestions(deckId)])
  }

  const loadTokenSuggestions = async (deckId: string) => {
    loadingTokens = true
    try {
      tokenSuggestions = await getDeckTokenSuggestions(deckId)
    } finally {
      loadingTokens = false
    }
  }

  const loadMatches = async (deckId: string) => {
    const [records, stats] = await Promise.all([
      getMatchesByDeck(deckId),
      getDeckMatchStats(deckId),
    ])
    matchRecords = records
    matchStats = stats
  }

  let showOwnershipModal = $state(false)
  let ownershipRows = $state<OwnershipCheckRow[]>([])
  let loadingOwnership = $state(false)
  let ownershipMatchMode = $state<OwnershipMatchMode>('print')

  async function runOwnershipCheck() {
    if (cards.length === 0) return
    loadingOwnership = true
    showOwnershipModal = true
    try {
      ownershipRows = await checkDeckOwnership(
        cards.map((c) => ({ cardPrintId: c.card_id, quantity: c.quantity })),
        { matchMode: ownershipMatchMode }
      )
    } finally {
      loadingOwnership = false
    }
  }

  function switchOwnershipMode(mode: OwnershipMatchMode) {
    if (mode === ownershipMatchMode || loadingOwnership) return
    ownershipMatchMode = mode
    runOwnershipCheck()
  }

  const zoneOfBase = $derived(
    cards.reduce((map, c) => {
      if (!map.has(c.card_base_id)) map.set(c.card_base_id, c.zone)
      return map
    }, new Map<string, string>())
  )
  const ZONE_ORDER: Record<string, number> = {
    mainDeck: 3,
    battlefields: 4,
    runes: 6,
    legend: 1,
    champion: 2,
    sideboard: 5,
  }
  const ownershipZones = $derived(
    ownershipRows
      .map((r) => ({ row: r, zone: zoneOfBase.get(r.cardId) ?? '' }))
      .sort(
        (a, b) =>
          (ZONE_ORDER[a.zone] ?? 9) - (ZONE_ORDER[b.zone] ?? 9) ||
          (a.row.cardNoExtend || a.row.cardNo).localeCompare(
            b.row.cardNoExtend || b.row.cardNo,
            undefined,
            {
              numeric: true,
            }
          )
      )
  )

  let ownershipExportFormat = $state<OwnershipExportFormat>('txt')
  let exportingOwnership = $state(false)
  let ownershipIncludeComplete = $state(false)
  let generatingPurchaseList = $state(false)

  async function generatePurchaseList() {
    if (!deck) return
    generatingPurchaseList = true
    try {
      const listId = await generatePurchaseListFromDeck(
        deck.id,
        deck.name || get(t)('builder.unnamedDeck'),
        { matchMode: ownershipMatchMode }
      )
      showOwnershipModal = false
      showToast(get(t)('purchase.created'), 'success')
      goto(`/collection/purchase-lists/${listId}`)
    } catch (err) {
      showToast(
        get(t)('deckDetail.exportFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      generatingPurchaseList = false
    }
  }

  const ownershipExportRows = $derived(
    ownershipZones
      .filter(({ row }) => ownershipIncludeComplete || row.owned < row.needed)
      .map(({ row, zone }) => ({
        zoneLabel: get(t)(ZONE_CONFIG[zone as ZoneKey].labelKey),
        cardName: row.cardName,
        cardNo: row.cardNoExtend || row.cardNo,
        owned: row.owned,
        needed: row.needed,
        insufficient: row.owned < row.needed,
      }))
  )

  async function exportOwnership() {
    if (ownershipExportRows.length === 0) return
    exportingOwnership = true
    try {
      const content =
        ownershipExportFormat === 'csv'
          ? buildOwnershipCsv(ownershipExportRows)
          : buildOwnershipText(ownershipExportRows, deck?.name ?? get(t)('builder.unnamedDeck'))
      const stamp = new Date().toISOString().slice(0, 10)
      const ok = await saveOwnershipExport(
        content,
        `${get(t)('deckDetail.ownershipFilePrefix')}-${deck?.name ?? 'deck'}-${stamp}.${ownershipExportFormat}`,
        ownershipExportFormat
      )
      if (ok) {
        showToast(
          get(t)('deckDetail.ownershipSaved', { values: { count: ownershipExportRows.length } }),
          'success'
        )
      } else {
        showToast(get(t)('deckDetail.saveCancelled'), 'info')
      }
    } catch (err) {
      showToast(
        get(t)('deckDetail.exportFailed', {
          values: { message: err instanceof Error ? err.message : get(t)('common.unknownError') },
        }),
        'error'
      )
    } finally {
      exportingOwnership = false
    }
  }

  function openCreateMatch() {
    editingMatch = null
    showMatchModal = true
  }

  function openEditMatch(match: MatchWithGames) {
    editingMatch = match
    showMatchModal = true
  }

  async function confirmDeleteMatch(match: MatchWithGames) {
    const confirm = await ask(get(t)('records.deleteConfirm'), {
      kind: 'warning',
      okLabel: get(t)('common.delete'),
      cancelLabel: get(t)('common.cancel'),
    })
    if (!confirm) return
    await deleteMatch(match.id)
    await loadMatches(deck?.id ?? '')
  }

  async function confirmDeleteDeck() {
    if (!deck) return
    const confirm = await ask(
      get(t)('deckDetail.deleteDeckConfirm', { values: { name: deck.name } }),
      {
        kind: 'warning',
        okLabel: get(t)('common.delete'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!confirm) return
    await deleteDeck(deck.id)
    goto('/decks')
  }

  const recentMatches = $derived(matchRecords.slice(0, 5))

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto('/decks')
  })

  let mobilePlatform = $state(false)

  onMount(() => {
    if (page.params.deckid) init(page.params.deckid)
    isMobile().then((is) => (mobilePlatform = is))
  })

  const legendCards = $derived(cards.filter((c) => c.zone === 'legend'))
  const championCards = $derived(cards.filter((c) => c.zone === 'champion'))
  const mainCards = $derived(cards.filter((c) => c.zone === 'mainDeck'))
  const battlefieldCards = $derived(cards.filter((c) => c.zone === 'battlefields'))
  const runeCards = $derived(cards.filter((c) => c.zone === 'runes'))
  const sideboardCards = $derived(cards.filter((c) => c.zone === 'sideboard'))

  const totalCardCount = $derived(cards.reduce((sum, c) => sum + c.quantity, 0))

  $effect(() => {
    const badges: { key: string; text: string }[] = []
    if (deck?.format) badges.push({ key: 'format', text: deck.format })
    if (deck?.is_favorite) badges.push({ key: 'favorite', text: $t('deckDetail.favorite') })
    setTopbar({
      title: deck?.name || $t('deckDetail.loading'),
      badges,
      actions: [
        {
          key: 'edit-info',
          icon: Info,
          title: $t('deckDetail.editInfo'),
          label: $t('deckDetail.infoLabel'),
          disabled: !deck,
          onClick: openEditInfo,
          priority: 5,
        },
        {
          key: 'share',
          icon: Upload,
          title: $t('deckDetail.shareDeck'),
          label: $t('common.export'),
          onClick: () => {
            shareFormat = 'text'
            showShareModal = true
          },
          priority: 2,
        },
        {
          key: 'ownership',
          icon: CircleCheck,
          title: $t('builder.ownershipCheck'),
          label: $t('builder.ownershipCheck'),
          disabled: !deck || cards.length === 0,
          onClick: runOwnershipCheck,
          priority: 5,
        },
        {
          key: 'delete',
          icon: Trash2,
          title: $t('decks.deleteTitle'),
          label: $t('common.delete'),
          variant: 'danger',
          disabled: !deck,
          onClick: confirmDeleteDeck,
          priority: 6,
        },
        {
          key: 'edit',
          label: $t('deckDetail.editDeck'),
          icon: PencilLine,
          variant: 'primary',
          priority: 0,
          onClick: () => goto(`/decks/builder?deckId=${page.params.deckid}`),
        },
      ],
    })
  })

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

  const deckFormat = $derived(resolveFormat(deck?.format))

  function displayName(card: DeckCardDetail): string {
    return card.sub_title_cn ? `${card.card_name_cn} - ${card.sub_title_cn}` : card.card_name_cn
  }

  function runeColorName(card: DeckCardDetail | null): string {
    if (!card) return 'neutral'
    const colors = parseColorList(card.card_color_list)
    return colors[0] ?? 'neutral'
  }

  const mergedRunes = $derived.by(() => {
    const map = new Map<string, { card: DeckCardDetail; quantity: number }>()
    for (const slot of runeCards) {
      const color = runeColorName(slot)
      const existing = map.get(color)
      if (existing) {
        existing.quantity += slot.quantity
      } else {
        map.set(color, { card: slot, quantity: slot.quantity })
      }
    }
    return [...map.entries()].map(([color, value]) => ({
      color,
      card: value.card,
      quantity: value.quantity,
    }))
  })

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
    initial: 'deckDetail.simInitial',
    draw: 'deckDetail.simDraw',
  }

  const simHint = $derived(
    simPhase === 'idle'
      ? $t('deckDetail.simHintIdle')
      : simPhase === 'initial'
        ? $t('deckDetail.simHintMulligan')
        : $t('deckDetail.simHintDraw', { values: { count: simDeck.length } })
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

  const exportText = $derived(formatDeckExport(zoneCards, textLang))
  const officialText = $derived(formatOfficialDeckExport(zoneCards))
  const deckCodeResult = $derived(buildDeckCode(zoneCards))

  const shareFormats = [
    {
      id: 'text',
      labelKey: 'deckDetail.formatText',
      descriptionKey: 'deckDetail.formatTextDesc',
      support: ['export', 'copy'],
    },
    {
      id: 'official',
      labelKey: 'decks.importOfficialLabel',
      descriptionKey: 'deckDetail.formatOfficialDesc',
      support: ['export', 'copy'],
    },
    {
      id: 'code',
      labelKey: 'deckDetail.formatCode',
      descriptionKey: 'deckDetail.formatCodeDesc',
      support: ['export', 'copy'],
    },
    {
      id: 'pdf',
      labelKey: 'deckDetail.formatPdf',
      descriptionKey: 'deckDetail.formatPdfDesc',
      support: ['export'],
      media: true,
      icon: FileText,
      shortLabelKey: 'pdf',
    },
    {
      id: 'image',
      labelKey: 'deckDetail.formatImage',
      descriptionKey: 'deckDetail.formatImageDesc',
      support: ['export', 'copy'],
      media: true,
      icon: ImageIcon,
      shortLabelKey: 'deckDetail.formatImageShort',
    },
    {
      id: 'qr',
      labelKey: 'decks.importQrLabel',
      descriptionKey: 'deckDetail.formatQrDesc',
      support: ['export', 'copy'],
      media: true,
      icon: QrCode,
      shortLabelKey: 'decks.importQrLabel',
    },
  ]

  function currentShareText(): string {
    if (shareFormat === 'code') return deckCodeResult.code ?? ''
    if (shareFormat === 'official') return officialText
    if (shareFormat === 'qr') return qrPayloadText
    return exportText
  }

  const qrPayloadText: string = $derived(serializeDeckPayload(zoneCards) ?? '')

  const selectedPdfZones = $derived(
    (Object.keys(ZONE_CONFIG) as ZoneKey[]).filter((zone) => pdfZones[zone])
  )

  const selectedPdfZoneCount = $derived(
    selectedPdfZones.reduce((sum, zone) => sum + (zoneCounts[zone] || 0), 0)
  )

  function currentShareTextAvailable(): boolean {
    if (shareFormat === 'code') return !!deckCodeResult.code
    if (shareFormat === 'official') return officialText.length > 0
    if (shareFormat === 'pdf') return selectedPdfZoneCount > 0
    if (shareFormat === 'image') return cards.length > 0
    if (shareFormat === 'qr') return qrPayloadText.length > 0
    return exportText.length > 0
  }

  function currentDeckBackground() {
    return {
      color: imageBgColor,
      imageUrl: imageBgImage ?? undefined,
      overlay: imageBgImage ? imageBgOverlay / 100 : undefined,
      maskColor: imageMaskColor,
    }
  }

  function currentDeckImageOptions() {
    return {
      deckName: deck?.name,
      cards,
      sortRules: imageSortList,
      background: currentDeckBackground(),
      textColor: imageTextColor || undefined,
      playerName: $playerName.trim() || undefined,
    }
  }

  async function buildDeckImageDataUrl(): Promise<string> {
    return await buildDeckImage({
      ...currentDeckImageOptions(),
      onProgress: (p) => (exportProgress = p),
    })
  }

  async function generateImagePreview() {
    imagePreviewing = true
    try {
      imagePreviewUrl = await buildDeckImage(currentDeckImageOptions())
      previewGenerated = true
    } catch (error) {
      console.error('[DeckImage] 生成预览失败:', error)
      imagePreviewUrl = null
    } finally {
      imagePreviewing = false
    }
  }

  function schedulePreviewRegen() {
    if (!previewGenerated) return
    if (previewRegenTimer) clearTimeout(previewRegenTimer)
    previewRegenTimer = setTimeout(() => {
      previewRegenTimer = undefined
      generateImagePreview()
    }, 500)
  }

  $effect(() => {
    imageBgColor
    imageBgImage
    imageBgOverlay
    imageMaskColor
    imageTextColor
    imageSortList
    schedulePreviewRegen()
  })

  async function generateQrPreview() {
    if (!qrPayloadText) {
      qrDataUrl = null
      return
    }
    qrGenerating = true
    try {
      qrDataUrl = await buildDeckQrDataUrl(qrPayloadText)
    } catch (error) {
      console.error('[DeckQr] 生成二维码失败:', error)
      qrDataUrl = null
    } finally {
      qrGenerating = false
    }
  }

  function scheduleQrRegen() {
    if (qrTimer) clearTimeout(qrTimer)
    qrTimer = setTimeout(() => {
      qrTimer = undefined
      generateQrPreview()
    }, 200)
  }

  $effect(() => {
    qrPayloadText
    if (shareFormat === 'qr') scheduleQrRegen()
  })

  async function copyDeckImage(dataUrl: string, isPng = false): Promise<void> {
    if (isTauri && mobilePlatform) {
      await shareDeckImage(dataUrl, isPng)
      return
    }
    if (isTauri) {
      const pngBytes = isPng ? dataUrlToBytes(dataUrl) : await jpegDataUrlToPngBytes(dataUrl)
      await writeImage(pngBytes)
      return
    }
    const png = isPng ? dataUrlToBytes(dataUrl) : await jpegDataUrlToPngBytes(dataUrl)
    const blob = new Blob([png], { type: 'image/png' })
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }

  async function shareDeckImage(dataUrl: string, isPng = false): Promise<void> {
    const { appCacheDir, join } = await import('@tauri-apps/api/path')
    const { writeFile, remove, mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    const cacheDir = await appCacheDir()
    const fileName = `${(deck?.name ?? 'deck').replace(/[\\/:*?"<>|]/g, '_')}.${isPng ? 'png' : 'jpg'}`
    const relFile = await join('share', fileName)
    const bytes = dataUrlToBytes(dataUrl)
    const absFile = await join(cacheDir, relFile)
    try {
      await mkdir('share', { baseDir: BaseDirectory.AppCache, recursive: true }).catch(() => {})
      await writeFile(relFile, bytes, { baseDir: BaseDirectory.AppCache })
      await shareFile('file://' + absFile, {
        mimeType: isPng ? 'image/png' : 'image/jpeg',
        title: fileName,
      })
      showToast(get(t)('deckDetail.sharePanelOpened'), 'success')
    } finally {
      await remove(relFile, { baseDir: BaseDirectory.AppCache }).catch(() => {})
    }
  }

  async function confirmCopy() {
    if (shareFormat === 'image') {
      exporting = true
      exportProgress = 0
      try {
        const dataUrl = await buildDeckImageDataUrl()
        await copyDeckImage(dataUrl)
        showShareModal = false
      } catch (error) {
        console.error('[DeckImage] 复制卡组图案失败:', error)
      } finally {
        exporting = false
      }
      return
    }
    if (shareFormat === 'qr') {
      exporting = true
      try {
        if (!qrDataUrl) await generateQrPreview()
        if (!qrDataUrl) return
        await copyDeckImage(qrDataUrl, true)
        showShareModal = false
      } catch (error) {
        console.error('[DeckQr] 复制二维码失败:', error)
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
    showShareModal = false
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
          showShareModal = false
          return
        }
        const dest = await save({
          title: get(t)('deckDetail.exportPdfTitle'),
          defaultPath: `${deck?.name || 'deck'}-proxy.pdf`,
          filters: [{ name: 'PDF', extensions: ['pdf'] }],
        })
        if (!dest) return
        await writePdfToPath(bytes, dest)
        showShareModal = false
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
          downloadImageInWeb(dataUrl, `${deck?.name || 'deck'}.jpg`)
          showShareModal = false
          return
        }
        const dest = await save({
          title: get(t)('deckDetail.exportImageTitle'),
          defaultPath: `${deck?.name || 'deck'}.jpg`,
          filters: [{ name: 'JPG', extensions: ['jpg'] }],
        })
        if (!dest) return
        await writeImageToPath(dataUrl, dest)
        showShareModal = false
      } catch (error) {
        console.error('[DeckImage] 导出卡组图案失败:', error)
      } finally {
        exporting = false
      }
      return
    }

    if (shareFormat === 'qr') {
      exporting = true
      try {
        if (!qrDataUrl) await generateQrPreview()
        if (!qrDataUrl) return
        const fileName = `${deck?.name || 'deck'}-qr.png`
        if (isWeb) {
          downloadImageInWeb(qrDataUrl, fileName)
          showShareModal = false
          return
        }
        const dest = await save({
          title: get(t)('deckDetail.exportQrTitle'),
          defaultPath: fileName,
          filters: [{ name: 'PNG', extensions: ['png'] }],
        })
        if (!dest) return
        await writeImageToPath(qrDataUrl, dest)
        showShareModal = false
      } catch (error) {
        console.error('[DeckQr] 导出二维码失败:', error)
      } finally {
        exporting = false
      }
      return
    }

    const text = currentShareText()
    if (!text) return
    if (isWeb) {
      if (navigator.clipboard) await navigator.clipboard.writeText(text)
      showShareModal = false
      return
    }

    const isCode = shareFormat === 'code'
    const dest = await save({
      title: get(t)('deckDetail.exportDeckTitle'),
      defaultPath: `${deck?.name || 'deck'}${isCode ? '.code' : '.txt'}`,
      filters: isCode
        ? [{ name: 'Deck Code', extensions: ['code'] }]
        : [{ name: 'Text', extensions: ['txt'] }],
    })
    if (!dest) return
    await writeTextFile(dest, text)
    showShareModal = false
  }
</script>

<div class="deck-builder-container">
  <div class="deck-info-bar">
    {#if deck?.description}
      <p class="deck-description selectable">{deck.description}</p>
    {/if}
    {#if deck?.tags && deck.tags.length > 0}
      <div class="deck-tags">
        {#each deck.tags as tag (tag)}
          <span class="deck-tag-chip">{tag}</span>
        {/each}
      </div>
    {/if}
    <div class="deck-meta">
      <span>{$t('deckDetail.totalCardsLabel')} <strong>{totalCardCount}</strong></span>
      <span class="divider">•</span>
      <span
        >{$t('deckDetail.createdAt')}
        {deck?.created_at
          ? new Date(deck.created_at).toLocaleDateString()
          : $t('common.unknown')}</span
      >
      {#if deck?.updated_at}
        <span class="divider">•</span>
        <span>{$t('deckDetail.updatedAt')} {getRelativeTime(deck.updated_at)}</span>
      {/if}
    </div>
  </div>

  <section class="analysis-dashboard">
    <section class="match-section">
      <div class="match-section-header">
        <div class="match-section-title">
          <Swords size={18} />
          <h2>{$t('records.title')}</h2>
          {#if matchStats}
            <span class="match-winrate-badge">
              {$t('deckDetail.winRate', {
                values: {
                  value:
                    matchStats.games > 0
                      ? Math.round((matchStats.wins / matchStats.games) * 100)
                      : 0,
                },
              })}
            </span>
          {/if}
        </div>
        <div class="match-section-actions">
          <button
            class="button button-ghost button-sm"
            onclick={() => goto(`/decks/${page.params.deckid}/records`)}
          >
            {$t('deckDetail.viewAll')}
            <ChevronRight size={14} />
          </button>
          <button class="button button-primary button-sm" onclick={openCreateMatch}>
            <Plus size={14} />
            {$t('match.recordTitle')}
          </button>
        </div>
      </div>

      {#if matchStats}
        <div class="match-summary">
          <div class="summary-item">
            <span class="summary-value">{matchStats.matches}</span>
            <span class="summary-label">{$t('records.statMatches')}</span>
          </div>
          <div class="summary-item">
            <span class="summary-value">{matchStats.games}</span>
            <span class="summary-label">{$t('records.statGames')}</span>
          </div>
          <div class="summary-item">
            <span class="summary-value summary-win">{matchStats.wins}</span>
            <span class="summary-label">{$t('records.statWins')}</span>
          </div>
          <div class="summary-item">
            <span class="summary-value summary-loss">{matchStats.losses}</span>
            <span class="summary-label">{$t('records.statLosses')}</span>
          </div>
          {#if matchStats.draws > 0}
            <div class="summary-item">
              <span class="summary-value">{matchStats.draws}</span>
              <span class="summary-label">{$t('records.statDraws')}</span>
            </div>
          {/if}
          {#if matchStats.first_games > 0}
            <div class="summary-item">
              <span class="summary-value summary-win">
                {Math.round((matchStats.first_wins / matchStats.first_games) * 100)}%
              </span>
              <span class="summary-label">{$t('records.statFirstWinRate')}</span>
            </div>
          {/if}
          {#if matchStats.second_games > 0}
            <div class="summary-item">
              <span class="summary-value summary-loss">
                {Math.round((matchStats.second_wins / matchStats.second_games) * 100)}%
              </span>
              <span class="summary-label">{$t('records.statSecondWinRate')}</span>
            </div>
          {/if}
        </div>
      {/if}

      {#if recentMatches.length > 0}
        <ul class="match-list">
          {#each recentMatches as match (match.id)}
            {@const expanded = expandedMatchIds.has(match.id)}
            <li class="match-item">
              <div
                class="match-item-header"
                role="presentation"
                onclick={() => toggleMatchExpand(match.id)}
              >
                <span class="match-item-date">
                  {match.played_at
                    ? new Date(match.played_at).toLocaleDateString()
                    : $t('records.noDate')}
                </span>
                <span class="match-item-opponent">
                  {match.player_name || $t('records.me')} vs {match.opponent_name ||
                    $t('records.unknownOpponent')}
                </span>
                {#if match.group_name}
                  <span class="match-group-badge">{match.group_name}</span>
                {/if}
                {#if match.best_of}
                  <span class="match-bestof-badge">BO{match.best_of}</span>
                {/if}
                {#if match.deck_version_number}
                  <span class="match-version-badge">v{match.deck_version_number.toFixed(1)}</span>
                {/if}
                <span class="match-item-result">{matchSummaryText(match)}</span>
                <span class="match-item-chevron" class:rotate={expanded}>
                  <ChevronRight size={14} />
                </span>
              </div>
              {#if expanded}
                <div class="match-item-detail">
                  {#if match.note}
                    <p class="match-note selectable">{match.note}</p>
                  {/if}
                  {#if match.opp_legend_name}
                    <div class="match-legend-row">
                      <CardSimpleImage
                        url={match.opp_legend_image}
                        name={`${match.opp_legend_print_code ?? match.opp_legend_id ?? 'none'}-${match.opp_legend_lang ?? match.opp_legend_print_id ?? 'none'}`}
                        className="match-legend-thumb"
                      />
                      <span class="match-legend-label">{$t('records.oppLegend')}</span>
                      <span class="match-legend-name">{match.opp_legend_name}</span>
                    </div>
                  {/if}
                  <ul class="game-list">
                    {#each match.games as game (game.id)}
                      <li class="game-item">
                        <span class="game-number-badge"
                          >{$t('match.gameNumber', { values: { number: game.game_number } })}</span
                        >
                        {#if game.is_first !== null}
                          <span
                            class="game-turn-badge"
                            class:first={game.is_first}
                            class:second={!game.is_first}
                          >
                            {game.is_first ? $t('records.first') : $t('records.second')}
                          </span>
                        {/if}
                        <span class="game-score">
                          {#if game.my_score !== null && game.opp_score !== null}
                            {game.my_score} : {game.opp_score}
                          {:else}
                            {$t('records.noScore')}
                          {/if}
                        </span>
                        <span
                          class="game-result"
                          class:win={gameResult(game) === 'win'}
                          class:loss={gameResult(game) === 'loss'}
                          class:draw={gameResult(game) === 'draw'}
                        >
                          {gameResult(game) === 'win'
                            ? $t('match.win')
                            : gameResult(game) === 'loss'
                              ? $t('match.loss')
                              : $t('match.draw')}
                        </span>
                        {#if game.win_type === 'concede'}
                          <span class="game-special-badge">{$t('match.oppConcede')}</span>
                        {:else if game.win_type === 'special'}
                          <span class="game-special-badge special">{$t('match.specialWin')}</span>
                        {/if}
                        {#if game.win_reason}
                          <span class="game-reason">{game.win_reason}</span>
                        {/if}
                      </li>
                      {#if game.log}
                        <li class="game-log">📝 {game.log}</li>
                      {/if}
                    {/each}
                  </ul>
                  <div class="match-item-actions">
                    <button
                      class="button button-text button-sm"
                      onclick={() => openEditMatch(match)}
                    >
                      <PencilLine size={13} />
                      {$t('common.edit')}
                    </button>
                    <button
                      class="button button-text button-sm"
                      onclick={() => confirmDeleteMatch(match)}
                    >
                      <Trash2 size={13} />
                      {$t('common.delete')}
                    </button>
                  </div>
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {:else}
        <div class="match-empty">
          <p>{$t('deckDetail.noMatches')}</p>
        </div>
      {/if}
    </section>

    <div class="analysis-card curve-card">
      <CostCurveChart cards={mainCards} />
    </div>

    <div class="analysis-card token-card">
      <div class="analysis-card-header">
        <Shapes size={18} />
        <h3>{$t('deckDetail.tokenSectionTitle')}</h3>
      </div>

      {#if loadingTokens}
        <p class="token-empty">{$t('deckDetail.tokenLoading')}</p>
      {:else if tokenSuggestions.length > 0}
        <p class="token-hint">{$t('deckDetail.tokenSectionHint')}</p>
        <ul class="token-grid">
          {#each tokenSuggestions as item (item.card.card_name_cn || item.card.card_name_en)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <li class="token-item" onclick={() => openCardModalForBase(item.card)}>
              <div class="token-item-img">
                <CardSimpleImage
                  url={item.bestPrint?.url}
                  name={item.bestPrint ? printCacheName(item.bestPrint) : item.card.id}
                  isLandscape={false}
                />
              </div>
              <span class="token-item-name">{item.card.card_name_cn || item.card.card_name_en}</span
              >
              <span class="token-item-count">
                {$t('deckDetail.tokenMentions', { values: { count: item.mentions } })}
              </span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="token-empty">{$t('deckDetail.tokenEmpty')}</p>
      {/if}
    </div>

    <!-- <div class="analysis-card">
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
    </div> -->

    <div class="analysis-card sim-card">
      <div class="analysis-card-header">
        <Dices size={18} />
        <h3>{$t('deckDetail.simTitle')}</h3>
        {#if simPhase !== 'idle'}
          <span class="sim-phase-badge">{$t(PHASE_LABEL[simPhase])}</span>
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
                name={`${instance.card.print_code}-${instance.card.language}`}
                isLandscape={false}
              />
              {#if mulliganSelection.has(instance.uid)}
                <span class="sim-check">{$t('deckDetail.simMulligan')}</span>
              {/if}
            </button>
          {/each}
        </div>
      {:else}
        <div class="sim-empty">{$t('deckDetail.simEmpty')}</div>
      {/if}

      <div class="sim-actions">
        <button
          class="button button-primary"
          disabled={simPhase !== 'idle' || mainCards.length === 0}
          onclick={drawFour}
        >
          {$t('deckDetail.draw4')}
        </button>
        <button
          class="button button-secondary"
          disabled={simPhase !== 'initial'}
          onclick={confirmMulligan}
        >
          {$t('deckDetail.mulligan2')}{mulliganSelection.size > 0
            ? ` · ${mulliganSelection.size}`
            : ''}
        </button>
        <button
          class="button button-secondary"
          disabled={simPhase !== 'draw' || simDeck.length === 0}
          onclick={drawOne}
        >
          {$t('deckDetail.draw1')}
        </button>
        <button class="button button-ghost" disabled={simPhase === 'idle'} onclick={resetSim}>
          {$t('common.reset')}
        </button>
      </div>
    </div>
  </section>

  <section class="hero-strip">
    <div class="hero-cards">
      <div class="hero-card-slot">
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
                name={`${legendCards[0].print_code}-${legendCards[0].language}`}
                isLandscape={false}
              />
            </div>
          </button>
        {:else}
          <div class="hero-card hero-placeholder">{$t('deckDetail.emptySlot')}</div>
        {/if}
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
                name={`${championCards[0].print_code}-${championCards[0].language}`}
                isLandscape={false}
              />
            </div>
          </button>
        {:else}
          <div class="hero-card hero-placeholder">{$t('deckDetail.emptySlot')}</div>
        {/if}

        {#if mergedRunes.length > 0}
          <ul class="rune-list">
            {#each mergedRunes as rune, i (rune.color)}
              {@const color = rune.color}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
              <li class="rune-row" onclick={() => openCardModal(rune.card)}>
                {#if color === 'neutral'}
                  <span class="rune-icon-fallback" title={displayName(rune.card)}></span>
                {:else}
                  <img
                    src={`/runes/${color}.svg`}
                    alt={color}
                    title={displayName(rune.card)}
                    width="36"
                    height="36"
                  />
                {/if}
                <span class="rune-count">×{rune.quantity}</span>
              </li>
            {/each}
          </ul>
        {:else}
          <div class="hero-placeholder rune-placeholder">{$t('deckDetail.noRunes')}</div>
        {/if}

        {#if battlefieldCards.length > 0}
          <section class="card-zone">
            <ul class="card-grid landscape-grid">
              {#each battlefieldCards as card}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
                <li class="card-item landscape-item" onclick={() => openCardModal(card)}>
                  <!-- <div class="qty-badge">x{card.quantity}</div> -->
                  <div class="card-img-wrapper landscape">
                    <CardSimpleImage
                      url={card.img_cdn}
                      name={`${card.print_code}-${card.language}`}
                      isLandscape={true}
                    />
                  </div>
                  <!-- <div class="card-details">
                    <span class="card-name">{card.card_name_cn}</span>
                    {#if card.sub_title_cn}
                      <span class="card-subtitle"> {card.sub_title_cn}</span>
                    {/if}
                  </div> -->
                </li>
              {/each}
            </ul>
          </section>
        {/if}
      </div>
    </div>
  </section>

  <div class="builder-layout">
    <main class="card-list-section">
      {#if mainCards.length > 0}
        <section class="card-zone">
          <h3>
            {$t('builder.mainDeck')}
            <span class="count-badge">
              {zoneCounts.mainDeck} / {getZoneConfig(deckFormat, 'mainDeck').maxCount}
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
                    name={`${card.print_code}-${card.language}`}
                    isLandscape={false}
                  />
                </div>
                <!-- <div class="card-details">
                  <span class="card-name">{card.card_name_cn}</span>
                  {#if card.sub_title_cn}
                    <span class="card-subtitle"> {card.sub_title_cn}</span>
                  {/if}
                </div> -->
              </li>
            {/each}
          </ul>
        </section>
      {/if}

      {#if sideboardCards.length > 0}
        <section class="card-zone">
          <h3>
            {$t('builder.sideboard')}
            <span class="count-badge">
              {zoneCounts.sideboard} / {getZoneConfig(deckFormat, 'sideboard').maxCount}
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
                    name={`${card.print_code}-${card.language}`}
                    isLandscape={false}
                  />
                </div>
                <!-- <div class="card-details">
                  <span class="card-name">{card.card_name_cn}</span>
                  {#if card.sub_title_cn}
                    <span class="card-subtitle"> {card.sub_title_cn}</span>
                  {/if}
                </div> -->
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    </main>

    <aside class="version-sidebar">
      <h3><History size={18} /> {$t('deckDetail.versionHistory')}</h3>
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
            <div class="version-note-row">
              <div class="version-note">{row.version.note || $t('deckDetail.noNote')}</div>
              <button
                type="button"
                class="icon-btn note-edit-btn"
                title={$t('deckDetail.editNote')}
                onclick={() => openEditNote(row.version)}
              >
                <Pencil size={13} />
              </button>
            </div>
            <div class="version-stats">
              {$t('deckDetail.totalCardsShort')} <strong>{row.totalCards}</strong>
            </div>
            {#if row.isInitial}
              <div class="version-diff version-diff-initial">{$t('deckDetail.initialVersion')}</div>
            {:else if row.diff.length === 0}
              <div class="version-diff version-diff-empty">{$t('deckDetail.noChanges')}</div>
            {:else}
              <ul class="version-diff">
                {#each visibleDiff as item (row.version.id + item.kind + item.card_id)}
                  <li
                    class="diff-item"
                    class:diff-add={item.kind === 'added' || item.kind === 'increased'}
                    class:diff-remove={item.kind === 'removed' || item.kind === 'decreased'}
                  >
                    <div class="diff-image-wrap">
                      <div class="diff-image">
                        <CardSimpleImage
                          url={item.img_cdn}
                          name={`${item.print_code}-${item.language}`}
                          isLandscape={item.isLandscape}
                        />
                      </div>
                      <span class="diff-qty-badge">{diffBadgeLabel(item)}</span>
                    </div>
                  </li>
                {/each}
              </ul>
              {#if row.diff.length > 5}
                <button
                  class="button button-text button-sm"
                  type="button"
                  onclick={() => toggleVersionExpand(row.version.id)}
                >
                  {expanded
                    ? $t('deckDetail.collapse')
                    : $t('deckDetail.diffChanges', { values: { count: row.diff.length } })}
                </button>
              {/if}
            {/if}
          </li>
        {:else}
          <li class="empty-hint">{$t('deckDetail.noVersions')}</li>
        {/each}
      </ul>
    </aside>
  </div>
</div>

<CommonModal
  open={showShareModal}
  title={$t('deckDetail.shareDeck')}
  onclose={() => (showShareModal = false)}
>
  <div class="share-format-list">
    {#each shareFormats.filter((f) => !f.media) as format (format.id)}
      <button
        type="button"
        class="share-format-option"
        class:selected={shareFormat === format.id}
        onclick={() => {
          shareFormat = format.id as 'text' | 'code' | 'pdf' | 'image' | 'official' | 'qr'
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
        <span class="share-format-label">{$t(format.labelKey)}</span>
        <span class="share-format-desc">{$t(format.descriptionKey)}</span>
      </button>
    {/each}

    {#if shareFormats.some((f) => f.media)}
      <div class="share-format-cards">
        {#each shareFormats.filter((f) => f.media) as format (format.id)}
          {@const FormatIcon = format.icon}
          <button
            type="button"
            class="share-format-card"
            class:selected={shareFormat === format.id}
            onclick={() => {
              shareFormat = format.id as 'text' | 'code' | 'pdf' | 'image' | 'official' | 'qr'
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
            <span class="share-format-card-icon">
              <FormatIcon size={22} />
            </span>
            <span class="share-format-card-label">{$t(format.shortLabelKey ?? '')}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if shareFormat === 'text' || shareFormat === 'code' || shareFormat === 'official'}
    <div class="text-preview-section">
      <div class="text-preview-title">{$t('deckDetail.preview')}</div>
      {#if shareFormat === 'text'}
        <div class="text-lang-switch">
          <button
            type="button"
            class="text-lang-btn"
            class:selected={textLang === 'cn'}
            onclick={() => (textLang = 'cn')}
          >
            {$t('deckDetail.chinese')}
          </button>
          <button
            type="button"
            class="text-lang-btn"
            class:selected={textLang === 'en'}
            onclick={() => (textLang = 'en')}
          >
            English
          </button>
        </div>
      {/if}
      {#if shareFormat === 'code' && deckCodeResult.error}
        <div class="share-format-error">
          <CircleAlert size={16} />
          <span>{$t('deckDetail.codeGenFailed', { values: { error: deckCodeResult.error } })}</span>
        </div>
      {:else}
        <pre class="text-preview-box selectable">{currentShareText() ||
            $t('deckDetail.noExportContent')}</pre>
      {/if}
    </div>
  {/if}

  {#if shareFormat === 'pdf'}
    <div class="pdf-zone-select">
      <div class="pdf-zone-title">
        {$t('deckDetail.selectZones', { values: { count: selectedPdfZoneCount } })}
      </div>
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
            <span class="pdf-zone-label">{$t('builder.' + zoneKey)}</span>
            <span class="pdf-zone-count"
              >{$t('deckDetail.cardsCount', { values: { count: zoneCounts[zoneKey] } })}</span
            >
          </button>
        {/each}
      </div>
    </div>
  {/if}

  {#if shareFormat === 'image'}
    <div class="image-sort-section">
      <div class="image-sort-title">{$t('deckDetail.preview')}</div>
      {#if imagePreviewUrl}
        <div class="image-preview-box">
          <img
            class="image-preview-img"
            src={imagePreviewUrl}
            alt={$t('deckDetail.imagePreviewAlt')}
          />
          {#if imagePreviewing}
            <div class="image-preview-loading">{$t('deckDetail.updatingPreview')}</div>
          {/if}
        </div>
      {:else}
        <p class="image-sort-desc">{$t('deckDetail.imagePreviewHint')}</p>
        <button
          type="button"
          class="button button-secondary button-sm"
          disabled={imagePreviewing || cards.length === 0}
          onclick={generateImagePreview}
        >
          <ImageIcon size={14} />
          {imagePreviewing ? $t('deckDetail.generating') : $t('deckDetail.generatePreview')}
        </button>
      {/if}
    </div>

    <div class="image-sort-section">
      <div class="image-sort-title">{$t('deckDetail.background')}</div>
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
          title={$t('deckDetail.customBgColor')}
        />
      </div>
      <div class="image-bg-color-row">
        <span class="overlay-label">{$t('deckDetail.textColorLabel')}</span>
        {#each IMAGE_TEXT_PRESETS as preset (preset)}
          {#if preset === ''}
            <button
              type="button"
              class="bg-swatch bg-swatch-auto"
              class:selected={imageTextColor === ''}
              title={$t('deckDetail.autoTextColor')}
              onclick={() => (imageTextColor = '')}
            >
              A
            </button>
          {:else}
            <button
              type="button"
              class="bg-swatch"
              class:selected={imageTextColor === preset}
              style={`background: ${preset}`}
              aria-label={preset}
              onclick={() => (imageTextColor = preset)}
            ></button>
          {/if}
        {/each}
        <input
          type="color"
          class="bg-color-picker"
          bind:value={imageTextColor}
          title={$t('deckDetail.customTextColor')}
        />
      </div>
      <div class="image-bg-image-row">
        <button type="button" class="button button-ghost button-sm" onclick={pickBackgroundImage}>
          <ImageIcon size={14} />
          {imageBgImage ? $t('deckDetail.changeBgImage') : $t('deckDetail.chooseBgImage')}
        </button>
        {#if imageBgImage}
          <div class="bg-image-preview">
            <img src={imageBgImage} alt={$t('deckDetail.bgPreviewAlt')} />
            <button
              type="button"
              class="icon-btn bg-image-remove"
              title={$t('deckDetail.removeBgImage')}
              onclick={() => (imageBgImage = null)}
            >
              <X size={14} />
            </button>
          </div>
        {/if}
      </div>
      {#if imageBgImage}
        <div class="image-bg-color-row">
          <span class="overlay-label">{$t('deckDetail.maskColor')}</span>
          {#each IMAGE_MASK_PRESETS as preset (preset)}
            <button
              type="button"
              class="bg-swatch"
              class:selected={imageMaskColor === preset}
              style={`background: ${preset}`}
              aria-label={preset}
              onclick={() => (imageMaskColor = preset)}
            ></button>
          {/each}
          <input
            type="color"
            class="bg-color-picker"
            bind:value={imageMaskColor}
            title={$t('deckDetail.customMaskColor')}
          />
        </div>
        <div class="image-bg-overlay-row">
          <span class="overlay-label"
            >{$t('deckDetail.maskStrength', { values: { value: imageBgOverlay } })}</span
          >
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
      <div class="image-sort-title">{$t('deckDetail.cardSort')}</div>
      <p class="image-sort-desc">{$t('deckDetail.cardSortDesc')}</p>
      <SortModal bind:sortByList={imageSortList} fields={DECK_IMAGE_SORT_FIELDS} />
    </div>
  {/if}

  {#if shareFormat === 'qr'}
    <div class="qr-section">
      <div class="text-preview-title">{$t('deckDetail.preview')}</div>
      {#if qrPayloadText}
        <div class="qr-preview-box">
          {#if qrDataUrl}
            <img
              src={qrDataUrl}
              alt={$t('deckDetail.qrPreviewAlt')}
              class="qr-preview-img"
              width={320}
              height={320}
            />
          {:else}
            <div class="image-preview-loading">{$t('deckDetail.generatingQr')}</div>
          {/if}
        </div>
        <pre class="text-preview-box selectable">{qrPayloadText}</pre>
      {:else}
        <p class="image-sort-desc">{$t('deckDetail.qrUnavailable')}</p>
      {/if}
      <p class="qr-hint">
        {$t('deckDetail.qrHint', { values: { version: QR_PAYLOAD_VERSION } })}
      </p>
    </div>
  {/if}

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => (showShareModal = false)}
      >{$t('common.cancel')}</button
    >
    {#if shareFormat !== 'pdf'}
      <button
        class="button button-primary"
        disabled={!currentShareTextAvailable() || exporting}
        onclick={confirmCopy}
      >
        {(shareFormat === 'image' || shareFormat === 'qr') && mobilePlatform
          ? $t('deckDetail.share')
          : $t('common.copy')}
      </button>
    {/if}
    <button
      class="button button-primary"
      disabled={!currentShareTextAvailable() || exporting}
      onclick={confirmExport}
    >
      {$t('common.download')}
    </button>
  {/snippet}
</CommonModal>

{#if exporting}
  <LoadingModal
    status="downloading"
    text={shareFormat === 'image'
      ? $t('deckDetail.generatingImage')
      : shareFormat === 'qr'
        ? $t('deckDetail.generatingQr')
        : $t('deckDetail.generatingPdf')}
    subtext={$t('deckDetail.loadingCardsLayout')}
    progress={exportProgress}
  />
{/if}

<CommonModal
  open={showEditInfoModal}
  title={$t('deckDetail.editDeckInfo')}
  subtitle={$t('deckDetail.editDeckInfoSub')}
  closable={!savingInfo}
  onclose={() => (showEditInfoModal = false)}
>
  <label class="edit-info-field">
    <span class="edit-info-label">
      {$t('builder.deckNameLabel')} <span class="edit-info-required">*</span>
    </span>
    <input
      class="edit-info-input"
      type="text"
      placeholder={$t('deckDetail.deckNamePlaceholder')}
      maxlength="100"
      bind:value={editName}
      disabled={savingInfo}
      onkeydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          saveEditInfo()
        }
      }}
    />
  </label>

  <label class="edit-info-field">
    <span class="edit-info-label">{$t('builder.description')}</span>
    <textarea
      class="edit-info-textarea"
      placeholder={$t('builder.descriptionPlaceholder')}
      maxlength="500"
      rows="4"
      bind:value={editDescription}
      disabled={savingInfo}></textarea>
  </label>

  <label class="edit-info-field">
    <span class="edit-info-label">{$t('deckDetail.format')}</span>
    <select class="edit-info-select" bind:value={editFormat} disabled={savingInfo}>
      <option value="">{$t('deckDetail.unknownFormat')}</option>
      {#each editFormatOptions() as format (format)}
        <option value={format}
          >{FORMAT_LABEL_KEYS[format] ? $t(FORMAT_LABEL_KEYS[format]) : format}</option
        >
      {/each}
    </select>
  </label>

  <div class="edit-info-field">
    <span class="edit-info-label">{$t('deckDetail.tags')}</span>
    {#if editTags.length > 0}
      <div class="edit-info-tags">
        {#each editTags as tag (tag)}
          <span class="edit-info-tag-chip">
            {tag}
            <button
              type="button"
              class="edit-info-tag-remove"
              disabled={savingInfo}
              onclick={() => removeEditTag(tag)}
              aria-label={$t('decks.removeTag')}
            >
              ×
            </button>
          </span>
        {/each}
      </div>
    {/if}
    <div class="edit-info-tag-input-wrap">
      <input
        class="edit-info-input edit-info-tag-input"
        type="text"
        placeholder={$t('deckDetail.tagInputPlaceholder')}
        maxlength="20"
        bind:value={editTagInput}
        disabled={savingInfo}
        onkeydown={(event) => {
          if (event.key === 'Enter' || event.key === ',') {
            event.preventDefault()
            addEditTag()
          }
        }}
        onblur={() => {
          if (editTagInput.trim()) addEditTag()
        }}
      />
    </div>
  </div>

  <label class="edit-info-favorite">
    <input type="checkbox" bind:checked={editFavorite} disabled={savingInfo} />
    <span>{$t('deckDetail.favorite')}</span>
  </label>

  {#snippet footer()}
    <button
      class="button button-ghost"
      disabled={savingInfo}
      onclick={() => (showEditInfoModal = false)}
    >
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      disabled={savingInfo || !editName.trim()}
      onclick={saveEditInfo}
    >
      {savingInfo ? $t('common.saving') : $t('common.save')}
    </button>
  {/snippet}
</CommonModal>

<CommonModal
  open={editingNoteVersionId !== null}
  title={$t('deckDetail.editVersionNote')}
  subtitle={editingNoteVersionId
    ? `v${versions.find((v) => v.id === editingNoteVersionId)?.version_number ?? ''}`
    : ''}
  closable={!savingNote}
  onclose={() => (editingNoteVersionId = null)}
>
  <label class="edit-info-field">
    <span class="edit-info-label">{$t('common.note')}</span>
    <textarea
      class="edit-info-textarea"
      placeholder={$t('builder.notePlaceholder')}
      maxlength="300"
      rows="4"
      bind:value={editNoteValue}
      disabled={savingNote}></textarea>
  </label>

  {#snippet footer()}
    <button
      class="button button-ghost"
      disabled={savingNote}
      onclick={() => (editingNoteVersionId = null)}
    >
      {$t('common.cancel')}
    </button>
    <button class="button button-primary" disabled={savingNote} onclick={saveEditNote}>
      {savingNote ? $t('common.saving') : $t('common.save')}
    </button>
  {/snippet}
</CommonModal>

<CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

<MatchRecordModal
  open={showMatchModal}
  deckId={deck?.id ?? ''}
  editing={editingMatch}
  onclose={() => (showMatchModal = false)}
  onSaved={() => loadMatches(deck?.id ?? '')}
/>

<CommonModal
  open={showOwnershipModal}
  title={$t('builder.ownershipCheck')}
  subtitle={$t('deckDetail.ownershipSubtitle')}
  closable={!loadingOwnership && !generatingPurchaseList}
  onclose={() => (showOwnershipModal = false)}
>
  <div class="ownership-panel">
    <div class="ownership-mode-toggle">
      <button
        class:active={ownershipMatchMode === 'card'}
        disabled={loadingOwnership}
        onclick={() => switchOwnershipMode('card')}
      >
        {$t('builder.byCard')}
      </button>
      <button
        class:active={ownershipMatchMode === 'print'}
        disabled={loadingOwnership}
        onclick={() => switchOwnershipMode('print')}
      >
        {$t('builder.byPrint')}
      </button>
    </div>
    {#if loadingOwnership}
      <div class="ownership-loading">
        <LoaderCircle class="animate-spin" size={16} />
        <span>{$t('builder.checking')}</span>
      </div>
    {:else if ownershipZones.length === 0}
      <p class="ownership-empty">{$t('builder.allOwned')}</p>
    {:else}
      <p class="ownership-hint">{$t('builder.insufficientOwned')}</p>
      <table class="ownership-table">
        <thead>
          <tr>
            <th>{$t('deckDetail.zoneCol')}</th>
            <th>{$t('builder.cardCol')}</th>
            <th>{$t('builder.noCol')}</th>
            <th>{$t('builder.ownedCol')}</th>
            <th>{$t('builder.neededCol')}</th>
          </tr>
        </thead>
        <tbody>
          {#each ownershipZones as { row, zone } (row.cardNo + '##' + row.cardNoExtend)}
            <tr>
              <td class="cell-zone">{$t('builder.' + zone)}</td>
              <td class="cell-name">{row.cardName}</td>
              <td class="cell-no">{row.cardNoExtend || row.cardNo}</td>
              <td class="cell-owned" class:insufficient={row.owned < row.needed}>{row.owned}</td>
              <td class="cell-needed">{row.needed}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>

  {#snippet footer()}
    {#if ownershipZones.length > 0}
      <div class="ownership-footer-options">
        <label class="ownership-extend-check">
          <input
            type="checkbox"
            bind:checked={ownershipIncludeComplete}
            disabled={exportingOwnership}
          />
          {$t('deckDetail.keepComplete')}
        </label>
        <select
          class="ownership-format-select"
          bind:value={ownershipExportFormat}
          disabled={exportingOwnership}
        >
          <option value="txt">{$t('deckDetail.txtOption')}</option>
          <option value="csv">{$t('deckDetail.csvOption')}</option>
        </select>
      </div>
    {/if}
    <button
      class="button button-ghost"
      disabled={exportingOwnership || generatingPurchaseList}
      onclick={() => (showOwnershipModal = false)}
    >
      {$t('common.close')}
    </button>
        <button
      class="button button-primary"
      disabled={!deck || loadingOwnership || generatingPurchaseList}
      onclick={generatePurchaseList}
    >
      <ShoppingCart size={15} />
      {generatingPurchaseList ? $t('purchase.generating') : ''}
    </button>
    {#if ownershipZones.length > 0}
      <button
        class="button button-primary"
        disabled={exportingOwnership || generatingPurchaseList || ownershipExportRows.length === 0}
        onclick={exportOwnership}
      >
        {exportingOwnership ? $t('deckDetail.exporting') : $t('common.export')}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  .deck-builder-container {
    max-width: 1280px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  .deck-info-bar {
    background: var(--surface);
    padding: 16px 24px;
    border-radius: var(--radius-lg);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    margin-bottom: 24px;
    border: 1px solid var(--border-color);
  }

  .deck-description {
    color: var(--text-secondary);
    margin: 0 0 12px 0;
    font-size: var(--text-base);
    line-height: 1.5;
  }

  .deck-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }

  .deck-tag-chip {
    display: inline-block;
    padding: 2px 10px;
    font-size: var(--text-sm);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 40%, transparent);
    color: var(--text-primary);
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

  .analysis-dashboard {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 20px;
    margin-bottom: 32px;
  }

  .analysis-card {
    background: var(--surface);
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

  /* ===== 指示物建议 ===== */
  .token-card {
    grid-column: 1 / -1;
  }

  .token-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
    margin: 0 0 14px 0;
    line-height: 1.5;
  }

  .token-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    gap: 14px;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .token-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .token-item:hover {
    border-color: var(--accent-color);
  }

  .token-item-img {
    width: 100%;
    aspect-ratio: 0.71;
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  :global(.token-item-img > img) {
    width: 100%;
  }

  .token-item-name {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    text-align: center;
    line-height: 1.3;
  }

  .token-item-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .token-empty {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    margin: 0;
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
    /* max-height: 250px; */
    overflow-y: auto;
    padding: 2px;
    column-gap: 2%;
    grid-template-columns: 1fr 1fr 1fr 1fr;
    justify-items: center;
  }

  .sim-card-face {
    position: relative;
    /* width: 78px; */
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
  /* .stat-list {
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
  } */

  .builder-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 24px;
  }

  .card-zone {
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    margin-bottom: 24px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
  }

  .card-zone:has(> .landscape-grid) {
    grid-column: 4 / -1;
    width: 100%;
    padding: unset;
    margin: unset;
    border: unset;
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

  .hero-card-slot {
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    display: grid;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    align-items: center;
    gap: 20px;
    justify-items: center;
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
    width: 100%;
    max-width: 160px;
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
    bottom: 0;
    right: 0;
    z-index: 2;
    min-width: 36px;
    height: 28px;
    padding: 8px 4px 8px 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-lg);
    font-weight: 700;
    color: #ffffff;
    background: var(--accent-color);
    border-top-left-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
    gap: 16px;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .landscape-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    /* max-width: 640px; */
    margin: 0 auto;
  }

  .card-item {
    position: relative;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
    background: var(--surface);
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

  /* .card-details {
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
  } */

  .version-sidebar {
    background: var(--surface);
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

  .version-note-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .version-note {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    line-height: 1.4;
    flex: 1;
    min-width: 0;
    overflow-wrap: break-word;
  }

  .note-edit-btn {
    flex: none;
    color: var(--text-tertiary);
    opacity: 0.6;
  }

  .note-edit-btn:hover {
    color: var(--accent-color);
    opacity: 1;
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
    flex-wrap: wrap;
    gap: 8px;
  }

  .version-diff-initial,
  .version-diff-empty {
    font-size: var(--text-xs);
    font-style: italic;
    color: var(--text-tertiary);
    margin-top: 8px;
  }

  .diff-item {
    flex: none;
  }

  .diff-image-wrap {
    position: relative;
    flex: none;
  }

  .diff-qty-badge {
    position: absolute;
    right: 0;
    bottom: 0;
    z-index: 2;
    min-width: 20px;
    height: 18px;
    padding: 0 5px 0 7px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    font-weight: 700;
    color: #ffffff;
    background: var(--accent-color);
    border-top-left-radius: 9999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.25);
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

  .diff-add .diff-qty-badge {
    background: #16a34a;
  }

  .diff-remove .diff-qty-badge {
    background: #dc2626;
  }

  .empty-hint {
    color: var(--text-tertiary);
    font-style: italic;
    font-size: var(--text-sm);
    padding: 12px 0;
  }

  @media (max-width: 1100px) {
    .hero-card-slot {
      grid-template-columns: 1fr 1fr 1fr;
    }

    .card-zone:has(> .landscape-grid) {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 900px) {
    .sim-card,
    .curve-card {
      grid-column: span 1;
    }

    .hero-card-slot {
      grid-template-columns: 1fr 1fr 1fr;
    }

    .card-zone:has(> .landscape-grid) {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 479.99px) {
    .deck-builder-container {
      padding: 16px;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }
    .deck-info-bar {
      order: 1;
      margin-bottom: 0;
    }
    .analysis-dashboard {
      display: contents;
    }
    .match-section {
      order: 2;
    }
    .curve-card {
      order: 5;
      margin-bottom: 0;
    }
    .token-card {
      order: 6;
      margin-bottom: 0;
    }
    .sim-card {
      order: 7;
    }
    .hero-strip {
      order: 3;
      margin-bottom: 0;
    }
    .builder-layout {
      display: contents;
    }
    .card-list-section {
      order: 4;
    }
    .version-sidebar {
      order: 8;
    }
    .landscape-grid {
      grid-template-columns: 1fr 1fr 1fr;
    }
    .hero-card-slot {
      grid-template-columns: 1fr 1fr;
    }
    .rune-list {
      grid-column: 1 / -1;
      flex-direction: row;
      justify-content: space-evenly;
      width: 100%;
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
      grid-template-columns: repeat(auto-fill, minmax(90px, 1fr));
    }
  }

  /* ===== 分享 / 导出格式弹窗 ===== */
  .share-format-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .share-format-error {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--text-sm);
    color: #e03e3e;
    background: color-mix(in srgb, #e03e3e 10%, transparent);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    line-height: 1.5;
    word-break: break-all;
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
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
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

  .share-format-cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 10px;
  }

  .share-format-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 10px;
    text-align: center;
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

  .share-format-card:hover {
    border-color: var(--accent-color);
  }

  .share-format-card.selected {
    border-color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
    box-shadow: 0 0 0 2px color-mix(in oklab, var(--accent-color) 20%, transparent);
  }

  .share-format-card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    background: color-mix(in oklab, var(--accent-color) 12%, transparent);
    color: var(--accent-color);
  }

  .share-format-card-label {
    font-size: var(--text-sm);
    font-weight: 600;
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
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
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
  .image-sort-desc {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin-bottom: 10px;
  }

  .image-sort-section :global(.trigger) {
    margin-left: 0;
  }

  /* ===== 文本预览 ===== */
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

  .text-preview-section {
    margin-top: 16px;
    padding-top: 16px;
    border-top: 1px solid var(--border-color);
  }

  .text-preview-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .text-lang-switch {
    display: inline-flex;
    gap: 4px;
    margin-bottom: 8px;
    padding: 3px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
  }

  .text-lang-btn {
    padding: 4px 14px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    background: transparent;
    border: none;
    border-radius: calc(var(--radius-md) - 2px);
    cursor: pointer;
    transition:
      background 0.15s,
      color 0.15s;
  }

  .text-lang-btn:hover {
    color: var(--text-primary);
  }

  .text-lang-btn.selected {
    background: var(--accent-color);
    color: var(--bg-primary);
  }

  .text-preview-box {
    margin: 0;
    margin-top: 4px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    padding: 10px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: var(--text-xs);
    line-height: 1.5;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }

  /* ===== 卡组图案预览 ===== */
  .image-preview-box {
    position: relative;
    margin-top: 4px;
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
  }

  .image-preview-img {
    display: block;
    width: 100%;
    height: auto;
  }

  .image-preview-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    background: rgba(255, 255, 255, 0.6);
    backdrop-filter: blur(2px);
  }

  /* ===== 二维码预览 ===== */
  .qr-section {
    display: flex;
    flex-direction: column;
    gap: 10px;
    margin-top: 14px;
  }

  .qr-preview-box {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .qr-preview-img {
    width: 240px;
    height: 240px;
    image-rendering: pixelated;
  }

  .qr-hint {
    font-size: var(--text-xs);
    color: var(--text-secondary);
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

  .bg-swatch-auto {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--text-xs);
    font-weight: 700;
    color: var(--text-secondary);
    background: linear-gradient(135deg, #f9fafb 50%, #111827 50%);
  }

  .bg-swatch-auto:hover {
    color: var(--text-primary);
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

  /* ===== 编辑卡组信息 ===== */
  .edit-info-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .edit-info-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .edit-info-required {
    color: #ef4444;
  }

  .edit-info-input,
  .edit-info-textarea,
  .edit-info-select {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border-color, #d1d5db);
    border-radius: 7px;
    background: var(--bg-primary);
    color: var(--text-primary);
    font: inherit;
    font-size: 14px;
    outline: none;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .edit-info-input {
    height: 40px;
    padding: 0 11px;
  }

  .edit-info-textarea {
    min-height: 90px;
    padding: 10px 11px;
    resize: vertical;
    line-height: 1.5;
  }

  .edit-info-select {
    height: 40px;
    padding: 0 11px;
  }

  .edit-info-input::placeholder,
  .edit-info-textarea::placeholder {
    color: var(--text-secondary);
    opacity: 0.65;
  }

  .edit-info-input:focus,
  .edit-info-textarea:focus,
  .edit-info-select:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 15%, transparent);
  }

  .edit-info-input:disabled,
  .edit-info-textarea:disabled,
  .edit-info-select:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .edit-info-favorite {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    font-weight: 500;
    color: var(--text-primary);
    cursor: pointer;
  }

  .edit-info-favorite input[type='checkbox'] {
    width: 16px;
    height: 16px;
    accent-color: var(--accent-color);
  }

  .edit-info-favorite span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .edit-info-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 6px;
  }

  .edit-info-tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    font-size: 13px;
    border-radius: var(--radius-sm, 6px);
    background: color-mix(in srgb, var(--accent-color) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 40%, transparent);
    color: var(--text-primary);
  }

  .edit-info-tag-remove {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-secondary);
    font-size: 14px;
    line-height: 1;
    cursor: pointer;
  }

  .edit-info-tag-remove:hover {
    background: rgba(0, 0, 0, 0.12);
    color: var(--text-primary);
  }

  .edit-info-tag-input-wrap {
    display: flex;
    gap: 8px;
  }

  .match-section {
    grid-column: 1 / -1;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 20px 24px;
  }

  .match-legend-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    font-size: 13px;
  }

  :global(.match-legend-thumb) {
    width: 28px;
    height: 38px;
    object-fit: cover;
    border-radius: 4px;
    flex-shrink: 0;
  }

  .match-legend-label {
    color: var(--text-secondary);
  }

  .match-legend-name {
    font-weight: 600;
  }

  .match-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
  }

  .match-section-title {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .match-section-title h2 {
    font-size: 17px;
    font-weight: 700;
    margin: 0;
    color: var(--text-primary);
  }

  .match-section-title :global(svg) {
    color: var(--accent-color, #4f46e5);
  }

  .match-winrate-badge {
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 600;
    border-radius: 999px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 12%, transparent);
  }

  .match-section-actions {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .match-summary {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
    margin: 16px 0;
    padding: 14px 18px;
    background: var(--bg-hover);
    border-radius: 10px;
  }

  .summary-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .summary-value {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .summary-value.summary-win {
    color: #16a34a;
  }

  .summary-value.summary-loss {
    color: #dc2626;
  }

  .summary-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .match-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .match-item {
    border: 1px solid var(--border-color);
    border-radius: 10px;
    overflow: hidden;
    background: var(--bg-primary);
  }

  .match-item-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .match-item-header:hover {
    background: var(--bg-hover);
  }

  .match-item-date {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .match-item-opponent {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .match-group-badge,
  .match-bestof-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .match-group-badge {
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 14%, transparent);
  }

  .match-bestof-badge {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .match-version-badge {
    font-size: var(--text-sm);
    padding: 2px 5px;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color, #4f46e5) 25%, transparent);
  }

  .game-turn-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
  }

  .game-turn-badge.first {
    color: #fff;
    background: #2563eb;
  }

  .game-turn-badge.second {
    color: #fff;
    background: #ea580c;
  }

  .match-item-result {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .match-item-header :global(svg) {
    flex-shrink: 0;
    color: var(--text-secondary);
  }

  .match-item-chevron {
    display: flex;
    flex-shrink: 0;
    color: var(--text-secondary);
    transition: transform 0.2s;
  }

  .match-item-chevron.rotate {
    transform: rotate(90deg);
  }

  .match-item-detail {
    padding: 12px 14px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-primary);
  }

  .match-note {
    margin: 0 0 10px;
    font-size: 13px;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .game-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .game-item {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
  }

  .game-number-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: var(--text-primary);
    background: var(--bg-hover);
    white-space: nowrap;
  }

  .game-score {
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .game-result {
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 700;
    border-radius: 999px;
    white-space: nowrap;
  }

  .game-result.win {
    color: #fff;
    background: #16a34a;
  }

  .game-result.loss {
    color: #fff;
    background: #dc2626;
  }

  .game-result.draw {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .game-special-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    color: #92400e;
    background: color-mix(in srgb, #f59e0b 18%, transparent);
    white-space: nowrap;
  }

  .game-special-badge.special {
    color: #7c3aed;
    background: color-mix(in srgb, #a855f7 18%, transparent);
  }

  .game-reason {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .game-log {
    font-size: 12px;
    color: var(--text-secondary);
    line-height: 1.6;
    padding: 4px 0 2px 42px;
    white-space: pre-wrap;
  }

  .match-item-actions {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 10px;
  }

  .match-empty {
    padding: 24px;
    text-align: center;
    color: var(--text-secondary);
    font-size: 14px;
    background: var(--bg-hover);
    border-radius: 10px;
    margin-top: 16px;
  }

  .ownership-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .ownership-mode-toggle {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    align-self: flex-start;
    padding: 2px;
    border-radius: 8px;
    background: var(--bg-hover);
  }

  .ownership-mode-toggle button {
    border: none;
    background: transparent;
    color: var(--text-secondary);
    padding: 4px 12px;
    border-radius: 6px;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .ownership-mode-toggle button.active {
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .ownership-loading,
  .ownership-empty {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-secondary);
    margin: 0;
  }

  .ownership-hint {
    margin: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
  }

  .ownership-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  .ownership-table th,
  .ownership-table td {
    padding: 6px 10px;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
  }

  .ownership-table th {
    color: var(--text-secondary);
    font-weight: 500;
  }

  .cell-zone {
    white-space: nowrap;
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  .cell-name {
    min-width: 120px;
  }

  .cell-no {
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .cell-owned {
    font-weight: 600;
  }

  .cell-owned.insufficient {
    color: #ef4444;
  }

  .cell-needed {
    font-weight: 600;
  }

  .ownership-footer-options {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    flex: 1;
    min-width: 0;
  }

  .ownership-extend-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--text-xs);
    color: var(--text-secondary);
    cursor: pointer;
    user-select: none;
  }

  .ownership-format-select {
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }
</style>
