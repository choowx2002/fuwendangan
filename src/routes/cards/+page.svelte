<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import type { CardBase } from '$lib/db/types'

  let selectedCard = $state<CardBase | null>(null)

  // 在卡池中点击卡牌时，打开详情弹窗
  function handleCardClick(card: CardBase) {
    selectedCard = card
  }
</script>

<div class="page-wrapper">
  <main class="main-content">
    <!-- 直接复用卡池组件，不传 deckCards，不显示数量 -->
    <CardPool onCardClick={handleCardClick} />
  </main>

  <!-- 详情弹窗依然留在当前页面 -->
  <CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />
</div>

<style>
  .page-wrapper {
    display: flex;
    height: calc(100vh - var(--topbar-height));
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
