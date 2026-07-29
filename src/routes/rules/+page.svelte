<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { getDocs } from '$lib/db'
  import type { RuleBooks } from '$lib/db/types'
  import { onMount } from 'svelte'

  let docs = $state<RuleBooks[]>([])

  onMount(async () => {
    try {
      docs = await getDocs()
    } catch (error) {
      console.error(error)
    }
  })

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0

    if (isBackward) {
      cancel()
      goto('/', { replaceState: true })
    }
  })
</script>

<div class="page-container">
  <section class="section">
    <div class="section-header">
      <h2 class="section-title">文件</h2>
    </div>
    <div class="deck-list">
      {#each docs as doc}
        <!-- svelte-ignore a11y_invalid_attribute -->
        <button class="deck-item" onclick={() => goto(`/rules/${doc.name}`)}>
          <div class="deck-main">
            <span class="deck-name">{doc.name}</span>
          </div>
          <div class="deck-stats">
            <span class="stat time">{doc.updated_at}</span>
          </div>
        </button>
      {/each}
    </div>
  </section>
</div>

<style>
  .page-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .page-container {
      padding: 24px 16px 80px;
    }
  }

  .section {
    margin-bottom: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .section-title {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    margin: 0;
  }

  /* 卡组列表 */
  .deck-list {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .deck-item {
    all: unset;
    display: flex;
    box-sizing: border-box;
    width: 100%;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    text-decoration: none;
    color: inherit;
    border-bottom: 1px solid var(--border-color);
    transition: background 0.1s;
  }
  .deck-item:last-child {
    border-bottom: none;
  }
  .deck-item:hover {
    background: var(--bg-secondary);
  }

  .deck-main {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .deck-name {
    font-size: var(--text-base);
    font-weight: 500;
  }

  .deck-stats {
    display: flex;
    align-items: center;
    gap: 16px;
    font-size: var(--text-sm);
  }
  .stat {
    color: var(--text-tertiary);
  }

  @media (max-width: 767.99px) {
    .deck-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
    }
    .deck-stats {
      width: 100%;
      justify-content: flex-start;
    }
  }
</style>
