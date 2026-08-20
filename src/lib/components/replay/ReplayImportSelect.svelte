<script lang="ts">
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { RiftAtlasMatchRecord } from '$lib/replay/types'
  import { resolveCardMetas, type ReplayCardMeta } from '$lib/replay/card-meta'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import { Check, CheckSquare, Square, X, Download } from '@lucide/svelte'

  interface Props {
    groups: RiftAtlasMatchRecord[]
    selectedKeys: Set<string>
    importing: boolean
    onToggle: (key: string) => void
    onToggleAll: () => void
    onImport: () => void
    onCancel: () => void
  }
  let { groups, selectedKeys, importing, onToggle, onToggleAll, onImport, onCancel }: Props =
    $props()

  // 全部传奇卡号（自/彼各取 legend.cardCode）→ 渲染期直查本地库
  let metas = $state(new Map<string, ReplayCardMeta>())
  $effect(() => {
    const codes: string[] = []
    for (const g of groups) {
      const { self, opp } = playerFor(g)
      for (const p of [self, opp]) {
        if (p?.legend?.cardCode) codes.push(p.legend.cardCode)
      }
    }
    let active = true
    void (async () => {
      const map = await resolveCardMetas([...new Set(codes)])
      if (active) metas = map
    })()
    return () => {
      active = false
    }
  })

  function playerFor(g: RiftAtlasMatchRecord) {
    const list = Object.values(g.players ?? {})
    if (g.perspective?.isSpectator) {
      // 观战：无「我方」，按玩家池顺序铺两名玩家，信息全量展示
      return { self: list[0] ?? null, opp: list[1] ?? null }
    }
    const self = g.perspective?.localPlayerId
      ? (g.players?.[g.perspective.localPlayerId] ?? null)
      : null
    const opp = list.find((p) => p.id !== (self?.id ?? null)) ?? null
    return { self, opp }
  }

  function boTotal(g: RiftAtlasMatchRecord): number {
    const m = /bo(\d+)/i.exec(g.meta?.format ?? '')
    return m ? parseInt(m[1], 10) : 1
  }

  function fmtTime(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const allSelected = $derived(groups.length > 0 && groups.every((g) => selectedKeys.has(g.key)))
</script>

<div class="import-select">
  <div class="toolbar">
    <button class="tool-btn" onclick={onToggleAll} disabled={importing}>
      {#if allSelected}
        <CheckSquare size={14} />
      {:else}
        <Square size={14} />
      {/if}
      <span>{allSelected ? $t('replay.deselectAll') : $t('replay.selectAll')}</span>
    </button>
    <span class="tool-count"
      >{$t('replay.selectedCount', { values: { count: selectedKeys.size } })}</span
    >
  </div>

  <div class="group-list">
    {#each groups as g (g.key)}
      {@const { self, opp } = playerFor(g)}
      <div
        class="grow"
        class:selected={selectedKeys.has(g.key)}
        role="button"
        tabindex="0"
        onclick={() => onToggle(g.key)}
        onkeydown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onToggle(g.key)
          }
        }}
      >
        <button
          class="g-check"
          class:checked={selectedKeys.has(g.key)}
          onclick={(e) => {
            e.stopPropagation()
            onToggle(g.key)
          }}
        >
          {#if selectedKeys.has(g.key)}<Check size={14} />{/if}
        </button>
        <div class="g-main">
          <div class="g-head">
            <span class="room">{g.meta?.roomCode ?? g.key}</span>
            <span class="badge bo">{$t('replay.groupBo', { values: { n: boTotal(g) } })}</span>
            {#if (g.games?.length ?? 0) > 1}
              <span class="badge games"
                >{$t('replay.seriesGames', { values: { n: g.games.length } })}</span
              >
            {/if}
            {#if g.meta?.format}
              <span class="badge queue"
                >{$t('replay.groupQueueFormat', { values: { format: g.meta.format } })}</span
              >
            {/if}
            {#if g.meta?.source}
              <span class="badge source"
                >{$t('replay.sourceWebsite', { values: { source: g.meta.source } })}</span
              >
            {/if}
            {#if g.perspective?.isSpectator}
              <span class="badge spectator">{$t('replay.spectatorView')}</span>
            {/if}
          </div>
          <div class="g-cols">
            <div class="col">
              {#if self?.legend?.cardCode}
                <div class="mini-card">
                  <CardSimpleImage
                    url={metas.get(self.legend.cardCode)?.imgCdn ?? ''}
                    name={metas.get(self.legend.cardCode)?.cacheName ?? ''}
                  />
                </div>
              {/if}
              <span class="pname">{self?.name ?? '-'}</span>
            </div>
            <div class="vs">
              {#if (g.games?.length ?? 0) > 1}
                {#each g.games as game, i (i)}
                  <span class="game-score" title={$t('replay.gameTab', { values: { n: i + 1 } })}>
                    {#if game.score}
                      {#if self}
                        {game.score[self.id] ?? '-'}
                      {/if}:{#if opp}{game.score[opp.id] ?? '-'}{/if}
                    {:else}
                      -:-
                    {/if}
                  </span>
                {/each}
              {:else if g.result?.score}
                <span class="score-hint">
                  {#if self}{g.result.score[self.id] ?? '-'}{/if}:{#if opp}{g.result.score[
                      opp.id
                    ] ?? '-'}{/if}
                </span>
              {:else}
                <span>{$t('replay.versus')}</span>
              {/if}
            </div>
            <div class="col">
              {#if opp?.legend?.cardCode}
                <div class="mini-card">
                  <CardSimpleImage
                    url={metas.get(opp.legend.cardCode)?.imgCdn ?? ''}
                    name={metas.get(opp.legend.cardCode)?.cacheName ?? ''}
                  />
                </div>
              {/if}
              <span class="pname">{opp?.name ?? '-'}</span>
            </div>
          </div>
          <div class="g-meta">
            <span>{fmtTime(g.meta?.startedAt ?? 0)}</span>
            {#if !g.telemetry?.hasReplayableData}
              <span class="warn">{$t('replay.groupNotReplayable')}</span>
            {/if}
          </div>
        </div>
      </div>
    {/each}
  </div>

  <div class="footer-actions">
    <button class="button button-ghost button-sm" onclick={onCancel} disabled={importing}>
      <X size={14} />
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary button-sm"
      onclick={onImport}
      disabled={importing || selectedKeys.size === 0}
    >
      {#if importing}
        {$t('common.loading')}
      {:else}
        <Download size={14} />
        {$t('replay.importSelected', { values: { count: selectedKeys.size } })}
      {/if}
    </button>
  </div>
</div>

<style>
  .import-select {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
  }
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tool-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 4px 10px;
    cursor: pointer;
    font-size: var(--text-sm);
  }
  .tool-btn:hover {
    color: var(--text-primary);
  }
  .tool-count {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    overflow-y: auto;
    max-height: min(52vh, 420px);
    padding-right: 2px;
  }
  .grow {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px;
    cursor: pointer;
    transition:
      border-color 0.12s ease,
      box-shadow 0.12s ease;
  }
  .grow:hover {
    border-color: var(--accent-color);
  }
  .grow.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 1px var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 6%, var(--surface));
  }
  .g-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    flex: none;
    margin-top: 2px;
    border-radius: 6px;
    border: 1.5px solid var(--border-color);
    background: var(--surface-muted);
    color: transparent;
    cursor: pointer;
    padding: 0;
  }
  .g-check.checked {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }
  .g-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .g-head {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .room {
    font-weight: 700;
    font-size: var(--text-md);
    color: var(--text-primary);
  }
  .badge {
    font-size: var(--text-xs);
    font-weight: 600;
    border-radius: 8px;
    padding: 1px 8px;
    white-space: nowrap;
  }
  .badge.bo {
    background: var(--accent-color);
    color: #fff;
  }
  .badge.games {
    background: var(--surface-subtle);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .badge.queue {
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .badge.source {
    background: #e8f3fb;
    color: #1b6bb0;
    border: 1px solid #b8d8f0;
  }
  .badge.spectator {
    background: #f5eefb;
    color: #7c3aed;
    border: 1px solid #ddd0f5;
  }
  .g-cols {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: center;
  }
  .col {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .mini-card {
    width: 34px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .mini-card :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .pname {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vs {
    font-weight: 700;
    color: var(--accent-color);
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: center;
  }
  .game-score {
    font-size: var(--text-sm);
    white-space: nowrap;
    line-height: 1.3;
  }
  .score-hint {
    font-size: var(--text-base);
  }
  .g-meta {
    display: flex;
    gap: 4px 12px;
    flex-wrap: wrap;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }
  .warn {
    color: #b45309;
  }
  .footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
