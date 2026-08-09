<script lang="ts">
  import { Lock, X } from '@lucide/svelte'
  import type { FilterOptions, ActiveFilter, FilterMode, NumberRange } from '$lib/db/types'
  import { sortOptions } from '$lib/cards/utils/options-utils'
  import NumberRangeSlider from '../ui/NumberRangeSlider.svelte'
  import { t } from '$lib/i18n'

  interface Props {
    isOpen: boolean
    filterOptions: FilterOptions | null
    activeFilters: ActiveFilter[]
    onToggle: (type: ActiveFilter['type'], value: string) => void
    onRemove: (type: ActiveFilter['type'], value: string) => void
    onClear: () => void
    onClose: () => void
    energy: NumberRange
    power: NumberRange
    return_energy: NumberRange
  }

  let {
    isOpen,
    filterOptions,
    activeFilters,
    onToggle,
    onRemove,
    onClear,
    onClose,
    energy = $bindable(),
    power = $bindable(),
    return_energy = $bindable(),
  }: Props = $props()

  const sections = $derived.by(() => {
    if (!filterOptions) return []
    const map = (type: ActiveFilter['type'], options: string[] | undefined) => ({
      type,
      title:
        type === 'card_color_list'
          ? $t('cards.filterColor')
          : type === 'card_category'
            ? $t('cards.filterCategory')
            : type === 'region'
              ? $t('cards.filterRegion')
              : type === 'tag'
                ? $t('cards.filterTag')
                : type === 'keyword'
                  ? $t('cards.filterKeyword')
                  : type === 'advanced_tag'
                    ? $t('cards.filterAdvancedTag')
                    : type === 'series'
                      ? $t('cards.filterSeries')
                      : type === 'rarity'
                        ? $t('cards.filterRarity')
                        : type,
      options: options || [],
    })

    return [
      map('card_color_list', filterOptions.colors),
      map('card_category', filterOptions.categories),
      map('series', filterOptions.series),
      map('rarity', filterOptions.rarities),
      map('region', filterOptions.regions),
      map('tag', filterOptions.tags),
      map('keyword', filterOptions.keywords),
      map('advanced_tag', filterOptions.advanced_tags),
    ].filter((s) => s.options.length > 0)
  })

  function getMode(type: string, value: string): FilterMode | null {
    return activeFilters.find((f) => f.type === type && f.value === value)?.mode || null
  }

  function handleToggle(type: string, value: string) {
    onToggle(type as any, value)
  }

  function handleRemove(e: MouseEvent, type: string, value: string) {
    e.preventDefault()
    onRemove(type as any, value)
  }

  function handleClearAll() {
    if (filterOptions) {
      energy = {
        min: filterOptions.energy_range?.min ?? 0,
        max: filterOptions.energy_range?.max ?? 12,
      }
      power = {
        min: filterOptions.power_range?.min ?? 0,
        max: filterOptions.power_range?.max ?? 12,
      }
      return_energy = {
        min: filterOptions.return_energy_range?.min ?? 0,
        max: filterOptions.return_energy_range?.max ?? 4,
      }
    }
    onClear()
  }
</script>

{#if isOpen}
  <!-- 遮罩层：点击关闭 -->
  <div class="modal-container">
    <div class="modal-inner">
      <div class="overlay" onclick={onClose} role="presentation"></div>
      <div class="modal-content" tabindex="-1" role="dialog" aria-modal="true">
        <!-- 头部 -->
        <header class="modal-header">
          <h2 style="display: flex; align-items: center; gap: 5px">
            {$t('cards.filterTitle')}
            <div
              style="display: flex; align-items: baseline; gap: 5px; font-size: var(--text-sm); color: var(--text-secondary)"
            >
              <div
                style="width: 10px; background-color: var(--accent-color); aspect-ratio: 1/1;"
              ></div>
              {$t('cards.optional')}
              <div style="width: 10px; background-color: royalblue; aspect-ratio: 1/1;"></div>
              {$t('cards.required')}
              <div style="width: 10px; background-color: #f5412a; aspect-ratio: 1/1;"></div>
              {$t('cards.excluded')}
            </div>
          </h2>
          <button class="close-btn" onclick={onClose} aria-label={$t('common.close')}>
            <X size={20} />
          </button>
        </header>

        <!-- 内容区：可滚动 -->
        <div class="modal-body">
          <section class="filter-section range-section">
            <!-- <h3 class="section-title">数值范围</h3> -->
            <div class="range-grid">
              <div class="range-item">
                <div class="range-label">
                  <span>{$t('cards.energy')}</span>
                  <!-- 🆕 直接显示对象的 min 和 max -->
                  {#if energy.min === energy.max}
                    <span class="range-value">{energy.min}</span>
                  {:else}
                    <span class="range-value">{energy.min} - {energy.max}</span>
                  {/if}
                </div>
                <!-- 🆕 直接 bind:value 传递对象 -->
                <NumberRangeSlider
                  bind:value={energy}
                  min={filterOptions?.energy_range?.min ?? 0}
                  max={filterOptions?.energy_range?.max ?? 12}
                  step={1}
                />
              </div>

              <div class="range-item">
                <div class="range-label">
                  <span>{$t('cards.runeEnergy')}</span>
                  {#if return_energy.min === return_energy.max}
                    <span class="range-value">{return_energy.min}</span>
                  {:else}
                    <span class="range-value">{return_energy.min} - {return_energy.max}</span>
                  {/if}
                </div>
                <NumberRangeSlider
                  bind:value={return_energy}
                  min={filterOptions?.return_energy_range?.min ?? 0}
                  max={filterOptions?.return_energy_range?.max ?? 4}
                  step={1}
                />
              </div>

              <div class="range-item">
                <div class="range-label">
                  <span>{$t('cards.power')}</span>
                  {#if power.min === power.max}
                    <span class="range-value">{power.min}</span>
                  {:else}
                    <span class="range-value">{power.min} - {power.max}</span>
                  {/if}
                </div>
                <NumberRangeSlider
                  bind:value={power}
                  min={filterOptions?.power_range?.min ?? 0}
                  max={filterOptions?.power_range?.max ?? 12}
                  step={1}
                />
              </div>
            </div>
          </section>

          <div class="columns-wrapper">
            {#each sections as section}
              {@const sortedList = sortOptions(section.type, section.options)}
              <section class="filter-section">
                <h3 class="section-title">{section.title}</h3>
                <div class="options-grid">
                  {#each sortedList as option}
                    {@const mode = getMode(section.type, option)}
                    <button
                      class="option-btn"
                      class:include={mode === 'include'}
                      class:require={mode === 'require'}
                      class:exclude={mode === 'exclude'}
                      onclick={() => handleToggle(section.type, option)}
                      oncontextmenu={(e) => handleRemove(e, section.type, option)}
                    >
                      {#if section.type === 'card_color_list'}
                        {#if option !== 'colorless'}
                          <img
                            class:refelctIcon={mode}
                            src={`/runes/${option}.svg`}
                            alt={option}
                            width="20"
                          />
                        {:else}
                          {$t('cards.colorColorless')}
                        {/if}
                      {:else}
                        {option}
                      {/if}

                      <!-- {#if mode === 'require'}
                        <Lock size={14} />
                      {/if}

                      {#if mode === 'exclude'}
                        <X size={14} />
                      {/if} -->
                    </button>
                  {/each}
                </div>
              </section>
            {/each}
          </div>
        </div>

        <!-- 底部操作栏 (移动端极其友好) -->
        <footer class="modal-footer">
          <div>
            <span class="count">{$t('cards.activeCount', { values: { count: activeFilters.length } })}</span>
            <button class="button button-text" onclick={handleClearAll}>{$t('common.reset')}</button>
          </div>

          <button class="button button-primary" onclick={onClose}>{$t('cards.done')}</button>
        </footer>
      </div>
    </div>
  </div>
{/if}

<style>
  .refelctIcon {
    filter: brightness(0) invert(1);
  }

  /* 遮罩层 */
  .modal-container {
    position: fixed;
    inset: 0;
    background: transparent;
    z-index: 1000;
    animation: fadeIn 0.2s ease;
  }

  .modal-inner {
    position: relative;
    width: 100%;
    height: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .overlay {
    position: absolute;
    inset: 0;
    background-color: rgba(0, 0, 0, 0.4);
    z-index: 40;
    backdrop-filter: blur(2px);
  }

  /* 弹窗主体 (桌面端居中) */
  .modal-content {
    background: var(--bg-secondary);
    border-radius: 16px;
    width: 90vw;
    max-width: 900px;
    max-height: 85vh;
    display: flex;
    position: absolute;
    z-index: 50;
    flex-direction: column;
    /*box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);*/
    animation: slideUp 0.25s cubic-bezier(0.22, 1, 0.36, 1);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .modal-header h2 {
    font-size: var(--text-lg);
    font-weight: 600;
    margin: 0;
    color: var(--text-primary);
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

  .modal-body {
    flex: 1;
    overflow-y: auto;
    column-count: 2;
    padding: 16px 20px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 20px;
    border-top: 1px solid var(--border-color);
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  .count {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  /* ================= 内部元素样式 ================= */
  .filter-section {
    break-inside: avoid;
    margin-bottom: 20px;
  }

  .section-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0 0 8px 0;
  }

  .options-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .option-btn {
    padding: 4px 10px;
    font-size: var(--text-base);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    background: var(--bg-primary);
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
    display: flex;
    align-items: center;
    gap: 5px;
    user-select: none;
  }
  .option-btn:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }

  .option-btn.include {
    background: var(--accent-color);
    color: var(--bg-primary);
    font-weight: 500;
  }
  .option-btn.require {
    background: royalblue;
    color: var(--bg-primary);
    font-weight: 500;
  }
  .option-btn.exclude {
    background: #f5412a;
    color: var(--bg-primary);
    text-decoration-line: line-through;
  }

  /* ================= 移动端适配 (底部弹出抽屉) ================= */
  @media (max-width: 479.99px) {
    .modal-container {
      padding: 0;
      align-items: flex-end;
    }

    .modal-content {
      max-width: 100%;
      width: 100%;
      height: calc(100dvh - env(safe-area-inset-top));
      max-height: 100vh;
      border-radius: 0;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
      animation: slideUpMobile 0.3s cubic-bezier(0.22, 1, 0.36, 1);
    }

    .modal-body {
      column-count: unset;
    }

    .filter-section {
      break-inside: unset;
    }
  }

  /* ================= 动画 ================= */
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
      opacity: 0;
      transform: translateY(20px) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes slideUpMobile {
    from {
      transform: translateY(100%);
    }
    to {
      transform: translateY(0);
    }
  }
  .range-section {
    margin-bottom: 24px;
    padding-bottom: 16px;
    border-bottom: 1px solid var(--border-color);
  }
  .range-grid {
    display: grid;
    gap: 20px;
  }
  .range-item {
    padding: 8px 0;
  }
  .range-label {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: 12px;
  }
  .range-value {
    font-weight: 600;
    color: var(--accent-color);
    font-variant-numeric: tabular-nums;
  }
</style>
