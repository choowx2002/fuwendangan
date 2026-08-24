<!-- src/routes/cards/+page.svelte -->
<script lang="ts">
  import CardPool from '$lib/components/cards/CardPool.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'
  import type { CardBase } from '$lib/db/types'
  import { ttsState } from '$lib/stores/tts'
  import { setTopbar, showToast } from '$lib/stores/ui-store.svelte'
  import { showTTSFeatures } from '$lib/stores/settings'
  import { multiSpawn } from '$lib/services/tts-communication-service'
  import { notifyFilterClose } from '$lib/services/filter-bridge'
  import { beforeNavigate, goto } from '$app/navigation'
  import { routeBackConfig } from '$lib/utils/route-config'
  import { confirmAction } from '$lib/utils/confirm'
  import { Send, LoaderCircle } from '@lucide/svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'

  let selectedCard = $state<CardBase | null>(null)
  let displayedCards = $state<CardBase[]>([])
  let isFilterOpen = $state(false)
  let sending = $state(false)

  $effect(() => {
    setTopbar({ title: $t('cards.title') })
  })

  // 在卡池中点击卡牌时，打开详情弹窗
  function handleCardClick(card: CardBase) {
    selectedCard = card
  }

  async function spawnMulti() {
    if (sending) return
    if (!displayedCards.length) return

    const accepted = await confirmAction(
      get(t)('cards.ttsBatchConfirm', { values: { count: displayedCards.length } }),
      {
        title: get(t)('cards.ttsBatch'),
        okLabel: get(t)('common.confirm'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (!accepted) return

    sending = true
    try {
      await multiSpawn([...displayedCards])
      showToast(
        get(t)('cards.ttsBatchSent', { values: { count: displayedCards.length } }),
        'success'
      )
    } catch (error) {
      console.error('[Cards] 批量生成失败:', error)
      showToast(get(t)('cards.ttsBatchFailed'), 'error')
    } finally {
      sending = false
    }
  }

  // onMount(() => {
  //   isMobile().then((is) => {
  //     if (!is && window.innerWidth >= 767.99) {
  //       sidebarState.isMinimized = true
  //     } else {
  //       sidebarState.isMinimized = false
  //     }
  //   })
  // })

  beforeNavigate(({ from, cancel, type, delta, to }) => {
    // 离开单卡库页时，关闭已打开的筛选独立窗口
    if (from?.url.pathname === '/cards' && to?.url.pathname !== '/cards') {
      void notifyFilterClose()
    }

    // 核心判断：只有当导航类型是浏览器后退(popstate) 且 delta 为负数时才触发
    const isBackward = delta && delta < 0

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

        // 如果有指定的返回页面（比如从 /decks/builder 回到 /decks）
        // 使用 replaceState: true，避免污染历史记录栈
        goto('/', { replaceState: true })
      }
    }
  })
</script>

<div class="page-wrapper">
  <main class="main-content">
    <CardPool
      onCardClick={handleCardClick}
      bind:displayedCards
      bind:isFilterOpen
      filterSyncEnabled
    />
  </main>

  <!-- 详情弹窗依然留在当前页面 -->
  <CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

  {#if $showTTSFeatures}
    <button
      class="fab-btn"
      onclick={spawnMulti}
      disabled={!$ttsState.sendPort || sending}
      title={!$ttsState.sendPort ? $t('tts.connectFirst') : undefined}
    >
      {#if sending}
        <span class="fab-spinner"><LoaderCircle size={20} /></span>
        <span>{$t('cards.sending')}</span>
      {:else}
        <Send size={20} />
        <span>{$t('cards.ttsBatch')}</span>
      {/if}
    </button>
  {/if}
</div>

<style>
  .fab-btn {
    position: fixed;
    right: 1rem;
    bottom: 1.25rem;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 10px 18px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-base);
    font-weight: 500;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    cursor: pointer;
  }

  .fab-btn:hover:not(:disabled) {
    background: var(--bg-hover);
  }

  .fab-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .fab-spinner {
    display: inline-flex;
    animation: fab-spin 0.9s linear infinite;
  }

  @keyframes fab-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .page-wrapper {
    display: flex;
    height: 100%;
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

  @media (max-width: 767.99px) {
    .main-content {
      padding: 5px 16px 0;
    }

    /* .page-wrapper {
      padding-bottom: 47px;
    } */
  }
</style>
