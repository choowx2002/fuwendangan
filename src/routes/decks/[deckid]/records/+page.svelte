<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation'
  import { page } from '$app/state'
  import {
    getDeckById,
    getDeckMatchStats,
    getMatchesByDeck,
    gameResult,
    type Deck,
    type MatchSummary,
    type MatchWithGames,
  } from '$lib/db/index.js'
  import MatchRecordModal from '$lib/components/decks/MatchRecordModal.svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { onMount } from 'svelte'
  import { BarChart3, ChevronRight, List, Plus, Swords } from '@lucide/svelte'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  let deck = $state<Deck>()
  let matches = $state<MatchWithGames[]>([])
  let stats = $state<MatchSummary | null>(null)
  let showMatchModal = $state(false)

  let activeTab = $state<'records' | 'analysis'>('records')

  let filterGroup = $state('all')
  let filterResult = $state('all')
  let searchText = $state('')

  const allGroups = $derived(
    Array.from(new Set(matches.map((m) => m.group_name).filter((g): g is string => !!g))).sort(
      (a, b) => a.localeCompare(b, 'zh')
    )
  )

  const filteredMatches = $derived.by(() => {
    let list = matches
    if (filterGroup !== 'all') {
      list = list.filter((m) => (m.group_name ?? '') === filterGroup)
    }
    if (filterResult !== 'all') {
      list = list.filter((m) => {
        const results = m.games.map((g) => gameResult(g))
        const wins = results.filter((r) => r === 'win').length
        const losses = results.filter((r) => r === 'loss').length
        const draws = results.filter((r) => r === 'draw').length
        if (filterResult === 'win') return wins > losses
        if (filterResult === 'loss') return losses > wins
        if (filterResult === 'draw') return draws > 0
        return true
      })
    }
    if (searchText.trim()) {
      const kw = searchText.trim().toLowerCase()
      list = list.filter((m) => {
        if ((m.opponent_name ?? '').toLowerCase().includes(kw)) return true
        if ((m.group_name ?? '').toLowerCase().includes(kw)) return true
        if ((m.note ?? '').toLowerCase().includes(kw)) return true
        return m.games.some(
          (g) =>
            (g.log ?? '').toLowerCase().includes(kw) ||
            (g.win_reason ?? '').toLowerCase().includes(kw)
        )
      })
    }
    return list
  })

  function matchSummaryText(match: MatchWithGames): string {
    const results = match.games.map((g) => gameResult(g))
    const wins = results.filter((r) => r === 'win').length
    const losses = results.filter((r) => r === 'loss').length
    const draws = results.filter((r) => r === 'draw').length
    if (draws > 0) return get(t)('records.summary', { values: { wins, losses, draws } })
    return `${wins} : ${losses}`
  }

  // ==================== 分析 tab：全部由 matches + stats 前端聚合 ====================

  type Outcome = 'win' | 'loss' | 'draw'

  function matchOutcome(m: MatchWithGames): Outcome {
    let wins = 0
    let losses = 0
    for (const g of m.games) {
      const r = gameResult(g)
      if (r === 'win') wins++
      else if (r === 'loss') losses++
    }
    if (wins > losses) return 'win'
    if (losses > wins) return 'loss'
    return 'draw'
  }

  const outcomes = $derived(matches.map((m) => matchOutcome(m)))

  /** A. 胜率（平局不计入分母） */
  const matchWinRate = $derived(
    stats && stats.match_wins + stats.match_losses > 0
      ? Math.round((stats.match_wins / (stats.match_wins + stats.match_losses)) * 100)
      : 0
  )
  const gameWinRate = $derived(
    stats && stats.wins + stats.losses > 0
      ? Math.round((stats.wins / (stats.wins + stats.losses)) * 100)
      : 0
  )

  /** B. 结果分布（胜/平/负 + 占比） */
  const matchDist = $derived.by(() => {
    const total = stats?.matches ?? 0
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
    return [
      { key: 'win', count: stats?.match_wins ?? 0, pct: pct(stats?.match_wins ?? 0) },
      { key: 'draw', count: stats?.match_draws ?? 0, pct: pct(stats?.match_draws ?? 0) },
      { key: 'loss', count: stats?.match_losses ?? 0, pct: pct(stats?.match_losses ?? 0) },
    ]
  })
  const gameDist = $derived.by(() => {
    const total = stats?.games ?? 0
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0)
    return [
      { key: 'win', count: stats?.wins ?? 0, pct: pct(stats?.wins ?? 0) },
      { key: 'draw', count: stats?.draws ?? 0, pct: pct(stats?.draws ?? 0) },
      { key: 'loss', count: stats?.losses ?? 0, pct: pct(stats?.losses ?? 0) },
    ]
  })

  /** C. 先手优势 */
  const firstRate = $derived(
    stats && stats.games > 0 ? Math.round((stats.first_games / stats.games) * 100) : 0
  )
  const firstWinRate = $derived(
    stats && stats.first_games > 0 ? Math.round((stats.first_wins / stats.first_games) * 100) : 0
  )
  const secondGames = $derived((stats?.games ?? 0) - (stats?.first_games ?? 0))
  const secondWinRate = $derived(
    secondGames > 0 ? Math.round(((stats?.second_wins ?? 0) / secondGames) * 100) : 0
  )
  const firstDiff = $derived(firstWinRate - secondWinRate)

  /** D. 系列比分分布（如 2:0 / 2:1 / 1:2 / 平局） */
  const scoreLines = $derived.by(() => {
    const map = new Map<string, number>()
    for (const m of matches) {
      let wins = 0
      let losses = 0
      let draws = 0
      for (const g of m.games) {
        const r = gameResult(g)
        if (r === 'win') wins++
        else if (r === 'loss') losses++
        else draws++
      }
      const key = draws > 0 && wins === losses ? 'draw' : `${wins}:${losses}`
      map.set(key, (map.get(key) ?? 0) + 1)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  })

  /** E. 对阵分析：按分组 / 按对手传奇（含先后手胜率） */
  interface MatchupRow {
    name: string
    count: number
    wins: number
    losses: number
    rate: number
    firstGames: number
    firstWins: number
    secondGames: number
    secondWins: number
    firstRate: number
    secondRate: number
  }
  function buildMatchupRows(pick: (m: MatchWithGames) => string): MatchupRow[] {
    const map = new Map<
      string,
      {
        count: number
        wins: number
        losses: number
        firstGames: number
        firstWins: number
        secondGames: number
        secondWins: number
      }
    >()
    matches.forEach((m, i) => {
      const name = pick(m) || $t('records.anaUnknown')
      const row = map.get(name) ?? {
        count: 0,
        wins: 0,
        losses: 0,
        firstGames: 0,
        firstWins: 0,
        secondGames: 0,
        secondWins: 0,
      }
      row.count++
      if (outcomes[i] === 'win') row.wins++
      else if (outcomes[i] === 'loss') row.losses++
      for (const g of m.games) {
        if (g.is_first === true) {
          row.firstGames++
          if (g.is_win) row.firstWins++
        } else if (g.is_first === false) {
          row.secondGames++
          if (g.is_win) row.secondWins++
        }
      }
      map.set(name, row)
    })
    return [...map.entries()]
      .map(([name, r]) => ({
        name,
        count: r.count,
        wins: r.wins,
        losses: r.losses,
        rate: r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0,
        firstGames: r.firstGames,
        firstWins: r.firstWins,
        secondGames: r.secondGames,
        secondWins: r.secondWins,
        firstRate: r.firstGames > 0 ? Math.round((r.firstWins / r.firstGames) * 100) : 0,
        secondRate: r.secondGames > 0 ? Math.round((r.secondWins / r.secondGames) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
  }
  const groupStats = $derived(buildMatchupRows((m) => m.group_name ?? ''))
  const legendStats = $derived(buildMatchupRows((m) => m.opp_legend_name ?? ''))

  /** F. 卡组版本趋势 */
  const versionStats = $derived.by(() => {
    const map = new Map<number | null, { count: number; wins: number; losses: number }>()
    matches.forEach((m, i) => {
      const v = m.deck_version_number
      const row = map.get(v) ?? { count: 0, wins: 0, losses: 0 }
      row.count++
      if (outcomes[i] === 'win') row.wins++
      else if (outcomes[i] === 'loss') row.losses++
      map.set(v, row)
    })
    return [...map.entries()]
      .map(([v, r]) => ({
        version: v,
        label: v === null ? $t('records.anaUnknown') : `v${v}`,
        count: r.count,
        wins: r.wins,
        losses: r.losses,
        rate: r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0,
      }))
      .sort((a, b) => {
        if (a.version === null) return 1
        if (b.version === null) return -1
        return a.version - b.version
      })
  })

  /** G. 连胜 / 连败（对局级，按时间序） */
  const streakStats = $derived.by(() => {
    const ordered = [...matches]
      .map((m, i) => ({ outcome: outcomes[i], time: m.played_at ?? m.created_at ?? '' }))
      .sort((a, b) => a.time.localeCompare(b.time))
    let bestWin = 0
    let bestLoss = 0
    let run = 0
    let runType: Outcome | null = null
    for (const { outcome } of ordered) {
      if (outcome === 'draw') {
        run = 0
        runType = null
        continue
      }
      if (outcome === runType) run++
      else {
        run = 1
        runType = outcome
      }
      if (runType === 'win' && run > bestWin) bestWin = run
      if (runType === 'loss' && run > bestLoss) bestLoss = run
    }
    let cur = 0
    let curType: Outcome | null = null
    for (let i = ordered.length - 1; i >= 0; i--) {
      const o = ordered[i].outcome
      if (o === 'draw') break
      if (curType === null) {
        curType = o
        cur = 1
      } else if (o === curType) {
        cur++
      } else {
        break
      }
    }
    return { cur: curType === 'win' ? cur : curType === 'loss' ? -cur : 0, bestWin, bestLoss }
  })

  /** H. 小局类型分布 + 胜负原因关键词 */
  const winTypeCounts = $derived.by(() => {
    const map = new Map<string, number>()
    for (const m of matches) {
      for (const g of m.games) {
        map.set(g.win_type, (map.get(g.win_type) ?? 0) + 1)
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  })
  function winTypeLabel(type: string): string {
    switch (type) {
      case 'normal':
        return $t('records.anaTypeNormal')
      case 'concede':
        return $t('match.oppConcede')
      case 'special':
        return $t('match.specialWin')
      case 'draw':
        return $t('match.drawWin')
      default:
        return type
    }
  }
  const reasonStats = $derived.by(() => {
    const winMap = new Map<string, number>()
    const lossMap = new Map<string, number>()
    for (const m of matches) {
      for (const g of m.games) {
        const map = g.is_win ? winMap : lossMap
        for (const w of tokenize(g.win_reason)) {
          map.set(w, (map.get(w) ?? 0) + 1)
        }
      }
    }
    const top = (map: Map<string, number>) =>
      [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
    return { win: top(winMap), loss: top(lossMap) }
  })
  function tokenize(text: string | null | undefined): string[] {
    return (text ?? '')
      .split(/[\s,，。、;；:：/|()（）【】[\]\-—]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2)
  }

  // ==================== 数据加载 ====================

  async function loadData() {
    const deckId = page.params.deckid
    if (!deckId) {
      goto('/decks')
      return
    }
    const d = await getDeckById(deckId)
    if (!d) {
      goto('/decks')
      return
    }
    deck = d
    const [records, s] = await Promise.all([getMatchesByDeck(deckId), getDeckMatchStats(deckId)])
    matches = records
    stats = s
  }

  function openCreateMatch() {
    showMatchModal = true
  }

  beforeNavigate(({ from, cancel, type, delta }) => {
    const isBackward = type === 'popstate' && delta && delta < 0
    if (isBackward) goto(`/decks/${page.params.deckid}`)
  })

  onMount(() => {
    loadData()
  })

  $effect(() => {
    setTopbar({
      title: deck?.name
        ? $t('records.titleWithDeck', { values: { name: deck.name } })
        : $t('records.title'),
      description: $t('records.count', { values: { count: matches.length } }),
      onBack: () => goto(`/decks/${page.params.deckid}`),
      actions: [
        {
          key: 'record',
          label: $t('match.recordTitle'),
          icon: Plus,
          variant: 'primary',
          priority: 0,
          onClick: openCreateMatch,
        },
      ],
    })
  })
</script>

<div class="records-container">
  <div class="tab-bar">
    <button
      class="tab-btn"
      class:active={activeTab === 'records'}
      onclick={() => (activeTab = 'records')}
    >
      <List size={16} />
      {$t('records.tabsRecords')}
    </button>
    <button
      class="tab-btn"
      class:active={activeTab === 'analysis'}
      onclick={() => (activeTab = 'analysis')}
    >
      <BarChart3 size={16} />
      {$t('records.tabsAnalysis')}
    </button>
  </div>

  {#if activeTab === 'records'}
    <div class="records-filter">
      <div class="filter-group">
        <button
          class="filter-chip"
          class:active={filterGroup === 'all'}
          onclick={() => (filterGroup = 'all')}
        >
          {$t('records.allGroups')}
        </button>
        {#each allGroups as group (group)}
          <button
            class="filter-chip"
            class:active={filterGroup === group}
            onclick={() => (filterGroup = group)}
          >
            {group}
          </button>
        {/each}
      </div>

      <div class="filter-group">
        <button
          class="filter-chip"
          class:active={filterResult === 'all'}
          onclick={() => (filterResult = 'all')}
        >
          {$t('records.allResults')}
        </button>
        <button
          class="filter-chip"
          class:active={filterResult === 'win'}
          onclick={() => (filterResult = 'win')}
        >
          {$t('records.winMatches')}
        </button>
        <button
          class="filter-chip"
          class:active={filterResult === 'loss'}
          onclick={() => (filterResult = 'loss')}
        >
          {$t('records.lossMatches')}
        </button>
        <button
          class="filter-chip"
          class:active={filterResult === 'draw'}
          onclick={() => (filterResult = 'draw')}
        >
          {$t('records.drawMatches')}
        </button>
      </div>

      <div class="search-input search-bar search-bar--sm">
        <input
          class="search-bar-input"
          type="text"
          placeholder={$t('records.searchPlaceholder')}
          bind:value={searchText}
        />
      </div>
    </div>

    {#if filteredMatches.length > 0}
      <ul class="records-list">
        {#each filteredMatches as match (match.id)}
          {@const outcome = matchOutcome(match)}
          <li
            class="record-item"
            class:outcome-win={outcome === 'win'}
            class:outcome-loss={outcome === 'loss'}
            class:outcome-draw={outcome === 'draw'}
          >
            <div
              class="record-item-header"
              role="presentation"
              onclick={() => goto(`/decks/${page.params.deckid}/records/${match.id}/logs`)}
            >
              <div class="record-item-meta">
                <span class="record-item-date">
                  {match.played_at
                    ? new Date(match.played_at).toLocaleDateString()
                    : $t('records.noDate')}
                </span>
                {#if match.group_name}
                  <span class="record-group-badge">{match.group_name}</span>
                {/if}
                <span class="record-item-meta-right">
                  {#if match.deck_version_number}
                    <span class="record-meta-text">v{match.deck_version_number}</span>
                  {/if}
                  {#if match.best_of}
                    <span class="record-meta-text">BO{match.best_of}</span>
                  {/if}
                </span>
              </div>
              <div class="record-item-main">
                <span class="record-item-opponent">
                  {match.player_name || $t('records.me')} vs
                  {match.opponent_name || $t('records.unknownOpponent')}
                </span>
                <span class="record-item-result">{matchSummaryText(match)}</span>
                <span class="record-item-chevron">
                  <ChevronRight size={16} />
                </span>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    {:else}
      <div class="records-empty">
        <Swords size={40} />
        <p>{$t('records.empty')}</p>
      </div>
    {/if}
  {:else}
    {#if matches.length === 0}
      <div class="records-empty">
        <BarChart3 size={40} />
        <p>{$t('records.anaEmpty')}</p>
      </div>
    {:else}
      <div class="analytics">
        <!-- A. 概览 -->
        <section class="ana-card ana-overview">
          <div class="ana-tile">
            <span class="ana-tile-value">{stats?.matches ?? 0}</span>
            <span class="ana-tile-label">{$t('records.statMatches')}</span>
          </div>
          <div class="ana-tile">
            <span class="ana-tile-value">{stats?.games ?? 0}</span>
            <span class="ana-tile-label">{$t('records.statGames')}</span>
          </div>
          <div class="ana-tile">
            <span class="ana-tile-value ana-tile-win">{matchWinRate}%</span>
            <span class="ana-tile-label">{$t('records.anaMatchWinRate')}</span>
          </div>
          <div class="ana-tile">
            <span class="ana-tile-value ana-tile-win">{gameWinRate}%</span>
            <span class="ana-tile-label">{$t('records.anaGameWinRate')}</span>
          </div>
        </section>

        <!-- B. 结果分布 -->
        <div class="ana-grid">
          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaResultDist')} · {$t('records.statMatches')}</h3>
            <div class="dist-bar">
              {#each matchDist as d (d.key)}
                <div
                  class="dist-seg dist-{d.key}"
                  style="width: {d.pct}%"
                  title="{$t(
                    `records.ana${d.key === 'win' ? 'Win' : d.key === 'loss' ? 'Loss' : 'Draw'}`
                  )} {d.count}"
                ></div>
              {/each}
            </div>
            <div class="dist-legend">
              {#each matchDist as d (d.key)}
                <span class="dist-item dist-item-{d.key}">
                  <i></i>{$t(
                    `records.ana${d.key === 'win' ? 'Win' : d.key === 'loss' ? 'Loss' : 'Draw'}`
                  )}
                  {d.count}（{d.pct}%）
                </span>
              {/each}
            </div>
          </section>

          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaResultDist')} · {$t('records.statGames')}</h3>
            <div class="dist-bar">
              {#each gameDist as d (d.key)}
                <div class="dist-seg dist-{d.key}" style="width: {d.pct}%"></div>
              {/each}
            </div>
            <div class="dist-legend">
              {#each gameDist as d (d.key)}
                <span class="dist-item dist-item-{d.key}">
                  <i></i>{$t(
                    `records.ana${d.key === 'win' ? 'Win' : d.key === 'loss' ? 'Loss' : 'Draw'}`
                  )}
                  {d.count}（{d.pct}%）
                </span>
              {/each}
            </div>
          </section>
        </div>

        <!-- C. 先手优势 -->
        <section class="ana-card">
          <h3 class="ana-title">{$t('records.anaFirstAdv')}</h3>
          <div class="first-rate-row">
            <span class="first-rate-label">{$t('records.anaFirstRate')}</span>
            <span class="first-rate-value">{firstRate}%</span>
            <span class="first-rate-sub">{stats?.first_games ?? 0} / {stats?.games ?? 0}</span>
          </div>
          <div class="compare-row">
            <span class="compare-label">{$t('records.anaFirstWinRate')}</span>
            <div class="compare-bar">
              <div class="compare-fill compare-win" style="width: {firstWinRate}%"></div>
            </div>
            <span class="compare-value">{firstWinRate}%</span>
          </div>
          <div class="compare-row">
            <span class="compare-label">{$t('records.anaSecondWinRate')}</span>
            <div class="compare-bar">
              <div class="compare-fill compare-loss" style="width: {secondWinRate}%"></div>
            </div>
            <span class="compare-value">{secondWinRate}%</span>
          </div>
          <div class="first-diff">
            {$t('records.anaFirstDiff')}：
            <b class:pos={firstDiff >= 0}>{firstDiff >= 0 ? '+' : ''}{firstDiff}%</b>
          </div>
        </section>

        <!-- D. 系列比分 -->
        <section class="ana-card">
          <h3 class="ana-title">{$t('records.anaScoreDist')}</h3>
          <div class="score-chips">
            {#each scoreLines as [key, count] (key)}
              <span class="score-chip">
                {key === 'draw' ? $t('records.anaScoreDraw') : key}
                <b>×{count}</b>
              </span>
            {/each}
          </div>
        </section>

        <!-- E. 对阵分析 -->
        <div class="ana-grid">
          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaMatchup')} · {$t('records.anaByGroup')}</h3>
            {#each groupStats as row (row.name)}
              <div class="ana-row">
                <div class="ana-row-main">
                  <span class="ana-row-label">{row.name}</span>
                  <div class="ana-row-bar">
                    <div class="ana-row-fill" style="width: {row.rate}%"></div>
                  </div>
                  <span class="ana-row-rate">{row.rate}%</span>
                  <span class="ana-row-count">{row.count}{$t('records.anaMatchUnit')}</span>
                </div>
                <div class="ana-row-fs">
                  <span class="fs-item fs-first"><i></i>{$t('records.first')} {row.firstRate}%</span
                  >
                  <span class="fs-item fs-second"
                    ><i></i>{$t('records.second')} {row.secondRate}%</span
                  >
                </div>
              </div>
            {/each}
          </section>

          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaMatchup')} · {$t('records.anaByLegend')}</h3>
            {#each legendStats.slice(0, 8) as row (row.name)}
              <div class="ana-row">
                <div class="ana-row-main">
                  <span class="ana-row-label">{row.name}</span>
                  <div class="ana-row-bar">
                    <div class="ana-row-fill" style="width: {row.rate}%"></div>
                  </div>
                  <span class="ana-row-rate">{row.rate}%</span>
                  <span class="ana-row-count">{row.count}{$t('records.anaMatchUnit')}</span>
                </div>
                <div class="ana-row-fs">
                  <span class="fs-item fs-first"><i></i>{$t('records.first')} {row.firstRate}%</span
                  >
                  <span class="fs-item fs-second"
                    ><i></i>{$t('records.second')} {row.secondRate}%</span
                  >
                </div>
              </div>
            {/each}
          </section>
        </div>

        <!-- F. 版本趋势 -->
        <section class="ana-card">
          <h3 class="ana-title">{$t('records.anaByVersion')}</h3>
          {#each versionStats as row (row.label)}
            <div class="ana-row">
              <div class="ana-row-main">
                <span class="ana-row-label">{row.label}</span>
                <div class="ana-row-bar">
                  <div class="ana-row-fill" style="width: {row.rate}%"></div>
                </div>
                <span class="ana-row-rate">{row.rate}%</span>
                <span class="ana-row-count">{row.count}{$t('records.anaMatchUnit')}</span>
              </div>
            </div>
          {/each}
        </section>

        <!-- G. 连胜连败 -->
        <section class="ana-card ana-overview">
          <div class="ana-tile">
            <span class="ana-tile-value"
              >{#if streakStats.cur > 0}
                {$t('records.anaStreakWin', { values: { count: streakStats.cur } })}
              {:else if streakStats.cur < 0}
                {$t('records.anaStreakLoss', { values: { count: -streakStats.cur } })}
              {:else}
                {$t('records.anaNone')}
              {/if}</span
            >
            <span class="ana-tile-label">{$t('records.anaStreakCur')}</span>
          </div>
          <div class="ana-tile">
            <span class="ana-tile-value ana-tile-win"
              >{$t('records.anaStreakWin', { values: { count: streakStats.bestWin } })}</span
            >
            <span class="ana-tile-label">{$t('records.anaStreakBest')}</span>
          </div>
          <div class="ana-tile">
            <span class="ana-tile-value ana-tile-loss"
              >{$t('records.anaStreakLoss', { values: { count: streakStats.bestLoss } })}</span
            >
            <span class="ana-tile-label">{$t('records.anaStreakWorst')}</span>
          </div>
        </section>

        <!-- H. 小局细节 -->
        <div class="ana-grid">
          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaWinTypes')}</h3>
            <div class="score-chips">
              {#each winTypeCounts as [type, count] (type)}
                <span class="score-chip">
                  {winTypeLabel(type)}
                  <b>×{count}</b>
                </span>
              {/each}
            </div>
          </section>

          <section class="ana-card">
            <h3 class="ana-title">{$t('records.anaReasons')}</h3>
            <div class="reason-cols">
              <div class="reason-col">
                <span class="reason-col-title reason-win">{$t('records.anaWinReasons')}</span>
                {#if reasonStats.win.length === 0}
                  <span class="reason-empty">{$t('records.anaNone')}</span>
                {:else}
                  {#each reasonStats.win as [word, count] (word)}
                    <span class="reason-item"><i>{word}</i><b>{count}</b></span>
                  {/each}
                {/if}
              </div>
              <div class="reason-col">
                <span class="reason-col-title reason-loss">{$t('records.anaLossReasons')}</span>
                {#if reasonStats.loss.length === 0}
                  <span class="reason-empty">{$t('records.anaNone')}</span>
                {:else}
                  {#each reasonStats.loss as [word, count] (word)}
                    <span class="reason-item"><i>{word}</i><b>{count}</b></span>
                  {/each}
                {/if}
              </div>
            </div>
          </section>
        </div>
      </div>
    {/if}
  {/if}
</div>

<MatchRecordModal
  open={showMatchModal}
  deckId={page.params.deckid ?? ''}
  editing={null}
  onclose={() => (showMatchModal = false)}
  onSaved={() => loadData()}
/>

<style>
  .records-container {
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
    color: var(--text-primary);
  }

  /* Tab 栏 */
  .tab-bar {
    display: flex;
    gap: 8px;
    margin-bottom: 16px;
  }

  .tab-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 18px;
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .tab-btn:hover {
    background: var(--bg-hover);
  }

  .tab-btn.active {
    color: #fff;
    background: var(--accent-color, #4f46e5);
    border-color: var(--accent-color, #4f46e5);
  }

  /* ==================== 记录 tab ==================== */

  .records-filter {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
    margin-bottom: 16px;
    padding: 12px 16px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  .filter-group {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .filter-chip {
    padding: 4px 12px;
    font-size: 12px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .filter-chip:hover {
    background: var(--bg-hover);
  }

  .filter-chip.active {
    color: #fff;
    background: var(--accent-color, #4f46e5);
    border-color: var(--accent-color, #4f46e5);
  }

  .search-input {
    flex: 1;
    min-width: 200px;
  }

  .records-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .record-item {
    position: relative;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-left: 4px solid var(--border-color);
    border-radius: 12px;
    overflow: hidden;
    transition: border-color 0.15s;
  }

  .record-item.outcome-win {
    border-left-color: #16a34a;
  }

  .record-item.outcome-loss {
    border-left-color: #dc2626;
  }

  .record-item.outcome-draw {
    border-left-color: var(--text-tertiary);
  }

  .record-item-header {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 12px 16px;
    cursor: pointer;
    user-select: none;
    transition: background 0.15s;
  }

  .record-item-header:hover {
    background: var(--bg-hover);
  }

  .record-item-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .record-item-meta-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .record-meta-text {
    font-size: 12px;
    color: var(--text-tertiary);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .record-item-main {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
  }

  .record-item-date {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .record-item-opponent {
    flex: 1;
    min-width: 0;
    font-size: 16px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .record-group-badge {
    padding: 2px 8px;
    font-size: 11px;
    border-radius: 999px;
    white-space: nowrap;
    color: var(--text-primary);
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 14%, transparent);
  }

  .record-item-result {
    flex-shrink: 0;
    font-size: 15px;
    font-weight: 700;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    color: var(--text-primary);
    transition: color 0.15s;
  }

  .record-item.outcome-win .record-item-result {
    color: #16a34a;
  }

  .record-item.outcome-loss .record-item-result {
    color: #dc2626;
  }

  .record-item.outcome-draw .record-item-result {
    color: var(--text-tertiary);
  }

  .record-item-chevron {
    display: flex;
    flex-shrink: 0;
    color: var(--text-secondary);
    transition: transform 0.2s;
  }

  .record-item-header:hover .record-item-chevron {
    transform: translateX(2px);
  }

  .records-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 60px 24px;
    text-align: center;
    color: var(--text-secondary);
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  /* ==================== 分析 tab ==================== */

  .analytics {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .ana-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
  }

  .ana-card {
    padding: 16px;
    background: var(--surface);
    border: 1px solid var(--border-color);
    border-radius: 12px;
  }

  .ana-title {
    margin: 0 0 12px;
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* A/G 概览数字 */
  .ana-overview {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
  }

  .ana-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 14px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 10px;
  }

  .ana-tile-value {
    font-size: 22px;
    font-weight: 700;
    line-height: 1;
    text-align: center;
  }

  .ana-tile-value.ana-tile-win {
    color: #16a34a;
  }

  .ana-tile-value.ana-tile-loss {
    color: #dc2626;
  }

  .ana-tile-label {
    font-size: 12px;
    color: var(--text-secondary);
    text-align: center;
  }

  /* B 结果分布 */
  .dist-bar {
    display: flex;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-hover);
    margin-bottom: 10px;
  }

  .dist-seg.dist-win {
    background: #16a34a;
  }

  .dist-seg.dist-draw {
    background: #94a3b8;
  }

  .dist-seg.dist-loss {
    background: #dc2626;
  }

  .dist-legend {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .dist-item {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    white-space: nowrap;
  }

  .dist-item i {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .dist-item-win i {
    background: #16a34a;
  }

  .dist-item-draw i {
    background: #94a3b8;
  }

  .dist-item-loss i {
    background: #dc2626;
  }

  /* C 先手优势 */
  .first-rate-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 10px;
  }

  .first-rate-label {
    font-size: 13px;
    color: var(--text-secondary);
  }

  .first-rate-value {
    font-size: 20px;
    font-weight: 700;
  }

  .first-rate-sub {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  .compare-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  .compare-label {
    width: 72px;
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .compare-bar {
    flex: 1;
    height: 10px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-hover);
  }

  .compare-fill {
    height: 100%;
    border-radius: 999px;
    transition: width 0.3s;
  }

  .compare-fill.compare-win {
    background: #16a34a;
  }

  .compare-fill.compare-loss {
    background: #dc2626;
  }

  .compare-value {
    width: 44px;
    flex-shrink: 0;
    text-align: right;
    font-size: 13px;
    font-weight: 600;
  }

  .first-diff {
    margin-top: 10px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .first-diff b {
    color: #dc2626;
  }

  .first-diff b.pos {
    color: #16a34a;
  }

  /* D/H 统计 chips */
  .score-chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .score-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 6px;
    padding: 5px 12px;
    font-size: 13px;
    font-weight: 600;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 999px;
  }

  .score-chip b {
    font-size: 12px;
    color: var(--text-secondary);
  }

  /* E/F 行式条形 */
  .ana-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 0;
  }

  .ana-row-main {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .ana-row-fs {
    display: flex;
    align-items: center;
    gap: 14px;
    padding-left: 110px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  .fs-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
  }

  .fs-item i {
    width: 6px;
    height: 6px;
    border-radius: 50%;
  }

  .fs-item.fs-first i {
    background: #16a34a;
  }

  .fs-item.fs-second i {
    background: #dc2626;
  }

  .ana-row-label {
    width: 110px;
    flex-shrink: 0;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ana-row-bar {
    flex: 1;
    height: 8px;
    border-radius: 999px;
    overflow: hidden;
    background: var(--bg-hover);
  }

  .ana-row-fill {
    height: 100%;
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-color, #4f46e5) 65%, transparent);
    transition: width 0.3s;
  }

  .ana-row-rate {
    width: 42px;
    flex-shrink: 0;
    text-align: right;
    font-size: 12px;
    font-weight: 600;
  }

  .ana-row-count {
    width: 52px;
    flex-shrink: 0;
    text-align: right;
    font-size: 12px;
    color: var(--text-tertiary);
  }

  /* H 原因关键词 */
  .reason-cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
  }

  .reason-col {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .reason-col-title {
    font-size: 12px;
    font-weight: 600;
  }

  .reason-col-title.reason-win {
    color: #16a34a;
  }

  .reason-col-title.reason-loss {
    color: #dc2626;
  }

  .reason-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 13px;
    padding: 4px 10px;
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    min-width: 0;
  }

  .reason-item i {
    font-style: normal;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .reason-item b {
    flex-shrink: 0;
    font-size: 12px;
    color: var(--text-secondary);
  }

  .reason-empty {
    font-size: 12px;
    color: var(--text-tertiary);
  }

  @media (max-width: 479.99px) {
    .reason-cols {
      grid-template-columns: 1fr;
    }
  }
</style>
