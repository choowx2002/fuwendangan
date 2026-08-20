<script lang="ts">
  import type { SortKeyItem } from '$lib/db/types'
  import { draggable, droppable, type DragDropState } from '@thisux/sveltednd'
  import { fade, fly } from 'svelte/transition'
  import { flip } from 'svelte/animate'
  import { t } from '$lib/i18n'

  // --- 数据与状态 ---
  const DEFAULT_FIELDS = [
    { value: 'card_no', label: 'card_no', labelKey: 'cards.sortCardNo' },
    { value: 'card_category', label: 'card_category', labelKey: 'cards.sortCardCategory' },
    { value: 'card_color_list', label: 'card_color_list', labelKey: 'cards.sortCardColorList' },
    { value: 'power', label: 'power', labelKey: 'cards.sortPower' },
    { value: 'energy', label: 'energy', labelKey: 'cards.sortEnergy' },
    { value: 'return_energy', label: 'return_energy', labelKey: 'cards.sortReturnEnergy' },
  ]

  interface SortModalProps {
    sortByList: SortKeyItem[]
    onChangeSubmit?: () => void
    fields?: { value: string; label: string; labelKey?: string }[]
    /** 显示内置触发按钮（默认 true；由外部触发时设 false） */
    showTrigger?: boolean
    /** 外部打开信号（如顶栏按钮）；关闭时由 onClose 复位 */
    open?: boolean
    /** 关闭回调（遮罩/关闭按钮/完成都会调用） */
    onClose?: (open: boolean) => void
  }

  let {
    sortByList = $bindable([]),
    onChangeSubmit,
    fields = DEFAULT_FIELDS,
    showTrigger = true,
    open = false,
    onClose,
  }: SortModalProps = $props()

  let isSortModalOpen = $state(false)

  $effect(() => {
    if (open) isSortModalOpen = true
  })
  let dndZoneEl = $state<HTMLElement | null>(null)

  function handleDrop(state: DragDropState<SortKeyItem>) {
    const { draggedItem, targetElement, dropPosition } = state
    const targetEl =
      targetElement instanceof Element ? targetElement.closest<HTMLElement>('.sort-row') : null
    const rest = sortByList.filter((i) => i.id !== draggedItem.id)
    let next: SortKeyItem[]
    if (targetEl && dndZoneEl) {
      const rows = Array.from(dndZoneEl.children).filter((el) => el.classList.contains('sort-row'))
      const idx = rows.indexOf(targetEl)
      const at = dropPosition === 'after' ? idx + 1 : idx
      next = [...rest.slice(0, at), draggedItem, ...rest.slice(at)]
    } else {
      next = [...rest, draggedItem]
    }
    // 重新计算 order
    sortByList = next.map((item, index) => ({
      ...item,
      order: index + 1,
    }))
  }

  function addSort() {
    // select the latest fields value after remove the value exits in sortByList
    const latestField = fields.filter((f) => !sortByList.some((item) => item.name === f.value))[0]

    sortByList = [
      ...sortByList,
      {
        id: Date.now(),
        name: latestField.value,
        isAsc: true,
        order: sortByList.length + 1,
      },
    ]
  }

  function removeSort(index: number) {
    sortByList = sortByList.filter((_, i) => i !== index)
  }

  function closeModal() {
    isSortModalOpen = false
    onClose?.(false)
    onChangeSubmit?.()
  }

  function openModal() {
    isSortModalOpen = true
  }

  // check disable those value that already in sortByList but not it self
  function checkIsDisable(field: string, currentValue: string): boolean {
    return sortByList.some((item) => item.name === field) && field !== currentValue
  }
</script>

<!-- 外部触发按钮 (带 Badge) -->
{#if showTrigger}
  <button class="button button-ghost trigger" onclick={openModal}>
    <svg
      class="trigger-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
    >
      <path d="M3 6h18M3 12h18M3 18h18" />
    </svg>
    <span>{$t('cards.sortLabel')}</span>
    {#if sortByList.length > 0}
      <span class="badge">{sortByList.length}</span>
    {/if}
  </button>
{/if}

<!-- Modal Popup -->
{#if isSortModalOpen}
  <div
    class="modal-backdrop"
    onclick={closeModal}
    onkeydown={(e) => e.key === 'Escape' && closeModal()}
    role="presentation"
    transition:fade={{ duration: 150 }}
  >
    <div
      class="modal-content"
      role="presentation"
      onclick={(e) => e.stopPropagation()}
      transition:fly={{ y: 20, duration: 200 }}
    >
      <!-- Modal Header -->
      <div class="modal-header">
        <h3>{$t('cards.sortSettings')}</h3>
        <button class="icon-btn close-btn" onclick={closeModal} aria-label={$t('common.close')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Modal Body (DnD Zone) -->
      <div class="modal-body">
        {#if sortByList.length === 0}
          <div class="empty-state">
            <p>{$t('cards.noSortRules')}</p>
            <p class="sub-text">{$t('cards.addSortHint')}</p>
          </div>
        {:else}
          <div
            class="dnd-zone"
            bind:this={dndZoneEl}
            use:droppable={{
              container: 'sort-rules',
              callbacks: { onDrop: handleDrop },
            }}
          >
            {#each sortByList as item, i (item.id)}
              <div
                class="sort-row"
                use:draggable={{ container: 'sort-rules', dragData: item }}
                use:droppable={{
                  container: 'sort-rules',
                  callbacks: { onDrop: handleDrop },
                }}
                animate:flip={{ duration: 200 }}
              >
                <!-- Drag Handle -->
                <div class="drag-handle" title={$t('cards.dragSort')}>
                  <svg viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="1.5" />
                    <circle cx="15" cy="6" r="1.5" />
                    <circle cx="9" cy="12" r="1.5" />
                    <circle cx="15" cy="12" r="1.5" />
                    <circle cx="9" cy="18" r="1.5" />
                    <circle cx="15" cy="18" r="1.5" />
                  </svg>
                </div>

                <!-- Order Number -->
                <span class="order-num">{i + 1}</span>

                <!-- Field Select -->
                <div class="select-wrapper">
                  <select bind:value={item.name}>
                    {#each fields as field}
                      <option value={field.value} disabled={checkIsDisable(field.value, item.name)}
                        >{field.labelKey ? $t(field.labelKey) : field.label}</option
                      >
                    {/each}
                  </select>
                  <svg
                    class="chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>

                <!-- Direction Select -->
                <div class="select-wrapper direction">
                  <select bind:value={item.isAsc}>
                    <option value={true}>{$t('cards.asc')}</option>
                    <option value={false}>{$t('cards.desc')}</option>
                  </select>
                  <svg
                    class="chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <path d="M6 9l6 6 6-6" />
                  </svg>
                </div>

                <!-- Remove Button -->
                <button
                  class="icon-btn remove-btn"
                  onclick={() => removeSort(i)}
                  aria-label={$t('cards.remove')}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path
                      d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"
                    />
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <!-- Modal Footer -->
      <div class="modal-footer">
        <div>
          <button class="button button-text" onclick={addSort}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              width="16"
              height="16"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            {$t('cards.addSortCondition')}
          </button>
        </div>

        <button class="button button-primary" onclick={closeModal}> {$t('cards.done')} </button>
      </div>
    </div>
  </div>
{/if}

<style>
  h3 {
    margin: 0;
  }

  .trigger {
    margin-left: auto;
  }

  .trigger-icon {
    width: 16px;
    height: 16px;
    color: var(--text-primary);
  }
  .badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    background: var(--accent-color);
    color: white;
    border-radius: 9px;
    font-size: var(--text-sm);
    font-weight: 500;
  }

  /* --- Modal 遮罩与容器 --- */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(15, 15, 15, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    backdrop-filter: blur(2px);
  }

  .modal-content {
    background: var(--bg-secondary);
    width: 100%;
    max-width: 520px;
    max-height: 80vh;
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin: 20px;
  }

  /* --- Modal 头部 --- */
  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--border-color);
  }
  .modal-header h3 {
    font-size: var(--text-lg);
    font-weight: 600;
    color: var(--text-primary);
  }

  /* --- Modal 主体 (DnD 区域) --- */
  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }

  .empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--text-secondary);
  }
  .empty-state p {
    font-size: var(--text-base);
  }
  .empty-state .sub-text {
    font-size: var(--text-sm);
    margin-top: 4px;
    opacity: 0.7;
  }

  .dnd-zone {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-height: 50px;
  }

  .sort-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    transition:
      box-shadow 0.2s,
      transform 0.2s,
      background 0.1s;
  }

  /* @thisux/sveltednd 拖拽中的样式 */
  :global(.sort-row.dragging) {
    opacity: 0.5;
  }

  .drag-handle {
    cursor: grab;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    padding: 4px;
    border-radius: 4px;
    transition: background 0.1s;
  }
  .drag-handle:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  .drag-handle:active {
    cursor: grabbing;
  }
  .drag-handle svg {
    width: 16px;
    height: 16px;
  }

  .order-num {
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
    min-width: 16px;
    text-align: center;
  }

  /* --- Notion 风格 Select --- */
  .select-wrapper {
    position: relative;
    flex: 1;
    min-width: 0;
  }
  .select-wrapper.direction {
    flex: 0.8;
  }

  select {
    width: 100%;
    appearance: none;
    background: transparent;
    border: none;
    padding: 6px 24px 6px 8px;
    font-size: var(--text-base);
    color: var(--text-primary);
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.1s;
    outline: none;
  }
  select:hover {
    background: var(--bg-secondary);
  }
  select:focus {
    background: var(--bg-secondary);
    box-shadow: 0 0 0 2px var(--accent-color);
  }

  .chevron {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    width: 14px;
    height: 14px;
    color: var(--text-primary);
    pointer-events: none;
  }

  /* --- 图标按钮 --- */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--text-primary);
    cursor: pointer;
    transition:
      background 0.1s,
      color 0.1s;
  }
  .icon-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }
  .icon-btn svg {
    width: 16px;
    height: 16px;
  }
  .remove-btn:hover {
    background: color-mix(in srgb, #e03e3e 10%, transparent);
    color: #e03e3e;
  }

  /* --- Modal 底部 --- */
  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--border-color);
    gap: 12px;
  }

  /* 滚动条美化 (Notion 风格) */
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }
  .modal-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-body::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 4px;
  }
  .modal-body::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border-radius: 50%;
    transition: background 0.15s;
  }
  .close-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }
</style>
