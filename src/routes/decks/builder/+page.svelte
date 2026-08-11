<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import { onMount, tick } from 'svelte'
  import {
    ArrowUpDownIcon,
    ChartColumn,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    CircleAlert,
    EllipsisVerticalIcon,
    GripHorizontal,
    GripVertical,
    LoaderCircle,
    Minus,
    Plus,
    Save,
    TriangleAlert,
    X,
  } from '@lucide/svelte'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { printCacheName } from '$lib/db/helper'
  import CostCurveChart from '$lib/components/cards/CostCurveChart.svelte'
  import { COLOR_ORDER, COLOR_VARS, computeColorTotals } from '$lib/cards/utils/cost-curve-utils'
  import { validateDeck, checkZoneCapacity } from '$lib/decks/deck-validator'
  import { convertDeckCardInput, compressDeckCards, flattenDeckCards } from '$lib/decks/deck-input'
  import { groupCards } from '$lib/decks/group-cards'
  import { isMobile } from '$lib/utils/os'
  import {
    createDeck,
    deleteDeck,
    saveDeckAsNewVersion,
    updateDeck,
    updateDeckLatestVersion,
    updateDeckLatestVersionNote,
    type DeckInput,
  } from '$lib/db'
  import { loadDeckForEdit } from '$lib/decks/deck-loader'
  import { consumePendingDeckImport } from '$lib/stores/deck-import.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import {
    ZONE_CONFIG,
    DEFAULT_FORMAT,
    getZoneConfig,
    resolveFormat,
    type ZoneKey,
  } from '$lib/decks/zone'
  import { DECK_FORMATS, FORMAT_LABEL_KEYS } from '$lib/decks/format'
  import type { cardAndPrint } from '$lib/decks/types'
  import { get } from 'svelte/store'
  import {
    revertLayout,
    settingsStoreReady,
    builderShowAllZones,
    builderZoneDisplayModes,
    builderGraphicColumns,
    builderMainDeckDisplayMode,
    builderSideboardDisplayMode,
  } from '$lib/stores/settings'
  import { t } from '$lib/i18n'

  let legendCards = $state<cardAndPrint[]>([])
  let championCards = $state<cardAndPrint[]>([])
  let mainDeckCards = $state<cardAndPrint[]>([])
  let battlefieldCards = $state<cardAndPrint[]>([])
  let runeCards = $state<cardAndPrint[]>([])
  let sideboardCards = $state<cardAndPrint[]>([])

  let deckName = $state(get(t)('builder.unnamedDeck'))
  let selectedZone = $state<ZoneKey>('mainDeck')
  let deckFormat = $state(DEFAULT_FORMAT)

  let showSaveModal = $state(false)
  let saveDeckName = $state(get(t)('builder.unnamedDeck'))
  let saveDeckDescription = $state('')
  let saveDeckNote = $state('')
  let editingDeckId = $state<string | null>(null)
  let showMoreMenu = $state(false)
  let showDeckStats = $state(false)

  type DisplayMode = 'grouped' | 'single'
  let mainDeckDisplayMode = $state<DisplayMode>('grouped')
  let sideboardDisplayMode = $state<DisplayMode>('grouped')

  let singleColumnCount = $state(4)
  type CardDisplayMode = 'text' | 'graphic'
  let cardDisplayMode = $state<CardDisplayMode>('text')

  let zoneDisplayModes = $state<Record<ZoneKey, CardDisplayMode>>({
    legend: 'text',
    champion: 'text',
    mainDeck: 'text',
    battlefields: 'text',
    runes: 'text',
    sideboard: 'text',
  })

  let globalDisplayMode = $state<CardDisplayMode>('text')
  let showDisplayModeAdvanced = $state(false)

  let showAllZoneMode = $state(true)
  let prefsHydrated = $state(false)

  $effect(() => {
    if (!prefsHydrated) return
    builderShowAllZones.set(showAllZoneMode)
    builderZoneDisplayModes.set({ ...zoneDisplayModes })
    builderGraphicColumns.set(singleColumnCount)
    builderMainDeckDisplayMode.set(mainDeckDisplayMode)
    builderSideboardDisplayMode.set(sideboardDisplayMode)
  })

  let printModalPrintIndex = $state(0)
  let printModalTarget = $state<{
    card: cardAndPrint
    zone: ZoneKey
    grouped: boolean
  } | null>(null)
  let showCurrentCardDetails = $state(false)

  let isDirty = $state(false)
  let isSaving = $state(false)
  let confirmBack = $state(false)

  let isMobile1 = $state(false)
  let rightPanelWidth = $state(50)
  let rightPanelHeight = $state(50)

  let isResizing = $state(false)

  let startX = 0
  let startY = 0
  let startSize = 0

  let containerWidth = 0
  let containerHeight = 0

  let layoutElement: HTMLDivElement
  let animationFrame: number | null = null
  let pendingEvent: PointerEvent | null = null

  const allDeckCards = $derived(
    flattenDeckCards({
      legendCards,
      championCards,
      mainDeckCards,
      battlefieldCards,
      runeCards,
      sideboardCards,
    })
  )

  let deckIssues = $derived(
    validateDeck(
      {
        legendCards,
        championCards,
        mainDeckCards,
        battlefieldCards,
        runeCards,
        sideboardCards,
      },
      deckFormat
    )
  )

  let isTouchDevice = $state(false)
  let useVerticalResize = $state(false)
  function translateIssue(issue: import('$lib/decks/deck-validator').DeckIssue): string {
    const params: Record<string, string | number> = {}
    for (const [key, value] of Object.entries(issue.params)) {
      params[key] = key === 'zone' ? get(t)(String(value)) : value
    }
    return get(t)(issue.messageKey, { values: params })
  }

  let hasErrors = $derived(deckIssues.some((issue) => issue.severity === 'error'))
  let showErrorModal = $state(false)
  let showOwnershipModal = $state(false)
  let ownershipRows = $state<import('$lib/db').OwnershipCheckRow[]>([])
  let loadingOwnership = $state(false)
  let ownershipMatchMode = $state<import('$lib/db').OwnershipMatchMode>('print')

  async function runOwnershipCheck() {
    if (allDeckCards.length === 0) {
      message(get(t)('builder.emptyOwnershipCheck'))
      return
    }
    loadingOwnership = true
    showOwnershipModal = true
    try {
      const { checkDeckOwnership } = await import('$lib/db')
      const items = allDeckCards.map((c) => ({
        cardPrintId: c.selectedPrints ?? c.card_prints?.[0]?.id ?? '',
        quantity: 1,
      }))
      ownershipRows = await checkDeckOwnership(items, { matchMode: ownershipMatchMode })
    } finally {
      loadingOwnership = false
    }
  }

  function switchOwnershipMode(mode: import('$lib/db').OwnershipMatchMode) {
    if (mode === ownershipMatchMode || loadingOwnership) return
    ownershipMatchMode = mode
    runOwnershipCheck()
  }

  beforeNavigate(async (navigation) => {
    if (!navigation.to) {
      navigation.cancel()
      return
    }

    if (confirmBack) {
      return
    }

    if (isDirty) {
      navigation.cancel()
      const confirmed = await ask(get(t)('builder.unsavedChanges'), {
        kind: 'warning',
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('builder.keepEditing'),
      })
      if (confirmed) {
        confirmBack = confirmed
        window.history.back()
      }
    }
  })

  onMount(() => {
    async function updateLayoutMode() {
      isTouchDevice = await isMobile()
      isMobile1 = window.innerWidth < 479.99

      useVerticalResize = isMobile1 || isTouchDevice
    }

    updateLayoutMode()

    window.addEventListener('resize', updateLayoutMode)

    const queryDeckId = page.url.searchParams.get('deckId')
    if (queryDeckId) {
      loadDeck(queryDeckId)
    }

    const pending = consumePendingDeckImport()
    if (pending) {
      applyImportedDeck(pending)
    }

    settingsStoreReady.then(() => {
      showAllZoneMode = get(builderShowAllZones)
      zoneDisplayModes = { ...get(builderZoneDisplayModes) }
      singleColumnCount = get(builderGraphicColumns)
      mainDeckDisplayMode = get(builderMainDeckDisplayMode)
      sideboardDisplayMode = get(builderSideboardDisplayMode)
      updateGlobalDisplayMode()
      prefsHydrated = true
    })

    return () => {
      window.removeEventListener('resize', updateLayoutMode)
    }
  })

  async function loadDeck(deckId: string) {
    try {
      const loaded = await loadDeckForEdit(deckId)
      if (!loaded) {
        message(get(t)('builder.deckNotFound'))
        goto('/decks')
        return
      }

      editingDeckId = deckId
      deckName = loaded.deck.name || get(t)('builder.unnamedDeck')
      saveDeckName = loaded.deck.name || get(t)('builder.unnamedDeck')
      saveDeckDescription = loaded.deck.description || ''
      deckFormat = resolveFormat(loaded.deck.format)
      legendCards = loaded.legendCards
      championCards = loaded.championCards
      mainDeckCards = loaded.mainDeckCards
      battlefieldCards = loaded.battlefieldCards
      runeCards = loaded.runeCards
      sideboardCards = loaded.sideboardCards
      isDirty = false
    } catch (error) {
      console.error('加载卡组失败:', error)
      message(get(t)('builder.loadFailed'))
    }
  }

  function applyImportedDeck(result: import('$lib/decks/deck-import').DecodedDeckResult) {
    editingDeckId = null
    deckName = get(t)('builder.importedDeck')
    saveDeckName = get(t)('builder.importedDeck')
    saveDeckDescription = ''
    deckFormat = DEFAULT_FORMAT
    legendCards = result.deck.legendCards
    championCards = result.deck.championCards
    mainDeckCards = result.deck.mainDeckCards
    battlefieldCards = result.deck.battlefieldCards
    runeCards = result.deck.runeCards
    sideboardCards = result.deck.sideboardCards
    isDirty = true
  }

  async function handleAddCard(card: cardAndPrint) {
    if (card.is_banned) {
      message(get(t)('builder.bannedCard'))
      return
    }

    // Promo / 自定义打印不可入卡组
    if (card.card_prints?.every((p) => p.is_promo || p.is_custom)) {
      message(get(t)('builder.promoNotAllowed'))
      return
    }

    const capacityError = checkZoneCapacity(
      selectedZone,
      getZoneCards(selectedZone).length,
      deckFormat
    )
    const isReplacable = ['legend', 'champion'].includes(selectedZone)
    if (capacityError && !isReplacable) {
      message(
        get(t)(capacityError.messageKey, {
          values: { zone: get(t)(capacityError.params.zone), max: capacityError.params.max },
        })
      )
      return
    }

    const defaultPrint =
      card.card_prints?.find((p) => p.is_default) ??
      card.card_prints?.find((p) => p.card_no_extend === card.card_no && p.language === 'SC') ??
      card.card_prints?.[0]

    const newCard: cardAndPrint = {
      ...card,
      card_prints: card.card_prints ?? [],
      selectedPrints: defaultPrint?.id,
    }

    const zoneElementDiv = document.getElementById(`${selectedZone.toLowerCase()}-zone`)
    const dataId = `${newCard.id}-${newCard.selectedPrints || 'default'}`
    switch (selectedZone) {
      case 'legend':
        legendCards = [newCard]
        selectedZone = 'champion'
        break

      case 'champion':
        championCards = [newCard]
        selectedZone = 'mainDeck'
        break

      case 'mainDeck':
        mainDeckCards = [...mainDeckCards, newCard]
        break

      case 'battlefields':
        battlefieldCards = [...battlefieldCards, newCard]
        break

      case 'runes':
        runeCards = [...runeCards, newCard]
        break

      case 'sideboard':
        sideboardCards = [...sideboardCards, newCard]
        break
    }
    await tick()
    if (zoneElementDiv) {
      const cardElements = zoneElementDiv.querySelectorAll(`[data-id="${dataId}"]`)
      const lastIndexCard = cardElements[cardElements.length - 1]

      if (lastIndexCard) {
        lastIndexCard.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    isDirty = true
  }

  function handleRemoveOneCard(cardId: string, zone: ZoneKey) {
    let targetArray: cardAndPrint[]
    switch (zone) {
      case 'legend':
        targetArray = legendCards
        break
      case 'champion':
        targetArray = championCards
        break
      case 'mainDeck':
        targetArray = mainDeckCards
        break
      case 'battlefields':
        targetArray = battlefieldCards
        break
      case 'runes':
        targetArray = runeCards
        break
      case 'sideboard':
        targetArray = sideboardCards
        break
      default:
        return
    }

    const index = targetArray.findIndex((c) => c.id === cardId)
    if (index !== -1) {
      switch (zone) {
        case 'legend':
          legendCards = legendCards.toSpliced(index, 1)
          break
        case 'champion':
          championCards = championCards.toSpliced(index, 1)
          break
        case 'mainDeck':
          mainDeckCards = mainDeckCards.toSpliced(index, 1)
          break
        case 'battlefields':
          battlefieldCards = battlefieldCards.toSpliced(index, 1)
          break
        case 'runes':
          runeCards = runeCards.toSpliced(index, 1)
          break
        case 'sideboard':
          sideboardCards = sideboardCards.toSpliced(index, 1)
          break
      }
      isDirty = true
    }
  }

  function getZoneCards(zone: ZoneKey): cardAndPrint[] {
    switch (zone) {
      case 'legend':
        return legendCards
      case 'champion':
        return championCards
      case 'mainDeck':
        return mainDeckCards
      case 'battlefields':
        return battlefieldCards
      case 'runes':
        return runeCards
      case 'sideboard':
        return sideboardCards
    }
  }

  function setZoneCards(zone: ZoneKey, cards: cardAndPrint[]) {
    switch (zone) {
      case 'legend':
        legendCards = cards
        break
      case 'champion':
        championCards = cards
        break
      case 'mainDeck':
        mainDeckCards = cards
        break
      case 'battlefields':
        battlefieldCards = cards
        break
      case 'runes':
        runeCards = cards
        break
      case 'sideboard':
        sideboardCards = cards
        break
    }
  }

  function addCardQuantity(card: cardAndPrint, zone: ZoneKey) {
    const cards = getZoneCards(zone)

    if (cards.length >= getZoneConfig(deckFormat, zone).maxCount) {
      message(
        get(t)('builder.zoneCapacity', {
          values: {
            zoneName: ZONE_CONFIG[zone].name,
            maxCount: getZoneConfig(deckFormat, zone).maxCount,
          },
        })
      )
      return
    }

    const newCard: cardAndPrint = {
      ...card,
      card_prints: card.card_prints ?? [],
      selectedPrints: card.selectedPrints,
    }

    setZoneCards(zone, [...cards, newCard])
    isDirty = true
  }

  function removeCardQuantity(card: cardAndPrint, zone: ZoneKey, grouped: boolean) {
    const cards = getZoneCards(zone)

    let index = -1

    if (grouped) {
      index = cards.findIndex((c) => c.id === card.id && c.selectedPrints === card.selectedPrints)
    } else {
      index = cards.findIndex((c) => c === card)
    }

    if (index === -1) return

    setZoneCards(zone, cards.toSpliced(index, 1))
    isDirty = true
  }

  async function handleSave() {
    if (hasErrors) {
      message(get(t)('builder.constructionIssues'))
      return
    }

    if (deckIssues.filter((i) => i.severity === 'warning').length) {
      const ignoreWarning = await ask(
        get(t)('builder.continueSavePrompt', {
          values: {
            issues: deckIssues
              .filter((i) => i.severity === 'warning')
              .map((i) => translateIssue(i))
              .join('\n'),
          },
        }),
        {
          okLabel: get(t)('builder.saveAnyway'),
          cancelLabel: get(t)('builder.keepEditing'),
        }
      )

      if (!ignoreWarning) return
    }

    saveDeckName = deckName === get(t)('builder.unnamedDeck') ? '' : deckName
    saveDeckDescription = ''
    saveDeckNote = ''
    showSaveModal = true
  }

  async function confirmSaveDeck(mode: 'overwrite' | 'newVersion' = 'newVersion') {
    const name = saveDeckName.trim()

    if (!name) {
      message(get(t)('builder.enterName'))
      return
    }

    isSaving = true

    const deckInfo: DeckInput = {
      name,
      description: saveDeckDescription.trim() || null,
      format: deckFormat,
    }

    const convertedCards = convertDeckCardInput(allDeckCards)
    const compressCards = compressDeckCards(convertedCards)

    let deckID: string | null = null

    try {
      if (editingDeckId) {
        await updateDeck(editingDeckId, {
          name,
        })

        if (mode === 'overwrite') {
          await updateDeckLatestVersion(editingDeckId, compressCards)

          const note = saveDeckNote.trim()
          if (note) {
            await updateDeckLatestVersionNote(editingDeckId, note)
          }
        } else {
          await saveDeckAsNewVersion(editingDeckId, compressCards, saveDeckNote.trim() || undefined)
        }

        deckName = name
        isDirty = false
        showSaveModal = false

        goto(`/decks/${editingDeckId}`)
      } else {
        deckID = await createDeck(deckInfo)

        if (deckID) {
          await saveDeckAsNewVersion(deckID, compressCards)
        }

        deckName = name
        isDirty = false
        showSaveModal = false

        goto('/decks')
      }
    } catch (error) {
      if (!editingDeckId && deckID) {
        try {
          await deleteDeck(deckID)
        } catch (deleteError) {
          console.error('清理保存失败的卡组失败:', deleteError)
        }
      }

      console.error('保存失败:', error)
      message(get(t)('builder.saveFailed'))
    } finally {
      isSaving = false
    }
  }

  function cancelSaveDeck() {
    if (isSaving) return

    showSaveModal = false
  }

  function handlePointerDown(e: PointerEvent) {
    if (!layoutElement) return
    if (useVerticalResize && get(revertLayout) && rightPanelHeight === 100) {
      rightPanelHeight = 50
      return
    }
    e.preventDefault()

    const target = e.currentTarget as HTMLElement

    target.setPointerCapture?.(e.pointerId)

    containerWidth = layoutElement.clientWidth
    containerHeight = layoutElement.clientHeight

    isResizing = true

    if (useVerticalResize) {
      startY = e.clientY
      startSize = rightPanelHeight
    } else {
      startX = e.clientX
      startSize = rightPanelWidth
    }

    window.addEventListener('pointermove', handlePointerMove, {
      passive: false,
    })

    window.addEventListener('pointerup', handlePointerUp, {
      once: true,
    })

    document.body.style.userSelect = 'none'
    document.body.style.touchAction = 'none'

    document.documentElement.style.cursor = useVerticalResize ? 'row-resize' : 'col-resize'
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isResizing) return

    e.preventDefault()

    pendingEvent = e

    if (animationFrame !== null) return

    animationFrame = requestAnimationFrame(() => {
      animationFrame = null

      if (!pendingEvent || !isResizing) return

      const event = pendingEvent

      pendingEvent = null

      if (useVerticalResize) {
        const deltaY = event.clientY - startY
        let deltaPercent: number
        if (get(revertLayout)) {
          deltaPercent = (deltaY / containerHeight) * 100
        } else {
          deltaPercent = (-deltaY / containerHeight) * 100
        }

        let newHeight = startSize + deltaPercent

        const MIN_HEIGHT = 5
        const MAX_HEIGHT = 95
        newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight))

        const SNAP_THRESHOLD_BOTTOM = 10
        const SNAP_THRESHOLD_TOP = 85

        if (newHeight <= SNAP_THRESHOLD_BOTTOM) {
          newHeight = 0
        } else if (newHeight >= SNAP_THRESHOLD_TOP) {
          newHeight = 100
        }

        rightPanelHeight = newHeight
      } else {
        const deltaX = startX - event.clientX

        const deltaPercent = (deltaX / containerWidth) * 100

        rightPanelWidth = Math.max(20, Math.min(80, startSize + deltaPercent))
      }
    })
  }

  function handlePointerUp() {
    if (!isResizing) return

    isResizing = false

    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)

      animationFrame = null
    }

    pendingEvent = null

    window.removeEventListener('pointermove', handlePointerMove)

    document.body.style.userSelect = ''

    document.body.style.touchAction = ''

    document.documentElement.style.cursor = ''
  }

  function openPrintModal(card: cardAndPrint, zone: ZoneKey, grouped: boolean) {
    if (!card.card_prints?.length) return
    const filteredCard = {
      ...card,
      card_prints: card.card_prints
        .filter((p) => p.language === 'SC')
        .sort((a, b) => {
          const nameA = a.card_no_extend.toUpperCase()
          const nameB = b.card_no_extend.toUpperCase()
          if (nameA < nameB) {
            return -1
          }
          if (nameA > nameB) {
            return 1
          }

          return 0
        }),
    }

    if (!filteredCard.card_prints?.length) return

    const index = Math.max(
      0,
      filteredCard.card_prints.findIndex((print) => print.id === card.selectedPrints)
    )

    printModalPrintIndex = index

    printModalTarget = {
      card: filteredCard,
      zone,
      grouped,
    }
  }

  function closePrintModal() {
    printModalTarget = null
  }

  function getPrintQuantity(zone: ZoneKey, cardId: string, printId: string): number {
    return getZoneCards(zone).filter(
      (card) => card.id === cardId && card.selectedPrints === printId
    ).length
  }

  function changePrintQuantity(delta: number) {
    const target = printModalTarget

    if (!target) return

    const currentPrint = target.card.card_prints[printModalPrintIndex]

    if (!currentPrint) return

    const currentQuantity = getPrintQuantity(target.zone, target.card.id, currentPrint.id)

    if (delta > 0) {
      addCardQuantity(
        {
          ...target.card,
          selectedPrints: currentPrint.id,
        },
        target.zone
      )

      return
    }

    if (currentQuantity <= 0) return

    removeCardQuantity(
      {
        ...target.card,
        selectedPrints: currentPrint.id,
      },
      target.zone,
      true
    )
  }

  function changePrintsId(id: string) {
    const target = printModalTarget
    if (!target || !id) return

    const currentPrint = target.card.card_prints[printModalPrintIndex]
    if (!currentPrint) return

    let card = getZoneCards(target.zone).filter(
      (card) => card.id === target.card.id && card.selectedPrints === target.card.selectedPrints
    )

    card.forEach((c) => {
      c.selectedPrints = currentPrint.id
    })

    target.card.selectedPrints = id
  }

  function arrangeDecks() {
    for (const zone of Object.keys(ZONE_CONFIG)) {
      const zoneCards = getZoneCards(zone as ZoneKey)
      if (zoneCards.length <= 1) continue

      zoneCards.sort((a, b) => {
        const aName = (a.card_name_en || '') + (a.sub_title_en || '')
        const bName = (b.card_name_en || '') + (b.sub_title_en || '')
        if (aName !== bName) return aName.localeCompare(bName)

        const aCardName = a.selectedPrints || ''
        const bCardName = b.selectedPrints || ''
        if (aCardName !== bCardName) return aCardName.localeCompare(bCardName)
        return 0
      })
    }
  }

  const filteredCardsIssues = $derived.by(() => {
    const ErrorCards = new Set<string>()
    deckIssues.forEach((issue) => {
      if (issue.cardNames && issue.cardNames.length > 0) {
        issue.cardNames.forEach((name) => {
          if (name) ErrorCards.add(name)
        })
      }
    })
    return ErrorCards
  })

  function checkErrorCard(rawName: string) {
    return filteredCardsIssues.has(rawName)
  }

  function cardItemRemove(card: cardAndPrint, zone: ZoneKey, grouped: boolean): any {
    if (isTouchDevice) return
    removeCardQuantity(card, zone, grouped)
  }

  function updateGlobalDisplayMode() {
    const modes = Object.values(zoneDisplayModes)
    const allSame = modes.every((m) => m === modes[0])
    if (allSame) {
      globalDisplayMode = modes[0]
    } else {
      globalDisplayMode = 'text'
    }
  }

  const zoneDisplayConfig: { key: ZoneKey; labelKey: string }[] = [
    { key: 'legend', labelKey: 'builder.legend' },
    { key: 'champion', labelKey: 'builder.champion' },
    { key: 'mainDeck', labelKey: 'builder.mainDeck' },
    { key: 'battlefields', labelKey: 'builder.battlefields' },
    { key: 'runes', labelKey: 'builder.runes' },
    { key: 'sideboard', labelKey: 'builder.sideboard' },
  ]

  const mainDeckStatCards = $derived(mainDeckCards.map((card) => ({ ...card, quantity: 1 })))

  const typeTotals = $derived.by(() => {
    const totals: Record<string, number> = {}
    mainDeckCards.forEach((card) => {
      card.card_category?.forEach((cat) => {
        totals[cat] = (totals[cat] || 0) + 1
      })
    })
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  })

  const colorTotals = $derived.by(() => {
    const totals = computeColorTotals(mainDeckStatCards)
    return COLOR_ORDER.map((color) => ({ color, count: totals[color] || 0 })).filter(
      (item) => item.count > 0
    )
  })

  const maxColorCount = $derived(Math.max(...colorTotals.map((item) => item.count), 1))

  const regionTotals = $derived.by(() => {
    const totals: Record<string, number> = {}
    mainDeckCards.forEach((card) => {
      card.region?.forEach((region) => {
        totals[region] = (totals[region] || 0) + 1
      })
    })
    return Object.entries(totals).sort((a, b) => b[1] - a[1])
  })
</script>

{#snippet cardItem(group: { card: cardAndPrint; count: number }, zone: ZoneKey, grouped: boolean)}
  {@const rawName = `${group.card.card_name_cn}${group.card.sub_title_cn ? ' - ' + group.card.sub_title_cn : ''}`}
  {@const hasErrorCard = checkErrorCard(rawName)}
  {@const selectedPrint = group.card.card_prints.find((p) => p.id === group.card.selectedPrints)}
  <div
    data-id={`${group.card.id}-${selectedPrint?.id || 'default'}`}
    role="presentation"
    class="card-item"
    onclick={() => openPrintModal(group.card, zone, grouped)}
    oncontextmenu={(e) => {
      e.stopPropagation
      cardItemRemove(group.card, zone, grouped)
    }}
  >
    <div class="card-image">
      <CardSimpleImage
        url={selectedPrint?.img_cdn}
        name={printCacheName(selectedPrint)}
        isLandscape={group.card.card_category?.findIndex((cat) => cat === '战场') !== -1}
      />
    </div>

    {#if zoneDisplayModes[zone] === 'text'}
      <div class="card-info">
        <div class="card-name">{rawName}</div>
        <div class="card-id">{group.card.card_no}</div>
      </div>
    {/if}

    {#if grouped}
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="card-quantity-control"
        class:hasErrorCard
        class:graphic-mode={zoneDisplayModes[zone] === 'graphic'}
        onclick={(e) => e.stopPropagation()}
      >
        <span class="card-count">{group.count}</span>
      </div>
    {/if}
  </div>
{/snippet}

<div
  bind:this={layoutElement}
  class="deck-builder-layout"
  class:revert-layout={$revertLayout && useVerticalResize}
>
  <main class="card-pool-panel">
    <CardPool
      onCardClick={handleAddCard}
      onMenuClick={handleRemoveOneCard}
      deckCards={allDeckCards}
      showDeckCount={true}
      bind:zone={selectedZone}
    />
  </main>

  <button
    class="grip-button"
    class:resizing={isResizing}
    aria-label={$t('builder.resizePanel')}
    onpointerdown={handlePointerDown}
  >
    {#if isMobile1}
      {#if $revertLayout && rightPanelHeight === 100}
        <ChevronUpIcon size={24} />
      {:else}
        <GripHorizontal size={24} />
      {/if}
    {:else}
      <GripVertical size={16} />
    {/if}
  </button>

  <aside
    class="deck-panel"
    style:width={!isMobile1 ? `${rightPanelWidth}%` : undefined}
    style:height={isMobile1 ? `${rightPanelHeight}%` : undefined}
  >
    <div class="deck-header">
      <button
        class="button button-text"
        style="margin-right: auto; color: var(--secondary-accent-color);"
        onclick={() => window.history.back()}
      >
        {$t('common.cancel')}
      </button>

      {#if hasErrors}
        <div
          class="button-icon button-danger"
          role="presentation"
          onclick={() => (showErrorModal = !showErrorModal)}
          style="width: 36px; height: 36px;"
        >
          <CircleAlert size={25} color={'#dc2626'} />
        </div>
      {/if}

      <div class="stats-trigger-wrap">
        <button
          class="button-icon"
          class:active={showDeckStats}
          onclick={() => (showDeckStats = !showDeckStats)}
          title={$t('builder.deckStats')}
        >
          <ChartColumn size={16} />
        </button>
      </div>

      <button
        class="button {hasErrors ? 'button-danger' : 'button-primary'}"
        onclick={handleSave}
        disabled={isSaving || !isDirty || hasErrors}
      >
        {#if isSaving}
          <LoaderCircle class="animate-spin" size={16} />
        {:else}
          <Save size={16} />
        {/if}
        <!-- <span>{$t('common.save')}</span> -->
      </button>

      <button
        class="button-icon"
        onclick={() => (showMoreMenu = !showMoreMenu)}
        title={$t('common.moreActions')}
      >
        <EllipsisVerticalIcon size={16} />
      </button>
    </div>

    <div class="zones-container">
      {#if showAllZoneMode || (!showAllZoneMode && (selectedZone === 'legend' || selectedZone === 'champion'))}
        <div class="zone-section" id="legend-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'legend')}
              >{$t('builder.legend')}</span
            >
            <div class="display-mode-switch">
              <button
                class:active={zoneDisplayModes.legend === 'text'}
                onclick={() => {
                  zoneDisplayModes.legend = 'text'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.textMode')}
              </button>

              <button
                class:active={zoneDisplayModes.legend === 'graphic'}
                onclick={() => {
                  zoneDisplayModes.legend = 'graphic'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
          </div>
          <div class="zone-list" class:graphic-mode={zoneDisplayModes.legend === 'graphic'}>
            {#each groupCards(legendCards) as group}
              {@render cardItem(group, 'legend', true)}
            {:else}
              <div class="empty-zone">{$t('builder.emptyZone')}</div>
            {/each}
          </div>
        </div>

        <div class="zone-section" id="champion-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'champion')}
              >{$t('builder.champion')}</span
            >
            <div class="display-mode-switch">
              <button
                class:active={zoneDisplayModes.champion === 'text'}
                onclick={() => {
                  zoneDisplayModes.champion = 'text'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.textMode')}
              </button>

              <button
                class:active={zoneDisplayModes.champion === 'graphic'}
                onclick={() => {
                  zoneDisplayModes.champion = 'graphic'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
          </div>
          <div class="zone-list" class:graphic-mode={zoneDisplayModes.champion === 'graphic'}>
            {#each groupCards(championCards) as group}
              {@render cardItem(group, 'champion', true)}
            {:else}
              <div class="empty-zone">{$t('builder.emptyZone')}</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'mainDeck')}
        <div class="zone-section full-space" id="maindeck-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'mainDeck')}>
              {$t('builder.zoneCount', {
                values: {
                  name: $t('builder.mainDeck'),
                  count: mainDeckCards.length,
                  max: getZoneConfig(deckFormat, 'mainDeck').maxCount,
                },
              })}
            </span>

            <div style="display: flex;column-gap: 5px; ">
              <div class="display-mode-switch">
                <button
                  class:active={mainDeckDisplayMode === 'grouped'}
                  onclick={() => (mainDeckDisplayMode = 'grouped')}
                >
                  {$t('builder.grouped')}
                </button>

                <button
                  class:active={mainDeckDisplayMode === 'single'}
                  onclick={() => (mainDeckDisplayMode = 'single')}
                >
                  {$t('builder.single')}
                </button>
              </div>

              <div class="display-mode-switch">
                <button
                  class:active={zoneDisplayModes.mainDeck === 'text'}
                  onclick={() => {
                    zoneDisplayModes.mainDeck = 'text'
                    updateGlobalDisplayMode()
                  }}
                >
                  {$t('builder.textMode')}
                </button>

                <button
                  class:active={zoneDisplayModes.mainDeck === 'graphic'}
                  onclick={() => {
                    zoneDisplayModes.mainDeck = 'graphic'
                    updateGlobalDisplayMode()
                  }}
                >
                  {$t('builder.graphicMode')}
                </button>
              </div>
            </div>
          </div>
          <div
            class="zone-list multi-item"
            class:graphic-mode={zoneDisplayModes.mainDeck === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#if mainDeckDisplayMode === 'grouped'}
              {#each groupCards(mainDeckCards) as group}
                {@render cardItem(group, 'mainDeck', true)}
              {:else}
                <div class="empty-zone">{$t('builder.emptyZone')}</div>
              {/each}
            {:else}
              {#each mainDeckCards as card}
                {@render cardItem({ card, count: 1 }, 'mainDeck', false)}
              {:else}
                <div class="empty-zone">{$t('builder.emptyZone')}</div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'battlefields')}
        <div class="zone-section full-space" id="battlefields-zone">
          <div class="zone-header">
            <span
              class="zone-name"
              role="presentation"
              onclick={() => (selectedZone = 'battlefields')}
            >
              {$t('builder.zoneCount', {
                values: {
                  name: $t('builder.battlefields'),
                  count: battlefieldCards.length,
                  max: getZoneConfig(deckFormat, 'battlefields').maxCount,
                },
              })}
            </span>

            <div class="display-mode-switch">
              <button
                class:active={zoneDisplayModes.battlefields === 'text'}
                onclick={() => {
                  zoneDisplayModes.battlefields = 'text'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.textMode')}
              </button>

              <button
                class:active={zoneDisplayModes.battlefields === 'graphic'}
                onclick={() => {
                  zoneDisplayModes.battlefields = 'graphic'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
          </div>
          <div
            class="zone-list multi-item max-3"
            class:graphic-mode={zoneDisplayModes.battlefields === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#each groupCards(battlefieldCards) as group}
              {@render cardItem(group, 'battlefields', true)}
            {:else}
              <div class="empty-zone">{$t('builder.emptyZone')}</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'runes')}
        <div class="zone-section full-space" id="runes-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'runes')}
              >{$t('builder.zoneCount', {
                values: {
                  name: $t('builder.runes'),
                  count: runeCards.length,
                  max: getZoneConfig(deckFormat, 'runes').maxCount,
                },
              })}</span
            >

            <div class="display-mode-switch">
              <button
                class:active={zoneDisplayModes.runes === 'text'}
                onclick={() => {
                  zoneDisplayModes.runes = 'text'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.textMode')}
              </button>

              <button
                class:active={zoneDisplayModes.runes === 'graphic'}
                onclick={() => {
                  zoneDisplayModes.runes = 'graphic'
                  updateGlobalDisplayMode()
                }}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
          </div>
          <div
            class="zone-list multi-item"
            class:graphic-mode={zoneDisplayModes.runes === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#each groupCards(runeCards) as group}
              {@render cardItem(group, 'runes', true)}
            {:else}
              <div class="empty-zone">{$t('builder.emptyZone')}</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'sideboard')}
        <div class="zone-section full-space" id="sideboard-zone">
          <div class="zone-header">
            <span
              class="zone-name"
              role="presentation"
              onclick={() => (selectedZone = 'sideboard')}
            >
              {$t('builder.zoneCount', {
                values: {
                  name: $t('builder.sideboard'),
                  count: sideboardCards.length,
                  max: getZoneConfig(deckFormat, 'sideboard').maxCount,
                },
              })}
            </span>

            <div style="display: flex;column-gap: 5px; ">
              <div class="display-mode-switch">
                <button
                  class:active={sideboardDisplayMode === 'grouped'}
                  onclick={() => (sideboardDisplayMode = 'grouped')}
                >
                  {$t('builder.grouped')}
                </button>

                <button
                  class:active={sideboardDisplayMode === 'single'}
                  onclick={() => (sideboardDisplayMode = 'single')}
                >
                  {$t('builder.single')}
                </button>
              </div>
              <div class="display-mode-switch">
                <button
                  class:active={zoneDisplayModes.sideboard === 'text'}
                  onclick={() => {
                    zoneDisplayModes.sideboard = 'text'
                    updateGlobalDisplayMode()
                  }}
                >
                  {$t('builder.textMode')}
                </button>

                <button
                  class:active={zoneDisplayModes.sideboard === 'graphic'}
                  onclick={() => {
                    zoneDisplayModes.sideboard = 'graphic'
                    updateGlobalDisplayMode()
                  }}
                >
                  {$t('builder.graphicMode')}
                </button>
              </div>
            </div>
          </div>
          <div
            class="zone-list multi-item"
            class:graphic-mode={zoneDisplayModes.sideboard === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#if sideboardDisplayMode === 'grouped'}
              {#each groupCards(sideboardCards) as group}
                {@render cardItem(group, 'sideboard', true)}
              {:else}
                <div class="empty-zone">{$t('builder.emptyZone')}</div>
              {/each}
            {:else}
              {#each sideboardCards as card}
                {@render cardItem({ card, count: 1 }, 'sideboard', false)}
              {:else}
                <div class="empty-zone">{$t('builder.emptyZone')}</div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}
    </div>
  </aside>

  {#if printModalTarget}
    {@const prints = printModalTarget.card.card_prints}
    {@const currentPrint = prints[printModalPrintIndex]}

    <CommonModal
      open
      title={`${printModalTarget!.card.card_name_cn!} ${printModalTarget!.card.sub_title_cn || ''}`.trim()}
      subtitle={currentPrint.card_no_extend}
      onclose={closePrintModal}
      footerCentered={true}
    >
      <div class="print-slider">
        <button
          class="slider-arrow"
          disabled={printModalPrintIndex === 0}
          onclick={() => {
            printModalPrintIndex = Math.max(0, printModalPrintIndex - 1)
            showCurrentCardDetails = false
          }}
        >
          <ChevronLeftIcon size={16}></ChevronLeftIcon>
        </button>

        <div class="print-slide">
          <div class="print-slide-image">
            <CardSimpleImage
              url={prints[printModalPrintIndex]?.img_cdn}
              name={printCacheName(prints[printModalPrintIndex])}
              isLandscape={printModalTarget.card.card_category?.findIndex(
                (cat) => cat === '战场'
              ) !== -1}
            />
          </div>
          <div
            class="print-slide-details"
            style:--detail-height={showCurrentCardDetails ? '50vh' : 0}
          >
            {printModalTarget.card.effect_cn}
          </div>
        </div>

        <button
          class="slider-arrow"
          disabled={printModalPrintIndex >= prints.length - 1}
          onclick={() => {
            printModalPrintIndex = Math.min(prints.length - 1, printModalPrintIndex + 1)
          }}
        >
          <ChevronRightIcon size={16}></ChevronRightIcon>
        </button>
      </div>

      {#snippet footer()}
        <div class="print-quantity-control">
          <button
            class="button button-primary button-sm"
            onclick={() => (showCurrentCardDetails = !showCurrentCardDetails)}
          >
            {showCurrentCardDetails ? $t('builder.collapse') : $t('builder.details')}
          </button>

          <button
            class="quantity-btn"
            disabled={getPrintQuantity(
              printModalTarget!.zone,
              printModalTarget!.card.id,
              currentPrint?.id ?? ''
            ) <= 0}
            onclick={() => changePrintQuantity(-1)}
          >
            <Minus size={18} />
          </button>

          <span class="print-quantity">
            {getPrintQuantity(
              printModalTarget!.zone,
              printModalTarget!.card.id,
              currentPrint?.id ?? ''
            )}
          </span>

          <button class="quantity-btn" onclick={() => changePrintQuantity(1)}>
            <Plus size={18} />
          </button>

          <button
            class="button button-primary button-sm"
            disabled={printModalTarget?.card.selectedPrints === currentPrint.id}
            onclick={() => changePrintsId(currentPrint.id)}
          >
            {$t('builder.switchPrint')}
          </button>
        </div>
      {/snippet}
    </CommonModal>
  {/if}

  <CommonModal
    open={showSaveModal}
    title={$t('builder.saveDeckTitle')}
    subtitle={editingDeckId ? $t('builder.saveSubtitleEdit') : $t('builder.saveSubtitleNew')}
    closable={!isSaving}
    onclose={cancelSaveDeck}
  >
    <label class="save-modal-field">
      <span class="save-modal-label">
        {$t('builder.deckNameLabel')} <span class="required">*</span>
      </span>
      <input
        class="save-modal-input"
        type="text"
        placeholder={$t('builder.deckNamePlaceholder')}
        maxlength="100"
        bind:value={saveDeckName}
        disabled={isSaving}
        onkeydown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            confirmSaveDeck()
          }
        }}
      />
    </label>

    {#if editingDeckId}
      <label class="save-modal-field">
        <span class="save-modal-label">{$t('common.note')}</span>
        <textarea
          class="save-modal-textarea"
          placeholder={$t('builder.notePlaceholder')}
          maxlength="300"
          rows="5"
          bind:value={saveDeckNote}
          disabled={isSaving}></textarea>
      </label>
    {:else}
      <label class="save-modal-field">
        <span class="save-modal-label">{$t('builder.description')}</span>
        <textarea
          class="save-modal-textarea"
          placeholder={$t('builder.descriptionPlaceholder')}
          maxlength="500"
          rows="5"
          bind:value={saveDeckDescription}
          disabled={isSaving}></textarea>
      </label>
    {/if}

    {#snippet footer()}
      <button class="button button-ghost footer-btn" disabled={isSaving} onclick={cancelSaveDeck}>
        {$t('common.cancel')}
      </button>
      {#if editingDeckId}
        <button
          class="button button-ghost footer-btn"
          disabled={isSaving || !saveDeckName.trim()}
          onclick={() => confirmSaveDeck('overwrite')}
        >
          {#if isSaving}
            <LoaderCircle class="animate-spin" size={16} />
            <span>{$t('common.saving')}</span>
          {:else}
            <Save size={16} />
            <span>{$t('builder.overwriteDeck')}</span>
          {/if}
        </button>
        <button
          class="button button-primary footer-btn"
          disabled={isSaving || !saveDeckName.trim()}
          onclick={() => confirmSaveDeck('newVersion')}
        >
          {#if isSaving}
            <LoaderCircle class="animate-spin" size={16} />
            <span>{$t('common.saving')}</span>
          {:else}
            <Save size={16} />
            <span>{$t('builder.saveNewVersion')}</span>
          {/if}
        </button>
      {:else}
        <button
          class="button button-primary footer-btn"
          disabled={isSaving || !saveDeckName.trim()}
          onclick={() => confirmSaveDeck('newVersion')}
        >
          {#if isSaving}
            <LoaderCircle class="animate-spin" size={16} />
            <span>{$t('common.saving')}</span>
          {:else}
            <Save size={16} />
            <span>{$t('builder.saveDeck')}</span>
          {/if}
        </button>
      {/if}
    {/snippet}
  </CommonModal>

  <CommonModal
    closeOnOverlay={true}
    onclose={() => (showErrorModal = !showErrorModal)}
    open={showErrorModal}
    title={$t('builder.validationFailed', { values: { count: deckIssues.length } })}
  >
    <div class="issues-panel">
      <ul class="issues-list">
        {#each deckIssues as issue}
          <li class="issue-item" class:error={issue.severity === 'error'}>
            <span class="issue-icon">
              {#if issue.severity === 'error'}
                <X size={12} />
              {:else}<TriangleAlert size={12} />
              {/if}
            </span>
            <span class="issue-text">{@html translateIssue(issue)}</span>
          </li>
        {/each}
      </ul>
    </div>

    {#snippet footer()}
      <button class="button button-primary" onclick={() => (showErrorModal = !showErrorModal)}>
        <span>{$t('builder.gotIt')}</span>
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    closeOnOverlay={true}
    onclose={() => (showOwnershipModal = !showOwnershipModal)}
    open={showOwnershipModal}
    title={$t('builder.ownershipCheck')}
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
      {:else if ownershipRows.length === 0}
        <p class="ownership-empty">{$t('builder.allOwned')}</p>
      {:else}
        <p class="ownership-hint">{$t('builder.insufficientOwned')}</p>
        <table class="ownership-table">
          <thead>
            <tr>
              <th>{$t('builder.cardCol')}</th>
              <th>{$t('builder.noCol')}</th>
              <th>{$t('builder.ownedCol')}</th>
              <th>{$t('builder.neededCol')}</th>
            </tr>
          </thead>
          <tbody>
            {#each ownershipRows as row (row.cardNo + '##' + row.cardNoExtend)}
              <tr>
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
      <button class="button button-primary" onclick={() => (showOwnershipModal = false)}>
        <span>{$t('common.close')}</span>
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    open={showDeckStats}
    onclose={() => (showDeckStats = false)}
    title={$t('builder.deckStats')}
    subtitle={$t('builder.deckStatsSubtitle')}
    width="min(560px, 100%)"
  >
    <div class="deck-stats-content">
      <div class="stats-section-title">{$t('builder.totalCards')}</div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.legend')}</span>
        <span class="stat-value">{legendCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.champion')}</span>
        <span class="stat-value">{championCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.mainDeck')}</span>
        <span class="stat-value">{mainDeckCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.battlefields')}</span>
        <span class="stat-value">{battlefieldCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.runes')}</span>
        <span class="stat-value">{runeCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">{$t('builder.sideboard')}</span>
        <span class="stat-value">{sideboardCards.length}</span>
      </div>

      <div class="stat-divider"></div>
      <div class="stats-section-title">{$t('builder.costColor')}</div>
      <CostCurveChart cards={mainDeckStatCards} />

      <div class="stat-divider"></div>
      <div class="stats-section-title">{$t('builder.colorDist')}</div>
      {#if colorTotals.length === 0}
        <div class="stats-empty">{$t('builder.mainDeckEmpty')}</div>
      {:else}
        {#each colorTotals as item (item.color)}
          <div class="color-bar-row">
            <span class="color-bar-label">
              {item.color === 'neutral'
                ? $t('cards.colorColorless')
                : $t('cards.color' + item.color.charAt(0).toUpperCase() + item.color.slice(1))}
            </span>
            <div class="color-bar-track">
              <div
                class="color-bar-fill"
                style="width: {(item.count / maxColorCount) * 100}%; background: {COLOR_VARS[
                  item.color
                ]}"
              ></div>
            </div>
            <span class="color-bar-value">{item.count}</span>
          </div>
        {/each}
      {/if}

      <div class="stat-divider"></div>
      <div class="stats-section-title">{$t('builder.typeStats')}</div>
      {#if typeTotals.length === 0}
        <div class="stats-empty">{$t('builder.mainDeckEmpty')}</div>
      {:else}
        {#each typeTotals as [cat, count]}
          <div class="stat-row">
            <span class="stat-label">{cat}</span>
            <span class="stat-value">{count}</span>
          </div>
        {/each}
      {/if}

      <div class="stat-divider"></div>
      <div class="stats-section-title">{$t('builder.regionDist')}</div>
      {#if regionTotals.length === 0}
        <div class="stats-empty">{$t('builder.mainDeckEmpty')}</div>
      {:else}
        {#each regionTotals as [region, count]}
          <div class="stat-row">
            <span class="stat-label">{region}</span>
            <span class="stat-value">{count}</span>
          </div>
        {/each}
      {/if}

      <div class="stat-divider"></div>
      <div class="stat-row stat-total">
        <span class="stat-label">{$t('builder.total')}</span>
        <span class="stat-value">{allDeckCards.length}</span>
      </div>
    </div>
  </CommonModal>

  <CommonModal
    open={showMoreMenu}
    onclose={() => {
      showMoreMenu = false
      showDisplayModeAdvanced = false
    }}
    title={$t('common.moreActions')}
    subtitle={$t('builder.moreMenuSubtitle')}
    closable={true}
  >
    <div class="more-menu-content">
      <div style="justify-content: right;display: flex;gap: 10px;">
        {#if useVerticalResize}
          <button
            class="button button-md button-secondary"
            onclick={() => {
              $revertLayout = !$revertLayout
              showMoreMenu = false
            }}
          >
            <ArrowUpDownIcon size={18} />
            <span>{$revertLayout ? $t('builder.restoreLayout') : $t('builder.toggleLayout')}</span>
          </button>
        {/if}

        <button
          class="button button-md button-secondary"
          onclick={() => {
            arrangeDecks()
            showMoreMenu = false
          }}
        >
          <span>{$t('builder.arrangeDeck')}</span>
        </button>
        <button
          class="button button-md button-secondary"
          onclick={() => {
            showMoreMenu = false
            runOwnershipCheck()
          }}
        >
          <span>{$t('builder.ownershipCheck')}</span>
        </button>
      </div>

      <div class="more-menu-item more-menu-toggle">
        <span class="toggle-label">
          <span>{$t('builder.format')}</span>
        </span>
        <select
          class="format-select"
          bind:value={deckFormat}
          aria-label={$t('builder.format')}
          title={$t('builder.format')}
        >
          {#each DECK_FORMATS as format (format)}
            <option value={format}>
              {FORMAT_LABEL_KEYS[format] ? $t(FORMAT_LABEL_KEYS[format]) : format}
            </option>
          {/each}
        </select>
      </div>

      <div class="more-menu-item more-menu-toggle">
        <span class="toggle-label">
          <span
            >{showAllZoneMode ? $t('builder.showAllZones') : $t('builder.showSelectedZones')}</span
          >
        </span>
        <div class="toggle-button-group">
          <button
            class="toggle-btn {showAllZoneMode ? 'active' : ''}"
            onclick={() => {
              showAllZoneMode = !showAllZoneMode
            }}
          >
            {$t('builder.allZones')}
          </button>
          <button
            class="toggle-btn {!showAllZoneMode ? 'active' : ''}"
            onclick={() => {
              showAllZoneMode = !showAllZoneMode
            }}
          >
            {$t('builder.selectedZones')}
          </button>
        </div>
      </div>

      <div>
        <div
          role="presentation"
          aria-label={$t('builder.displayModeAria')}
          class="more-menu-item more-menu-expandable more-menu-toggle"
        >
          <span class="toggle-label">
            <span>{$t('builder.displayMode')}</span>
          </span>
          <div class="expand-control">
            <div class="toggle-button-group">
              <button
                class="toggle-btn {globalDisplayMode === 'text' ? 'active' : ''}"
                onclick={() => {
                  globalDisplayMode = 'text'
                  cardDisplayMode = 'text'
                  Object.keys(zoneDisplayModes).forEach((key) => {
                    zoneDisplayModes[key as ZoneKey] = 'text'
                  })
                }}
              >
                {$t('builder.textMode')}
              </button>
              <button
                class="toggle-btn {globalDisplayMode === 'graphic' ? 'active' : ''}"
                onclick={() => {
                  globalDisplayMode = 'graphic'
                  cardDisplayMode = 'graphic'
                  Object.keys(zoneDisplayModes).forEach((key) => {
                    zoneDisplayModes[key as ZoneKey] = 'graphic'
                  })
                }}
              >
                {$t('builder.graphicMode')}
              </button>
            </div>
            <ChevronRightIcon
              onclick={() => {
                showDisplayModeAdvanced = !showDisplayModeAdvanced
              }}
              size={16}
              class="expand-icon {showDisplayModeAdvanced ? 'expanded' : ''}"
            />
          </div>
        </div>

        {#if showDisplayModeAdvanced}
          <div class="display-mode-advanced">
            {#each zoneDisplayConfig as zoneCfg}
              <div class="display-mode-zone-row">
                <span class="zone-label">
                  {$t(zoneCfg.labelKey)}
                </span>
                <div class="toggle-button-group">
                  <button
                    class="toggle-btn {zoneDisplayModes[zoneCfg.key] === 'text' ? 'active' : ''}"
                    onclick={() => {
                      zoneDisplayModes[zoneCfg.key] = 'text'
                      updateGlobalDisplayMode()
                    }}
                  >
                    {$t('builder.textMode')}
                  </button>
                  <button
                    class="toggle-btn {zoneDisplayModes[zoneCfg.key] === 'graphic' ? 'active' : ''}"
                    onclick={() => {
                      zoneDisplayModes[zoneCfg.key] = 'graphic'
                      updateGlobalDisplayMode()
                    }}
                  >
                    {$t('builder.graphicMode')}
                  </button>
                </div>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="more-menu-item more-menu-input">
        <span class="toggle-label">
          <span>{$t('builder.graphicColumns')}</span>
        </span>
        <input
          type="number"
          min="2"
          value={singleColumnCount}
          oninput={(e) => {
            const target = e.target as HTMLInputElement
            singleColumnCount = parseInt(target.value || '4')
          }}
          class="number-input"
          style="width: 60px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); text-align: center;"
        />
      </div>
    </div>

    {#snippet footer()}
      <button
        class="button button-primary"
        onclick={() => {
          showMoreMenu = false
          showDisplayModeAdvanced = false
        }}
      >
        <span>{$t('common.close')}</span>
      </button>
    {/snippet}
  </CommonModal>
</div>

<style>
  .issues-list {
    list-style: none;
    margin: 0;
    padding: 8px 1rem;
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-height: 150px;
    overflow-y: auto;
  }

  .issue-item {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--text-base);
    color: #7f1d1d;
    line-height: 1.4;
  }

  .issue-icon {
    flex-shrink: 0;
    margin-top: 1px;
    font-weight: bold;
  }

  .issue-item.error .issue-icon {
    color: #dc2626;
  }

  .deck-builder-layout {
    margin: 0 auto;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  .deck-panel {
    border-right: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    flex-shrink: 0;
    container-type: inline-size;
  }

  .deck-header {
    padding: 1rem 2%;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  .stats-trigger-wrap {
    position: relative;
  }

  .button-icon.active {
    background: var(--bg-active, #e5e7eb);
    color: var(--accent-color);
  }

  .zones-container {
    overflow-y: auto;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
  }

  @container (max-width: 310.99px) {
    .zones-container {
      grid-template-columns: 1fr;
    }
    .zone-list.max-3:not(.graphic-mode) .card-image {
      transform: translateY(-50%);
    }
  }

  .zones-container > .zone-section.full-space {
    grid-column: 1 / -1;
  }

  .zone-section {
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    scroll-snap-align: start;
  }

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 1rem;
    background: var(--bg-secondary, #f9fafb);
    font-weight: 600;
    font-size: 13px;
    position: sticky;
    top: 0;
    z-index: 6;
  }

  .zone-name {
    color: var(--text-primary);
    cursor: pointer;
  }

  .zone-list {
    display: grid;
    gap: 8px;
    padding: 12px;
    margin: 0;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  .zone-list:not(.multi-item) {
    padding: 12px;
    margin: 0;
    grid-template-columns: unset;
  }

  .zone-list:has(> .empty-zone) {
    display: block;
  }

  .card-item {
    position: relative;
    height: 64px;
    width: 100%;
    overflow: hidden;
    border-radius: 10px;
    cursor: pointer;
    background: #0f172a;
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }

  .card-item:hover {
    box-shadow: 0 5px 20px rgba(0, 0, 0, 0.15);
  }

  .card-item:active {
    transform: translateY(0);
  }

  .card-image {
    position: absolute;
    inset: 0;
    z-index: 1;
  }

  .zone-list.max-3:not(.graphic-mode) .card-image {
    scale: 1.25;
  }

  :global(.card-image img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 15px 16%;
    transform: scale(1.05);
    opacity: 1;
  }

  .card-info {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 80%;
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-left: 16px;
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.95) 0%,
      rgba(15, 23, 42, 0.85) 40%,
      rgba(15, 23, 42, 0.4) 55%,
      transparent 100%
    );
  }

  .card-name {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .card-id {
    font-size: 11px;
    color: #cbd5e1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }

  .empty-zone {
    width: 100%;
    color: var(--text-secondary);
    text-align: center;
    padding: 24px 1rem;
    font-size: 13px;
    font-style: italic;
    background: var(--bg-primary);
    border-radius: 6px;
  }

  .card-pool-panel {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
    background-color: var(--bg-primary);
  }

  :global(.card-pool-panel > .card-pool-wrapper) {
    padding: 12px 2%;
  }

  .grip-button {
    border: none;
    border-inline: 1px solid var(--border-color, #e5e7eb);
    cursor: col-resize;
    padding: 1px;
    background: var(--bg-primary);
    color: var(--text-primary);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition:
      background-color 0.2s,
      color 0.2s;
    position: relative;
    z-index: 20;
    touch-action: none;
    user-select: none;
  }

  .grip-button:hover {
    color: var(--text-secondary);
    background-color: var(--bg-hover);
  }

  .grip-button.resizing {
    background-color: var(--bg-active, #e5e7eb);
    color: var(--text-primary);
  }

  .card-quantity-control {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 2px;
    height: 32px;
    padding: 2px;
    background: rgba(15, 23, 42, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 7px;
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(4px);
  }

  .card-quantity-control.graphic-mode {
    font-weight: bold;
    bottom: 0;
    top: unset;
    transform: unset;
    right: 0;
    height: 20px;
    padding: 2%;
    background-color: var(--accent-color);
    border-bottom-right-radius: 5%;
    border-bottom-left-radius: 0;
    border-top-right-radius: 0;
  }

  .card-quantity-control.hasErrorCard {
    background: #dc2626;
  }

  .quantity-btn {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 5px;
    color: white;
    background: transparent;
    cursor: pointer;
    transition:
      background-color 0.15s,
      transform 0.15s;
  }

  .quantity-btn:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .quantity-btn:active {
    transform: scale(0.9);
  }

  .card-count {
    min-width: 24px;
    padding: 0 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-size: var(--text-base);
    font-weight: 700;
    line-height: 1;
  }

  .card-quantity-control.graphic-mode .card-count {
    font-size: var(--text-base);
  }

  .display-mode-switch {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 5px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color, #e5e7eb);
  }

  .display-mode-switch button {
    border: none;
    border-radius: 4px;
    padding: 3px 7px;
    background: transparent;
    color: var(--text-secondary);
    font-size: 11px;
    cursor: pointer;
  }

  .display-mode-switch button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .display-mode-switch button.active {
    background: var(--accent-color);
    color: var(--bg-primary);
  }

  .zone-list.multi-item.graphic-mode {
    --single-column-count: 4;
    grid-template-columns: repeat(var(--single-column-count), 1fr);
  }

  :global(.zone-list.multi-item.graphic-mode.max-3) {
    grid-template-columns: repeat(3, 1fr);
  }

  .zone-list.graphic-mode .card-item {
    min-width: 0;
    height: 100%;
    width: 100%;
    aspect-ratio: 744 / 1040;
  }

  .zone-list.graphic-mode:not(.multi-item) .card-item {
    min-width: 0;
    height: 100%;
    max-height: 200px;
    width: auto;
    aspect-ratio: 744 / 1040;
  }

  .zone-list.graphic-mode.max-3 .card-item {
    height: min-content;
    aspect-ratio: 1040/744;
  }

  :global(.zone-list.graphic-mode .card-item img) {
    object-position: initial;
    image-rendering: optimizeQuality;
    transform: none;
  }

  @media (min-width: 1023.99px) {
    .deck-panel {
      min-width: 300px;
    }
  }

  @media (min-width: 479.99px) {
    @container (max-width: 320px) {
      .zone-section .display-mode-switch {
        display: none;
      }
    }
  }

  @media (max-width: 479.99px) {
    ::-webkit-scrollbar {
      display: none;
    }

    .card-item {
      border-radius: 5%;
    }

    .deck-builder-layout {
      padding-block-start: env(safe-area-inset-top);
      flex-direction: column;
    }

    .deck-builder-layout.revert-layout {
      flex-direction: column-reverse;
    }

    .deck-panel {
      width: 100% !important;
      min-height: 65px;
      min-width: none;
      max-height: calc(100% - 26px);
      flex-direction: column-reverse;
      justify-content: space-between;
    }

    .deck-builder-layout.revert-layout > .deck-panel {
      flex-direction: column;
      justify-content: unset;
    }

    .grip-button {
      cursor: row-resize;
      filter: drop-shadow(0 -10px 10px rgba(0, 0, 0, 0.1));
    }

    .grip-button:hover {
      color: var(--text-secondary);
      background-color: var(--bg-hover);
      cursor: row-resize;
      filter: drop-shadow(0 -10px 10px rgba(0, 0, 0, 0.1));
    }

    .zone-list.multi-item {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }
  }

  .print-slider {
    display: flex;
    align-items: center;
    gap: 20px;
    width: 100%;
    position: relative;
  }

  .slider-arrow {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: 300;
    cursor: pointer;
    transition: all 0.2s;
    flex-shrink: 0;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .slider-arrow:hover:not(:disabled) {
    background: var(--bg-hover);
    border-color: var(--text-secondary);
  }

  .slider-arrow:disabled {
    opacity: 0.3;
    cursor: not-allowed;
    box-shadow: none;
  }

  .print-slide {
    flex: 1;
    display: flex;
    gap: 24px;
    align-items: center;
    min-width: 0;
    justify-content: center;
    flex-direction: column;
  }

  .print-slide-image {
    flex: 0 0 100%;
    width: 70%;
    max-width: 260px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  :global(.print-slide-image img) {
    width: 100%;
    max-height: 360px;
    object-fit: cover;
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    transition: transform 0.3s ease;
    image-rendering: optimizeQuality;
  }

  .print-slide-details {
    --detail-height: 0;
    max-height: var(--detail-height);
    transition: max-height 0.3s ease;
    overflow: hidden;
    text-align: start;
  }

  .print-quantity-control {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 24px;
    background: var(--bg-primary);
  }

  .print-quantity-control .quantity-btn {
    width: 44px;
    height: 44px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: all 0.15s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .print-quantity-control .quantity-btn:hover {
    background: var(--bg-hover);
    border-color: var(--accent-color);
    color: var(--accent-color);
    transform: translateY(-2px);
    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.08);
  }

  .print-quantity-control .quantity-btn:active {
    transform: translateY(0);
  }

  .print-quantity {
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
    min-width: 48px;
    text-align: center;
    font-variant-numeric: tabular-nums;
  }

  @media (max-width: 640px) {
    .print-slider {
      flex-direction: column;
      gap: 16px;
    }

    .print-slide {
      flex-direction: column;
      gap: 16px;
      width: 100%;
      text-align: center;
    }

    .print-slide-image {
      max-width: 240px;
      width: 100%;
    }

    .slider-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 36px;
      height: 36px;
      font-size: 20px;
      background: rgba(247, 247, 245, 0.95);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      z-index: 5;
    }

    .slider-arrow:first-child {
      left: 8px;
    }

    .slider-arrow:last-child {
      right: 8px;
    }

    .print-quantity-control {
      padding: 14px 16px;
      gap: 16px;
    }

    .print-quantity-control .quantity-btn {
      width: 40px;
      height: 40px;
    }

    .print-quantity {
      font-size: var(--text-xl);
    }
  }

  @media (max-width: 380px) {
    .print-slide-image {
      max-width: 200px;
    }
  }

  .save-modal-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .save-modal-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .required {
    color: #ef4444;
  }

  .save-modal-input,
  .save-modal-textarea {
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

  .save-modal-input {
    height: 40px;
    padding: 0 11px;
  }

  .save-modal-textarea {
    min-height: 110px;
    padding: 10px 11px;
    resize: vertical;
    line-height: 1.5;
  }

  .save-modal-input::placeholder,
  .save-modal-textarea::placeholder {
    color: var(--text-secondary);
    opacity: 0.65;
  }

  .save-modal-input:focus,
  .save-modal-textarea:focus {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 15%, transparent);
  }

  .save-modal-input:disabled,
  .save-modal-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .footer-btn {
    min-height: 36px;
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

  .cell-no {
    color: var(--text-secondary);
  }

  .cell-owned {
    font-weight: 600;
  }

  .cell-owned.insufficient {
    color: #ef4444;
  }

  @media (max-width: 479.99px) {
    .footer-btn {
      min-height: 42px;
      flex: 1;
    }
  }

  .more-menu-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
  }

  .more-menu-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-md);
    cursor: pointer;
    transition: background-color 0.15s ease;
    width: 100%;
  }

  .more-menu-item:hover {
    background-color: var(--bg-hover);
  }

  .more-menu-item:active {
    background-color: var(--bg-active);
  }

  .toggle-button-group {
    display: flex;
    gap: 2px;
    background-color: var(--bg-primary);
    border-radius: var(--radius-sm);
    padding: 2px;
    border: 1px solid var(--border-color);
  }

  .toggle-btn {
    padding: 4px 14px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .toggle-btn.active:hover {
    background-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .display-mode-advanced {
    padding: 4px 14px 10px 14px;
    animation: slideDown 0.25s ease;
  }

  .display-mode-zone-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }

  .zone-label {
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  .more-menu-expandable {
    cursor: pointer;
  }

  .expand-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  :global(.expand-icon) {
    transition: transform 0.3s ease;
    color: var(--text-secondary);
  }

  :global(.more-menu-expandable .expand-icon:hover) {
    background-color: var(--bg-hover);
  }

  :global(.expand-icon.expanded) {
    transform: rotate(90deg);
  }

  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-8px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .more-menu-toggle {
    justify-content: space-between !important;
    cursor: default !important;
  }

  .more-menu-toggle:hover {
    background-color: transparent !important;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: var(--text-md);
    color: var(--text-primary);
  }

  .more-menu-input {
    justify-content: space-between !important;
    cursor: default !important;
  }

  .more-menu-input:hover {
    background-color: transparent !important;
  }

  .number-input {
    width: 60px;
    padding: 4px 8px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    text-align: center;
    outline: none;
    transition: border-color 0.2s ease;
  }

  .number-input:focus {
    border-color: var(--accent-color);
  }

  .format-select {
    max-width: 160px;
    padding: 6px 8px;
    border: 1px solid var(--border-color, #d1d5db);
    border-radius: 6px;
    background: var(--bg-secondary, #fff);
    color: var(--text-color, #111827);
    font-size: 12px;
  }

  .number-input::-webkit-inner-spin-button {
    opacity: 0.5;
  }

  .deck-stats-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 0;
  }

  .stats-section-title {
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
    padding: 6px 12px 2px 12px;
  }

  .stats-empty {
    color: var(--text-tertiary);
    font-size: var(--text-sm);
    font-style: italic;
    text-align: center;
    padding: 8px 12px;
  }

  .color-bar-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 12px;
  }

  .color-bar-label {
    flex-shrink: 0;
    width: 56px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    text-align: right;
  }

  .color-bar-track {
    flex: 1;
    height: 14px;
    background: var(--bg-hover);
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .color-bar-fill {
    height: 100%;
    border-radius: var(--radius-sm);
    transition: width 0.45s cubic-bezier(0.22, 1, 0.36, 1);
    min-width: 4px;
  }

  .color-bar-value {
    flex-shrink: 0;
    width: 32px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border-radius: var(--radius-sm);
    transition: background-color 0.15s ease;
  }

  .stat-row:hover {
    background-color: var(--bg-hover);
  }

  .stat-label {
    color: var(--text-secondary);
    font-size: var(--text-md);
  }

  .stat-value {
    font-weight: 600;
    font-size: var(--text-md);
    color: var(--text-primary);
  }

  .stat-divider {
    height: 1px;
    background: var(--border-color);
    margin: 4px 0;
  }

  .stat-total {
    background-color: var(--bg-hover);
    border-radius: var(--radius-sm);
  }

  .stat-total .stat-label {
    font-weight: 600;
    color: var(--text-primary);
  }

  .stat-total .stat-value {
    font-size: var(--text-lg);
    color: var(--accent-color);
  }

  @media (max-width: 479.99px) {
    .more-menu-item {
      padding: 12px 14px;
      font-size: var(--text-base);
    }

    .stat-row {
      padding: 10px 12px;
    }

    .display-mode-zone-row {
      padding: 8px 0;
    }
  }
</style>
