<script lang="ts">
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { Swords, Dice6, ChevronRight } from '@lucide/svelte'
  import { goto } from '$app/navigation'

  const toolCards = [
    {
      icon: Swords,
      label: '对战记录',
      desc: '双人对战计分器，记录每局比分与对局历史',
      color: '#e03e3e',
      href: '/tools/gameCounter',
    },
    {
      icon: Dice6,
      label: '骰子',
      desc: '掷 d20 骰子 / 掷硬币，随机数生成',
      color: '#d9730d',
      href: '/tools/dice',
    },
  ]

  $effect(() => {
    setTopbar({ title: '对战工具' })
  })
</script>

<div class="tools-page">
  <div class="tools-grid">
    {#each toolCards as tool}
      <button class="tool-card" onclick={() => goto(tool.href)}>
        <div class="tool-icon" style="background: {tool.color}15; color: {tool.color}">
          <tool.icon size={28} />
        </div>
        <div class="tool-info">
          <span class="tool-label">{tool.label}</span>
          <span class="tool-desc">{tool.desc}</span>
        </div>
        <span class="tool-arrow"><ChevronRight size={18} /></span>
      </button>
    {/each}
  </div>
</div>

<style>
  .tools-page {
    max-width: 800px;
    margin: 0 auto;
    padding: 24px 32px;
  }

  @media (max-width: 767.99px) {
    .tools-page {
      padding: 24px 16px 80px;
    }
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }

  .tool-card {
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
  .tool-card:hover {
    border-color: #d3d1cb;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    transform: translateY(-2px);
  }

  .tool-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    border-radius: var(--radius-lg);
    flex-shrink: 0;
  }

  .tool-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .tool-label {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
  }
  .tool-desc {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    margin-top: 4px;
    line-height: 1.4;
  }

  .tool-arrow {
    position: absolute;
    top: 50%;
    right: 16px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    color: var(--text-tertiary);
  }
</style>
