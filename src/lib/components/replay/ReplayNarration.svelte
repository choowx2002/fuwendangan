<script lang="ts">
  import { t } from '$lib/i18n'
  import type { NarrationEntry } from '$lib/replay/replay-engine'

  interface Props {
    entries: NarrationEntry[]
    current: number
    collapsed?: boolean
    onToggle?: () => void
  }
  let { entries, current, collapsed = false, onToggle }: Props = $props()

  let listEl = $state<HTMLElement | null>(null)

  const visible = $derived(entries.filter((n) => n.at <= current))

  $effect(() => {
    if (listEl) listEl.scrollTop = listEl.scrollHeight
    visible.length
  })

  function fmtClock(ms: number): string {
    if (ms == null || !isFinite(ms)) return '-'
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
</script>

<div class="narration" class:collapsed>
  <div class="nh">
    <h3>{$t('replay.narrationTitle')}</h3>
    <button
      class="ntoggle"
      onclick={onToggle}
      title={$t(collapsed ? 'replay.narrationExpand' : 'replay.narrationCollapse')}
      aria-label={$t(collapsed ? 'replay.narrationExpand' : 'replay.narrationCollapse')}
    >
      {collapsed ? '▲' : '▼'}
    </button>
  </div>
  {#if !collapsed}
    <div class="nlist" bind:this={listEl}>
      {#if visible.length === 0}
        <span class="empty">{$t('replay.noNarration')}</span>
      {/if}
      {#each visible as n (n.ts + n.text)}
        {#if n.kind === 'reconnect'}
          <div class="nl reconnect"><span>{$t('replay.reconnectedMark')}</span></div>
        {:else}
          <div class="nl {n.kind === 'chat' ? 'chat' : ''}">
            <span class="nlt">{fmtClock(n.ts)}</span>{n.text}
          </div>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .narration {
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1 1 auto;
    max-height: 45vh;
  }
  .narration.collapsed {
    flex: 0 0 auto;
  }
  .nh {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  .nh h3 {
    margin: 0;
  }
  .ntoggle {
    background: var(--surface-muted);
    border: 1px solid var(--border-subtle);
    border-radius: 6px;
    color: var(--text-secondary);
    font-size: 10px;
    line-height: 1;
    padding: 3px 6px;
    cursor: pointer;
  }
  .ntoggle:hover {
    color: var(--text-primary);
  }
  h3 {
    font-size: 13px;
    color: var(--text-secondary);
  }
  .nlist {
    overflow-y: auto;
    font-size: 12px;
    line-height: 1.5;
    min-height: 0;
    flex: 1;
  }
  .empty {
    color: var(--text-tertiary);
  }
  .nl {
    margin: 2px 0;
    color: var(--text-secondary);
  }
  .nl.chat {
    color: var(--text-tertiary);
  }
  .nlt {
    color: var(--text-tertiary);
    margin-right: 6px;
    font-size: 10px;
  }
  .nl.reconnect {
    text-align: center;
    color: var(--accent-color);
    font-weight: 600;
    margin: 6px 0;
  }
</style>
