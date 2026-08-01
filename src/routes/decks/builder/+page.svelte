<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import type { CardBase, CardPrint, CardWithPrint } from '$lib/db/types'
  import { beforeNavigate, goto } from '$app/navigation'
  import { onMount, tick } from 'svelte'
  import {
    ArrowDownAZIcon,
    ArrowUpDownIcon,
    ChevronLeftIcon,
    ChevronRightIcon,
    ChevronUpIcon,
    CircleAlert,
    EllipsisVerticalIcon,
    GripHorizontal,
    GripVertical,
    LoaderCircle,
    CheckIcon,
    Minus,
    Plus,
    Save,
    TriangleAlert,
    X,
  } from '@lucide/svelte'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { validateDeck } from '$lib/decks/deck-validator'
  import { isMobile } from '$lib/services/os-serives'
  import {
    createDeck,
    deleteDeck,
    saveDeckAsNewVersion,
    type DeckCardInput,
    type DeckInput,
  } from '$lib/db'
  import CommonModal from '$lib/components/CommonModal.svelte'
  import { ZONE_CONFIG, type ZoneKey } from '$lib/db/constants'

  type cardAndPrint = CardBase & { card_prints: CardPrint[] } & { selectedPrints?: string }

  // --- 卡组状态：六个区域 ---
  let legendCards = $state<cardAndPrint[]>([])
  let championCards = $state<cardAndPrint[]>([])
  let mainDeckCards = $state<cardAndPrint[]>([])
  let battlefieldCards = $state<cardAndPrint[]>([])
  let runeCards = $state<cardAndPrint[]>([])
  let sideboardCards = $state<cardAndPrint[]>([])

  let deckName = $state('未命名卡组')
  let selectedZone = $state<ZoneKey>('mainDeck')

  let showSaveModal = $state(false)
  let saveDeckName = $state('未命名卡组')
  let saveDeckDescription = $state('')
  let showMoreMenu = $state(false)
  let showDeckStats = $state(false)
  let showZoneSelector = $state(false)

  type DisplayMode = 'grouped' | 'single'
  let mainDeckDisplayMode = $state<DisplayMode>('grouped')
  let sideboardDisplayMode = $state<DisplayMode>('grouped')

  let singleColumnCount = $state(4)
  type CardDisplayMode = 'text' | 'graphic'
  let cardDisplayMode = $state<CardDisplayMode>('text')

  // 每个区域的独立显示模式
  let zoneDisplayModes = $state<Record<ZoneKey, CardDisplayMode>>({
    legend: 'text',
    champion: 'text',
    mainDeck: 'text',
    battlefields: 'text',
    runes: 'text',
    sideboard: 'text',
  })

  // 全局显示模式（用于快速切换）
  let globalDisplayMode = $state<CardDisplayMode>('text')
  let showDisplayModeMenu = $state(false)

  let showAllZoneMode = $state(true)
  let printModalPrintIndex = $state(0)
  let printModalTarget = $state<{
    card: cardAndPrint
    zone: ZoneKey
    grouped: boolean
  } | null>(null)
  let showCurrentCardDetails = $state(false)

  // --- 核心：未保存修改标记 (Dirty State) ---
  let isDirty = $state(false)
  let isSaving = $state(false)
  let confirmBack = $state(false)

  // --- 拖拽调整宽度状态 ---
  let isMobile1 = $state(false)
  let revertLayout = $state(false)
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

  function getAllDeckCards(): (cardAndPrint & { zone: string })[] {
    return [
      ...legendCards.map((card) => ({ ...card, zone: 'legend' })),
      ...championCards.map((card) => ({ ...card, zone: 'champion' })),
      ...mainDeckCards.map((card) => ({ ...card, zone: 'mainDeck' })),
      ...battlefieldCards.map((card) => ({ ...card, zone: 'battlefields' })),
      ...runeCards.map((card) => ({ ...card, zone: 'runes' })),
      ...sideboardCards.map((card) => ({ ...card, zone: 'sideboard' })),
    ]
  }

  let deckIssues = $derived(
    validateDeck({
      legendCards,
      championCards,
      mainDeckCards,
      battlefieldCards,
      runeCards,
      sideboardCards,
    })
  )

  let isTouchDevice = $state(false)
  let useVerticalResize = $state(false)
  let hasErrors = $derived(deckIssues.some((issue) => issue.severity === 'error'))
  let showErrorModal = $state(false)

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
      const confirmed = await ask('您有未保存的卡组修改，离开将丢失这些更改。确定要离开吗？', {
        kind: 'warning',
        okLabel: '确定',
        cancelLabel: '继续编辑',
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

    return () => {
      window.removeEventListener('resize', updateLayoutMode)
    }
  })

  function groupCards(cards: cardAndPrint[]) {
    const map = new Map<string, { card: cardAndPrint; count: number }>()

    for (const card of cards) {
      // Print 不同的情况下不能合并，否则切换 Print 后无法准确知道数量
      const key = `${card.id}:${card.selectedPrints ?? ''}`
      const existing = map.get(key)

      if (existing) {
        existing.count += 1
      } else {
        map.set(key, {
          card,
          count: 1,
        })
      }
    }

    return Array.from(map.values())
  }

  function checkZoneCapacity(targetZone: ZoneKey): string | null {
    const config = ZONE_CONFIG[targetZone]
    let currentCount: number

    switch (targetZone) {
      case 'legend':
        currentCount = legendCards.length
        break
      case 'champion':
        currentCount = championCards.length
        break
      case 'mainDeck':
        currentCount = mainDeckCards.length
        break
      case 'battlefields':
        currentCount = battlefieldCards.length
        break
      case 'runes':
        currentCount = runeCards.length
        break
      case 'sideboard':
        currentCount = sideboardCards.length
        break
      default:
        currentCount = 0
    }

    if (currentCount >= config.maxCount) {
      return `${config.name} 区域已达到最大容量 ${config.maxCount} 张！`
    }
    return null
  }

  function checkNameSubtitleLimit(card: cardAndPrint, targetZone: ZoneKey): string | null {
    const checkedZones: ZoneKey[] = ['champion', 'mainDeck', 'sideboard']
    if (!checkedZones.includes(targetZone)) return null
    if ((card.card_name_cn ?? '') + (card.sub_title_cn ?? '') === '小蜘蛛') return null
    const cardIdentifier = `${card.card_name_cn || ''}|${card.sub_title_cn || ''}`
    const currentTotalCount = [...championCards, ...mainDeckCards, ...sideboardCards].filter(
      (c) => `${c.card_name_cn || ''}|${c.sub_title_cn || ''}` === cardIdentifier
    ).length

    if (currentTotalCount >= 3) {
      return `根据《符文战场》规则，同名卡牌（${card.card_name_cn}${card.sub_title_cn ? ' - ' + card.sub_title_cn : ''}）在 Champion + MainDeck + Sideboard 中最多只能加入 3 张！`
    }
    return null
  }

  function checkWeiWoLimit(card: cardAndPrint): string | null {
    if (!card.keyword?.includes('唯我')) return null

    const weiWoCount = getAllDeckCards().filter((c) => c.keyword?.includes('唯我')).length
    if (weiWoCount >= 1) {
      return `根据《符文战场》规则，关键字包含"唯我"的卡牌全局只能有一张！`
    }
    return null
  }

  async function handleAddCard(card: cardAndPrint) {
    if (card.is_banned) {
      message('该卡牌为禁卡，无法加入卡组！')
      return
    }

    const capacityError = checkZoneCapacity(selectedZone)
    const isReplacable = ['legend', 'champion'].includes(selectedZone)
    // if (capacityError && !isReplacable) {
    //   message(capacityError)
    //   return
    // }

    // const nameLimitError = checkNameSubtitleLimit(card, selectedZone)
    // if (nameLimitError) {
    //   message(nameLimitError)
    //   return
    // }

    // const weiWoError = checkWeiWoLimit(card)
    // if (weiWoError) {
    //   message(weiWoError)
    //   return
    // }

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

    if (cards.length >= ZONE_CONFIG[zone].maxCount) {
      message(`${ZONE_CONFIG[zone].name} 区域已达到最大容量 ${ZONE_CONFIG[zone].maxCount} 张！`)
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
      // Single 模式只删除当前这一张实体卡
      index = cards.findIndex((c) => c === card)
    }

    if (index === -1) return

    setZoneCards(zone, cards.toSpliced(index, 1))
    isDirty = true
  }

  const convertDeckCardInput = (cards: (cardAndPrint & { zone: string })[]) => {
    const deckCardInputs: DeckCardInput[] = []
    for (const card of cards) {
      const c: DeckCardInput = {
        cardPrintId: card.selectedPrints ?? card.card_prints[0].id,
        quantity: 1,
        zone: card.zone!,
      }
      deckCardInputs.push(c)
    }

    return deckCardInputs
  }

  const compressDeckCards = (cards: DeckCardInput[]) => {
    const compressed: DeckCardInput[] = []
    for (const card of cards) {
      const existing = compressed.find(
        (c) => c.cardPrintId === card.cardPrintId && c.zone === card.zone
      )
      if (existing) {
        existing.quantity += card.quantity
      } else {
        compressed.push(card)
      }
    }
    return compressed
  }

  async function handleSave() {
    if (hasErrors) {
      message('你的构筑存在问题哦')
      return
    }

    if (deckIssues.filter((i) => i.severity === 'warning').length) {
      const ignoreWarning = await ask(
        `是否要继续保存？\n${deckIssues
          .filter((i) => i.severity === 'warning')
          .map((i) => i.message)
          .join('\n')}`,
        {
          okLabel: '确定保存',
          cancelLabel: '继续编辑',
        }
      )

      if (!ignoreWarning) return
    }

    // 校验通过后，不立即保存，先打开保存信息 Modal
    saveDeckName = deckName === '未命名卡组' ? '' : deckName
    saveDeckDescription = ''
    showSaveModal = true
  }

  async function confirmSaveDeck() {
    const name = saveDeckName.trim()

    if (!name) {
      message('请输入卡组名称')
      return
    }

    isSaving = true

    const deckInfo: DeckInput = {
      name,
      description: saveDeckDescription.trim() || null,
      format: '1v1（比赛）',
    }

    const convertedCards = convertDeckCardInput(getAllDeckCards())
    const compressCards = compressDeckCards(convertedCards)

    let deckID: string | null = null

    try {
      deckID = await createDeck(deckInfo)

      if (deckID) {
        await saveDeckAsNewVersion(deckID, compressCards)
      }

      deckName = name
      isDirty = false
      showSaveModal = false

      goto('/decks')
    } catch (error) {
      if (deckID) {
        try {
          await deleteDeck(deckID)
        } catch (deleteError) {
          console.error('清理保存失败的卡组失败:', deleteError)
        }
      }

      console.error('保存失败:', error)
      message('保存失败，请重试')
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
    if (useVerticalResize && revertLayout && rightPanelHeight === 100) {
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
        // 【关键修复】加上负号：向上拖拽(deltaY<0) -> deltaPercent>0 -> 高度增加
        if (revertLayout) {
          deltaPercent = (deltaY / containerHeight) * 100
        } else {
          deltaPercent = (-deltaY / containerHeight) * 100
        }

        let newHeight = startSize + deltaPercent

        // 1. Clamp (边界限制)：限制在 20% 到 85% 之间
        // 如果你希望允许完全收起，可以把 20 改成 0
        const MIN_HEIGHT = 5
        const MAX_HEIGHT = 95
        newHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight))

        // 2. Snap (吸附效果)
        const SNAP_THRESHOLD_BOTTOM = 10 // 拖到小于 30% 时，自动收起
        const SNAP_THRESHOLD_TOP = 85 // 拖到大于 80% 时，自动最大化

        if (newHeight <= SNAP_THRESHOLD_BOTTOM) {
          newHeight = 0 // 完全收起 (如果 MIN_HEIGHT 是 0 的话)
        } else if (newHeight >= SNAP_THRESHOLD_TOP) {
          newHeight = 100 // 完全展开 (可选)
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

  // 更新全局显示模式（检查所有区域是否一致）
  function updateGlobalDisplayMode() {
    const modes = Object.values(zoneDisplayModes)
    const allSame = modes.every((m) => m === modes[0])
    if (allSame) {
      globalDisplayMode = modes[0]
    } else {
      globalDisplayMode = 'text' // 或者保持当前，但显示为"混合"
    }
  }

  // 获取区域的显示模式
  function getZoneDisplayMode(zone: ZoneKey): CardDisplayMode {
    return zoneDisplayModes[zone] || 'text'
  }
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
        name={`${group.card.id}-${selectedPrint?.id || 'default'}`}
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
  class:revert-layout={revertLayout && useVerticalResize}
>
  <!-- 左侧：卡池 -->
  <main class="card-pool-panel">
    <CardPool
      onCardClick={handleAddCard}
      onMenuClick={handleRemoveOneCard}
      deckCards={getAllDeckCards()}
      showDeckCount={true}
      bind:zone={selectedZone}
    />
  </main>

  <!-- 中间：拖拽手柄 -->
  <button
    class="grip-button"
    class:resizing={isResizing}
    aria-label="resize panel"
    onpointerdown={handlePointerDown}
  >
    {#if isMobile1}
      {#if revertLayout && rightPanelHeight === 100}
        <ChevronUpIcon size={24} />
      {:else}
        <GripHorizontal size={24} />
      {/if}
    {:else}
      <GripVertical size={16} />
    {/if}
  </button>

  <!-- 右侧：卡组面板 -->
  <aside
    class="deck-panel"
    style:width={!isMobile1 ? `${rightPanelWidth}%` : undefined}
    style:height={isMobile1 ? `${rightPanelHeight}%` : undefined}
  >
    <div class="deck-header">
      <!-- 1. 取消按钮 -->
      <button
        class="button button-text"
        style="margin-right: auto; color: var(--secondary-accent-color);"
        onclick={() => window.history.back()}
      >
        取消
      </button>

      <button
        class="button-icon"
        onclick={() => (showDisplayModeMenu = !showDisplayModeMenu)}
        title="切换显示模式"
      >
        {globalDisplayMode === 'text' ? '📝' : '🖼️'}
      </button>

      <!-- 2. 错误信息按钮 -->
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

      <!-- 3. 保存按钮 -->
      <button
        class="button {hasErrors ? 'button-danger' : 'button-primary'}"
        onclick={handleSave}
        disabled={isSaving || !isDirty || hasErrors}
        style="min-width: 80px;"
      >
        {#if isSaving}
          <LoaderCircle class="animate-spin" size={16} />
        {:else}
          <Save size={16} />
        {/if}
        <span>保存</span>
      </button>

      <!-- 4. 更多选项按钮 -->
      <button class="button-icon" onclick={() => (showMoreMenu = !showMoreMenu)} title="更多选项">
        <EllipsisVerticalIcon size={16} />
      </button>
    </div>

    <div class="zones-container">
      {#if showAllZoneMode || (!showAllZoneMode && (selectedZone === 'legend' || selectedZone === 'champion'))}
        <!-- Legend Zone -->
        <div class="zone-section" id="legend-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'legend')}
              >传奇 ({legendCards.length}/{ZONE_CONFIG.legend.maxCount})</span
            >
          </div>
          <div class="zone-list" class:graphic-mode={zoneDisplayModes.legend === 'graphic'}>
            {#each groupCards(legendCards) as group}
              {@render cardItem(group, 'legend', true)}
            {:else}
              <div class="empty-zone">该区域为空</div>
            {/each}
          </div>
        </div>

        <!-- Champion Zone -->
        <div class="zone-section" id="champion-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'champion')}
              >选定英雄 ({championCards.length}/{ZONE_CONFIG.champion.maxCount})</span
            >
          </div>
          <div class="zone-list" class:graphic-mode={zoneDisplayModes.champion === 'graphic'}>
            {#each groupCards(championCards) as group}
              {@render cardItem(group, 'champion', true)}
            {:else}
              <div class="empty-zone">该区域为空</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'mainDeck')}
        <!-- MainDeck Zone -->
        <div class="zone-section full-space" id="maindeck-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'mainDeck')}>
              主牌堆 ({mainDeckCards.length}/{ZONE_CONFIG.mainDeck.maxCount})
            </span>

            <div class="display-mode-switch">
              <button
                class:active={mainDeckDisplayMode === 'grouped'}
                onclick={() => (mainDeckDisplayMode = 'grouped')}
              >
                合并
              </button>

              <button
                class:active={mainDeckDisplayMode === 'single'}
                onclick={() => (mainDeckDisplayMode = 'single')}
              >
                单张
              </button>
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
                <div class="empty-zone">该区域为空</div>
              {/each}
            {:else}
              {#each mainDeckCards as card}
                {@render cardItem({ card, count: 1 }, 'mainDeck', false)}
              {:else}
                <div class="empty-zone">该区域为空</div>
              {/each}
            {/if}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'battlefields')}
        <!-- Battlefields Zone -->
        <div class="zone-section full-space" id="battlefields-zone">
          <div class="zone-header">
            <span
              class="zone-name"
              role="presentation"
              onclick={() => (selectedZone = 'battlefields')}
            >
              战场 ({battlefieldCards.length}/{ZONE_CONFIG.battlefields.maxCount})
            </span>
          </div>
          <div
            class="zone-list multi-item max-3"
            class:graphic-mode={zoneDisplayModes.battlefields === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#each groupCards(battlefieldCards) as group}
              {@render cardItem(group, 'battlefields', true)}
            {:else}
              <div class="empty-zone">该区域为空</div>
            {/each}
          </div>
        </div>
      {/if}
      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'runes')}
        <!-- Runes Zone -->
        <div class="zone-section full-space" id="runes-zone">
          <div class="zone-header">
            <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'runes')}
              >符文 ({runeCards.length}/{ZONE_CONFIG.runes.maxCount})</span
            >
          </div>
          <div
            class="zone-list multi-item"
            class:graphic-mode={zoneDisplayModes.runes === 'graphic'}
            style:--single-column-count={singleColumnCount}
          >
            {#each groupCards(runeCards) as group}
              {@render cardItem(group, 'runes', true)}
            {:else}
              <div class="empty-zone">该区域为空</div>
            {/each}
          </div>
        </div>
      {/if}

      {#if showAllZoneMode || (!showAllZoneMode && selectedZone === 'sideboard')}
        <!-- Sideboard Zone -->
        <div class="zone-section full-space" id="sideboard-zone">
          <div class="zone-header">
            <span
              class="zone-name"
              role="presentation"
              onclick={() => (selectedZone = 'sideboard')}
            >
              备牌 ({sideboardCards.length}/{ZONE_CONFIG.sideboard.maxCount})
            </span>

            <div class="display-mode-switch">
              <button
                class:active={sideboardDisplayMode === 'grouped'}
                onclick={() => (sideboardDisplayMode = 'grouped')}
              >
                合并
              </button>

              <button
                class:active={sideboardDisplayMode === 'single'}
                onclick={() => (sideboardDisplayMode = 'single')}
              >
                单张
              </button>
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
                <div class="empty-zone">该区域为空</div>
              {/each}
            {:else}
              {#each sideboardCards as card}
                {@render cardItem({ card, count: 1 }, 'sideboard', false)}
              {:else}
                <div class="empty-zone">该区域为空</div>
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
              name={`${printModalTarget.card.id}-${currentPrint?.id}`}
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
            class="save-btn"
            onclick={() => (showCurrentCardDetails = !showCurrentCardDetails)}
          >
            {showCurrentCardDetails ? '收起' : '详情'}
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
            class="save-btn"
            disabled={printModalTarget?.card.selectedPrints === currentPrint.id}
            onclick={() => changePrintsId(currentPrint.id)}
          >
            切换
          </button>
        </div>
      {/snippet}
    </CommonModal>
  {/if}

  <CommonModal
    open={showSaveModal}
    title="保存卡组"
    subtitle="为你的卡组设置名称和描述"
    closable={!isSaving}
    onclose={cancelSaveDeck}
  >
    <!-- 默认 slot → modal-content -->
    <label class="save-modal-field">
      <span class="save-modal-label">
        卡组名称 <span class="required">*</span>
      </span>
      <input
        class="save-modal-input"
        type="text"
        placeholder="例如：蜘蛛快攻"
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

    <label class="save-modal-field">
      <span class="save-modal-label">Description</span>
      <textarea
        class="save-modal-textarea"
        placeholder="简单描述一下这个卡组……"
        maxlength="500"
        rows="5"
        bind:value={saveDeckDescription}
        disabled={isSaving}></textarea>
    </label>

    <!-- footer snippet → modal-footer -->
    {#snippet footer()}
      <button class="save-modal-cancel" disabled={isSaving} onclick={cancelSaveDeck}> 取消 </button>
      <button
        class="save-modal-confirm"
        disabled={isSaving || !saveDeckName.trim()}
        onclick={confirmSaveDeck}
      >
        {#if isSaving}
          <LoaderCircle class="animate-spin" size={16} />
          <span>保存中...</span>
        {:else}
          <Save size={16} />
          <span>保存卡组</span>
        {/if}
      </button>
    {/snippet}
  </CommonModal>

  <CommonModal
    closeOnOverlay={true}
    onclose={() => (showErrorModal = !showErrorModal)}
    open={showErrorModal}
    title={`卡组校验未通过 (${deckIssues.length} 个问题)`}
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
            <span class="issue-text">{@html issue.message}</span>
          </li>
        {/each}
      </ul>
    </div>

    <!-- footer snippet → modal-footer -->
    {#snippet footer()}
      <button class="save-modal-confirm" onclick={() => (showErrorModal = !showErrorModal)}>
        <span>了解</span>
      </button>
    {/snippet}
  </CommonModal>

  <!-- 更多选项 Modal -->
  <CommonModal
    open={showMoreMenu}
    onclose={() => (showMoreMenu = false)}
    title="更多选项"
    subtitle="卡组管理工具"
    closable={true}
  >
    <div class="more-menu-content">
      <!-- 1. 显示模式切换 - 文字/卡图 -->
      <div class="more-menu-section">
        <div class="more-menu-item more-menu-toggle-buttons">
          <span class="toggle-label">
            <span>显示模式</span>
          </span>
          <div class="toggle-button-group">
            <button
              class="toggle-btn {cardDisplayMode === 'text' ? 'active' : ''}"
              onclick={() => {
                cardDisplayMode = 'text'
              }}
            >
              文字
            </button>
            <button
              class="toggle-btn {cardDisplayMode === 'graphic' ? 'active' : ''}"
              onclick={() => {
                cardDisplayMode = 'graphic'
              }}
            >
              卡图
            </button>
          </div>
        </div>
      </div>

      <!-- 2. 区域选择 - 可展开 -->
      <div class="more-menu-section">
        <div
          role="presentation"
          aria-label="区域卡牌展示模式"
          class="more-menu-item more-menu-expandable"
          onclick={() => {
            showZoneSelector = !showZoneSelector
          }}
        >
          <span class="toggle-label">
            <span>📌</span>
            <span>选择区域</span>
          </span>
          <div class="expand-control">
            <span class="selected-zone-label">{ZONE_CONFIG[selectedZone].label}</span>
            <ChevronRightIcon size={16} class="expand-icon {showZoneSelector ? 'expanded' : ''}" />
          </div>
        </div>

        {#if showZoneSelector}
          <div class="zone-selector-dropdown">
            {#each Object.entries(ZONE_CONFIG) as [key, config]}
              <button
                class="zone-option {selectedZone === key ? 'active' : ''}"
                onclick={() => {
                  selectedZone = key as ZoneKey
                  showZoneSelector = false
                }}
              >
                <span class="zone-option-name">{config.name}</span>
                <span class="zone-option-count"
                  >({getZoneCards(key as ZoneKey).length}/{config.maxCount})</span
                >
                {#if selectedZone === key}
                  <CheckIcon size={16} class="zone-check" />
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <!-- 3. 布局切换 -->
      {#if useVerticalResize}
        <button
          class="more-menu-item"
          onclick={() => {
            revertLayout = !revertLayout
            showMoreMenu = false
          }}
        >
          <ArrowUpDownIcon size={18} />
          <span>{revertLayout ? '恢复默认布局' : '切换布局'}</span>
        </button>
      {/if}

      <!-- 4. 整理按钮 -->
      <button
        class="more-menu-item"
        onclick={() => {
          arrangeDecks()
          showMoreMenu = false
        }}
      >
        <ArrowDownAZIcon size={18} />
        <span>整理卡组</span>
      </button>

      <!-- 5. 每行列数 (仅在卡图模式显示) -->
      {#if cardDisplayMode === 'graphic'}
        <div class="more-menu-item more-menu-input">
          <span class="more-menu-label">
            <span>每行列数</span>
          </span>
          <input
            type="number"
            min="2"
            max="6"
            value={singleColumnCount}
            oninput={(e) => {
              const target = e.target as HTMLInputElement
              singleColumnCount = parseInt(target.value || '4')
            }}
            class="number-input"
            style="width: 60px; padding: 4px 8px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); text-align: center;"
          />
        </div>
      {/if}

      <!-- 6. 显示所有区域切换 - Toggle -->
      <div class="more-menu-item more-menu-toggle">
        <span class="toggle-label">
          <span>{showAllZoneMode ? '📁' : '📂'}</span>
          <span>{showAllZoneMode ? '显示所有区域' : '专注当前区域'}</span>
        </span>
        <button
          aria-label="区域模式"
          class="toggle-switch {showAllZoneMode ? 'active' : ''}"
          onclick={() => {
            showAllZoneMode = !showAllZoneMode
          }}
          role="switch"
          aria-checked={showAllZoneMode}
        >
          <span class="toggle-slider"></span>
        </button>
      </div>

      <!-- 7. 显示卡组统计 -->
      <button
        class="more-menu-item"
        onclick={() => {
          showDeckStats = !showDeckStats
          showMoreMenu = false
        }}
      >
        <span>📊</span>
        <span>卡组统计</span>
      </button>
    </div>

    <!-- footer -->
    {#snippet footer()}
      <button class="save-modal-confirm" onclick={() => (showMoreMenu = false)}>
        <span>关闭</span>
      </button>
    {/snippet}
  </CommonModal>

  <!-- 卡组统计 Modal -->
  <CommonModal
    open={showDeckStats}
    onclose={() => (showDeckStats = false)}
    title="卡组统计"
    subtitle="卡组构成分析"
  >
    <div class="deck-stats-content">
      <div class="stat-row">
        <span class="stat-label">总卡牌数</span>
        <span class="stat-value">{getAllDeckCards().length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">传奇</span>
        <span class="stat-value">{legendCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">英雄</span>
        <span class="stat-value">{championCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">主牌堆</span>
        <span class="stat-value">{mainDeckCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">战场</span>
        <span class="stat-value">{battlefieldCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">符文</span>
        <span class="stat-value">{runeCards.length}</span>
      </div>
      <div class="stat-row">
        <span class="stat-label">备牌</span>
        <span class="stat-value">{sideboardCards.length}</span>
      </div>
      <div class="stat-divider"></div>
      <div class="stat-row stat-total">
        <span class="stat-label">合计</span>
        <span class="stat-value">{getAllDeckCards().length}</span>
      </div>
    </div>

    {#snippet footer()}
      <button class="save-modal-confirm" onclick={() => (showDeckStats = false)}>
        <span>了解</span>
      </button>
    {/snippet}
  </CommonModal>
</div>

<!-- 显示模式选择 Modal -->
<CommonModal
  open={showDisplayModeMenu}
  onclose={() => (showDisplayModeMenu = false)}
  title="区域显示模式"
  subtitle="为每个区域单独设置显示方式"
  closable={true}
>
  <div class="display-mode-menu">
    <!-- 全局快速切换 -->
    <div class="display-mode-global">
      <span class="global-label">🌐 全局切换</span>
      <div class="display-mode-switch">
        <button
          class:active={globalDisplayMode === 'text'}
          onclick={() => {
            globalDisplayMode = 'text'
            // 应用到所有区域
            Object.keys(zoneDisplayModes).forEach((key) => {
              zoneDisplayModes[key as ZoneKey] = 'text'
            })
          }}
        >
          📝 文字
        </button>
        <button
          class:active={globalDisplayMode === 'graphic'}
          onclick={() => {
            globalDisplayMode = 'graphic'
            // 应用到所有区域
            Object.keys(zoneDisplayModes).forEach((key) => {
              zoneDisplayModes[key as ZoneKey] = 'graphic'
            })
          }}
        >
          🖼️ 卡图
        </button>
      </div>
    </div>

    <div class="display-mode-divider"></div>

    <!-- 各区域独立控制 -->
    <div class="display-mode-item">
      <span class="zone-label">⚔️ 传奇</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.legend === 'text'}
          onclick={() => {
            zoneDisplayModes.legend = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.legend === 'graphic'}
          onclick={() => {
            zoneDisplayModes.legend = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>

    <div class="display-mode-item">
      <span class="zone-label">👑 英雄</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.champion === 'text'}
          onclick={() => {
            zoneDisplayModes.champion = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.champion === 'graphic'}
          onclick={() => {
            zoneDisplayModes.champion = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>

    <div class="display-mode-item">
      <span class="zone-label">📚 主牌堆</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.mainDeck === 'text'}
          onclick={() => {
            zoneDisplayModes.mainDeck = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.mainDeck === 'graphic'}
          onclick={() => {
            zoneDisplayModes.mainDeck = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>

    <div class="display-mode-item">
      <span class="zone-label">🏛️ 战场</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.battlefields === 'text'}
          onclick={() => {
            zoneDisplayModes.battlefields = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.battlefields === 'graphic'}
          onclick={() => {
            zoneDisplayModes.battlefields = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>

    <div class="display-mode-item">
      <span class="zone-label">🔮 符文</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.runes === 'text'}
          onclick={() => {
            zoneDisplayModes.runes = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.runes === 'graphic'}
          onclick={() => {
            zoneDisplayModes.runes = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>

    <div class="display-mode-item">
      <span class="zone-label">📦 备牌</span>
      <div class="display-mode-switch small">
        <button
          class:active={zoneDisplayModes.sideboard === 'text'}
          onclick={() => {
            zoneDisplayModes.sideboard = 'text'
            updateGlobalDisplayMode()
          }}
        >
          文字
        </button>
        <button
          class:active={zoneDisplayModes.sideboard === 'graphic'}
          onclick={() => {
            zoneDisplayModes.sideboard = 'graphic'
            updateGlobalDisplayMode()
          }}
        >
          卡图
        </button>
      </div>
    </div>
  </div>

  {#snippet footer()}
    <button class="save-modal-confirm" onclick={() => (showDisplayModeMenu = false)}>
      <span>完成</span>
    </button>
  {/snippet}
</CommonModal>

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
  }

  .deck-header {
    padding: 1rem 2%;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    gap: 8px;
    align-items: center;
    justify-content: flex-end;
  }

  .save-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: var(--accent-color);
    color: var(--bg-primary);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.2s;
  }

  .save-btn:disabled {
    background: #9ca3af;
    cursor: not-allowed;
  }

  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.4);
    }
    70% {
      box-shadow: 0 0 0 6px rgba(245, 158, 11, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);
    }
  }

  .zones-container {
    /* flex: 1; */
    overflow-y: auto;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    scroll-snap-type: y proximity;
  }

  .deck-panel {
    container-type: inline-size;
  }

  @container (max-width: 360.99px) {
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

  /* 列表容器调整间距 */
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

  /* 图片层：铺满容器，作为底层背景 */
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

  /* 信息层：绝对定位在左侧，承载文字和渐变 */
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
    text-shadow: 0 2px 4px rgba(0, 0, 0, 0.8); /* 文字阴影增加立体感 */
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 2px;
  }

  .card-id {
    font-size: 11px;
    color: #cbd5e1; /* 浅灰色 */
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  }

  /* 空状态样式保持 */
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

  .zone-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;

    padding: 8px 1rem;
    background: var(--bg-secondary, #f9fafb);
    font-weight: 600;
    font-size: 13px;
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

    /* .zone-list.graphic-mode {
      --single-column-count: 4;
      grid-template-columns: repeat(var(--single-column-count), 1fr);
    } */
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px) scale(0.98);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
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
    max-width: 260px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* 针对 CardSimpleImage 渲染的 img 标签使用 :global 穿透 */
  :global(.print-slide-image img) {
    width: 100%;
    /*aspect-ratio: 744/1040;*/
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

  /* =========================================
     Mobile Responsive (手机适配)
     ========================================= */
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
  .save-modal-cancel,
  .save-modal-confirm {
    min-height: 36px;

    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;

    padding: 0 14px;

    border-radius: 7px;

    font-size: 13px;
    font-weight: 600;

    cursor: pointer;
  }

  .save-modal-cancel {
    border: 1px solid var(--border-color, #d1d5db);

    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .save-modal-cancel:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .save-modal-confirm {
    border: 1px solid var(--accent-color);

    background: var(--accent-color);
    color: var(--bg-primary);
  }

  .save-modal-confirm:hover:not(:disabled) {
    filter: brightness(0.95);
  }

  .save-modal-cancel:disabled,
  .save-modal-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  @media (max-width: 479.99px) {
    .save-modal-cancel,
    .save-modal-confirm {
      min-height: 42px;
      flex: 1;
    }
  }

  /* ========== 更多菜单样式 ========== */
  .more-menu-content {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 4px 0;
  }

  .more-menu-section {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 4px;
    margin-bottom: 4px;
  }

  .more-menu-section:last-child {
    border-bottom: none;
    padding-bottom: 0;
    margin-bottom: 0;
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

  /* ========== 显示模式切换 ========== */
  .more-menu-toggle-buttons {
    justify-content: space-between !important;
    cursor: default !important;
  }

  .more-menu-toggle-buttons:hover {
    background-color: transparent !important;
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

  /* ========== 区域选择器（可展开） ========== */
  .more-menu-expandable {
    cursor: pointer;
  }

  .more-menu-expandable:hover {
    background-color: var(--bg-hover);
  }

  .expand-control {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .selected-zone-label {
    font-size: var(--text-sm);
    color: var(--accent-color);
    font-weight: 500;
  }

  :global(.expand-icon) {
    transition: transform 0.3s ease;
    color: var(--text-secondary);
  }

  :global(.expand-icon.expanded) {
    transform: rotate(90deg);
  }

  .zone-selector-dropdown {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 14px 8px 14px;
    animation: slideDown 0.25s ease;
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

  .zone-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.15s ease;
    width: 100%;
    position: relative;
  }

  .zone-option:hover {
    background-color: var(--bg-hover);
  }

  .zone-option.active {
    background-color: color-mix(in oklab, var(--accent-color) 10%, transparent);
    color: var(--accent-color);
  }

  .zone-option-name {
    flex: 1;
    text-align: left;
    font-weight: 500;
  }

  .zone-option-count {
    color: var(--text-secondary);
    font-size: var(--text-xs);
  }

  /* ========== Toggle Switch ========== */
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

  .toggle-switch {
    position: relative;
    width: 44px;
    height: 24px;
    background-color: var(--border-color);
    border-radius: 12px;
    border: none;
    cursor: pointer;
    transition: background-color 0.3s ease;
    flex-shrink: 0;
    padding: 0;
  }

  .toggle-switch.active {
    background-color: var(--accent-color);
  }

  .toggle-slider {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 20px;
    height: 20px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.3s ease;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  }

  .toggle-switch.active .toggle-slider {
    transform: translateX(20px);
  }

  .toggle-switch:hover .toggle-slider {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  }

  .toggle-switch:active .toggle-slider {
    transform: scale(0.9);
  }

  .toggle-switch.active:active .toggle-slider {
    transform: translateX(20px) scale(0.9);
  }

  /* ========== 输入框 ========== */
  .more-menu-input {
    justify-content: space-between !important;
    cursor: default !important;
  }

  .more-menu-input:hover {
    background-color: transparent !important;
  }

  .more-menu-label {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--text-secondary);
    font-size: var(--text-sm);
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

  .number-input::-webkit-inner-spin-button {
    opacity: 0.5;
  }

  /* ========== 卡组统计 ========== */
  .deck-stats-content {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 4px 0;
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

  /* ========== 响应式 ========== */
  @media (max-width: 479.99px) {
    .more-menu-item {
      padding: 12px 14px;
      font-size: var(--text-base);
    }

    .toggle-switch {
      width: 48px;
      height: 28px;
    }

    .toggle-slider {
      width: 24px;
      height: 24px;
    }

    .toggle-switch.active .toggle-slider {
      transform: translateX(20px);
    }

    .toggle-switch:active .toggle-slider {
      transform: scale(0.9);
    }

    .toggle-switch.active:active .toggle-slider {
      transform: translateX(20px) scale(0.9);
    }

    .zone-option {
      padding: 10px 12px;
    }

    .stat-row {
      padding: 10px 12px;
    }
  }
</style>
