<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import type { CardBase } from '$lib/db/types'
  import { sidebarState, ttsState } from '$lib/stores/ui-store.svelte'
  import { multiSpawn } from '$lib/services/tts-communication-service'
  import { onMount } from 'svelte'
  import { isMobile } from '$lib/services/os-serives'
  import { beforeNavigate, goto } from '$app/navigation'
  import { routeBackConfig } from '$lib/services/route-service'

  let selectedCard = $state<CardBase | null>(null)
  let displayedCards = $state<CardBase[]>([])
  let isFilterOpen = $state(false)

  // 在卡池中点击卡牌时，打开详情弹窗
  function handleCardClick(card: CardBase) {
    selectedCard = card
  }

  function spwanMulti() {
    multiSpawn([...displayedCards])
  }

  onMount(() => {
    isMobile().then((is) => {
      if (!is && window.innerWidth >= 767.99) {
        sidebarState.isMinimized = true
      } else {
        sidebarState.isMinimized = false
      }
    })
  })

  beforeNavigate(({ from, cancel, type, delta }) => {
    // 核心判断：只有当导航类型是浏览器后退(popstate) 且 delta 为负数时才触发
    const isBackward = type === 'popstate' && delta && delta < 0

    if (isBackward && from && from.url) {
      // console.log(isBackward, $state.snapshot(isFilterOpen))
      if (isFilterOpen) {
        isFilterOpen = false
        cancel()
        return
      }
      if (!!selectedCard) {
        selectedCard = null
        cancel()
        return
      }
      const currentPath = from.url.pathname
      const config = routeBackConfig[currentPath]
      // console.log(currentPath, $state.snapshot(config))
      if (config) {
        cancel() // 拦截原有的后退

        if (config.backTo === null) {
          // 如果当前已经在 '/' 首页，或者配置的 backTo 是 null（代表正常退出）
          // 此时让浏览器继续正常的后退行为（退出你的应用/返回上一个网站）
          return
        }

        // 如果有指定的返回页面（比如从 /decks/builder 回到 /decks）
        // 使用 replaceState: true，避免污染历史记录栈
        goto(config.backTo, { replaceState: true })
      }
    }
  })
</script>

<div class="page-wrapper">
  <main class="main-content">
    <CardPool onCardClick={handleCardClick} bind:displayedCards bind:isFilterOpen />
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
