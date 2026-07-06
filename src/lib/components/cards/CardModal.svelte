<script lang="ts">
  import { X } from '@lucide/svelte'
  import CacheImage from './CachedImage.svelte'
  import type { CardBase, CardPrint } from '$lib/db/types'
  import { sortCardPrints, combineCardPrints } from '$lib/cards/utils/card-print-utils'
  import { renderCardEffect } from '$lib/cards/utils/card-effect-utils'
  import { showForeignCardArt } from '$lib/stores/settings'

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

  const isBattlefield = $derived.by(() => {
    return card?.card_category === '战场'
  })

  let formatedEffect = $state<string>('')

  $effect(() => {
    const effectText = card?.effect_cn
    if (effectText) {
      renderCardEffect(effectText).then((result) => {
        formatedEffect = result ?? effectText
      })
    } else {
      formatedEffect = ''
    }
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
        <div class="title-group-mobile">
          <h1 class="card-title">
            {card.card_name_cn}
            <span class="small-text">{card.card_name_en}</span>
          </h1>
          {#if card.sub_title_cn}
            <h2 class="card-subtitle">{card.sub_title_cn} {card.sub_title_en}</h2>
          {/if}
        </div>
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
          {#if $showForeignCardArt}
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
          {/if}

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
                <span class="chip">编号: {selectedVersion[selectedIndex]?.card_no_extend}</span>
              {/if}
              {#if card.rarity_name}
                <span class="chip rarity"
                  >{card.rarity_name}（{selectedVersion[selectedIndex]?.extend_rarity_name}）</span
                >
              {/if}
              {#if card.card_color_list && card.card_color_list.length > 0}
                {#each card.card_color_list as t (t)}
                  {#if t !== 'colorless'}
                    <div class="chip">
                      <img src={`/runes/${t}.svg`} alt={t} width="16" />
                    </div>
                  {/if}
                {/each}
              {/if}
              {#if card.card_category}
                <span class="chip">{card.card_category}</span>
              {/if}

              {#if card.champion_tag}
                <span class="chip">{card.champion_tag}</span>
              {/if}

              {#if card.region && card.region.length > 0}
                {#each card.region as r (r)}
                  <span class="chip">{r}</span>
                {/each}
              {/if}

              {#if card.tag && card.tag.length > 0}
                {#each card.tag as t (t)}
                  <span class="chip">{t}</span>
                {/each}
              {/if}
            </div>
          </header>

          <!-- 核心数值 (Stats) -->
          {#if !['传奇', '战场', '符文'].includes(card?.card_category ?? '')}
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
              {#if card.power != null && !card?.card_category?.includes('法术')}
                <div class="stat-box">
                  <span class="stat-label">战力</span>
                  <span class="stat-value">{card.power}</span>
                </div>
              {/if}
            </div>
          {/if}

          <!-- 效果文本 -->
          <div class="effect-section">
            <div class="effect-text">
              {#if formatedEffect}
                {@html formatedEffect}
              {:else if card.effect_cn}
                {@html card.effect_cn}
              {:else}
                <span class="empty-text">无效果</span>
              {/if}
              <br />
              {#if card.effect_en?.trim()}
                {@html card.effect_en?.trim()}
              {/if}
            </div>
          </div>

          <!-- 标签行 (Tags) -->
          <div>
            {#if card.keyword && card.keyword.length > 0}
              <div class="tags-row" style="margin-bottom: 5px;">
                <span class="card-subtitle" style="padding: 4px 0px;">关键词：</span>
                {#each card.keyword as k (k)}
                  <span class="chip">{k}</span>
                {/each}
              </div>
            {/if}

            {#if card.advanced_tag && card.advanced_tag.length > 0}
              <div class="tags-row">
                <span class="card-subtitle" style="padding: 4px 0px;">高级标签：</span>
                {#each card.advanced_tag as t (t)}
                  <span class="chip">{t}</span>
                {/each}
              </div>
            {/if}
          </div>

          <!-- 风味文本 -->
          {#if card.flavor_text_cn}
            <div class="flavor-section">
              <p class="flavor-text">{card.flavor_text_cn}</p>
              <p class="flavor-text">{card.flavor_text_en}</p>
            </div>
          {/if}
        </section>

        {#if card.is_banned}
          <section class="isBanned">
            <h1>禁用中</h1>
          </section>
        {/if}
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
    background: var(--bg-primary);
    width: 100%;
    max-width: 1000px;
    height: max-content;
    max-height: 90vh;
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
    padding: 24px;
  }

  /* ================= 左侧：图片区 ================= */
  .image-section {
    width: 40vw;
    padding-right: 24px;
    max-width: 300px;
    flex-shrink: 0;
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
    border-radius: 8px;
    filter: drop-shadow(0 4px 12px rgba(0, 0, 0, 0.1));
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
    background: var(--bg-secondary);
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
    font-size: var(--text-sm);
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
    border-radius: var(--radius-md);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: all 0.15s;
    padding: 0;
    opacity: 0.7;
    border: none;
    overflow: hidden;
  }
  .print-thumb.active {
    opacity: 1;
  }
  .print-thumb:hover:not(.active) {
    opacity: 1;
  }

  .artist-credit {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    padding: 16px;
    text-align: center;
  }

  /* ================= 右侧：信息区 ================= */
  .info-section {
    flex: 1;
    padding-left: 24px;
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
    font-size: var(--text-3xl);
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 4px 0;
    line-height: 1.2;
  }
  .card-subtitle {
    font-size: var(--text-sm);
    color: var(--text-primary);
    font-weight: 500;
    margin: 0;
  }
  .meta-tags {
    display: flex;
    gap: 8px;
    margin-top: 12px;
    flex-wrap: wrap;
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
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    text-transform: uppercase;
  }
  .stat-value {
    font-size: var(--text-2xl);
    font-weight: 700;
    color: var(--text-primary);
  }

  /* Tags & Chips */
  .tags-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .chip {
    font-size: var(--text-sm);
    padding: 4px 10px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 99px;
    color: var(--text-primary);
    display: flex;
    justify-content: center;
    align-items: center;
  }

  /* Effect Text */
  .effect-section {
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    padding: 16px;
  }
  .effect-text {
    font-size: var(--text-md);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
  }

  .effect-text :global(p) {
    margin: 0;
  }

  .effect-text :global(strong) {
    color: var(--text-primary);
    font-weight: 700;
  }

  .effect-text :global(.keyword-highlight) {
    background: var(--accent-color);
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
    font-size: var(--text-base);
    color: var(--text-secondary);
    font-style: italic;
    line-height: 1.5;
    margin: 0;
  }

  .title-group-mobile {
    display: none;
  }

  .isBanned {
    position: absolute;
    right: 0;
    left: 0;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    padding: 24px;
    opacity: 0.5;
    pointer-events: none;
    user-select: none;
  }

  .isBanned h1 {
    margin: 0;
    color: rgb(214, 21, 21);
  }
  /* ================= 响应式适配 ================= */
  @media (max-width: 600.99px) {
    .modal-content {
      height: 95vh;
      max-height: none;
    }

    .modal-body {
      flex-direction: column;
      overflow-y: auto;
    }

    .title-group-mobile {
      display: block;
      border-bottom: 1px solid var(--border-color);
      padding-bottom: 16px;
    }

    .card-header {
      border-bottom: none;
      padding-bottom: 0;
    }

    .image-section {
      width: 100%;
      flex-shrink: 0;
      border-right: none;
      border-bottom: 1px solid var(--border-color);
      padding: 16px;
      gap: 16px;
      max-width: none;
    }
    .main-image-wrapper {
      width: 100%;
      max-width: 300px;
      overflow-y: hidden;
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
      overflow: visible;
      padding: 0;
    }
    .card-title {
      font-size: var(--text-2xl);
    }
    .stats-grid {
      grid-template-columns: repeat(3, 1fr);
    }

    .title-group {
      display: none;
    }

    .isBanned {
      justify-content: center;
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

  ::-webkit-scrollbar {
    display: none;
  }
</style>
