<script lang="ts">
  import { flip } from 'svelte/animate'
  import { droppable, type DragDropState } from '@thisux/sveltednd'
  import { Eye, EyeOff, Trash2 } from '@lucide/svelte'
  import type { CardInstance, ChainDragPayload, DisplayMode } from '$lib/simulator/chain'
  import type { CardWithOwned } from '$lib/db'
  import { t } from '$lib/i18n'
  import Card from './Card.svelte'

  let {
    zoneKey,
    title,
    items = [],
    mode = 'text',
    cards = {},
    playerColors = [],
    collapsible = true,
    snapToGrid = true,
    ondrop,
    onremove,
    onremovecard,
    onclear,
    onduplicate,
    onpreview,
    onrotate,
    ontagchange,
    onedit,
  }: {
    zoneKey: string
    title: string
    items?: CardInstance[]
    mode?: DisplayMode
    cards?: Record<string, CardWithOwned | null>
    playerColors?: string[]
    collapsible?: boolean
    snapToGrid?: boolean
    ondrop?: (zoneKey: string, state: DragDropState<ChainDragPayload>) => void
    onremove?: (zoneKey: string, item: CardInstance, target: 'discard' | 'banish') => void
    onremovecard?: (zoneKey: string, item: CardInstance) => void
    onclear?: (zoneKey: string) => void
    onduplicate?: (zoneKey: string, item: CardInstance) => void
    onpreview?: (item: CardInstance) => void
    onrotate?: (zoneKey: string, item: CardInstance) => void
    ontagchange?: (zoneKey: string, item: CardInstance, tags: string[]) => void
    onedit?: (zoneKey: string, item: CardInstance) => void
  } = $props()

  let collapsed = $state(false)

  function toggleCollapsed() {
    collapsed = !collapsed
  }

  function handleDrop(state: DragDropState<ChainDragPayload>) {
    ondrop?.(zoneKey, state)
  }
</script>

<div class="chain-zone">
  <div class="zone-header">
    <span class="zone-title">{title}</span>
    <span class="zone-count">{$t('simulator.itemsCount', { values: { count: items.length } })}</span
    >
    <div class="zone-header-right">
      <button
        type="button"
        class="clear-btn"
        title={$t('simulator.clearZone')}
        onclick={() => onclear?.(zoneKey)}
      >
        <Trash2 size={14} />
      </button>
      {#if collapsible}
        <button
          type="button"
          class="collapse-btn"
          title={$t('simulator.collapseZone')}
          onclick={toggleCollapsed}
        >
          {#if collapsed}<EyeOff size={14} />{:else}<Eye size={14} />{/if}
        </button>
      {/if}
    </div>
  </div>

  {#if !collapsed}
    <div
      class="zone-list"
      class:empty={items.length === 0}
      class:snap-grid={snapToGrid}
      use:droppable={{
        container: zoneKey,
        direction: 'grid',
        callbacks: { onDrop: handleDrop },
      }}
    >
      {#each items as item (item.id)}
        <div class="zone-item" animate:flip={{ duration: 200 }}>
          <Card
            {item}
            {zoneKey}
            {mode}
            card={item.cardNo ? cards[item.cardNo] : null}
            ownerColor={item.owner !== null && item.owner !== undefined
              ? (playerColors[item.owner] ?? '#888')
              : '#888'}
            playerLabel={item.owner !== null && item.owner !== undefined
              ? `玩家 ${(item.owner ?? 0) + 1}`
              : '未标记'}
            {onpreview}
            {onremovecard}
            {onremove}
            {onduplicate}
            {onrotate}
            {ontagchange}
            {onedit}
          />
        </div>
      {/each}
      {#if items.length === 0}
        <span class="zone-empty">{$t('simulator.boxDropHint')}</span>
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

  .clear-btn {
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

  .clear-btn:hover {
    color: var(--danger-color, #e5484d);
    background: var(--bg-hover);
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

  .zone-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
    gap: 8px;
    padding: 10px;
    min-height: 170px;
    overflow: visible;
    justify-content: start;
    align-content: start;
  }

  .zone-list.snap-grid {
    grid-template-columns: repeat(auto-fill, 100px);
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
    width: 100%;
    border-radius: 8px;
    background: transparent;
  }
</style>
