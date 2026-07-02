<script lang="ts">
  import { X } from '@lucide/svelte'
  import CacheImage from './CachedImage.svelte'
  import type { CardBase, CardPrint } from '$lib/db/types'
  import { combineCardPrints, sortCardPrints } from '$lib/cards/helpers'

  interface Props {
    card: (CardBase & { card_prints?: CardPrint[] }) | null
    isOpen: boolean
    onClose: () => void
  }

  let { card, isOpen, onClose }: Props = $props()

  let selectedVersion = $state<CardPrint[]>([])
  let selectedIndex = $state<number>(0)

  const sortedMap = $derived.by(() => {
    if (!card?.card_prints?.length) return new Map<string, CardPrint[]>()
    const sorted = sortCardPrints(card.card_prints)
    return combineCardPrints(sorted)
  })

  $effect(() => {
    const currentCardId = card?.id

    if (!currentCardId) {
      selectedVersion = []
      selectedIndex = 0
      return
    }

    // 获取默认的第一个版本
    const firstKey = sortedMap.keys().next().value
    const firstVersion = firstKey ? sortedMap.get(firstKey) : undefined

    if (firstVersion && firstVersion.length > 0) {
      // 直接赋值，不读取 selectedVersion 进行比较
      selectedVersion = firstVersion
      selectedIndex = 0
    } else {
      selectedVersion = []
      selectedIndex = 0
    }
  })

  function handlePrintSelect(ver: CardPrint[]) {
    selectedVersion = ver
    selectedIndex = 0
  }
</script>

{#if isOpen && card}
  <!-- 遮罩层 -->
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
      <button class="close-btn" onclick={onClose} aria-label="关闭">
        <X size={20} />
      </button>

      <div class="modal-body">
        <aside class="image-section">
          <div class="main-image-wrapper">
            {#if selectedVersion[selectedIndex]}
              <CacheImage
                src={selectedVersion[selectedIndex].img_cdn || ''}
                name={`${card.id}-${selectedVersion[selectedIndex]?.id || 'default'}`}
                alt={card.card_name_cn || ''}
                fit="contain"
                borderRadius="6px"
                isHover={false}
                errorImage=""
              />
            {:else}
              <div class="no-image">No Image</div>
            {/if}
          </div>

          <!-- 底部控制栏：语言切换 + 缩略图 -->
          <div class="image-controls">
            {#if selectedVersion && selectedVersion.length > 1}
              <div class="lang-switcher">
                {#each selectedVersion as v, index (v.language)}
                  <button
                    class:active={selectedIndex === index}
                    onclick={() => (selectedIndex = index)}
                  >
                    {v.language.toUpperCase()}
                  </button>
                {/each}
              </div>
            {/if}
          </div>

          {#if selectedVersion[selectedIndex]?.artist}
            <div class="artist-credit">
              画师: {selectedVersion[selectedIndex].artist}
            </div>
          {/if}

          {#if sortedMap && sortedMap.size > 0}
            <div class="prints-scroll">
              {#each Array.from(sortedMap ?? []) as [k, v], i (k)}
                <button
                  class="print-thumb {selectedVersion?.[0]?.card_no_extend === k ? 'active' : ''}"
                  onclick={() => handlePrintSelect(v)}
                  title={k}
                >
                  <CacheImage
                    src={v[0].img_cdn || ''}
                    name={`${card.id}-${v[0]?.id || 'default'}`}
                    alt={card.card_name_cn || ''}
                    fit="contain"
                    isHover={false}
                    errorImage=""
                  />
                </button>
              {/each}
            </div>
          {/if}
        </aside>

        <!-- 右侧：详细信息区域 -->
        <section class="info-section">
          <!-- 头部：标题与元数据 -->
          <header class="card-header">
            <div class="title-group">
              <h1 class="card-title">
                {card.card_name_cn}
                <span class="small-text">{card.card_name_en}</span>
              </h1>
              {#if card.sub_title_cn}
                <h2 class="card-subtitle">{card.sub_title_cn} {card.sub_title_en}</h2>
              {/if}
            </div>
            <div class="meta-tags">
              {#if card.card_no}
                <span class="meta-tag">编号: {selectedVersion[selectedIndex]?.card_no_extend}</span>
              {/if}
              {#if card.rarity_name}
                <span class="meta-tag rarity"
                  >{selectedVersion[selectedIndex]?.extend_rarity_name}</span
                >
              {/if}
            </div>
          </header>

          <!-- 核心数值 (Stats) -->
          <div class="stats-grid">
            {#if card.energy != null}
              <div class="stat-box">
                <span class="stat-label">法力</span>
                <span class="stat-value">{card.energy}</span>
              </div>
            {/if}
            {#if card.return_energy != null}
              <div class="stat-box">
                <span class="stat-label">符能</span>
                <span class="stat-value">{card.return_energy}</span>
              </div>
            {/if}
            {#if card.power != null}
              <div class="stat-box">
                <span class="stat-label">战力</span>
                <span class="stat-value">{card.power}</span>
              </div>
            {/if}
          </div>

          <!-- 标签行 (Tags) -->
          <div class="tags-row">
            {#if card.card_category}
              <span class="chip">{card.card_category}</span>
            {/if}
            {#if card.region && card.region.length > 0}
              {#each card.region as r}
                <span class="chip">{r}</span>
              {/each}
            {/if}
            {#if card.champion_tag}
              <span class="chip champion">{card.champion_tag}</span>
            {/if}
          </div>

          <!-- 效果文本 -->
          <div>
            <h3 class="section-title">效果文本</h3>

            <div class="effect-section">
              <div class="effect-text">
                {#if card.effect_cn}
                  {@html card.effect_cn}
                {:else}
                  <span class="empty-text">无效果</span>
                {/if}

                {#if card.effect_en}
                  {@html card.effect_en}
                {/if}
              </div>
            </div>
          </div>

          <!-- 关键词列表 (可选) -->
          {#if card.keyword && card.keyword.length > 0}
            <div class="keywords-section">
              <h3 class="section-title">关键词</h3>
              <div class="tags-row">
                {#each card.keyword as k}
                  <span class="chip keyword">{k}</span>
                {/each}
              </div>
            </div>
          {/if}

          <!-- 风味文本 -->
          {#if card.flavor_text_cn}
            <div class="flavor-section">
              <p class="flavor-text">{card.flavor_text_cn}</p>
              <p class="flavor-text">{card.flavor_text_en}</p>
            </div>
          {/if}
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  /* ================= Modal 容器 ================= */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    animation: fadeIn 0.2s ease;
  }

  .modal-content {
    background: var(--bg-secondary);
    width: 100%;
    max-width: 1000px;
    height: 90vh;
    max-height: 800px;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    animation: slideUp 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  }

  .close-btn {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 10;
    background: rgba(255, 255, 255, 0.9);
    border: none;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
    transition: transform 0.1s;
  }
  .close-btn:hover {
    transform: scale(1.05);
  }

  .modal-body {
    display: flex;
    flex: 1;
    overflow: hidden;
    height: 100%;
  }

  /* ================= 左侧：图片区 ================= */
  .image-section {
    width: 40%;
    max-width: 300px;
    flex-shrink: 0;
    padding: 24px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    border-right: 1px solid var(--border-color);
    overflow-y: auto;
  }

  .main-image-wrapper {
    width: 100%;
    aspect-ratio: 744 / 1040;
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    margin-bottom: 16px;
    overflow: hidden;
  }

  .image-controls {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-bottom: 8px;
  }

  .lang-switcher {
    display: flex;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 6px;
    overflow: hidden;
    width: 100px;
    align-self: center;
  }
  .lang-switcher button {
    flex: 1;
    border: none;
    background: transparent;
    padding: 6px 0;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }
  .lang-switcher button.active {
    background: var(--accent-color);
    color: white;
  }

  .prints-scroll {
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 4px;
    justify-content: center;
  }
  .print-thumb {
    width: 48px;
    border: 2px solid var(--border-color);
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
    opacity: 0.7;
  }
  .print-thumb.active {
    border-color: var(--accent-color);
    opacity: 1;
  }
  .print-thumb:hover:not(.active) {
    opacity: 1;
  }

  .artist-credit {
    font-size: 12px;
    color: var(--text-tertiary);
    padding: 16px;
    text-align: center;
  }

  /* ================= 右侧：信息区 ================= */
  .info-section {
    flex: 1;
    padding: 24px 32px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .small-text {
    font-size: var(--text-sm);
  }

  .card-header {
    border-bottom: 1px solid var(--border-color);
    padding-bottom: 16px;
  }
  .card-title {
    font-size: 28px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 4px 0;
    line-height: 1.2;
  }
  .card-subtitle {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 500;
    margin: 0;
  }
  .meta-tags {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
  }
  .meta-tag {
    font-size: 12px;
    padding: 2px 8px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    color: var(--text-secondary);
  }
  .meta-tag.rarity {
    border-color: var(--accent-color);
    color: var(--accent-color);
    font-weight: 600;
  }

  /* Stats Grid */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 12px;
  }
  .stat-box {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
  }
  .stat-label {
    font-size: 12px;
    color: var(--text-tertiary);
    text-transform: uppercase;
  }
  .stat-value {
    font-size: 24px;
    font-weight: 700;
    color: var(--text-primary);
  }

  /* Tags & Chips */
  .tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .chip {
    font-size: 13px;
    padding: 4px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    color: var(--text-primary);
  }
  .chip.champion {
    background: #fff7e6;
    border-color: #ffd591;
    color: #d48806;
    font-weight: 600;
  }
  .chip.keyword {
    background: var(--bg-secondary);
    font-style: italic;
  }

  /* Effect Text */
  .effect-section {
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px;
  }
  .section-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    margin: 0;
    letter-spacing: 0.5px;
  }
  .effect-text {
    font-size: 15px;
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
  }
  .effect-text :global(strong) {
    color: var(--text-primary);
    font-weight: 700;
  }
  /* 简单的关键词高亮模拟 */
  .effect-text :global(.keyword-highlight) {
    background: rgba(0, 0, 0, 0.05);
    padding: 0 2px;
    border-radius: 2px;
  }

  /* Flavor Text */
  .flavor-section {
    margin-top: auto;
    padding-top: 24px;
    border-top: 1px solid var(--border-color);
  }
  .flavor-text {
    font-size: 14px;
    color: var(--text-tertiary);
    font-style: italic;
    line-height: 1.5;
    margin: 0;
  }

  /* ================= 响应式适配 ================= */
  /* @media (max-width: 900px) {
    .modal-content {
      height: 95vh;
      max-height: none;
    }
    .modal-body {
      flex-direction: column;
      overflow-y: auto;
    }
    .image-section {
      width: 100%;
      flex-shrink: 0;
      border-right: none;
      border-bottom: 1px solid var(--border-color);
      padding: 16px;
      flex-direction: row;
      align-items: flex-start;
      gap: 16px;
      max-height: 300px;
    }
    .main-image-wrapper {
      width: 140px;
      aspect-ratio: 744/1040;
      margin-bottom: 0;
      flex-shrink: 0;
    }
    .image-controls {
      flex: 1;
      margin-bottom: 0;
    }
    .artist-credit {
      display: none;
    }

    .info-section {
      padding: 20px;
      overflow: visible;
    }
    .card-title {
      font-size: 24px;
    }
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  } */

  @media (max-width: 600px) {
    .image-section {
      flex-direction: column;
      align-items: center;
      max-height: none;
    }
    .main-image-wrapper {
      width: 100%;
      max-width: 240px;
    }
    .stats-grid {
      grid-template-columns: 1fr;
    }
    .stat-box {
      flex-direction: row;
      justify-content: space-between;
      padding: 10px 16px;
    }
    .stat-label {
      font-size: 14px;
    }
    .stat-value {
      font-size: 18px;
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
      opacity: 0;
      transform: translateY(40px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
</style>
