<script lang="ts">
  import type { SortKeyItem } from '$lib/db/types'
  import { dndzone } from 'svelte-dnd-action'
  import { fade, fly } from 'svelte/transition'

  // --- 数据与状态 ---
  const fields = [
    { value: 'card_no', label: '编号' },
    { value: 'card_category', label: '类型' },
    { value: 'card_color_list', label: '颜色' },
    { value: 'power', label: '战力' },
    { value: 'energy', label: '法力' },
    { value: 'return_energy', label: '符能' },
  ]

  let idCounter = 0
  // let sortByList = [
  //     { id: ++idCounter, name: "card_no", isAsc: true, order: 1 },
  // ];

  interface SortModalProps {
    sortByList: SortKeyItem[]
    onChangeSubmit: () => void
  }

  let { sortByList = $bindable([]), onChangeSubmit }: SortModalProps = $props()

  let isSortModalOpen = $state(false)

  // DnD 配置
  const flipDurationMs = 200
  const dndType = 'sort-rules'

  function handleConsider(e: CustomEvent) {
    sortByList = e.detail.items
  }

  function handleFinalize(e: CustomEvent) {
    sortByList = e.detail.items
    // 重新计算 order
    sortByList = sortByList.map((item, index) => ({
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
    onChangeSubmit()
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
<button class="trigger" onclick={openModal}>
  <svg class="trigger-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
    <path d="M3 6h18M3 12h18M3 18h18" />
  </svg>
  <span>排序</span>
  {#if sortByList.length > 0}
    <span class="badge">{sortByList.length}</span>
  {/if}
</button>

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
        <h3>排序设置</h3>
        <button class="icon-btn close-btn" onclick={closeModal} aria-label="关闭">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <!-- Modal Body (DnD Zone) -->
      <div class="modal-body">
        {#if sortByList.length === 0}
          <div class="empty-state">
            <p>暂无排序规则</p>
            <p class="sub-text">点击下方按钮添加排序条件</p>
          </div>
        {:else}
          <div
            class="dnd-zone"
            use:dndzone={{
              items: sortByList,
              flipDurationMs,
              type: dndType,
              dragDisabled: false,
              dropFromOthersDisabled: false,
            }}
            onconsider={handleConsider}
            onfinalize={handleFinalize}
          >
            {#each sortByList as item, i (item.id)}
              <div class="sort-row" class:dragging={false}>
                <!-- Drag Handle -->
                <div class="drag-handle" title="拖拽排序">
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
                        >{field.label}</option
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
                    <option value={true}>升序 (A-Z)</option>
                    <option value={false}>降序 (Z-A)</option>
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
                <button class="icon-btn remove-btn" onclick={() => removeSort(i)} aria-label="移除">
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
          <button class="btn text-btn" onclick={addSort}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            添加排序条件
          </button>
        </div>

        <button class="btn primary-btn" onclick={closeModal}> 完成 </button>
      </div>
    </div>
  </div>
{/if}

<style>
  h3 {
    margin: 0;
  }

  .trigger {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    box-shadow: 0 1px 4px 0px rgba(0, 0, 0, 0.05);
    margin-left: auto;
  }

  .trigger:hover {
    background: var(--bg-hover);
    border-color: #d3d1cb;
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
    z-index: 1000;
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

  /* svelte-dnd-action 拖拽中的样式 */
  :global(.sort-row[style*='transform']) {
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.1);
    z-index: 10;
    background: #fafafa;
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
    background: #fce8e8;
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

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border: none;
    border-radius: 4px;
    font-size: var(--text-base);
    font-weight: 500;
    cursor: pointer;
    transition: background 0.1s;
  }
  .btn svg {
    width: 16px;
    height: 16px;
  }

  .text-btn {
    background: transparent;
    color: var(--text-primary);
  }
  .text-btn:hover {
    background: var(--bg-secondary);
  }

  .primary-btn {
    background: var(--accent-color);
    color: #ffffff;
  }
  .primary-btn:hover {
    opacity: 0.9;
  }
  .primary-btn:active {
    opacity: 0.8;
  }

  /* 滚动条美化 (Notion 风格) */
  .modal-body::-webkit-scrollbar {
    width: 8px;
  }
  .modal-body::-webkit-scrollbar-track {
    background: transparent;
  }
  .modal-body::-webkit-scrollbar-thumb {
    background: #d3d1cb;
    border-radius: 4px;
  }
  .modal-body::-webkit-scrollbar-thumb:hover {
    background: #aeaca6;
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
