<script lang="ts">
  import {
    Check,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Gamepad2,
    Minus,
    Plus,
    Save,
    Search,
    Swords,
    Trash2,
    Trophy,
    X,
  } from '@lucide/svelte'
  import { fly } from 'svelte/transition'
  import { goto } from '$app/navigation'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import { scoreCounterState } from '$lib/stores/tools'
  import {
    createMatch,
    getBestPrint,
    getDeckVersions,
    getMatchGroups,
    searchCards,
    updateMatch,
    printCacheName,
  } from '$lib/db/index.js'
  import type { CardBase, CardPrint, MatchWinType, MatchWithGames } from '$lib/db/types'
  import type { DeckVersion } from '$lib/db/index.js'
  import { playerName } from '$lib/stores/settings'
  import { get } from 'svelte/store'
  import { t } from '$lib/i18n'

  interface Props {
    open: boolean
    deckId: string
    editing: MatchWithGames | null
    onclose: () => void
    onSaved: () => void
  }

  let { open, deckId, editing, onclose, onSaved }: Props = $props()

  interface GameDraft {
    winType: MatchWinType
    myScore: string | number | null
    oppScore: string | number | null
    result: 'win' | 'loss'
    isFirst: boolean | null
    winReason: string
    log: string
    reviewOpen: boolean
  }

  /** number 输入框绑定值归一化为字符串 */
  function scoreToStr(v: string | number | null | undefined): string {
    if (v === null || v === undefined) return ''
    return String(v)
  }

  /** 完全未填写的小局（比分/原因/log 全空），视为预置的空槽位 */
  function isUnusedGame(game: GameDraft): boolean {
    return (
      scoreToStr(game.myScore).trim() === '' &&
      scoreToStr(game.oppScore).trim() === '' &&
      game.winReason.trim() === '' &&
      game.log.trim() === ''
    )
  }

  let step = $state(1)
  let saving = $state(false)
  let errorMsg = $state('')

  let groupName = $state('')
  let opponentName = $state('')
  let opponentDeck = $state('')
  let bestOf = $state('3')
  let playedAt = $state('')
  let note = $state('')

  let oppLegend = $state<{
    id: string
    printId: string | null
    name: string
    image: string
  } | null>(null)
  let legendQuery = $state('')
  let legendLoading = $state(false)
  let legendOpen = $state(false)
  let allLegends = $state<CardBase[]>([])

  let deckVersions = $state<DeckVersion[]>([])
  let deckVersionId = $state<string>('')

  let games = $state<GameDraft[]>([])
  let groupSuggestions = $state<string[]>([])

  function todayStr(): string {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  }

  function emptyGame(): GameDraft {
    return {
      winType: 'normal',
      myScore: '',
      oppScore: '',
      result: 'win',
      isFirst: null,
      winReason: '',
      log: '',
      reviewOpen: false,
    }
  }

  function resetDraft() {
    step = 1
    errorMsg = ''
    saving = false
    legendOpen = false
    if (editing) {
      groupName = editing.group_name ?? ''
      opponentName = editing.opponent_name ?? ''
      opponentDeck = editing.opponent_deck ?? ''
      oppLegend = editing.opp_legend_id
        ? {
            id: editing.opp_legend_id,
            printId: editing.opp_legend_print_id ?? null,
            name: editing.opp_legend_name ?? '',
            image: editing.opp_legend_image ?? '',
          }
        : null
      legendQuery = ''
      deckVersionId = ''
      bestOf = editing.best_of ? String(editing.best_of) : ''
      playedAt = editing.played_at ? editing.played_at.slice(0, 10) : todayStr()
      note = editing.note ?? ''
      games =
        editing.games.length > 0
          ? editing.games.map((g) => ({
              winType: g.win_type,
              myScore: g.my_score !== null ? String(g.my_score) : '',
              oppScore: g.opp_score !== null ? String(g.opp_score) : '',
              result: g.is_win ? 'win' : 'loss',
              isFirst: g.is_first,
              winReason: g.win_reason ?? '',
              log: g.log ?? '',
              reviewOpen: false,
            }))
          : [emptyGame()]
    } else {
      groupName = ''
      opponentName = ''
      opponentDeck = ''
      oppLegend = null
      legendQuery = ''
      deckVersionId = ''
      bestOf = '3'
      playedAt = todayStr()
      note = ''
      games = [emptyGame()]
    }
  }

  $effect(() => {
    if (open) {
      resetDraft()
      getMatchGroups()
        .then((list) => {
          groupSuggestions = list
        })
        .catch(() => {
          groupSuggestions = []
        })
      getDeckVersions(deckId)
        .then((list) => {
          deckVersions = list
          if (list.length > 0) {
            if (editing) {
              const byId = editing.deck_version_id
                ? list.find((v) => v.id === editing.deck_version_id)
                : undefined
              const byNum = editing.deck_version_number
                ? list.find((v) => v.version_number === editing.deck_version_number)
                : undefined
              deckVersionId = byId?.id ?? byNum?.id ?? list[0].id
            } else {
              deckVersionId = list[0].id
            }
          } else {
            deckVersionId = ''
          }
        })
        .catch(() => {
          deckVersions = []
          deckVersionId = ''
        })
      if (!legendLoading && allLegends.length === 0) {
        legendLoading = true
        searchCards({
          page: 1,
          pageSize: 1000,
          card_category: { include: ['传奇'] },
        })
          .then((res) => {
            allLegends = res.data
              .slice()
              .sort((a, b) =>
                (a.card_name_cn || a.card_name_en || a.card_no).localeCompare(
                  b.card_name_cn || b.card_name_en || b.card_no,
                  'zh'
                )
              )
          })
          .catch(() => {
            allLegends = []
          })
          .finally(() => {
            legendLoading = false
          })
      }
    }
  })

  /* ---------------- 小局数量 ---------------- */

  function addGame() {
    games = [...games, emptyGame()]
  }

  function removeGame(index: number) {
    if (games.length <= 1) return
    games = games.filter((_, i) => i !== index)
  }

  /* ---------------- 赛制 ---------------- */

  function setFormat(v: string) {
    bestOf = v
    if (!editing && (v === '1' || v === '3' || v === '5') && games.every((g) => isUnusedGame(g))) {
      games = Array.from({ length: Number(v) }, () => emptyGame())
    }
  }

  /* ---------------- 传奇选择 ---------------- */

  const legendFiltered = $derived.by(() => {
    const q = legendQuery.trim().toLowerCase()
    if (!q) return allLegends
    return allLegends
      .filter((c) =>
        [c.card_name_cn, c.card_name_en, c.card_no].some((v) => v && v.toLowerCase().includes(q))
      )
      .slice(0, 50)
  })

  function pickLegend(card: CardBase) {
    const print = getBestPrint(card as CardBase & { card_prints?: CardPrint[] })
    oppLegend = {
      id: card.id,
      printId: print?.id ?? null,
      name: card.card_name_cn || card.card_name_en || '',
      image: print?.url || '',
    }
    legendOpen = false
    legendQuery = ''
  }

  function clearLegend() {
    oppLegend = null
    legendQuery = ''
  }

  /* ---------------- 小局交互 ---------------- */

  /** 结果优先：大按钮直接设定本局胜负/平局 */
  function setResult(game: GameDraft, r: 'win' | 'loss' | 'draw') {
    if (r === 'draw') {
      game.winType = 'draw'
      return
    }
    game.result = r
    if (game.winType === 'draw') game.winType = 'normal'
  }

  function setEndType(game: GameDraft, wt: MatchWinType) {
    if (wt === 'draw') {
      game.winType = 'draw'
      return
    }
    if (game.winType === 'draw') game.result = 'win'
    game.winType = wt
  }

  function bumpScore(game: GameDraft, side: 'my' | 'opp', delta: number) {
    const cur = scoreToStr(side === 'my' ? game.myScore : game.oppScore).trim()
    const num = cur === '' ? 0 : Number(cur)
    const next = Math.max(0, (Number.isNaN(num) ? 0 : num) + delta)
    if (side === 'my') game.myScore = String(next)
    else game.oppScore = String(next)
  }

  function deriveResult(game: GameDraft): 'win' | 'loss' | 'draw' | null {
    if (game.winType === 'draw') return 'draw'
    if (game.winType !== 'normal') return game.result
    const my = scoreToStr(game.myScore).trim()
    const opp = scoreToStr(game.oppScore).trim()
    if (my === '' || opp === '') return null
    const myNum = Number(my)
    const oppNum = Number(opp)
    if (Number.isNaN(myNum) || Number.isNaN(oppNum)) return null
    if (myNum > oppNum) return 'win'
    if (myNum < oppNum) return 'loss'
    return 'draw'
  }

  /* ---------------- 系列比分看板 ---------------- */

  const series = $derived.by(() => {
    const s = { w: 0, l: 0, d: 0, filled: 0 }
    for (const g of games) {
      if (isUnusedGame(g)) continue
      s.filled++
      const r = deriveResult(g)
      if (r === 'win') s.w++
      else if (r === 'loss') s.l++
      else if (r === 'draw') s.d++
    }
    return s
  })

  const seriesState = $derived.by(() => {
    if (series.filled === 0) return null
    if (series.w > series.l) return 'leading'
    if (series.w < series.l) return 'trailing'
    return 'level'
  })

  /** BO 目标胜局数（如 BO3 为 2）；非标准赛制为 0 */
  const targetWins = $derived(
    bestOf === '1' || bestOf === '3' || bestOf === '5' ? Math.ceil(Number(bestOf) / 2) : 0
  )

  const seriesTag = $derived.by(() => {
    if (seriesState === null) return null
    if (targetWins > 0 && series.w >= targetWins) return 'won'
    if (seriesState === 'leading') return 'leading'
    if (seriesState === 'trailing') return 'trailing'
    return 'level'
  })

  /* ---------------- 校验与保存 ---------------- */

  function goToStep2() {
    errorMsg = ''
    const target = bestOf === '1' || bestOf === '3' || bestOf === '5' ? Number(bestOf) : 0
    if (!editing && target > 0 && games.every((g) => isUnusedGame(g))) {
      games = Array.from({ length: target }, () => emptyGame())
    }
    step = 2
  }

  /** 把对局信息带入对战工具（tools/gameCounter）实时记录 */
  function goLive() {
    const version = deckVersions.find((v) => v.id === deckVersionId)
    const parts: string[] = []
    if (opponentName.trim()) parts.push(`vs ${opponentName.trim()}`)
    if (bestOf) parts.push(`BO${bestOf}`)
    if (version) parts.push(`v${version.version_number}`)
    if (groupName.trim()) parts.push(groupName.trim())
    scoreCounterState.update((s) => ({
      ...s,
      deckId,
      deckVersionId,
      opponentName,
      opponentDeck,
      oppLegendId: oppLegend?.id ?? null,
      oppLegendPrintId: oppLegend?.printId ?? null,
      oppLegendName: oppLegend?.name ?? null,
      oppLegendImage: oppLegend?.image ?? null,
      bestOf,
      groupName,
      note,
      pendingDraftSummary: parts.length > 0 ? parts.join(' · ') : null,
    }))
    onclose()
    goto('/tools/gameCounter')
  }

  function handleStep1Keydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement)) {
      goToStep2()
    }
  }

  /** 打开弹窗后聚焦首个输入框 */
  function focusInput(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus())
  }

  function validate(): string | null {
    const filled = games.filter((g) => !isUnusedGame(g))
    if (filled.length === 0) return get(t)('match.minOneGame')
    for (const game of filled) {
      if (game.isFirst === null) return get(t)('match.chooseTurn')
      if (game.winType === 'normal') {
        const my = scoreToStr(game.myScore).trim()
        const opp = scoreToStr(game.oppScore).trim()
        if (my === '' || opp === '') return get(t)('match.normalNeedsScore')
        const myNum = Number(my)
        const oppNum = Number(opp)
        if (!Number.isInteger(myNum) || myNum < 0 || !Number.isInteger(oppNum) || oppNum < 0) {
          return get(t)('match.scoreNonNegative')
        }
      } else {
        for (const score of [scoreToStr(game.myScore).trim(), scoreToStr(game.oppScore).trim()]) {
          if (score === '') continue
          const num = Number(score)
          if (!Number.isInteger(num) || num < 0) return get(t)('match.scoreNonNegative')
        }
        if (game.winType === 'special' && !game.winReason.trim()) {
          return get(t)('match.specialNeedsReason')
        }
      }
    }
    return null
  }

  async function save() {
    const err = validate()
    if (err) {
      errorMsg = err
      return
    }
    errorMsg = ''
    saving = true
    try {
      const filled = games.filter((g) => !isUnusedGame(g))
      const gameInputs = filled.map((game, index) => {
        const myStr = scoreToStr(game.myScore).trim()
        const oppStr = scoreToStr(game.oppScore).trim()
        let isWin: boolean
        if (game.winType === 'draw') {
          isWin = false
        } else if (game.winType === 'normal') {
          isWin = Number(myStr) > Number(oppStr)
        } else {
          isWin = game.result === 'win'
        }
        return {
          game_number: index + 1,
          my_score: myStr === '' ? null : Number(myStr),
          opp_score: oppStr === '' ? null : Number(oppStr),
          win_type: game.winType,
          is_win: isWin,
          is_first: game.isFirst,
          win_reason: game.winReason.trim() || null,
          log: game.log.trim() || null,
        }
      })

      const pickedVersion = deckVersions.find((v) => v.id === deckVersionId)

      const input = {
        deck_id: deckId,
        ...(editing
          ? {}
          : {
              player_name: $playerName.trim() || null,
            }),
        group_name: groupName.trim() || null,
        opponent_name: opponentName.trim() || null,
        opponent_deck: opponentDeck.trim() || null,
        opp_legend_id: oppLegend?.id ?? null,
        opp_legend_print_id: oppLegend?.printId ?? null,
        opp_legend_name: oppLegend?.name || null,
        opp_legend_image: oppLegend?.image || null,
        deck_version_id: pickedVersion?.id ?? null,
        deck_version_number: pickedVersion?.version_number ?? null,
        best_of: bestOf === '' ? null : Number(bestOf),
        note: note.trim() || null,
        played_at: playedAt ? new Date(`${playedAt}T00:00:00`).toISOString() : null,
      }

      if (editing) {
        await updateMatch(editing.id, input, gameInputs)
      } else {
        await createMatch(input, gameInputs)
      }
      onSaved()
      onclose()
    } catch (error) {
      console.error('[MatchRecord] 保存对局失败:', error)
      errorMsg = get(t)('match.saveFailed')
    } finally {
      saving = false
    }
  }

  const title = $derived(editing ? $t('match.editTitle') : $t('match.recordTitle'))
</script>

<CommonModal {open} {title} width="min(640px, 100%)" closable={!saving} {onclose}>
  {#snippet header()}
    <div class="mr-header">
      <div class="mr-header-top">
        <div class="mr-header-text">
          <div class="mr-title">{title}</div>
          {#if !editing && step === 1 && opponentName.trim()}
            <div class="mr-subtitle">
              {$t('match.recordSubtitle', { values: { name: opponentName.trim() } })}
            </div>
          {/if}
        </div>
        {#if !saving}
          <button class="mr-close" aria-label={$t('common.close')} onclick={onclose}>
            <X size={20} />
          </button>
        {/if}
      </div>
      <div class="mr-stepper">
        <div class="mr-step" class:active={step === 1} class:done={step > 1}>
          <span class="mr-step-dot">
            {#if step > 1}
              <Check size={12} />
            {:else}
              1
            {/if}
          </span>
          <span class="mr-step-name">{$t('match.stepperInfo')}</span>
        </div>
        <div class="mr-step-line" class:done={step > 1}></div>
        <div class="mr-step" class:active={step === 2}>
          <span class="mr-step-dot">2</span>
          <span class="mr-step-name">{$t('match.stepperScores')}</span>
        </div>
      </div>
    </div>
  {/snippet}

  {#key step}
    {#if step === 1}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="match-form"
        role="presentation"
        transition:fly={{ y: 12, duration: 200 }}
        onkeydown={handleStep1Keydown}
      >
        <div class="field-group">
          <div class="field-group-title">{$t('match.sectionOpponent')}</div>
          <div class="field-row">
            <label class="field">
              <span class="field-label">{$t('match.oppName')}</span>
              <input
                class="input"
                type="text"
                placeholder={$t('match.oppNamePlaceholder')}
                maxlength="50"
                bind:value={opponentName}
                disabled={saving}
                use:focusInput
              />
            </label>
            <label class="field">
              <span class="field-label">{$t('match.oppDeck')}</span>
              <input
                class="input"
                type="text"
                placeholder={$t('match.oppDeckPlaceholder')}
                maxlength="50"
                bind:value={opponentDeck}
                disabled={saving}
              />
            </label>
          </div>

          <div class="legend-field">
            <span class="field-label">{$t('match.oppLegend')}</span>
            {#if oppLegend}
              <div class="legend-picked">
                <CardSimpleImage
                  url={oppLegend.image}
                  name={printCacheName({ id: oppLegend.printId ?? oppLegend.id })}
                  className="legend-picked-thumb"
                />
                <span class="legend-picked-name">{oppLegend.name}</span>
                <button
                  class="legend-picked-clear"
                  type="button"
                  title={$t('match.clearSelect')}
                  onclick={clearLegend}
                  disabled={saving}
                >
                  <X size={14} />
                </button>
              </div>
            {:else}
              <button
                type="button"
                class="legend-trigger"
                class:open={legendOpen}
                onclick={() => (legendOpen = !legendOpen)}
                disabled={saving}
              >
                <Swords size={15} />
                {$t('match.legendPick')}
                <ChevronDown
                  size={14}
                  class={legendOpen ? 'legend-trigger-chevron flipped' : 'legend-trigger-chevron'}
                />
              </button>
            {/if}

            {#if legendOpen && !oppLegend}
              <div class="legend-panel" transition:fly={{ y: 6, duration: 160 }}>
                <div class="legend-search search-bar search-bar--sm">
                  <Search size={14} class="search-bar-icon" />
                  <input
                    class="search-bar-input"
                    type="text"
                    placeholder={$t('match.legendSearch')}
                    maxlength="50"
                    bind:value={legendQuery}
                    disabled={saving}
                  />
                  {#if legendQuery}
                    <button
                      class="search-bar-clear"
                      type="button"
                      title={$t('match.clearSelect')}
                      onclick={() => (legendQuery = '')}
                      disabled={saving}
                    >
                      <X size={14} />
                    </button>
                  {/if}
                </div>
                {#if legendLoading}
                  <span class="legend-hint">{$t('match.legendLoading')}</span>
                {:else if legendFiltered.length === 0}
                  <span class="legend-hint">{$t('match.noLegendFound')}</span>
                {:else}
                  <div class="legend-row">
                    {#each legendFiltered as card (card.id)}
                      {@const best = getBestPrint(card as CardBase & { card_prints?: CardPrint[] })}
                      <button
                        type="button"
                        class="legend-item"
                        title={card.card_name_cn || card.card_name_en || card.card_no}
                        onclick={() => pickLegend(card)}
                        disabled={saving}
                      >
                        <CardSimpleImage
                          url={best?.url}
                          name={printCacheName(best)}
                          className="legend-thumb"
                        />
                        <span class="legend-item-name">
                          {card.card_name_cn || card.card_name_en || card.card_no}
                        </span>
                      </button>
                    {/each}
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <div class="field-group">
          <div class="field-group-title">{$t('match.sectionFormat')}</div>
          <div class="format-pills">
            {#each [{ value: '1', label: 'BO1' }, { value: '3', label: 'BO3' }, { value: '5', label: 'BO5' }, { value: '', label: $t('match.anyFormat') }] as f (f.value)}
              <button
                type="button"
                class="format-pill"
                class:active={bestOf === f.value}
                onclick={() => setFormat(f.value)}
                disabled={saving}
              >
                {f.label}
              </button>
            {/each}
          </div>
          {#if !editing && (bestOf === '3' || bestOf === '5')}
            <p class="format-hint">{$t('match.boHint', { values: { bestOf } })}</p>
          {/if}

          <div class="field-row">
            <label class="field">
              <span class="field-label">{$t('match.deckVersion')}</span>
              {#if deckVersions.length > 0}
                <select class="input select" bind:value={deckVersionId} disabled={saving}>
                  <option value="">{$t('match.noAssociation')}</option>
                  {#each deckVersions as v (v.id)}
                    <option value={v.id}>
                      v{v.version_number}
                      {new Date(v.created_at ?? '').toLocaleDateString()}
                      {#if v.note}· {v.note}{/if}
                    </option>
                  {/each}
                </select>
              {:else}
                <input class="input" type="text" value={$t('match.noVersion')} disabled />
              {/if}
            </label>
            <label class="field">
              <span class="field-label">{$t('match.date')}</span>
              <input class="input" type="date" bind:value={playedAt} disabled={saving} />
            </label>
          </div>

          <label class="field">
            <span class="field-label">{$t('match.group')}</span>
            <input
              class="input"
              type="text"
              placeholder={$t('match.groupPlaceholder')}
              maxlength="50"
              list="match-group-suggestions"
              bind:value={groupName}
              disabled={saving}
            />
            <datalist id="match-group-suggestions">
              {#each groupSuggestions as g (g)}
                <option value={g}></option>
              {/each}
            </datalist>
          </label>

          <label class="field">
            <span class="field-label">{$t('common.note')}</span>
            <textarea
              class="input textarea"
              placeholder={$t('match.notePlaceholder')}
              maxlength="500"
              rows="3"
              bind:value={note}
              disabled={saving}></textarea>
          </label>
        </div>
      </div>
    {:else}
      <div class="match-form" transition:fly={{ y: 12, duration: 200 }}>
        {#if series.filled > 0}
          <div
            class="scoreboard"
            class:leading={seriesTag === 'leading'}
            class:trailing={seriesTag === 'trailing'}
            class:level={seriesTag === 'level'}
            class:won={seriesTag === 'won'}
          >
            <div class="sb-head">
              <Trophy size={15} />
              <span>{$t('match.scoreboardTitle')}</span>
            </div>
            <div class="sb-body">
              <span class="sb-name sb-me">{$t('match.me')}</span>
              <div class="sb-score">
                <b>{series.w}</b>
                <span class="sb-colon">:</span>
                <b>{series.l}</b>
              </div>
              <span class="sb-name sb-opp">{opponentName.trim() || $t('match.opponent')}</span>
              {#if series.d > 0}
                <span class="sb-draw"
                  >{$t('match.sbDrawCount', { values: { count: series.d } })}</span
                >
              {/if}
            </div>
            <div class="sb-tag">
              {#if seriesTag === 'won'}
                <Check size={13} />{$t('match.sbWon')}
              {:else if seriesTag === 'leading'}
                {$t('match.sbLeading')}
              {:else if seriesTag === 'trailing'}
                {$t('match.sbTrailing')}
              {:else}
                {$t('match.sbLevel')}
              {/if}
            </div>
            {#if seriesTag === 'leading' && targetWins > 0 && series.w < targetWins}
              <div class="sb-goal">
                {$t('match.sbNeedWin', { values: { count: targetWins - series.w } })}
              </div>
            {/if}
          </div>
        {/if}

        <div class="games-header">
          <span class="field-label">{$t('match.gamesList')}</span>
          <button
            class="button button-ghost button-sm"
            type="button"
            onclick={addGame}
            disabled={saving}
          >
            <Plus size={14} />
            {$t('match.addGame')}
          </button>
        </div>

        {#each games as game, index (index)}
          <div class="game-card" transition:fly={{ y: 14, duration: 220 }}>
            <div class="game-card-header">
              <span class="game-number"
                >{$t('match.gameNumber', { values: { number: index + 1 } })}</span
              >
              <div class="game-result-pill-wrap">
                {#key deriveResult(game)}
                  <span
                    class="result-pill"
                    class:win={deriveResult(game) === 'win'}
                    class:loss={deriveResult(game) === 'loss'}
                    class:draw={deriveResult(game) === 'draw'}
                  >
                    {deriveResult(game) === 'win'
                      ? $t('match.win')
                      : deriveResult(game) === 'loss'
                        ? $t('match.loss')
                        : deriveResult(game) === 'draw'
                          ? $t('match.draw')
                          : $t('match.pending')}
                  </span>
                {/key}
              </div>
              {#if games.length > 1}
                <button
                  type="button"
                  class="icon-btn game-remove"
                  title={$t('match.removeGame')}
                  onclick={() => removeGame(index)}
                  disabled={saving}
                >
                  <Trash2 size={15} />
                </button>
              {/if}
            </div>

            <div class="result-main">
              <button
                type="button"
                class="result-main-btn win"
                class:active={deriveResult(game) === 'win'}
                onclick={() => setResult(game, 'win')}
                disabled={saving}
              >
                {$t('match.resultWin')}
              </button>
              <button
                type="button"
                class="result-main-btn loss"
                class:active={deriveResult(game) === 'loss'}
                onclick={() => setResult(game, 'loss')}
                disabled={saving}
              >
                {$t('match.resultLoss')}
              </button>
              <button
                type="button"
                class="result-main-btn draw"
                class:active={game.winType === 'draw'}
                onclick={() => setResult(game, 'draw')}
                disabled={saving}
              >
                {$t('match.drawWin')}
              </button>
            </div>

            {#if game.winType !== 'draw'}
              <div class="end-type-row">
                <span class="mini-label">{$t('match.endType')}</span>
                <div class="end-type-pills">
                  <button
                    type="button"
                    class="end-type-btn"
                    class:active={game.winType === 'normal'}
                    onclick={() => setEndType(game, 'normal')}
                    disabled={saving}
                  >
                    {$t('match.normalScore')}
                  </button>
                  <button
                    type="button"
                    class="end-type-btn"
                    class:active={game.winType === 'concede'}
                    onclick={() => setEndType(game, 'concede')}
                    disabled={saving}
                  >
                    {$t('match.oppConcede')}
                  </button>
                  <button
                    type="button"
                    class="end-type-btn"
                    class:active={game.winType === 'special'}
                    onclick={() => setEndType(game, 'special')}
                    disabled={saving}
                  >
                    {$t('match.specialWin')}
                  </button>
                </div>
              </div>

              {#if game.winType === 'normal'}
                <div class="score-row">
                  <div class="score-side">
                    <span class="score-side-label">{$t('match.ourScore')}</span>
                    <div class="stepper">
                      <button
                        type="button"
                        class="step-btn"
                        aria-label="−"
                        onclick={() => bumpScore(game, 'my', -1)}
                        disabled={saving ||
                          scoreToStr(game.myScore).trim() === '' ||
                          Number(scoreToStr(game.myScore)) <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        class="input score-input"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        bind:value={game.myScore}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        class="step-btn"
                        aria-label="+"
                        onclick={() => bumpScore(game, 'my', 1)}
                        disabled={saving}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                  <span class="score-sep">:</span>
                  <div class="score-side">
                    <span class="score-side-label">{$t('match.oppScore')}</span>
                    <div class="stepper">
                      <button
                        type="button"
                        class="step-btn"
                        aria-label="−"
                        onclick={() => bumpScore(game, 'opp', -1)}
                        disabled={saving ||
                          scoreToStr(game.oppScore).trim() === '' ||
                          Number(scoreToStr(game.oppScore)) <= 0}
                      >
                        <Minus size={14} />
                      </button>
                      <input
                        class="input score-input"
                        type="number"
                        min="0"
                        inputmode="numeric"
                        bind:value={game.oppScore}
                        disabled={saving}
                      />
                      <button
                        type="button"
                        class="step-btn"
                        aria-label="+"
                        onclick={() => bumpScore(game, 'opp', 1)}
                        disabled={saving}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              {:else}
                <input
                  class="input"
                  type="text"
                  placeholder={game.winType === 'concede'
                    ? $t('match.concedeReasonPlaceholder')
                    : $t('match.specialReasonPlaceholder')}
                  maxlength="100"
                  bind:value={game.winReason}
                  disabled={saving}
                />
              {/if}
            {/if}

            <div class="turn-toggle">
              <span class="turn-toggle-label">{$t('match.turnOrder')}</span>
              <button
                type="button"
                class="turn-btn"
                class:active={game.isFirst === true}
                onclick={() => (game.isFirst = game.isFirst === true ? null : true)}
                disabled={saving}
              >
                {$t('match.ourFirst')}
              </button>
              <button
                type="button"
                class="turn-btn"
                class:active={game.isFirst === false}
                onclick={() => (game.isFirst = game.isFirst === false ? null : false)}
                disabled={saving}
              >
                {$t('match.oppFirst')}
              </button>
              {#if game.isFirst === null}
                <span class="turn-required">{$t('match.turnRequired')}</span>
              {/if}
            </div>

            <button
              type="button"
              class="review-toggle"
              class:open={game.reviewOpen}
              onclick={() => (game.reviewOpen = !game.reviewOpen)}
              disabled={saving}
            >
              <span>{$t('match.reviewToggle')}</span>
              <ChevronDown
                size={14}
                class={game.reviewOpen ? 'review-chevron flipped' : 'review-chevron'}
              />
            </button>
            {#if game.reviewOpen}
              <textarea
                class="input textarea review-input"
                placeholder={$t('match.logPlaceholder')}
                maxlength="2000"
                rows="2"
                bind:value={game.log}
                disabled={saving}
                transition:fly={{ y: 6, duration: 150 }}></textarea>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  {/key}

  {#if errorMsg}
    <div class="form-error" transition:fly={{ y: 4, duration: 150 }}>{errorMsg}</div>
  {/if}

  {#snippet footer()}
    {#if step === 1}
      <button class="button button-ghost" onclick={onclose} disabled={saving}>
        {$t('common.cancel')}
      </button>
      {#if editing}
        <button class="button button-primary" onclick={goToStep2} disabled={saving}>
          {$t('match.next')}
          <ChevronRight size={16} />
        </button>
      {:else}
        <button class="button button-secondary" onclick={goToStep2} disabled={saving}>
          {$t('match.fillGames')}
        </button>
        <button class="button button-primary" onclick={goLive} disabled={saving}>
          <Gamepad2 size={16} />
          {$t('match.startLive')}
        </button>
      {/if}
    {:else}
      {#if series.filled > 0}
        <span class="footer-summary">
          {$t('match.filledSummary', {
            values: { filled: series.filled, w: series.w, l: series.l, d: series.d },
          })}
        </span>
      {/if}
      <button
        class="button button-ghost"
        onclick={() => {
          errorMsg = ''
          step = 1
        }}
        disabled={saving}
      >
        <ChevronLeft size={16} />
        {$t('match.prev')}
      </button>
      <button
        class="button button-primary"
        class:button-loading={saving}
        onclick={save}
        disabled={saving}
      >
        <Save size={16} />
        {saving ? $t('common.saving') : $t('common.save')}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  /* ---------------- 自定义头部 ---------------- */

  .mr-header {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .mr-header-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .mr-header-text {
    min-width: 0;
  }

  .mr-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .mr-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-secondary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mr-close {
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .mr-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  /* 步骤指示器 */
  .mr-stepper {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .mr-step {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-tertiary);
    transition: color 0.2s;
    user-select: none;
  }

  .mr-step-dot {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 12px;
    font-weight: 700;
    background: var(--bg-hover);
    color: var(--text-secondary);
    transition: all 0.2s;
  }

  .mr-step.active {
    color: var(--text-primary);
  }

  .mr-step.active .mr-step-dot {
    background: var(--accent-color);
    color: #fff;
  }

  .mr-step.done {
    color: var(--accent-color);
  }

  .mr-step.done .mr-step-dot {
    background: color-mix(in oklab, var(--accent-color) 15%, transparent);
    color: var(--accent-color);
  }

  .mr-step-line {
    flex: 1;
    height: 2px;
    border-radius: 1px;
    background: var(--bg-hover);
    transition: background 0.3s;
  }

  .mr-step-line.done {
    background: var(--accent-color);
  }

  /* ---------------- 表单通用 ---------------- */

  .match-form {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field-group-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.06em;
    color: var(--text-tertiary);
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-row {
    display: flex;
    gap: 12px;
  }

  .field-row .field {
    flex: 1;
    min-width: 0;
  }

  .field-label {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .input {
    width: 100%;
    padding: 8px 12px;
    font-size: 14px;
    color: var(--text-primary);
    background: var(--bg-primary);
    border: 1px solid var(--border-color);
    border-radius: 8px;
    outline: none;
    box-sizing: border-box;
    transition:
      border-color 0.15s,
      box-shadow 0.15s;
  }

  .input:focus {
    border-color: var(--accent-color, #4f46e5);
    box-shadow: 0 0 0 3px color-mix(in oklab, var(--accent-color) 15%, transparent);
  }

  .input:disabled {
    opacity: 0.6;
  }

  .select {
    appearance: auto;
  }

  .textarea {
    resize: vertical;
    min-height: 40px;
    font-family: inherit;
    line-height: 1.5;
  }

  .mini-label {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  /* ---------------- 赛制分段 ---------------- */

  .format-pills {
    display: flex;
    gap: 8px;
  }

  .format-pill {
    flex: 1;
    padding: 9px 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px solid var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .format-pill:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .format-pill.active {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
    box-shadow: 0 2px 8px color-mix(in oklab, var(--accent-color) 30%, transparent);
  }

  .format-hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 6px 10px;
    background: var(--bg-hover);
    border-radius: 8px;
  }

  /* ---------------- 传奇选择 ---------------- */

  .legend-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .legend-trigger {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    align-self: flex-start;
    padding: 8px 14px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px dashed var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .legend-trigger:hover,
  .legend-trigger.open {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 6%, transparent);
  }

  :global(.legend-trigger-chevron) {
    transition: transform 0.2s;
  }

  :global(.legend-trigger-chevron.flipped) {
    transform: rotate(180deg);
  }

  .legend-picked {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    align-self: flex-start;
    max-width: 100%;
    padding: 6px 10px 6px 6px;
    background: var(--bg-hover);
    border: 1px solid color-mix(in oklab, var(--accent-color) 35%, transparent);
    border-radius: 10px;
  }

  :global(.legend-picked-thumb) {
    width: 30px;
    aspect-ratio: 744 / 1040;
    object-fit: cover;
    border-radius: 5px;
    flex-shrink: 0;
    background: var(--bg-secondary);
  }

  .legend-picked-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
  }

  .legend-picked-clear {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .legend-picked-clear:hover {
    background: var(--bg-active);
    color: var(--danger-color, #dc2626);
  }

  .legend-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-primary);
  }

  .legend-search {
    width: 100%;
  }

  .legend-hint {
    padding: 6px 2px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .legend-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    overflow-x: auto;
    padding: 4px 2px 8px;
    max-height: 150px;
    scrollbar-width: thin;
  }

  .legend-row::-webkit-scrollbar {
    height: 6px;
  }

  .legend-row::-webkit-scrollbar-thumb {
    background: var(--border-color);
    border-radius: 3px;
  }

  .legend-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    width: 62px;
    padding: 4px 4px 6px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .legend-item:hover {
    background: var(--bg-hover);
    border-color: var(--border-color);
  }

  .legend-item-name {
    font-size: 11px;
    color: var(--text-secondary);
    max-width: 58px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.legend-thumb) {
    width: 42px;
    aspect-ratio: 744 / 1040;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  /* ---------------- 系列比分看板 ---------------- */

  .scoreboard {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    overflow: hidden;
  }

  .scoreboard::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(
      120% 140% at 50% -20%,
      color-mix(in oklab, var(--accent-color) 12%, transparent),
      transparent 60%
    );
    pointer-events: none;
  }

  .sb-head {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.05em;
    color: var(--text-tertiary);
  }

  .sb-body {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
  }

  .sb-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sb-name.sb-me {
    color: var(--accent-color);
  }

  .sb-score {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 26px;
    font-weight: 800;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .sb-score b {
    min-width: 1.2em;
    text-align: center;
  }

  .sb-colon {
    color: var(--text-tertiary);
    font-weight: 600;
  }

  .sb-draw {
    font-size: 12px;
    color: var(--text-tertiary);
    background: var(--bg-hover);
    padding: 2px 8px;
    border-radius: 999px;
  }

  .sb-tag {
    position: absolute;
    top: 10px;
    right: 12px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 999px;
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .scoreboard.leading .sb-tag {
    color: #16a34a;
    background: color-mix(in srgb, #16a34a 12%, transparent);
  }

  .scoreboard.trailing .sb-tag {
    color: #dc2626;
    background: color-mix(in srgb, #dc2626 12%, transparent);
  }

  .scoreboard.won .sb-tag {
    color: #fff;
    background: #16a34a;
  }

  .sb-goal {
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-color);
  }

  /* ---------------- 小局卡片 ---------------- */

  .games-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .game-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px;
    border: 1px solid var(--border-color);
    border-radius: 12px;
    background: var(--bg-primary);
    transition: border-color 0.15s;
  }

  .game-card:focus-within {
    border-color: color-mix(in oklab, var(--accent-color) 45%, transparent);
  }

  .game-card-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .game-number {
    font-size: 13px;
    font-weight: 700;
    color: var(--text-primary);
    white-space: nowrap;
  }

  .game-result-pill-wrap {
    flex: 1;
    display: flex;
    justify-content: center;
  }

  .result-pill {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 56px;
    padding: 3px 14px;
    font-size: 13px;
    font-weight: 800;
    border-radius: 999px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    animation: pill-pop 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  @keyframes pill-pop {
    from {
      transform: scale(0.7);
      opacity: 0.4;
    }
    to {
      transform: scale(1);
      opacity: 1;
    }
  }

  .result-pill.win {
    color: #fff;
    background: #16a34a;
  }

  .result-pill.loss {
    color: #fff;
    background: #dc2626;
  }

  .result-pill.draw {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .game-remove {
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    background: color-mix(in srgb, #dc2626 10%, transparent);
    color: #dc2626;
  }

  /* 结果大按钮 */
  .result-main {
    display: flex;
    gap: 8px;
  }

  .result-main-btn {
    flex: 1;
    padding: 11px 0;
    font-size: 14px;
    font-weight: 700;
    color: var(--text-secondary);
    background: var(--bg-primary);
    border: 1.5px solid var(--border-color);
    border-radius: 10px;
    cursor: pointer;
    transition: all 0.18s;
  }

  .result-main-btn.win:hover {
    border-color: #16a34a;
    color: #16a34a;
  }

  .result-main-btn.win.active {
    background: color-mix(in srgb, #16a34a 12%, transparent);
    border-color: #16a34a;
    color: #16a34a;
    box-shadow: 0 2px 8px color-mix(in srgb, #16a34a 22%, transparent);
  }

  .result-main-btn.loss:hover {
    border-color: #dc2626;
    color: #dc2626;
  }

  .result-main-btn.loss.active {
    background: color-mix(in srgb, #dc2626 12%, transparent);
    border-color: #dc2626;
    color: #dc2626;
    box-shadow: 0 2px 8px color-mix(in srgb, #dc2626 22%, transparent);
  }

  .result-main-btn.draw:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .result-main-btn.draw.active {
    background: color-mix(in oklab, var(--accent-color) 12%, transparent);
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  /* 结束方式 */
  .end-type-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .end-type-pills {
    display: flex;
    gap: 6px;
    flex: 1;
    flex-wrap: wrap;
  }

  .end-type-btn {
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .end-type-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .end-type-btn.active {
    color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 10%, transparent);
    border-color: var(--accent-color);
    font-weight: 600;
  }

  /* 比分步进器 */
  .score-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
  }

  .score-side {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .score-side-label {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .score-input {
    width: 64px;
    text-align: center;
    font-size: 18px;
    font-weight: 700;
    padding: 7px 4px;
    font-variant-numeric: tabular-nums;
  }

  .score-input::-webkit-inner-spin-button {
    opacity: 0.25;
  }

  .step-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--bg-primary);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .step-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 6%, transparent);
  }

  .step-btn:active:not(:disabled) {
    transform: scale(0.92);
  }

  .step-btn:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }

  .score-sep {
    color: var(--text-tertiary);
    font-size: 22px;
    font-weight: 700;
    /* 与步进器（位于"我方/对方"标签下方）视觉居中 */
    padding-bottom: 21px;
  }

  /* 先后手 */
  .turn-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .turn-toggle-label {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .turn-btn {
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

  .turn-btn:hover {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .turn-btn.active {
    color: #fff;
    background: var(--accent-color);
    border-color: var(--accent-color);
    font-weight: 600;
  }

  .turn-required {
    font-size: 11px;
    color: var(--text-tertiary);
    margin-left: 2px;
  }

  /* 复盘折叠 */
  .review-toggle {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    align-self: flex-start;
    padding: 2px 0;
    border: none;
    background: transparent;
    font-size: 12px;
    font-weight: 500;
    color: var(--text-tertiary);
    cursor: pointer;
    transition: color 0.15s;
  }

  .review-toggle:hover,
  .review-toggle.open {
    color: var(--accent-color);
  }

  :global(.review-chevron) {
    transition: transform 0.2s;
  }

  :global(.review-chevron.flipped) {
    transform: rotate(180deg);
  }

  .review-input {
    margin-top: -2px;
  }

  /* ---------------- 底部 ---------------- */

  .footer-summary {
    margin-right: auto;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
  }

  .form-error {
    padding: 10px 12px;
    font-size: 13px;
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 8px;
    animation: shake 0.3s ease;
  }

  @keyframes shake {
    0%,
    100% {
      transform: translateX(0);
    }
    25% {
      transform: translateX(-4px);
    }
    75% {
      transform: translateX(4px);
    }
  }

  @media (max-width: 520px) {
    .mr-header {
      padding: 16px 16px 12px;
    }

    .field-row {
      flex-direction: column;
      gap: 14px;
    }

    .end-type-row {
      align-items: flex-start;
      flex-direction: column;
      gap: 6px;
    }

    .sb-tag {
      position: static;
      align-self: center;
    }

    .sb-body {
      flex-wrap: wrap;
    }
  }
</style>
