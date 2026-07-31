<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import type { CardBase, CardPrint } from '$lib/db/types'
  import { beforeNavigate, goto } from '$app/navigation'
  import { onMount } from 'svelte'
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

  type DisplayMode = 'grouped' | 'single'

  let mainDeckDisplayMode = $state<DisplayMode>('grouped')
  let sideboardDisplayMode = $state<DisplayMode>('grouped')
  let printModalPrintIndex = $state(0)
  let printModalTarget = $state<{
    card: cardAndPrint
    zone: ZoneKey
    grouped: boolean
  } | null>(null)

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
        goto('/decks')
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

  function handleAddCard(card: cardAndPrint) {
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

  function changePrintsId() {
    const target = printModalTarget
    if (!target) return

    const currentPrint = target.card.card_prints[printModalPrintIndex]
    if (!currentPrint) return

    let card = getZoneCards(target.zone).filter(
      (card) => card.id === target.card.id && card.selectedPrints === target.card.selectedPrints
    )

    card.forEach((c) => {
      c.selectedPrints = currentPrint.id
    })
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
    const data = deckIssues.forEach((issue) => {
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
</script>

{#snippet cardItem(group: { card: cardAndPrint; count: number }, zone: ZoneKey, grouped: boolean)}
  {@const rawName = `${group.card.card_name_cn}${group.card.sub_title_cn ? ' - ' + group.card.sub_title_cn : ''}`}
  {@const hasErrorCard = checkErrorCard(rawName)}
  <div
    role="presentation"
    class="card-item"
    onclick={() => openPrintModal(group.card, zone, grouped)}
  >
    <div class="card-image">
      {#if group.card.selectedPrints}
        {@const selectedPrint = group.card.card_prints.find(
          (p) => p.id === group.card.selectedPrints
        )}

        <CardSimpleImage
          url={selectedPrint?.img_cdn}
          name={`${group.card.id}-${selectedPrint?.id || 'default'}`}
        />
      {/if}
    </div>

    <div class="card-info">
      <div class="card-name">{rawName}</div>
      <div class="card-id">{group.card.card_no}</div>
    </div>

    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="card-quantity-control" onclick={(e) => e.stopPropagation()}>
      <!-- <button
        class="quantity-btn"
        aria-label="减少数量"
        onclick={() => removeCardQuantity(group.card, zone, grouped)}
      >
        <Minus size={14} />
      </button> -->

      <span class="card-count" class:hasErrorCard>{group.count}</span>

      <!-- <button
        class="quantity-btn"
        aria-label="增加数量"
        onclick={() => addCardQuantity(group.card, zone)}
      >
        <Plus size={14} />
      </button> -->
    </div>
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
      {#if hasErrors}
        <div
          class="error-info-container"
          role="presentation"
          onclick={() => (showErrorModal = !showErrorModal)}
        >
          <CircleAlert size={25} color={'#dc2626'} />
        </div>
      {/if}
      {#if useVerticalResize}
        <button
          onclick={() => {
            revertLayout = !revertLayout
          }}><ArrowUpDownIcon size={16} /></button
        >
      {/if}
      <button class="save-btn" onclick={arrangeDecks}><ArrowDownAZIcon size={16} />整理</button>
      <button
        class="save-btn"
        onclick={handleSave}
        disabled={isSaving || !isDirty || hasErrors}
        class:is-dirty={isDirty && !hasErrors}
        class:has-errors={hasErrors}
      >
        {#if isSaving}
          <LoaderCircle class="animate-spin" size={16} />
        {:else}
          <Save size={16} />
        {/if}
        <span>保存</span>
      </button>
      <EllipsisVerticalIcon size={16}></EllipsisVerticalIcon>
    </div>

    <div class="zones-container">
      <!-- Legend Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'legend')}
            >传奇 ({legendCards.length}/{ZONE_CONFIG.legend.maxCount})</span
          >
        </div>
        <div class="zone-list">
          {#each groupCards(legendCards) as group}
            {@render cardItem(group, 'legend', true)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- Champion Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'champion')}
            >选定英雄 ({championCards.length}/{ZONE_CONFIG.champion.maxCount})</span
          >
        </div>
        <div class="zone-list">
          {#each groupCards(championCards) as group}
            {@render cardItem(group, 'champion', true)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- MainDeck Zone -->
      <div class="zone-section">
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
        <div class="zone-list multi-item" class:single-mode={mainDeckDisplayMode === 'single'}>
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

      <!-- Battlefields Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span
            class="zone-name"
            role="presentation"
            onclick={() => (selectedZone = 'battlefields')}
            >战场 ({battlefieldCards.length}/{ZONE_CONFIG.battlefields.maxCount})</span
          >
        </div>
        <div class="zone-list multi-item">
          {#each groupCards(battlefieldCards) as group}
            {@render cardItem(group, 'battlefields', true)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- Runes Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'runes')}
            >符文 ({runeCards.length}/{ZONE_CONFIG.runes.maxCount})</span
          >
        </div>
        <div class="zone-list multi-item">
          {#each groupCards(runeCards) as group}
            {@render cardItem(group, 'runes', true)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- Sideboard Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'sideboard')}>
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
        <div class="zone-list multi-item" class:single-mode={sideboardDisplayMode === 'single'}>
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
          }}
        >
          <ChevronLeftIcon size={16}></ChevronLeftIcon>
        </button>

        <div class="print-slide">
          <div class="print-slide-image">
            <CardSimpleImage
              url={prints[printModalPrintIndex]?.img_cdn}
              name={`${printModalTarget.card.id}-${currentPrint?.id}`}
            />
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
            onclick={() => changePrintsId()}
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
</div>

<style>
  .error-info-container {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }

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
    background: #3b82f6;
    color: white;
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

  .save-btn.is-dirty:not(:disabled) {
    background: #f59e0b;
    animation: pulse 2s infinite;
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
  }

  .deck-panel {
    container-type: inline-size;
  }

  @container (max-width: 350px) {
    .zones-container {
      grid-template-columns: 1fr;
    }
  }

  .zones-container > .zone-section:nth-child(n + 3) {
    grid-column: 1 / -1;
  }

  .zone-section {
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .zone-header {
    padding: 8px 1rem;
    background: var(--bg-secondary, #f9fafb);
    font-weight: 600;
    font-size: 13px;
    position: sticky;
    top: 0;
    z-index: 10;
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
    border-radius: 6px;
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

  /* 数量徽章：绝对定位在最右侧，悬浮于图片之上 */
  .card-count {
    position: absolute;
    right: 12px;
    top: 50%;
    transform: translateY(-50%);
    z-index: 5;
    min-width: 32px;
    height: 32px;
    padding: 0 8px;
    background: #10b981; /* 翡翠绿 */
    color: white;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    border: 2px solid rgba(255, 255, 255, 0.2); /* 增加一点边缘高光 */
  }

  .card-count.hasErrorCard {
    background-color: #dc2626;
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

  .save-btn.has-errors {
    background: #ef4444; /* 红色 */
    cursor: not-allowed;
    opacity: 0.8;
  }

  .save-btn.has-errors:hover {
    background: #ef4444;
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
    font-size: 14px;
    font-weight: 700;
    line-height: 1;
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
    z-index: 10;
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

  .zone-list.single-mode {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  .zone-list.single-mode .card-item {
    min-width: 0;
  }

  @media (max-width: 479.99px) {
    ::-webkit-scrollbar {
      display: none;
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

    .zone-list.single-mode {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }
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
  }

  .print-slide-image {
    flex: 1;
    max-width: 260px;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* 针对 CardSimpleImage 渲染的 img 标签使用 :global 穿透 */
  :global(.print-slide-image img) {
    width: 100%;
    aspect-ratio: 744/1040;
    max-height: 360px;
    object-fit: contain;
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    transition: transform 0.3s ease;
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
</style>
