<script lang="ts">
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { Layers, ChevronRight, FileArchiveIcon } from '@lucide/svelte'
  import { goto } from '$app/navigation'
  import { t } from '$lib/i18n'
  import { isMobile } from '$lib/utils/os'

  const simulatorCards = [
    {
      icon: Layers,
      labelKey: 'simulator.chainTitle',
      descKey: 'simulator.chainDesc',
      color: '#128378',
      href: '/simulator/chainSimulator',
    },
    {
      icon: FileArchiveIcon,
      labelKey: 'simulator.packTitle',
      descKey: 'simulator.packDesc',
      color: '#d9730d',
      href: '/simulator/packOpener',
    },
  ]

  let isMobileOs = $state(false)

  const availableCards = $derived(
    simulatorCards.filter(
      (card) => card.href !== '/simulator/chainSimulator' || (!isMobileOs)
    )
  )

  $effect(() => {
    let cancelled = false
    isMobile()
      .then((mobile) => {
        if (!cancelled) isMobileOs = mobile
      })
      .catch(() => {
        isMobileOs = false
      })
    return () => {
      cancelled = true
    }
  })

  $effect(() => {
    setTopbar({ title: $t('simulator.title'), onBack: () => void goto('/') })
  })
</script>

<div class="simulator-page">
  <div class="simulator-grid">
    {#each availableCards as tool}
      <button class="simulator-card" onclick={() => goto(tool.href)}>
        <div
          class="simulator-icon"
          style="background: {tool.color}15; color: {tool.color}"
        >
          <tool.icon size={28} />
        </div>
        <div class="simulator-info">
          <span class="simulator-label">{$t(tool.labelKey)}</span>
          <span class="simulator-desc">{$t(tool.descKey)}</span>
        </div>
        <span class="simulator-arrow"><ChevronRight size={18} /></span>
      </button>
    {/each}
  </div>
</div>

<style>
  .simulator-page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .simulator-page {
      padding: 24px 16px 80px;
    }
  }

  .simulator-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .simulator-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 24px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    text-align: left;
    cursor: pointer;
    transition: all 0.15s;
  }
  .simulator-card:hover {
    border-color: var(--border-color);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    transform: translateY(-2px);
  }

  .simulator-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-lg);
    flex-shrink: 0;
  }

  .simulator-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .simulator-label {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
  }
  .simulator-desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    margin-top: 4px;
    line-height: 1.4;
  }

  .simulator-arrow {
    position: absolute;
    top: 50%;
    right: 16px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }
</style>
