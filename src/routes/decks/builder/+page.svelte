<!-- src/routes/deck-builder/+page.svelte -->
<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import type { CardBase } from '$lib/db/types'
  import { beforeNavigate } from '$app/navigation'
  import { onMount } from 'svelte'
  import { GripVertical, LoaderCircle, Save, TriangleAlert } from '@lucide/svelte'

  // --- 卡组状态 ---
  let deckCards = $state<CardBase[]>([])
  let deckName = $state('未命名卡组')

  // --- 核心：未保存修改标记 (Dirty State) ---
  let isDirty = $state(false)
  let isSaving = $state(false)

  // ==========================================
  // 1. 拦截 SPA 内部路由跳转 (SvelteKit 专属)
  // ==========================================
  beforeNavigate((navigation) => {
    if (isDirty) {
      // 使用浏览器原生 confirm，如果用户点击“取消”，则阻止导航
      const confirmed = confirm('您有未保存的卡组修改，离开将丢失这些更改。确定要离开吗？')
      if (!confirmed) {
        navigation.cancel()
      }
    }
  })

  // ==========================================
  // 2. 拦截浏览器刷新 / 关闭标签页 (原生 Web API)
  // ==========================================
  onMount(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty) {
        event.preventDefault()
        // 现代浏览器会忽略自定义文本，但必须设置 returnValue 才能触发弹窗
        event.returnValue = ''
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  })

  // --- 卡组操作逻辑 ---
  function handleAddCard(card: CardBase) {
    const currentCount = deckCards.filter((c) => c.id === card.id).length

    // 简单的规则校验
    if (currentCount >= 4) {
      alert('根据《符文战场》规则，同名卡牌最多只能加入4张！')
      return
    }
    if (card.is_banned) {
      alert('该卡牌为禁卡，无法加入卡组！')
      return
    }

    deckCards = [...deckCards, card]
    isDirty = true
  }

  function handleRemoveCard(index: number) {
    deckCards = deckCards.toSpliced(index, 1)
    isDirty = true
  }

  // --- 保存逻辑 (模拟) ---
  async function handleSave() {
    isSaving = true
    try {
      // TODO: 调用你的后端 API 保存卡组
      // await saveDeckToBackend({ name: deckName, cards: deckCards })

      // 模拟网络请求延迟
      await new Promise((resolve) => setTimeout(resolve, 800))

      // 保存成功后，重置脏数据标记
      isDirty = false
      alert('卡组保存成功！')
    } catch (error) {
      console.error('保存失败:', error)
      alert('保存失败，请重试')
    } finally {
      isSaving = false
    }
  }
</script>

<div class="deck-builder-layout">
  <!-- 左侧：卡池 -->
  <main class="card-pool-panel">
    <CardPool onCardClick={handleAddCard} {deckCards} showDeckCount={true} />
  </main>

  <!-- 中间：调整比例 -->
  <button class="grip-button">
    <GripVertical size={16} />
  </button>

  <!-- 右侧： 卡组面板-->
  <aside class="deck-panel">
    <div class="deck-header">
      <input
        type="text"
        bind:value={deckName}
        class="deck-name-input"
        oninput={() => (isDirty = true)}
        placeholder="输入卡组名称"
      />
      <button
        class="save-btn"
        onclick={handleSave}
        disabled={isSaving || !isDirty}
        class:is-dirty={isDirty}
      >
        {#if isSaving}
          <LoaderCircle class="animate-spin" size={16} />
        {:else}
          <Save size={16} />
        {/if}
        <span>保存</span>
      </button>
    </div>

    {#if isDirty}
      <div class="unsaved-warning">
        <TriangleAlert size={14} />
        <span>有未保存的修改</span>
      </div>
    {/if}

    <h2 class="deck-title">卡牌列表 ({deckCards.length})</h2>
    <ul class="deck-list">
      {#each deckCards as card, i (card.id + '-' + i)}
        <li class="deck-item">
          <span class="card-name">{card.card_name_cn}</span>
          <button class="remove-btn" onclick={() => handleRemoveCard(i)}>移除</button>
        </li>
      {:else}
        <li class="empty-deck">卡组为空，请在右侧点击添加卡牌</li>
      {/each}
    </ul>
  </aside>
</div>

<style>
  .deck-builder-layout {
    margin: 0 auto;
    display: flex;
    height: 100vh;
  }

  @media (max-width: 767.99px) {
    .deck-builder-layout {
      padding: 24px 16px;
    }
  }

  .deck-panel {
    width: 320px;
    border-right: 1px solid var(--border-color, #e5e7eb);
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
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
    background: #f59e0b; /* 有未保存修改时，按钮变橙色提醒 */
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

  .deck-list {
    list-style: none;
    padding: 0;
    margin: 0;
    flex: 1;
    overflow-y: auto;
  }

  .deck-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 1rem;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .card-name {
    font-size: 14px;
  }

  .remove-btn {
    background: none;
    border: none;
    color: #ef4444;
    cursor: pointer;
    font-size: 12px;
  }

  .empty-deck {
    color: #6b7280;
    text-align: center;
    padding: 2rem 1rem;
    font-size: 14px;
  }

  .card-pool-panel {
    padding: 12px 24px;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .grip-button {
    border: none;
    border-inline: 1px solid var(--border-color, #e5e7eb);
    cursor: col-resize;
    padding: 1px;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  .grip-button:hover {
    color: var(--text-secondary);
    background-color: var(--bg-hover);
  }

  .grip-button:active {
    color: var(--text-primary);
    background-color: var(--bg-active);
  }
</style>
