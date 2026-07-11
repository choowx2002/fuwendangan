<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import type { CardBase } from '$lib/db/types'
  import { ttsState } from '$lib/stores/ui-store.svelte'
  import { multiSpawn } from '$lib/services/tts-communication-service'

  let selectedCard = $state<CardBase | null>(null)
  let displayedCards = $state<CardBase[]>([])

  // 在卡池中点击卡牌时，打开详情弹窗
  function handleCardClick(card: CardBase) {
    selectedCard = card
  }

  function spwanMulti() {
    multiSpawn([...displayedCards])
  }
</script>

<div class="page-wrapper">
  <main class="main-content">
    <!-- 直接复用卡池组件，不传 deckCards，不显示数量 -->
    <CardPool onCardClick={handleCardClick} bind:displayedCards />
  </main>

  <!-- 详情弹窗依然留在当前页面 -->
  <CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

  {#if $ttsState.sendPort}
    <button class="fab-btn" onclick={spwanMulti}>批量生成</button>
  {/if}
</div>

<style>
  .fab-btn {
    position: fixed;
    margin-bottom: 1.25rem;
    margin-right: 1rem;
    bottom: 0;
    right: 0;
    background: var(--bg-primary);
    border-radius: 99%;
    aspect-ratio: 1/1;
    font-size: var(--text-base);
    border: none;
    outline: none;
  }

  .page-wrapper {
    display: flex;
    height: calc(100vh - var(--topbar-height) - env(safe-area-inset-top));
    overflow: hidden;
  }

  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    padding: 24px;
    padding-bottom: 0;
    background: var(--bg-primary);
  }
</style>
