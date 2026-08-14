<script lang="ts">
  import { flip } from 'svelte/animate'
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { Eye, EyeOff } from '@lucide/svelte'
  import type { ChainItem, DisplayMode } from '$lib/simulator/chain'
  import type { CardWithOwned } from '$lib/db'
  import { t } from '$lib/i18n'
  import ChainItemCard from './ChainItemCard.svelte'

  let {
    zoneKey,
    title,
    items = [],
    mode = 'text',
    cards = {},
    playerColors = [],
    dragDisabled = false,
    showTitle = true,
    collapsible = true,
    ondrop = null,
    onremove = null,
    onitemclick = null,
    headerActions,
  }: {
    zoneKey: string
    title: string
    items?: ChainItem[]
    mode?: DisplayMode
    cards?: Record<string, CardWithOwned | null>
    playerColors?: string[]
    dragDisabled?: boolean
    showTitle?: boolean
    collapsible?: boolean
    ondrop?: ((key: string, state: DragDropState<ChainItem>) => void) | null
    onremove?: ((key: string, item: ChainItem) => void) | null
    onitemclick?: ((item: ChainItem) => void) | null
    headerActions?: import('svelte').Snippet
  } = $props()

  let collapsed = $state(false)

  function toggleCollapsed() {
    collapsed = !collapsed
  }

  const zoneItemAttrs = $derived(onitemclick ? { role: 'button' as const, tabindex: 0 } : {})

  function handleDrop(state: DragDropState<ChainItem>) {
    if (dragDisabled) return
    ondrop?.(zoneKey, state)
  }
</script>

<div class="chain-zone">
  {#if showTitle}
    <div class="zone-header">
      <span class="zone-title">{title}</span>
      <span class="zone-count">
        {$t('simulator.itemsCount', { values: { count: items.length } })}
      </span>
      <div class="zone-header-right">
        {#if headerActions}
          {@render headerActions()}
        {/if}
        {#if collapsible && !dragDisabled}
          <button
            type="button"
            class="collapse-btn"
            title={$t('simulator.collapseZone')}
            aria-label={$t('simulator.collapseZone')}
            onclick={toggleCollapsed}
          >
            {#if collapsed}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
          </button>
        {/if}
      </div>
    </div>
  {/if}

  {#if !collapsed}
    <div
      class="zone-list"
      class:empty={items.length === 0}
      use:droppable={{
        container: zoneKey,
        disabled: dragDisabled,
        callbacks: { onDrop: handleDrop },
      }}
    >
      {#each items as item (item.id)}
        <div
          class="zone-item"
          class:clickable={!!onitemclick}
          {...zoneItemAttrs}
          use:draggable={{ container: zoneKey, dragData: item, disabled: dragDisabled }}
          use:droppable={{
            container: zoneKey,
            direction: 'grid',
            disabled: dragDisabled,
            callbacks: { onDrop: handleDrop },
          }}
          animate:flip={{ duration: 200 }}
          onclick={() => onitemclick?.(item)}
          oncontextmenu={(e) => {
            e.preventDefault()
            onremove?.(zoneKey, item)
          }}
          onkeydown={(e) => {
            if (onitemclick && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault()
              onitemclick(item)
            }
          }}
        >
          <ChainItemCard
            {item}
            {mode}
            card={item.cardNo ? cards[item.cardNo] : null}
            ownerColor={item.owner !== null && item.owner !== undefined
              ? (playerColors[item.owner] ?? '')
              : ''}
            playerLabel={item.owner !== null && item.owner !== undefined
              ? $t('simulator.playerLabel', { values: { n: item.owner + 1 } })
              : ''}
            zoomable={!!onitemclick}
          />
        </div>
      {/each}
      {#if items.length === 0}
        <span class="zone-empty">{$t('simulator.empty')}</span>
      {/if}
    </div>
  {/if}
</div>

<style>
  .chain-zone {
    display: flex;
    flex-direction: column;
    min-width: 0;
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
    min-width: 0;
  }

  .zone-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
    white-space: nowrap;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .zone-count {
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    white-space: nowrap;
  }

  .zone-header-right {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .collapse-btn {
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

  .collapse-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  /* === 核心修改：使用 Grid 固定 100px 宽度 === */
  .zone-list {
    display: grid;
    /* 自动填充 100px 宽的列，空间不足时自动换行 */
    grid-template-columns: repeat(auto-fill, 100px);
    gap: 8px;
    padding: 10px;
    min-height: 160px;
    overflow-y: auto;
    /* 防止最后一行元素被强行拉伸 */
    justify-content: start;
    align-content: start;
  }

  .zone-list.empty {
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .zone-empty {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
    padding: 2px 0 10px;
  }

  .zone-item {
    /* 宽度由 grid cell 严格控制在 100px */
    width: 100%;
    border-radius: 8px;
    background: transparent;
    transition: background 0.15s;
    user-select: none;
  }

  .zone-item.clickable {
    cursor: pointer;
  }

  .zone-item:hover {
    background: var(--bg-hover);
  }
</style>
