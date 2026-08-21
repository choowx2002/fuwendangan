<script lang="ts">
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import type { RiftAtlasGame, RiftAtlasMatchRecord } from '$lib/replay/types'
  import { resolveCardMetas, resolveNameMetas, type ReplayCardMeta } from '$lib/replay/card-meta'
  import { baseCardCode } from '$lib/replay/card-meta'
  import { normalizeSignedSuffix } from '$lib/decks/deck-import'
  import { getCardAndPrintByPrintCode, getCardAndPrintByEnglishName } from '$lib/db'
  import type { CardBase, CardPrint } from '$lib/db'
  import { CirclePlay, Trash2, Check, Info, FileLock } from '@lucide/svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import CardModal from '$lib/components/cards/CardModal.svelte'

  interface Props {
    group: RiftAtlasMatchRecord
    /** 与已绑定卡组的主牌重叠率（0-1），未绑定/无卡组数据时为 null */
    deckOverlap: number | null
    /** 该局是否已绑定本地卡组（显示 FileLock 指示） */
    isBound?: boolean
    /** 打开对局资料弹窗回调 */
    onInfo?: () => void
    onReplay: () => void
    /** 单局删除回调（传入则显示删除按钮） */
    onDelete?: () => void
    /** 多选模式：传入则显示勾选框并隐藏底部操作区 */
    selectable?: boolean
    /** 多选模式下该局是否被选中 */
    selected?: boolean
    /** 多选勾选回调 */
    onToggleSelect?: () => void
  }
  let {
    group,
    deckOverlap,
    isBound = false,
    onInfo,
    onReplay,
    onDelete,
    selectable = false,
    selected = false,
    onToggleSelect,
  }: Props = $props()

  // 视角解耦：我方 = perspective.localPlayerId，对方 = 剩余玩家（未来可扩展 2v2/观战）
  const players = $derived(group.players ?? {})
  const playerList = $derived(Object.values(players))
  const selfPlayer = $derived.by(() => {
    if (group.perspective?.isSpectator) return playerList[0] ?? null
    return group.perspective?.localPlayerId
      ? (players[group.perspective.localPlayerId] ?? null)
      : null
  })
  const oppPlayer = $derived.by(() => {
    if (group.perspective?.isSpectator) return playerList[1] ?? null
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
  // starterSide：该局先手方（实际先手 firstPlayerId 优先，缺失回退 starterChooserPlayerId；非我方/对方或未知 → null 不显示）
  const perGameScores = $derived.by(() =>
    (group.games ?? []).map((g) => {
      const my = selfPlayer ? (g.score?.[selfPlayer.id] ?? null) : null
      const opp = oppPlayer ? (g.score?.[oppPlayer.id] ?? null) : null
      return { my, opp, starterSide: starterSideOf(g) }
    })
  )

  // 系列首局先手方（传奇头像角标：bo1 即唯一一局；多局系列首局即第一局）
  const firstStarterSide = $derived(starterSideOf(firstGame))

  // 该局先手方（实际先手 firstPlayerId 优先，缺失回退先手选择者 starterChooserPlayerId；
  // 非我方/对方或未知 → null 不显示）
  function firstPlayerOf(game: RiftAtlasGame | null): string | null {
    return game?.firstPlayerId ?? game?.starterChooserPlayerId ?? null
  }

  function starterSideOf(game: RiftAtlasGame | null): 'self' | 'opp' | null {
    const starter = firstPlayerOf(game)
    if (starter == null) return null
    if (selfPlayer && starter === selfPlayer.id) return 'self'
    if (oppPlayer && starter === oppPlayer.id) return 'opp'
    return null
  }

  function starterNameOf(game: RiftAtlasGame | null): string | null {
    const id = firstPlayerOf(game)
    if (!id) return null
    return players[id]?.name ?? null
  }

  function scoreTitle(n: number, starterName: string | null): string {
    const base = get(t)('replay.gameTab', { values: { n } })
    return starterName
      ? `${base} · ${get(t)('replay.firstMoveHint', { values: { name: starterName } })}`
      : base
  }

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

<div class="gcard" class:unplayable={!group.telemetry?.hasReplayableData} class:selected>
  <div class="g-title">
    {#if onToggleSelect}
      <button
        class="g-check"
        class:checked={selected}
        onclick={onToggleSelect}
        title={$t('replay.toggleSelect')}
      >
        {#if selected}<Check size={14} />{/if}
      </button>
    {/if}
    <span class="room">{group.meta?.roomCode ?? group.key}</span>
    <span class="badge bo">{$t('replay.groupBo', { values: { n: boTotal } })}</span>
    {#if (group.games?.length ?? 0) > 1}
      <span class="badge games"
        >{$t('replay.seriesGames', { values: { n: group.games.length } })}</span
      >
    {/if}
    {#if group.perspective?.isSpectator}
      <span class="badge spectator">{$t('replay.spectatorView')}</span>
    {/if}
    <span class="g-title-actions">
      {#if isBound}
        <button class="g-info-btn bound" title={$t('replay.boundTooltip')} onclick={onInfo}>
          <FileLock size={15} />
        </button>
      {/if}
      <button class="g-info-btn" title={$t('replay.infoAction')} onclick={onInfo}>
        <Info size={15} />
      </button>
    </span>
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
      {#if selfBattlefield && boTotal === 1}
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
          {@const starterName = starterNameOf((group.games ?? [])[i])}
          <span class="game-score" title={scoreTitle(i + 1, starterName)}>
            {#if s.starterSide === 'self'}
              <span class="first-dot">{$t('replay.firstBadge')}</span>
            {:else if s.starterSide === 'opp'}
              <span class="second-dot">{$t('replay.secondBadge')}</span>
            {/if}
            {s.my ?? '-'}:{s.opp ?? '-'}
          </span>
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
      {#if oppBattlefield && boTotal === 1}
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
      {#if selectable}
        <span class="g-warn">{$t('replay.selectHint')}</span>
      {:else if group.telemetry?.hasReplayableData}
        <button class="button button-primary button-sm" onclick={onReplay}>
          <CirclePlay size={15} /> {$t('replay.replayAction')}
        </button>
      {:else}
        <span class="g-warn">{$t('replay.groupNotReplayable')}</span>
      {/if}
      {#if onDelete && !selectable}
        <button
          class="button button-text button-sm g-del"
          onclick={onDelete}
          title={$t('replay.deleteReplay')}
        >
          <Trash2 size={14} />
        </button>
      {/if}
    </div>
  </div>
</div>

<CardModal card={selectedCard} isOpen={!!selectedCard} onClose={() => (selectedCard = null)} />

<style>
  /* 与 decks 页 match-item 一致的卡片语言：surface 底 + 边框 + 左侧状态色条 */
  .gcard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 10px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-left: 4px solid var(--accent-color);
    border-radius: 12px;
    padding: 12px 14px;
    transition:
      transform 0.15s ease,
      box-shadow 0.15s ease,
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .gcard:hover {
    transform: translateY(-2px);
    border-color: var(--accent-color);
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
  }
  .gcard.unplayable {
    opacity: 0.65;
    border-left-color: var(--border-color);
  }
  .gcard.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 1px var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 6%, var(--surface));
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
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    font-size: 11px;
    font-weight: 600;
    border-radius: 999px;
    padding: 2px 8px;
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
  .badge.spectator {
    background: #f5eefb;
    color: #7c3aed;
    border: 1px solid #ddd0f5;
  }
  .g-title-actions {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .g-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    flex: none;
    border-radius: 6px;
    border: 1.5px solid var(--border-color);
    background: var(--surface-muted);
    color: transparent;
    cursor: pointer;
    padding: 0;
    transition:
      background 0.15s ease,
      border-color 0.15s ease;
  }
  .g-check:hover {
    border-color: var(--accent-color);
  }
  .g-check.checked {
    background: var(--accent-color);
    border-color: var(--accent-color);
    color: #fff;
  }
  .g-info-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    padding: 0;
    transition: all 0.15s ease;
  }
  .g-info-btn:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 8%, transparent);
  }
  .g-info-btn.bound {
    color: var(--accent-color);
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
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
  /* 中间比分：match-item-result 同款加粗数字排版 */
  .vs-badge {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    gap: 3px;
    height: 100%;
    min-width: 64px;
    font-size: var(--text-md);
    font-weight: 700;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }
  .score-hint {
    color: var(--accent-color);
  }
  .game-score {
    line-height: 1.3;
    white-space: nowrap;
  }
  .first-dot,
  .second-dot {
    display: inline-block;
    font-size: var(--text-sm);
    font-weight: 700;
    padding: 1px 5px;
    margin: 0 1px;
    border-radius: 999px;
    background: var(--surface-subtle);
    color: var(--text-secondary);
  }
  .pname {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-weight: 600;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 0 0 100%;
    text-align: center;
  }
  .legend-card {
    width: 42px;
    aspect-ratio: 744 / 1039;
    flex: none;
    border-radius: 4px;
    overflow: hidden;
    border: 1px solid var(--border-color);
    background: var(--surface-muted);
    position: relative;
  }
  .legend-card :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
  .card-hit {
    cursor: pointer;
    transition:
      filter 0.12s ease,
      transform 0.12s ease,
      box-shadow 0.12s ease;
  }
  .card-hit:hover {
    filter: brightness(1.06);
    transform: scale(1.03);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
  }
  .g-footer {
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    padding-top: 10px;
    border-top: 1px solid var(--border-subtle);
  }
  .g-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 14px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    min-width: 0;
  }
  .g-action {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
    justify-content: end;
  }
  /* 删除：全局 button-text 底子 + 危险红 hover（对齐 match-item-actions） */
  .g-del {
    padding: 4px;
    width: 28px;
    height: 28px;
    min-height: 28px;
    color: var(--text-tertiary);
  }
  .g-del:hover {
    color: #b42318;
    background: #fdecea;
  }
  .g-warn {
    font-size: var(--text-sm);
    color: var(--text-tertiary);
  }
</style>
