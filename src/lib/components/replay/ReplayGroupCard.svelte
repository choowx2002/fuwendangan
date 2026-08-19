<script lang="ts">
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { RiftAtlasMatchRecord } from '$lib/replay/types'
  import { resolveCardMetas, resolveNameMetas, type ReplayCardMeta } from '$lib/replay/card-meta'
  import { baseCardCode } from '$lib/replay/card-meta'
  import { normalizeSignedSuffix } from '$lib/decks/deck-import'
  import { getCardAndPrintByPrintCode, getCardAndPrintByEnglishName } from '$lib/db'
  import type { CardBase, CardPrint } from '$lib/db'
  import { CirclePlay, Trash2 } from '@lucide/svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'

  interface Props {
    group: RiftAtlasMatchRecord
    /** 与已绑定卡组的主牌重叠率（0-1），未绑定/无卡组数据时为 null */
    deckOverlap: number | null
    onReplay: () => void
    /** 单局删除回调（传入则显示删除按钮） */
    onDelete?: () => void
  }
  let { group, deckOverlap, onReplay, onDelete }: Props = $props()

  // 视角解耦：我方 = perspective.localPlayerId，对方 = 剩余玩家（未来可扩展 2v2/观战）
  const players = $derived(group.players ?? {})
  const selfPlayer = $derived(
    group.perspective?.localPlayerId ? (players[group.perspective.localPlayerId] ?? null) : null
  )
  const oppPlayer = $derived.by(() => {
    for (const [pid, p] of Object.entries(players)) {
      if (pid !== (group.perspective?.localPlayerId ?? null)) return p
    }
    return null
  })

  const selfLegend = $derived(selfPlayer?.legend ?? null)
  const oppLegend = $derived(oppPlayer?.legend ?? null)

  // 系列首局（展示用：传奇跨局稳定，战场取第 1 局选择）
  const firstGame = $derived((group.games ?? [])[0] ?? null)

  // 战场缩略图：优先首局战场选择，玩家池兜底
  const selfBattlefield = $derived.by(() => {
    const fromGame = selfPlayer
      ? (firstGame?.battlefieldSelections?.[selfPlayer.id]?.finalPick ?? null)
      : null
    return fromGame ?? selfPlayer?.battlefield?.finalPick ?? null
  })
  const oppBattlefield = $derived.by(() => {
    const fromGame = oppPlayer
      ? (firstGame?.battlefieldSelections?.[oppPlayer.id]?.finalPick ?? null)
      : null
    return fromGame ?? oppPlayer?.battlefield?.finalPick ?? null
  })

  // 卡图元数据渲染期直查本地库（与其他页面一致）：传奇按卡号、战场按英文名，
  // 图片文件由 CardSimpleImage 按需命中/下载；查询失败自然走占位卡背
  let metas = $state(new Map<string, ReplayCardMeta>())
  $effect(() => {
    const codes = [selfLegend?.cardCode, oppLegend?.cardCode].filter(
      (c): c is string => typeof c === 'string'
    )
    const names = [selfBattlefield, oppBattlefield].filter(
      (n): n is string => typeof n === 'string'
    )
    let active = true
    void (async () => {
      const [cm, nm] = await Promise.all([
        codes.length > 0 ? resolveCardMetas(codes) : Promise.resolve(new Map()),
        names.length > 0 ? resolveNameMetas(names) : Promise.resolve(new Map()),
      ])
      if (!active) return
      metas = new Map([...cm, ...nm])
    })()
    return () => {
      active = false
    }
  })

  const scoreText = $derived.by(() => {
    const score = group.result?.score ?? {}
    const my = selfPlayer ? (score[selfPlayer.id] ?? null) : null
    const opp = oppPlayer ? (score[oppPlayer.id] ?? null) : null
    if (my === null && opp === null) return null
    return get(t)('replay.groupScoreHint', { values: { my: my ?? '-', opp: opp ?? '-' } })
  })

  // 每局比分（未比完局 = 解析期按最后状态预填的最后分数；该局无任何比分数据 → 行显示 -）
  const perGameScores = $derived.by(() =>
    (group.games ?? []).map((g) => {
      const my = selfPlayer ? (g.score?.[selfPlayer.id] ?? null) : null
      const opp = oppPlayer ? (g.score?.[oppPlayer.id] ?? null) : null
      return { my, opp }
    })
  )

  function fmtTime(ts: number): string {
    const d = new Date(ts)
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
  }

  const durationMin = $derived(
    group.meta?.durationMs != null ? Math.max(1, Math.round(group.meta.durationMs / 60000)) : null
  )

  // 真实赛制局数（bo{n} → n；未知 1）
  const boTotal = $derived.by(() => {
    const m = /bo(\d+)/i.exec(group.meta?.format ?? '')
    return m ? parseInt(m[1], 10) : 1
  })

  // 点击缩略图 → 复用全局 CardModal 查看完整卡牌详情（含印刷版本/效果/TTS）
  let selectedCard = $state<(CardBase & { card_prints?: CardPrint[] }) | null>(null)
  const cardModalCache = new Map<string, CardBase & { card_prints?: CardPrint[] }>()

  async function openCard(key: string, kind: 'code' | 'name') {
    const cached = cardModalCache.get(key)
    if (cached) {
      selectedCard = cached
      return
    }
    let card: (CardBase & { card_prints: CardPrint[] }) | null = null
    if (kind === 'code') {
      for (const cand of [...new Set([key, normalizeSignedSuffix(key), baseCardCode(key)])]) {
        card = await getCardAndPrintByPrintCode(cand)
        if (card) break
      }
    } else {
      card = await getCardAndPrintByEnglishName(key)
      if (!card) {
        for (const cand of [...new Set([key, normalizeSignedSuffix(key), baseCardCode(key)])]) {
          card = await getCardAndPrintByPrintCode(cand)
          if (card) break
        }
      }
    }
    if (!card) return
    const full = { ...card, card_prints: card.card_prints }
    cardModalCache.set(key, full)
    selectedCard = full
  }
</script>

<div class="gcard" class:unplayable={!group.telemetry?.hasReplayableData}>
  <div class="g-title">
    <span class="room">{group.meta?.roomCode ?? group.key}</span>
    <span class="badge bo">{$t('replay.groupBo', { values: { n: boTotal } })}</span>
    {#if (group.games?.length ?? 0) > 1}
      <span class="badge games"
        >{$t('replay.seriesGames', { values: { n: group.games.length } })}</span
      >
    {/if}
    {#if group.meta?.format}
      <span class="badge queue"
        >{$t('replay.groupQueueFormat', { values: { format: group.meta.format } })}</span
      >
    {/if}
    {#if deckOverlap !== null && deckOverlap >= 0.7}
      <span class="badge match">
        {$t('replay.deckMatchScore', { values: { pct: Math.round(deckOverlap * 100) } })}
      </span>
    {/if}
  </div>
  <div class="g-cols">
    <div class="col">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="legend-card card-hit"
        onclick={() => (selfLegend ? openCard(selfLegend.cardCode, 'code') : undefined)}
      >
        <CardSimpleImage
          url={selfLegend ? (metas.get(selfLegend.cardCode)?.imgCdn ?? '') : ''}
          name={selfLegend ? (metas.get(selfLegend.cardCode)?.cacheName ?? '') : ''}
        />
      </div>
      {#if selfBattlefield}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="bf-card card-hit" onclick={() => openCard(selfBattlefield, 'name')}>
          <CardSimpleImage
            url={metas.get(selfBattlefield)?.imgCdn ?? ''}
            name={metas.get(selfBattlefield)?.cacheName ?? ''}
            isLandscape
          />
        </div>
      {/if}
      <span class="pname">{selfPlayer?.name ?? '-'}</span>
    </div>
    <div class="vs-badge">
      {#if (group.games?.length ?? 0) > 1}
        {#each perGameScores as s, i (i)}
          <span class="game-score" title={$t('replay.gameTab', { values: { n: i + 1 } })}
            >{s.my ?? '-'}:{s.opp ?? '-'}</span
          >
        {/each}
      {:else if scoreText}
        <span class="score-hint">{scoreText}</span>
      {:else}
        <span>{$t('replay.versus')}</span>
      {/if}
    </div>
    <div class="col">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="legend-card card-hit"
        onclick={() => (oppLegend ? openCard(oppLegend.cardCode, 'code') : undefined)}
      >
        <CardSimpleImage
          url={oppLegend ? (metas.get(oppLegend.cardCode)?.imgCdn ?? '') : ''}
          name={oppLegend ? (metas.get(oppLegend.cardCode)?.cacheName ?? '') : ''}
        />
      </div>
      {#if oppBattlefield}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="bf-card card-hit" onclick={() => openCard(oppBattlefield, 'name')}>
          <CardSimpleImage
            url={metas.get(oppBattlefield)?.imgCdn ?? ''}
            name={metas.get(oppBattlefield)?.cacheName ?? ''}
            isLandscape
          />
        </div>
      {/if}
      <span class="pname">{oppPlayer?.name ?? '-'}</span>
    </div>
  </div>
  <div class="g-footer">
    <div class="g-meta">
      <span>{fmtTime(group.meta?.startedAt ?? 0)}</span>
      {#if durationMin !== null}
        <span>{$t('replay.groupDuration', { values: { minutes: durationMin } })}</span>
      {/if}
    </div>
    <div class="g-action">
      {#if group.telemetry?.hasReplayableData}
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
</div>

<CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

<style>
  .gcard {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 10px 12px;
  }
  .gcard.unplayable {
    opacity: 0.65;
  }
  .g-cols {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: start;
  }
  .col {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    min-width: 0;
    flex-wrap: wrap;
    justify-content: space-around;
  }
  .vs-badge {
    font-size: var(--text-xl);
    font-weight: 700;
    color: var(--accent-color);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    height: 100%;
  }
  .pname {
    font-size: var(--text-md);
    color: var(--text-secondary);
    font-weight: 800;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 0 100%;
    text-align: center;
  }
  .g-title {
    display: flex;
    align-items: center;
    gap: 8px;
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
  .badge.games {
    background: var(--surface-subtle);
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  .badge.match {
    background: #fff3e0;
    color: #b45309;
    border: 1px solid #fcd9a8;
  }
  .legend-card {
    width: 42px;
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
  .card-hit {
    cursor: pointer;
    transition: filter 0.12s ease;
  }
  .card-hit:hover {
    filter: brightness(1.06);
  }
  .bf-card {
    width: 72px;
    aspect-ratio: 1040 / 744;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
  }
  .g-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }
  .score-hint {
    color: var(--accent-color);
  }
  .game-score {
    line-height: 1.3;
    white-space: nowrap;
  }

  .g-footer {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: end;
  }
  .g-action {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    justify-content: end;
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
    font-size: var(--text-sm);
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
    font-size: var(--text-base);
  }
  .g-btn:hover {
    filter: brightness(1.08);
  }
  .g-warn {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
</style>
