<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import type { CardBase, CardPrint } from '$lib/db/types'
  import { beforeNavigate, goto } from '$app/navigation'
  import { onMount } from 'svelte'
  import { CircleAlert, GripVertical, LoaderCircle, Save, TriangleAlert } from '@lucide/svelte'
  import { ask, message } from '@tauri-apps/plugin-dialog'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { validateDeck } from '$lib/decks/deck-validator'

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

  // --- 核心：未保存修改标记 (Dirty State) ---
  let isDirty = $state(false)
  let isSaving = $state(false)
  let confirmBack = $state(false)

  // --- 拖拽调整宽度状态 ---
  let rightPanelWidth = $state(50)
  let isResizing = $state(false)
  let startX = $state(0)
  let startWidth = $state(0)
  let containerWidth = $state(0)

  const ZONE_CONFIG = {
    legend: { name: 'Legend', maxCount: 1 },
    champion: { name: 'Champion', maxCount: 1 },
    mainDeck: { name: 'MainDeck', maxCount: 39 },
    battlefields: { name: 'Battlefields', maxCount: 3 },
    runes: { name: 'Runes', maxCount: 12 },
    sideboard: { name: 'Sideboard', maxCount: 8 },
  } as const

  type ZoneKey = keyof typeof ZONE_CONFIG

  function getAllDeckCards(): cardAndPrint[] {
    return [
      ...legendCards,
      ...championCards,
      ...mainDeckCards,
      ...battlefieldCards,
      ...runeCards,
      ...sideboardCards,
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

  let hasErrors = $derived(deckIssues.some((issue) => issue.severity === 'error'))

  function groupCards(cards: cardAndPrint[]) {
    const map = new Map<string, { card: cardAndPrint; count: number }>()
    for (const card of cards) {
      const existing = map.get(card.id)
      if (existing) {
        existing.count += 1
      } else {
        map.set(card.id, { card, count: 1 })
      }
    }
    return Array.from(map.values())
  }

  beforeNavigate(async (navigation) => {
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
    const updateContainerWidth = () => {
      containerWidth = window.innerWidth
    }
    updateContainerWidth()
    window.addEventListener('resize', updateContainerWidth)

    return () => {
      window.removeEventListener('resize', updateContainerWidth)
    }
  })

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

    let defaultPrint =
      card.card_prints?.find((p) => p.is_default) ??
      card.card_prints?.find((p) => p.card_no_extend === card.card_no && p.language === 'SC')

    if (defaultPrint?.id) card.selectedPrints = defaultPrint.id

    switch (selectedZone) {
      case 'legend':
        legendCards = [card]
        selectedZone = 'champion'
        break
      case 'champion':
        championCards = [card]
        selectedZone = 'mainDeck'
        break
      case 'mainDeck':
        mainDeckCards = [...mainDeckCards, card]
        break
      case 'battlefields':
        battlefieldCards = [...battlefieldCards, card]
        break
      case 'runes':
        runeCards = [...runeCards, card]
        break
      case 'sideboard':
        sideboardCards = [...sideboardCards, card]
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

  async function handleSave() {
    isSaving = true
    try {
      await new Promise((resolve) => setTimeout(resolve, 800))
      isDirty = false
      message('卡组保存成功！')
    } catch (error) {
      console.error('保存失败:', error)
      message('保存失败，请重试')
    } finally {
      isSaving = false
    }
  }

  function getTotalCount(): number {
    return getAllDeckCards().length
  }

  function handlePointerDown(e: PointerEvent) {
    isResizing = true
    startX = e.clientX
    startWidth = rightPanelWidth

    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    document.body.style.userSelect = 'none'
    document.documentElement.style.cursor = 'col-resize'
  }

  function handlePointerMove(e: PointerEvent) {
    if (!isResizing || containerWidth === 0) return

    const deltaX = startX - e.clientX
    const deltaPercent = (deltaX / containerWidth) * 100
    const newWidth = startWidth + deltaPercent

    rightPanelWidth = Math.max(20, Math.min(80, newWidth))
  }

  function handlePointerUp(e: PointerEvent) {
    if (!isResizing) return

    isResizing = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    document.body.style.userSelect = ''
    document.documentElement.style.cursor = ''
  }
</script>

{#snippet cardItem(
  group: { card: cardAndPrint; count: number },
  zone: ZoneKey,
  onRemove: (cardId: string, zone: ZoneKey) => void
)}
  <div role="presentation" class="card-item" onclick={() => onRemove(group.card.id, zone)}>
    <div class="card-image">
      {#if group.card.selectedPrints}
        {@const defaultPrint = group.card.card_prints.find(
          (p) => p.id === group.card.selectedPrints
        )}
        <CardSimpleImage
          url={defaultPrint?.img_cdn}
          name={`${group.card.id}-${defaultPrint!.id || 'default'}`}
        />
      {/if}
    </div>
    <div class="card-info">
      <div class="card-name">{group.card.card_name_cn}</div>
      <div class="card-id">{group.card.card_no}</div>
    </div>
    {#if group.count > 1}
      <div class="card-count">{group.count}</div>
    {/if}
  </div>
{/snippet}

<div class="deck-builder-layout">
  <!-- 左侧：卡池 -->
  <main class="card-pool-panel">
    <CardPool
      onCardClick={handleAddCard}
      deckCards={getAllDeckCards()}
      showDeckCount={true}
      bind:zone={selectedZone}
    />
  </main>

  <!-- 中间：拖拽手柄 -->
  <button
    class="grip-button"
    class:resizing={isResizing}
    aria-label="调整面板宽度"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
  >
    <GripVertical size={16} />
  </button>

  <!-- 右侧：卡组面板 -->
  <aside class="deck-panel" style="width: {rightPanelWidth}%">
    <div class="deck-header">
      <input
        type="text"
        bind:value={deckName}
        oninput={() => (isDirty = true)}
        class="deck-name-input"
        placeholder="输入卡组名称"
      />
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
      {#if hasErrors}
        <div class="error-info-container">
          <CircleAlert size={25} color={'#dc2626'} />
          <div class="issues-panel">
            <div class="issues-header">
              <TriangleAlert size={16} class="text-red-500" />
              <span>卡组校验未通过 ({deckIssues.length} 个问题)</span>
            </div>
            <ul class="issues-list">
              {#each deckIssues as issue}
                <li class="issue-item" class:error={issue.severity === 'error'}>
                  <span class="issue-icon">
                    {#if issue.severity === 'error'}✕
                    {:else}⚠{/if}
                  </span>
                  <span class="issue-text">{@html issue.message}</span>
                </li>
              {/each}
            </ul>
          </div>
        </div>
      {/if}
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
            {@render cardItem(group, 'legend', handleRemoveOneCard)}
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
            {@render cardItem(group, 'champion', handleRemoveOneCard)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- MainDeck Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'mainDeck')}
            >主牌堆 ({mainDeckCards.length}/{ZONE_CONFIG.mainDeck.maxCount})</span
          >
        </div>
        <div class="zone-list">
          {#each groupCards(mainDeckCards) as group}
            {@render cardItem(group, 'mainDeck', handleRemoveOneCard)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
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
        <div class="zone-list">
          {#each groupCards(battlefieldCards) as group}
            {@render cardItem(group, 'battlefields', handleRemoveOneCard)}
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
        <div class="zone-list">
          {#each groupCards(runeCards) as group}
            {@render cardItem(group, 'runes', handleRemoveOneCard)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>

      <!-- Sideboard Zone -->
      <div class="zone-section">
        <div class="zone-header">
          <span class="zone-name" role="presentation" onclick={() => (selectedZone = 'sideboard')}
            >备牌 ({sideboardCards.length}/{ZONE_CONFIG.sideboard.maxCount})</span
          >
        </div>
        <div class="zone-list">
          {#each groupCards(sideboardCards) as group}
            {@render cardItem(group, 'sideboard', handleRemoveOneCard)}
          {:else}
            <div class="empty-zone">该区域为空</div>
          {/each}
        </div>
      </div>
    </div>
  </aside>
</div>

<style>
  .error-info-container {
    display: flex;
    justify-content: center;
    align-items: center;
    position: relative;
  }

  .error-info-container:hover > .issues-panel,
  .issues-panel:hover {
    display: block;
  }

  .issues-panel {
    padding: 0;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    background: #fef2f2;
    position: absolute;
    right: -5px;
    z-index: 99999;
    width: min(300px, 100vw);
    top: 100%;
    padding-top: 5px;
    display: none;
  }

  .issues-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 1rem;
    font-weight: 600;
    font-size: var(--text-md);
    color: #991b1b; /* 深红色文字 */
    border-bottom: 1px solid #fecaca;
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

  @media (max-width: 767.99px) {
    /* .deck-builder-layout {
      padding: 24px 16px;
    } */
  }

  .deck-panel {
    border-right: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    flex-shrink: 0;
  }

  .deck-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    gap: 8px;
  }

  .deck-name-input {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 14px;
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

  .unsaved-warning {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 1rem;
    background: #fef3c7;
    color: #92400e;
    font-size: 12px;
    border-bottom: 1px solid #fde68a;
  }

  .deck-title {
    padding: 1rem;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .zones-container {
    flex: 1;
    overflow-y: auto;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
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
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  }

  .zone-list:has(> .empty-zone) {
    display: block;
  }

  /* 卡牌项容器：作为相对定位的基准 */
  .card-item {
    position: relative;
    height: 64px; /* 固定高度，适合横向展示 */
    width: 100%;
    overflow: hidden;
    border-radius: 6px;
    cursor: pointer;
    background: #0f172a; /* 兜底深色背景，防止图片加载前白屏 */
    transition:
      transform 0.2s ease,
      box-shadow 0.2s ease;
  }

  .card-item:hover {
    /* transform: translateY(-2px); */
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
    /* 可选：如果原图分辨率不高，放大后会有锯齿，加 1px 模糊会让背景更柔和自然 */
    /* filter: blur(1px); */
  }

  /* 信息层：绝对定位在左侧，承载文字和渐变 */
  .card-info {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 80%; /* 占据左侧大部分空间，留出右侧给图片透气 */
    z-index: 2;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding-left: 16px;

    /* 核心：从左到右的渐变，从深黑过渡到透明，完美凸显白色文字 */
    background: linear-gradient(
      90deg,
      rgba(15, 23, 42, 0.95) 0%,
      /* 左侧极暗，保证 name 清晰 */ rgba(15, 23, 42, 0.85) 40%,
      rgba(15, 23, 42, 0.4) 55%,
      transparent 100% /* 右侧完全透明，露出底层放大的卡牌原画 */
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
    font-family: 'Courier New', monospace;
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
    padding: 12px 24px;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-width: 0;
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
  }

  .grip-button:hover {
    color: var(--text-secondary);
    background-color: var(--bg-hover);
  }

  .grip-button.resizing {
    background-color: var(--bg-active, #e5e7eb);
    color: var(--text-primary);
  }

  .zone-selector {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 1rem;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
    background: var(--bg-secondary, #f9fafb);
  }

  .selector-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .zone-select {
    flex: 1;
    padding: 6px 10px;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    font-size: 13px;
    background: white;
    cursor: pointer;
  }

  .zone-select:focus {
    outline: none;
    border-color: #3b82f6;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }

  .save-btn.has-errors {
    background: #ef4444; /* 红色 */
    cursor: not-allowed;
    opacity: 0.8;
  }

  .save-btn.has-errors:hover {
    background: #ef4444;
  }
</style>
