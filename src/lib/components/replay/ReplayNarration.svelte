<script lang="ts">
  import { t } from '$lib/i18n'
  import type { NarrationEntry } from '$lib/replay/replay-engine'

  interface Props {
    entries: NarrationEntry[]
    current: number
  }
  let { entries, current }: Props = $props()

  let listEl = $state<HTMLElement | null>(null)

  const visible = $derived(entries.filter((n) => n.at <= current))

  $effect(() => {
    if (listEl) listEl.scrollTop = listEl.scrollHeight
  })

  function fmtClock(ms: number): string {
    if (ms == null || !isFinite(ms)) return '-'
    const d = new Date(ms)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }
</script>

<div class="narration">
  <h3>{$t('replay.narrationTitle')}</h3>
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
  }
  h3 {
    margin: 0 0 8px;
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
