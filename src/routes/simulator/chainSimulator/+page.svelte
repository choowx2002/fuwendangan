<script lang="ts">
  import { ChevronLeft, Eye, EyeOff, Plus, X } from '@lucide/svelte'
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { t } from '$lib/i18n'
  import { searchCards, getBestPrint, printCacheName, type CardWithOwned } from '$lib/db'
  import ChainSidebar from '$lib/components/simulator/chain/ChainSidebar.svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { newChainItem, type ChainItem, isCardPayload, type ChainDragPayload } from '$lib/simulator/chain'

  const PLAYER_COLORS = ['#e5484d', '#128378', '#d9730d', '#5b5bd6']

  type ZoneKey = 'chain' | 'resolving' | 'pending' | 'discard' | 'base' | 'battlefield'

  const ZONE_KEYS: ZoneKey[] = ['chain', 'resolving', 'pending', 'discard', 'base', 'battlefield']

  let currentOwner = $state(0)
  let pool = $state<ChainItem[]>([])
  let board = $state<Record<ZoneKey, ChainItem[]>>({
    chain: [],
    resolving: [],
    pending: [],
    discard: [],
    base: [],
    battlefield: [],
  })
  let cards = $state<Record<string, CardWithOwned | null>>({})
  let collapsedZones = $state<Record<ZoneKey, boolean>>({
    chain: false,
    resolving: false,
    pending: false,
    discard: false,
    base: false,
    battlefield: false,
  })

  async function ensureCard(cardNo: string) {
    if (cards[cardNo] !== undefined) return
    try {
      const res = await searchCards({ searchText: cardNo, pageSize: 1, is_banned: false })
      cards[cardNo] = res.data[0] ?? null
    } catch (err) {
      console.error('[chain-sim] 加载卡牌失败:', cardNo, err)
      cards[cardNo] = null
    }
  }

  function addCustom(partial: Partial<ChainItem>) {
    pool.push(newChainItem({ ...partial, owner: currentOwner }))
    if (partial.customNote) void ensureCard(partial.cardNo ?? '')
  }

  // 待处理效果区的「+」：直接新建一个效果条目
  function addPendingItem() {
    const n = board.pending.length + 1
    board.pending.push(
      newChainItem({ customName: $t('simulator.newItemName', { values: { n } }), owner: currentOwner })
    )
  }

  function removeCard(zoneKey: ZoneKey, card: ChainItem) {
    board[zoneKey] = board[zoneKey].filter((c) => c.id !== card.id)
  }

  function toggleZone(zoneKey: ZoneKey) {
    collapsedZones[zoneKey] = !collapsedZones[zoneKey]
  }

  // 侧栏卡池变更：若新池中出现了原本不在池中的条目，说明是从某个区域拖回，需同步从区域移除
  function onPoolDrop(items: ChainItem[]) {
    const prevIds = new Set(pool.map((i) => i.id))
    pool = items
    const added = items.filter((i) => !prevIds.has(i.id))
    if (added.length > 0) {
      const addedIds = new Set(added.map((i) => i.id))
      for (const key of ZONE_KEYS) {
        board[key] = board[key].filter((c) => !addedIds.has(c.id))
      }
    }
    for (const i of items) if (i.cardNo) void ensureCard(i.cardNo)
  }

  // 从侧栏卡池中移除条目（拖入目标区域时调用）
  function removeFromPool(card: ChainItem) {
    pool = pool.filter((i) => i.id !== card.id)
  }

  // 计算目标区域内的插入位置：优先基于光标所在卡片元素 + dropPosition
  function getCardInsertIndex(targetZone: ZoneKey, state: DragDropState<ChainDragPayload>): number {
    const { targetElement, dropPosition } = state
    const cardEl =
      targetElement instanceof Element ? targetElement.closest<HTMLElement>('.zone-item') : null
    if (!cardEl || !cardEl.parentElement) return board[targetZone].length
    const siblings = Array.from(cardEl.parentElement.children).filter((el) =>
      el.classList.contains('zone-item')
    ) as HTMLElement[]
    const idx = siblings.indexOf(cardEl)
    if (idx === -1) return board[targetZone].length
    return dropPosition === 'after' ? idx + 1 : idx
  }

  // 区域拖放：同区排序 / 跨区移动 / 侧栏卡池或搜索结果直接拖入
  function handleZoneDrop(state: DragDropState<ChainDragPayload>) {
    const { draggedItem, targetContainer } = state
    if (!targetContainer || !ZONE_KEYS.includes(targetContainer as ZoneKey)) return
    const targetZone = targetContainer as ZoneKey
    const targetItems = board[targetZone]

    // 侧栏卡池 / 搜索结果载荷为裸 ChainItem；区域卡片载荷为 { card, columnId }
    const isPayload = isCardPayload(draggedItem)
    const card = isPayload ? draggedItem.card : draggedItem
    const sourceZone =
      isPayload && ZONE_KEYS.includes(draggedItem.columnId as ZoneKey)
        ? (draggedItem.columnId as ZoneKey)
        : null

    // 侧栏卡池 / 搜索结果直接拖入：追加到目标区域并从卡池移除
    if (!sourceZone) {
      targetItems.push(card)
      removeFromPool(card)
      if (card.cardNo) void ensureCard(card.cardNo)
      return
    }

    const dragIndex = board[sourceZone].findIndex((c) => c.id === card.id)
    if (dragIndex === -1) return

    // 在 splice 之前根据当前 DOM 计算插入点
    const at = getCardInsertIndex(targetZone, state)
    const [movedCard] = board[sourceZone].splice(dragIndex, 1)
    // 同区拖拽：移除后 DOM 索引回移一位
    const insertAt = sourceZone === targetZone && dragIndex < at ? at - 1 : at
    targetItems.splice(insertAt, 0, movedCard)

    if (card.cardNo) void ensureCard(card.cardNo)
  }

  function onItemClick(item: ChainItem) {
    if (item.cardNo) void ensureCard(item.cardNo)
  }
</script>

{#snippet cardItem(card: ChainItem, zoneKey: ZoneKey)}
  {@const cardData = card.cardNo ? cards[card.cardNo] : null}
  {@const best = cardData ? getBestPrint(cardData) : null}
  {@const ownerColor = card.owner !== null && card.owner !== undefined
    ? (PLAYER_COLORS[card.owner] ?? '')
    : ''}
  {@const playerLabel = card.owner !== null && card.owner !== undefined
    ? $t('simulator.playerLabel', { values: { n: card.owner + 1 } })
    : ''}
  {@const displayName = cardData
    ? cardData.card_name_cn || cardData.card_name_en || card.cardNo || ''
    : card.customName || card.cardNo || ''}
  <div
    class="zone-item"
    use:draggable={{ container: zoneKey, dragData: { card, columnId: zoneKey } }}
  >
    <div class="zone-card">
      {#if best?.url}
        <div class="zone-img-wrap">
          <CardSimpleImage url={best.url} name={printCacheName(best)} className="zone-img" />
        </div>
      {/if}
      <div class="zone-text">
        {#if ownerColor}
          <span class="zone-owner-chip" style="--owner-color: {ownerColor}">
            {playerLabel}
          </span>
        {/if}
        <span class="zone-name">{displayName || card.id}</span>
        {#if card.customNote}
          <span class="zone-note">{card.customNote}</span>
        {/if}
      </div>
    </div>
    <button
      type="button"
      class="zone-remove"
      title={$t('simulator.removeZone')}
      aria-label={$t('simulator.removeZone')}
      onclick={(e) => {
        e.stopPropagation()
        removeCard(zoneKey, card)
      }}
    >
      <X size={11} />
    </button>
  </div>
{/snippet}

{#snippet zoneSection(key: ZoneKey, title: string, items: ChainItem[])}
  <section class="zone">
    <header class="zone-header">
      <span class="zone-title">{title}</span>
      <span class="zone-count">{$t('simulator.itemsCount', { values: { count: items.length } })}</span>
      <div class="zone-header-right">
        {#if key === 'pending'}
          <button
            type="button"
            class="zone-add-btn"
            title={$t('simulator.addPendingItem')}
            aria-label={$t('simulator.addPendingItem')}
            onclick={addPendingItem}
          >
            <Plus size={14} />
          </button>
        {/if}
        <button
          type="button"
          class="zone-collapse-btn"
          title={$t('simulator.collapseZone')}
          aria-label={$t('simulator.collapseZone')}
          onclick={() => toggleZone(key)}
        >
          {#if collapsedZones[key]}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
        </button>
      </div>
    </header>
    {#if !collapsedZones[key]}
      <div
        class="zone-list"
        class:empty={items.length === 0}
        use:droppable={{
          container: key,
          direction: 'grid',
          callbacks: { onDrop: handleZoneDrop },
        }}
      >
        {#each items as card, idx (`${card.id}-${idx}`)}
          {@render cardItem(card, key)}
        {/each}
        {#if items.length === 0}
          <span class="zone-hint">{$t('simulator.boxDropHint')}</span>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}

<div class="chain-page">
  <header class="chain-header">
    <button
      class="header-back-btn"
      onclick={() => window.history.back()}
      aria-label={$t('common.back')}
      title={$t('common.back')}
    >
      <ChevronLeft size={18} />
    </button>
    <h1 class="chain-title">{$t('simulator.chainTitle')}</h1>
  </header>

  <div class="chain-body">
    <main class="chain-main">
      <div class="board">
        <div class="board-top">
          {@render zoneSection('chain', $t('simulator.zone.chain'), board.chain)}
          {@render zoneSection('resolving', $t('simulator.zone.resolving'), board.resolving)}
        </div>
        <div class="board-pending">
          {@render zoneSection('pending', $t('simulator.zone.pending'), board.pending)}
        </div>
        <div class="board-bottom">
          {@render zoneSection('discard', $t('simulator.zone.discard'), board.discard)}
          {@render zoneSection('base', $t('simulator.zone.base'), board.base)}
          {@render zoneSection('battlefield', $t('simulator.zone.battlefield'), board.battlefield)}
        </div>
      </div>
    </main>

    <aside class="chain-side-col">
      <ChainSidebar
        playerCount={1}
        bind:currentOwner
        bind:pool
        {cards}
        playerColors={PLAYER_COLORS}
        onAddCustom={addCustom}
        {onPoolDrop}
        {onItemClick}
      />
    </aside>
  </div>
</div>

<style>
  .chain-page {
    display: flex;
    flex-direction: column;
    height: 100%;
    padding: calc(12px + env(safe-area-inset-top)) 16px 16px;
    gap: 10px;
    overflow: hidden;
  }

  .chain-header {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .header-back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    cursor: pointer;
  }

  .header-back-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .chain-title {
    margin: 0;
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .chain-body {
    display: flex;
    gap: 14px;
    flex: 1;
    min-height: 0;
  }

  .chain-main {
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .board {
    display: flex;
    flex-direction: column;
    gap: 14px;
    height: 100%;
    min-height: 0;
  }

  .board-top {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
    gap: 14px;
    flex: 1.2;
    min-height: 0;
  }

  .board-pending {
    flex: 0.9;
    min-height: 0;
  }

  .board-bottom {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 14px;
    flex: 1.2;
    min-height: 0;
  }

  .zone {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    overflow: hidden;
  }

  .zone-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 7px 10px;
    border-bottom: 1px solid var(--border-subtle);
    flex-shrink: 0;
  }

  .zone-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .zone-count {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .zone-header-right {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .zone-add-btn,
  .zone-collapse-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 3px;
    border-radius: 6px;
  }

  .zone-add-btn:hover,
  .zone-collapse-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .zone-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, 100px);
    gap: 8px;
    padding: 10px;
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    align-content: start;
    justify-content: start;
    position: relative;
  }

  .zone-list.empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 拖拽视觉反馈：被拖动卡片半透明、悬停区域虚线框、插入位置蓝线 */
  :global(.zone-item.dragging) {
    opacity: 0.5;
  }

  :global(.zone-list.drag-over) {
    outline: 2px dashed var(--accent-color);
    outline-offset: -2px;
  }

  :global(.zone-list.drop-before::before),
  :global(.zone-list.drop-after::after),
  :global(.zone-list.drop-left::before),
  :global(.zone-list.drop-right::after) {
    content: '';
    position: absolute;
    background: var(--accent-color);
    z-index: 10;
    pointer-events: none;
  }

  :global(.zone-list.drop-before::before) {
    top: -1px;
    left: 0;
    right: 0;
    height: 2px;
  }

  :global(.zone-list.drop-after::after) {
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
  }

  :global(.zone-list.drop-left::before) {
    left: -1px;
    top: 0;
    bottom: 0;
    width: 2px;
  }

  :global(.zone-list.drop-right::after) {
    right: -1px;
    top: 0;
    bottom: 0;
    width: 2px;
  }

  .zone-item {
    position: relative;
    width: 100%;
    border-radius: 8px;
    background: transparent;
    cursor: grab;
    user-select: none;
  }

  .zone-item:active {
    cursor: grabbing;
  }

  .zone-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    min-width: 0;
  }

  .zone-img-wrap {
    width: 100%;
    aspect-ratio: 3 / 4.2;
    border-radius: 6px;
    overflow: hidden;
    border: 1px solid var(--border-subtle);
    background: var(--surface-muted);
    flex-shrink: 0;
  }

  :global(.zone-img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .zone-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    flex: 1;
  }

  .zone-owner-chip {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 2px;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 600;
    color: var(--owner-color);
    background: color-mix(in srgb, var(--owner-color) 15%, transparent);
    flex-shrink: 0;
  }

  .zone-name {
    font-size: var(--text-xs);
    color: var(--text-primary);
    line-height: 1.3;
    word-break: break-all;
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  .zone-note {
    font-size: 10px;
    color: var(--text-tertiary);
    line-height: 1.2;
    word-break: break-all;
  }

  .zone-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
    padding: 16px 0;
    pointer-events: none;
  }

  .zone-remove {
    position: absolute;
    top: 2px;
    right: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: color-mix(in srgb, #000 55%, transparent);
    color: #fff;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .zone-item:hover .zone-remove,
  .zone-remove:focus-visible {
    opacity: 1;
  }

  .chain-side-col {
    width: 260px;
    flex-shrink: 0;
    overflow-y: auto;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    padding: 12px;
  }

  @media (max-width: 767.99px) {
    .chain-page {
      padding: calc(10px + env(safe-area-inset-top)) 10px 100px;
    }

    .chain-side-col {
      width: 100%;
    }

    .chain-body {
      flex-direction: column;
      overflow-y: auto;
    }

    .board {
      height: auto;
      min-height: 500px;
      overflow: visible;
    }

    .board-top {
      grid-template-columns: 1fr;
    }

    .board-bottom {
      grid-template-columns: 1fr;
    }
  }
</style>
