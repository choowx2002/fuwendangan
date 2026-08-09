<script lang="ts">
  import { ttsState, selectedTTSColor, colorOptions } from '$lib/stores/tts'
  import { detectTTSServer } from '$lib/services/tts-communication-service'
  import { RefreshCw } from '@lucide/svelte'
  import { onMount } from 'svelte'

  const colorMap: Record<string, string> = {
    Black: 'rgb(0,0,0)',
    Red: 'rgb(218,26,24)',
    Green: 'rgb(49,179,43)',
    Purple: 'rgb(160,32,240)',
    Blue: 'rgb(30,135,255)',
  }

  function refresh() {
    detectTTSServer(true)
  }

  onMount(() => {
    refresh()
  })

  const statusText = $derived(
    $ttsState.checking ? '正在检测 TTS 连接...' : $ttsState.sendPort ? 'TTS 已连接' : 'TTS 未连接'
  )

  const errorText = $derived(
    !$ttsState.checking &&
      !$ttsState.sendPort &&
      typeof $ttsState.details === 'string' &&
      $ttsState.details.length > 0
      ? $ttsState.details
      : ''
  )
</script>

<div class="tts-panel">
  <div
    class="tts-status"
    class:connected={!$ttsState.checking && $ttsState.sendPort}
    class:checking={$ttsState.checking}
  >
    <span class="status-dot"></span>
    <span class="status-text">{statusText}</span>
    <button
      class="tts-refresh"
      aria-label="重新检测 TTS 连接"
      title="重新检测 TTS 连接"
      onclick={refresh}
      disabled={$ttsState.checking}
    >
      <span class="refresh-icon" class:spinning={$ttsState.checking}>
        <RefreshCw size={14} />
      </span>
    </button>
  </div>

  {#if errorText}
    <div class="tts-error">{errorText}</div>
  {/if}

  <div class="color-row">
    <span class="color-label">TTS 颜色</span>
    <div class="color-picker">
      <span class="color-swatch" style="background: {colorMap[$selectedTTSColor]}"></span>
      <select bind:value={$selectedTTSColor}>
        {#each colorOptions as color (color.value)}
          <option value={color.value}>{color.name}</option>
        {/each}
      </select>
    </div>
  </div>
</div>

<style>
  .tts-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .tts-status {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
  }

  .status-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-tertiary);
  }

  .tts-status.connected .status-dot {
    background: #0f7b6c;
  }

  .tts-status.checking .status-dot {
    background: var(--accent-color);
    animation: pulse 1s ease infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .status-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-primary);
  }

  .tts-refresh {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 3px;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .tts-refresh:hover:not(:disabled) {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .tts-refresh:disabled {
    cursor: not-allowed;
  }

  .spinning {
    display: inline-flex;
    animation: spin 0.9s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tts-error {
    font-size: 11px;
    line-height: 1.4;
    color: #e03e3e;
    word-break: break-all;
  }

  .color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .color-label {
    flex: 0 0 auto;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .color-picker {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 6px;
  }

  .color-swatch {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 1px solid var(--border-color);
  }

  .color-picker select {
    min-width: 0;
    padding: 4px 6px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }
</style>
