<script lang="ts">
  import { onMount } from 'svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { ReplayGroup } from '$lib/replay/types'
  import { CirclePlay, Trash2 } from '@lucide/svelte'
  import { resolveCardMetas, type ReplayCardMeta } from '$lib/replay/card-meta'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'

  interface Props {
    group: ReplayGroup
    /** 与已绑定卡组的主牌重叠率（0-1），未绑定/无卡组数据时为 null */
    deckOverlap: number | null
    onReplay: () => void
    /** 单局删除回调（传入则显示删除按钮） */
    onDelete?: () => void
  }
  let { group, deckOverlap, onReplay, onDelete }: Props = $props()

  // 旧库文件可能缺 selfLegend 字段
  const selfLegend = $derived(group.selfLegend ?? null)
  const oppLegend = $derived(group.opponentLegend ?? null)

  let metas = $state(new Map<string, ReplayCardMeta>())

  // 挂载即搜索双方传奇卡元数据（本地库），用 CardSimpleImage 展示卡图
  onMount(() => {
    const codes = [selfLegend?.cardCode, oppLegend?.cardCode].filter(
      (c): c is string => typeof c === 'string' && c.length > 0
    )
    if (codes.length === 0) return
    resolveCardMetas(codes).then((m) => {
      metas.clear()
      for (const [k, v] of m) metas.set(k, v)
    })
  })

  const scoreText = $derived(
    group.finalScore && (group.finalScore.my !== null || group.finalScore.opp !== null)
      ? get(t)('replay.groupScoreHint', {
          values: {
            my: group.finalScore.my ?? '-',
            opp: group.finalScore.opp ?? '-',
          },
        })
      : null
  )

  function fmtTime(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const durationMin = $derived(
    group.durationMs != null ? Math.max(1, Math.round(group.durationMs / 60000)) : null
  )
</script>

<div class="gcard" class:unplayable={!group.hasReplayableData}>
  <div class="g-main">
    <div class="g-title">
      <span class="room">{group.roomCode ?? group.key}</span>
      <span class="badge bo">{$t('replay.groupBo', { values: { n: 1 } })}</span>
      {#if group.queueFormat}
        <span class="badge queue"
          >{$t('replay.groupQueueFormat', { values: { format: group.queueFormat } })}</span
        >
      {/if}
      {#if deckOverlap !== null && deckOverlap >= 0.7}
        <span class="badge match">
          {$t('replay.deckMatchScore', { values: { pct: Math.round(deckOverlap * 100) } })}
        </span>
      {/if}
    </div>
    <div class="g-legend">
      <div class="legend-card">
        <CardSimpleImage
          url={oppLegend ? (metas.get(oppLegend.cardCode)?.imgCdn ?? '') : ''}
          name={oppLegend ? (metas.get(oppLegend.cardCode)?.cacheName ?? '') : ''}
        />
      </div>
      <div class="legend-card">
        <CardSimpleImage
          url={selfLegend ? (metas.get(selfLegend.cardCode)?.imgCdn ?? '') : ''}
          name={selfLegend ? (metas.get(selfLegend.cardCode)?.cacheName ?? '') : ''}
        />
      </div>
    </div>
    <div class="g-meta">
      <span
        >{$t('replay.vs', {
          values: { self: group.selfName ?? '-', opp: group.opponentName ?? '-' },
        })}</span
      >
      <span>{fmtTime(group.startedAt)}</span>
      {#if durationMin !== null}
        <span>{$t('replay.groupDuration', { values: { minutes: durationMin } })}</span>
      {/if}
      {#if scoreText}
        <span class="score-hint">{scoreText}</span>
      {/if}
    </div>
  </div>
  <div class="g-action">
    {#if group.hasReplayableData}
      <button class="g-btn" onclick={onReplay}
        ><CirclePlay size={15} /> {$t('replay.replayAction')}</button
      >
    {:else}
      <span class="g-warn">{$t('replay.groupNotReplayable')}</span>
    {/if}
    {#if onDelete}
      <button class="g-del" onclick={onDelete} title={$t('replay.deleteReplay')}>
        <Trash2 size={14} />
      </button>
    {/if}
  </div>
</div>

<style>
  .gcard {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px 12px;
  }
  .gcard.unplayable {
    opacity: 0.65;
  }
  .g-main {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }
  .g-title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .room {
    font-weight: 700;
    font-size: 15px;
    color: var(--text-primary);
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    border-radius: 8px;
    padding: 1px 8px;
  }
  .badge.bo {
    background: var(--accent-color);
    color: #fff;
  }
  .badge.queue {
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .badge.match {
    background: #fff3e0;
    color: #b45309;
    border: 1px solid #fcd9a8;
  }
  .g-legend {
    display: flex;
    gap: 6px;
    align-items: flex-start;
  }
  .legend-card {
    width: 34px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .legend-card :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .g-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: 12px;
    color: var(--text-secondary);
  }
  .score-hint {
    color: var(--text-tertiary);
  }
  .g-action {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }
  .g-del {
    display: inline-flex;
    align-items: center;
    background: transparent;
    color: var(--text-tertiary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 5px 8px;
    cursor: pointer;
    font-size: 12px;
  }
  .g-del:hover {
    color: #b42318;
    background: #fdecea;
    border-color: #f5b5ad;
  }
  .g-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: var(--accent-color);
    color: #fff;
    border: none;
    border-radius: var(--radius-md);
    padding: 6px 14px;
    cursor: pointer;
    font-size: 13px;
  }
  .g-btn:hover {
    filter: brightness(1.08);
  }
  .g-warn {
    font-size: 12px;
    color: var(--text-tertiary);
  }
</style>
