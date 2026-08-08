<script lang="ts">
  import { Coins, Dice6, History, ChevronLeft } from '@lucide/svelte'

  let rngMode = $state<'dice' | 'coin'>('dice')

  let coinResult = $state<'正面' | '反面' | null>(null)
  let coinFlipping = $state(false)
  let coinHistory = $state<string[]>([])

  let diceResult = $state<number | null>(null)
  let diceRolling = $state(false)
  let diceHistory = $state<number[]>([])

  function flipCoin() {
    if (coinFlipping) return
    coinFlipping = true
    coinResult = null
    setTimeout(() => {
      coinResult = Math.random() < 0.5 ? '正面' : '反面'
      coinHistory = [...coinHistory, coinResult as string]
      coinFlipping = false
    }, 600)
  }

  function rollDice() {
    if (diceRolling) return
    diceRolling = true
    diceResult = null
    setTimeout(() => {
      const value = Math.floor(Math.random() * 20) + 1
      diceResult = value
      diceHistory = [...diceHistory, value]
      diceRolling = false
    }, 500)
  }
</script>

<div class="dice-page">
  <button class="back-btn" onclick={() => window.history.back()} aria-label="返回" title="返回">
    <ChevronLeft size={18} />
  </button>

  <div class="rng-card">
    <div class="rng-icon">{#if rngMode === 'dice'}<Dice6 size={20} />{:else}<Coins size={20} />{/if}</div>
    <div class="toggle-button-group rng-toggle">
      <button
        class="toggle-btn"
        class:active={rngMode === 'dice'}
        onclick={() => (rngMode = 'dice')}
      >
        投掷 d20
      </button>
      <button
        class="toggle-btn"
        class:active={rngMode === 'coin'}
        onclick={() => (rngMode = 'coin')}
      >
        掷硬币
      </button>
    </div>
    {#if rngMode === 'dice'}
      <button class="dice" class:rolling={diceRolling} onclick={rollDice} aria-label="投掷骰子">
        <span class="dice-face">
          {#if diceRolling}
            ?
          {:else}
            {diceResult ?? '20'}
          {/if}
        </span>
      </button>
      <span class="rng-result" class:ready={diceResult !== null}>
        {diceResult !== null ? `掷出 ${diceResult}` : '点击投掷'}
      </span>
    {:else}
      <button class="coin" class:flipping={coinFlipping} onclick={flipCoin} aria-label="掷硬币">
        <span class="coin-face">
          {#if coinFlipping}
            …
          {:else}
            {coinResult ?? '?'}
          {/if}
        </span>
      </button>
      <span class="rng-result" class:ready={coinResult !== null}>
        {coinResult ?? '点击掷币'}
      </span>
    {/if}
  </div>

  <div class="history-panel">
    <div class="history-title">
      <History size={14} />
      <span>本轮记录</span>
    </div>
    <div class="rng-history">
      <div class="rng-history-col">
        <span class="rng-history-label">{rngMode === 'dice' ? '骰子' : '硬币'}</span>
        {#if rngMode === 'dice'}
          {#if diceHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each diceHistory as item, i (i)}
                <span class="chip dice-chip">{item}</span>
              {/each}
            </div>
          {/if}
        {:else}
          {#if coinHistory.length === 0}
            <span class="rng-history-empty">—</span>
          {:else}
            <div class="rng-history-chips">
              {#each coinHistory as item, i (i)}
                <span class="chip coin-chip">{item}</span>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .dice-page {
    max-width: 480px;
    margin: 0 auto;
    padding: 24px 32px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    color: var(--text-primary);
  }

  @media (max-width: 767.99px) {
    .dice-page {
      padding: 24px 16px 80px;
    }
  }

  .back-btn {
    position: fixed;
    top: calc(12px + env(safe-area-inset-top));
    left: 12px;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: all 0.15s;
  }

  .back-btn:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .rng-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 24px 16px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
  }

  .rng-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    color: var(--accent-color);
  }

  .toggle-button-group {
    display: flex;
    gap: 2px;
    border-radius: var(--radius-sm);
    background-color: var(--bg-primary);
    border: 1px solid var(--border-color);
  }

  .toggle-btn {
    padding: 4px 14px;
    min-height: 26px;
    border: none;
    border-radius: calc(var(--radius-sm) - 2px);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
    transition: all 0.2s ease;
    font-weight: 500;
  }

  .toggle-btn:hover {
    color: var(--text-primary);
    background-color: var(--bg-hover);
  }

  .toggle-btn.active {
    background-color: var(--accent-color);
    color: white;
  }

  .toggle-btn.active:hover {
    background-color: color-mix(in oklab, var(--accent-color) 85%, black);
  }

  .coin {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    border: 1px solid #d3d1cb;
    background: linear-gradient(145deg, #faf9f7, #e4e3df);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
    transition: transform 0.15s;
  }
  .coin:hover {
    transform: translateY(-2px);
  }
  .coin.flipping {
    animation: coinFlip 0.6s ease;
  }

  .coin-face {
    font-size: 18px;
    font-weight: 700;
    color: #3a5a3a;
  }

  @keyframes coinFlip {
    0% {
      transform: rotateY(0deg);
    }
    100% {
      transform: rotateY(360deg);
    }
  }

  .dice {
    width: 120px;
    height: 120px;
    border-radius: var(--radius-lg);
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
    transition: transform 0.15s;
  }
  .dice:hover {
    transform: translateY(-2px);
  }
  .dice.rolling {
    animation: diceRoll 0.5s ease;
  }

  .dice-face {
    font-size: 46px;
    font-weight: 700;
    color: var(--accent-color);
  }

  @keyframes diceRoll {
    0%,
    100% {
      transform: rotate(0deg);
    }
    25% {
      transform: rotate(20deg);
    }
    50% {
      transform: rotate(-20deg);
    }
    75% {
      transform: rotate(10deg);
    }
  }

  .rng-result {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-tertiary);
  }
  .rng-result.ready {
    color: var(--accent-color);
  }

  .history-panel {
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    background: var(--bg-secondary);
    overflow: hidden;
  }

  .history-title {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .rng-history {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    border-top: 1px solid var(--border-color);
  }

  .rng-history-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .rng-history-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-tertiary);
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .rng-history-empty {
    font-size: 13px;
    color: var(--text-tertiary);
  }

  .rng-history-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .chip {
    padding: 3px 10px;
    font-size: 13px;
    font-weight: 500;
    border-radius: 999px;
  }

  .coin-chip {
    background: color-mix(in srgb, #d9730d 15%, transparent);
    border: 1px solid color-mix(in srgb, #d9730d 35%, transparent);
    color: #d9730d;
  }

  .dice-chip {
    background: color-mix(in srgb, var(--accent-color) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent-color) 35%, transparent);
    color: var(--accent-color);
  }
</style>
