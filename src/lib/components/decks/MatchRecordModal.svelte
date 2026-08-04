<script lang="ts">
  import { ChevronLeft, ChevronRight, Plus, Save, Trash2, Search, X } from '@lucide/svelte'
  import CardSimpleImage from '$lib/components/cards/CardSimpleImage.svelte'
  import CommonModal from '$lib/components/ui/CommonModal.svelte'
  import {
    createMatch,
    getBestPrint,
    getDeckVersions,
    getMatchGroups,
    searchCards,
    updateMatch,
  } from '$lib/db/index.js'
  import type { CardBase, CardPrint, MatchWinType, MatchWithGames } from '$lib/db/types'
  import type { DeckVersion } from '$lib/db/index.js'

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
    }
  }

  function resetDraft() {
    step = 1
    errorMsg = ''
    saving = false
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

  function addGame() {
    games = [...games, emptyGame()]
  }

  function removeGame(index: number) {
    if (games.length <= 1) return
    games = games.filter((_, i) => i !== index)
  }

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
  }

  function clearLegend() {
    oppLegend = null
  }

  function goToStep2() {
    errorMsg = ''
    const target = bestOf === '1' || bestOf === '3' || bestOf === '5' ? Number(bestOf) : 0
    if (!editing && target > 0 && games.every((g) => isUnusedGame(g))) {
      games = Array.from({ length: target }, () => emptyGame())
    }
    step = 2
  }

  function deriveResult(game: GameDraft): 'win' | 'loss' | 'draw' | null {
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

  function validate(): string | null {
    const filled = games.filter((g) => !isUnusedGame(g))
    if (filled.length === 0) return '至少需要记录一个小局'
    for (const game of filled) {
      if (game.isFirst === null) return '请选择先手或后手'
      if (game.winType === 'normal') {
        const my = scoreToStr(game.myScore).trim()
        const opp = scoreToStr(game.oppScore).trim()
        if (my === '' || opp === '') return '正常比分的对局需要填写双方积分'
        const myNum = Number(my)
        const oppNum = Number(opp)
        if (!Number.isInteger(myNum) || myNum < 0 || !Number.isInteger(oppNum) || oppNum < 0) {
          return '积分需为非负整数'
        }
      } else {
        for (const score of [scoreToStr(game.myScore).trim(), scoreToStr(game.oppScore).trim()]) {
          if (score === '') continue
          const num = Number(score)
          if (!Number.isInteger(num) || num < 0) return '积分需为非负整数'
        }
        if (game.winType === 'special' && !game.winReason.trim()) {
          return '特殊胜利请填写原因'
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
        if (game.winType === 'normal') {
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
      errorMsg = '保存失败，请重试'
    } finally {
      saving = false
    }
  }

  const title = $derived(editing ? '编辑对局' : '记录对局')
  const subtitle = $derived(`第 ${step} 步 / 共 2 步${step === 1 ? ' · 对局信息' : ' · 小局比分'}`)
</script>

<CommonModal {open} {title} {subtitle} width="min(680px, 100%)" closable={!saving} {onclose}>
  {#if step === 1}
    <div class="match-form">
      <label class="field">
        <span class="field-label">分组</span>
        <input
          class="input"
          type="text"
          placeholder="如：RQ比赛系列（选填）"
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

      <div class="field-row">
        <label class="field">
          <span class="field-label">对手名称</span>
          <input
            class="input"
            type="text"
            placeholder="选填"
            maxlength="50"
            bind:value={opponentName}
            disabled={saving}
          />
        </label>
        <label class="field">
          <span class="field-label">对手卡组</span>
          <input
            class="input"
            type="text"
            placeholder="选填"
            maxlength="50"
            bind:value={opponentDeck}
            disabled={saving}
          />
        </label>
      </div>

      <div class="field legend-field">
        <span class="field-label">对手传奇（选填）</span>
        <div class="legend-search">
          <Search size={14} class="legend-search-icon" />
          <input
            class="input"
            type="text"
            placeholder="搜索传奇卡牌…"
            maxlength="50"
            bind:value={legendQuery}
            disabled={saving}
          />
          {#if oppLegend}
            <button
              class="icon-btn legend-clear-btn"
              type="button"
              title="清除选择"
              onclick={clearLegend}
              disabled={saving}
            >
              <X size={14} />
            </button>
          {/if}
        </div>
        {#if legendLoading}
          <span class="legend-hint">加载中…</span>
        {:else if legendFiltered.length === 0}
          <span class="legend-hint">未找到匹配的传奇卡</span>
        {:else}
          <div class="legend-row">
            {#each legendFiltered as card (card.id)}
              {@const best = getBestPrint(card as CardBase & { card_prints?: CardPrint[] })}
              <button
                type="button"
                class="legend-item"
                class:selected={oppLegend?.id === card.id}
                title={card.card_name_cn || card.card_name_en || card.card_no}
                onclick={() => pickLegend(card)}
                disabled={saving}
              >
                <CardSimpleImage
                  url={best?.url}
                  name={`${card.id}-${best?.id ?? 'none'}`}
                  className="legend-thumb"
                />
                <!-- <span class="legend-item-name">
                  {card.card_name_cn || card.card_name_en || card.card_no}
                </span> -->
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="field-row">
        <label class="field">
          <span class="field-label">卡组版本</span>
          {#if deckVersions.length > 0}
            <select class="input select" bind:value={deckVersionId} disabled={saving}>
              <option value="">不关联</option>
              {#each deckVersions as v (v.id)}
                <option value={v.id}>
                  v{v.version_number}
                  {new Date(v.created_at ?? '').toLocaleDateString()}
                  {#if v.note}· {v.note}{/if}
                </option>
              {/each}
            </select>
          {:else}
            <input class="input" type="text" value="暂无版本" disabled />
          {/if}
        </label>
        <label class="field">
          <span class="field-label">对局日期</span>
          <input class="input" type="date" bind:value={playedAt} disabled={saving} />
        </label>
      </div>

      <div class="field-row">
        <label class="field">
          <span class="field-label">赛制</span>
          <select class="input select" bind:value={bestOf} disabled={saving}>
            <option value="1">BO1</option>
            <option value="3">BO3</option>
            <option value="5">BO5</option>
            <option value="">不限</option>
          </select>
        </label>
      </div>

      <label class="field">
        <span class="field-label">备注</span>
        <textarea
          class="input textarea"
          placeholder="对局整体备注（选填）"
          maxlength="500"
          rows="3"
          bind:value={note}
          disabled={saving}></textarea>
      </label>
    </div>
  {:else}
    <div class="match-form">
      <div class="games-header">
        <span class="field-label">小局列表</span>
        <button
          class="button button-ghost button-sm"
          type="button"
          onclick={addGame}
          disabled={saving}
        >
          <Plus size={14} /> 添加小局
        </button>
      </div>

      {#if !editing && (bestOf === '3' || bestOf === '5')}
        <p class="games-hint">
          已按 BO{bestOf} 预置 {bestOf} 局；只打了部分时，留空的小局会自动忽略
        </p>
      {/if}

      {#each games as game, index (index)}
        <div class="game-card">
          <div class="game-card-header">
            <span class="game-number">第 {index + 1} 局</span>
            <div class="game-end-type">
              <button
                type="button"
                class="end-type-btn"
                class:active={game.winType === 'normal'}
                onclick={() => (game.winType = 'normal')}
              >
                正常比分
              </button>
              <button
                type="button"
                class="end-type-btn"
                class:active={game.winType === 'concede'}
                onclick={() => (game.winType = 'concede')}
              >
                对方认输
              </button>
              <button
                type="button"
                class="end-type-btn"
                class:active={game.winType === 'special'}
                onclick={() => (game.winType = 'special')}
              >
                特殊胜利
              </button>
            </div>
            {#if games.length > 1}
              <button
                type="button"
                class="icon-btn game-remove"
                title="删除该小局"
                onclick={() => removeGame(index)}
                disabled={saving}
              >
                <Trash2 size={14} />
              </button>
            {/if}
          </div>

          <div class="turn-toggle">
            <span class="turn-toggle-label">先后手</span>
            <button
              type="button"
              class="end-type-btn"
              class:active={game.isFirst === true}
              onclick={() => (game.isFirst = game.isFirst === true ? null : true)}
              disabled={saving}
            >
              我方先手
            </button>
            <button
              type="button"
              class="end-type-btn"
              class:active={game.isFirst === false}
              onclick={() => (game.isFirst = game.isFirst === false ? null : false)}
              disabled={saving}
            >
              对方先手
            </button>
          </div>

          {#if game.winType === 'normal'}
            <div class="score-row">
              <input
                class="input score-input"
                type="number"
                min="0"
                placeholder="我方"
                bind:value={game.myScore}
                disabled={saving}
              />
              <span class="score-sep">:</span>
              <input
                class="input score-input"
                type="number"
                min="0"
                placeholder="对方"
                bind:value={game.oppScore}
                disabled={saving}
              />
              <span
                class="result-badge"
                class:win={deriveResult(game) === 'win'}
                class:loss={deriveResult(game) === 'loss'}
                class:draw={deriveResult(game) === 'draw'}
              >
                {deriveResult(game) === 'win'
                  ? '胜'
                  : deriveResult(game) === 'loss'
                    ? '负'
                    : deriveResult(game) === 'draw'
                      ? '平'
                      : '待比分'}
              </span>
            </div>
          {:else}
            <div class="score-row">
              <div class="result-toggle">
                <button
                  type="button"
                  class="end-type-btn"
                  class:active={game.result === 'win'}
                  onclick={() => (game.result = 'win')}
                >
                  我方胜
                </button>
                <button
                  type="button"
                  class="end-type-btn"
                  class:active={game.result === 'loss'}
                  onclick={() => (game.result = 'loss')}
                >
                  我方负
                </button>
              </div>
              <input
                class="input score-input"
                type="number"
                min="0"
                placeholder="比分可选"
                bind:value={game.myScore}
                disabled={saving}
              />
              <span class="score-sep">:</span>
              <input
                class="input score-input"
                type="number"
                min="0"
                placeholder="比分可选"
                bind:value={game.oppScore}
                disabled={saving}
              />
              <span
                class="result-badge"
                class:win={game.result === 'win'}
                class:loss={game.result === 'loss'}
              >
                {game.result === 'win' ? '胜' : '负'}
              </span>
            </div>
            <input
              class="input"
              type="text"
              placeholder={game.winType === 'concede'
                ? '原因（选填），如：对手第 3 回合认输'
                : '原因，如：集齐三枚符文规则胜利'}
              maxlength="100"
              bind:value={game.winReason}
              disabled={saving}
            />
          {/if}

          <textarea
            class="input textarea"
            placeholder="本局复盘记录（选填）……"
            maxlength="2000"
            rows="2"
            bind:value={game.log}
            disabled={saving}></textarea>
        </div>
      {/each}
    </div>
  {/if}

  {#if errorMsg}
    <div class="form-error">{errorMsg}</div>
  {/if}

  {#snippet footer()}
    {#if step === 1}
      <button class="button button-ghost" onclick={onclose} disabled={saving}>取消</button>
      <button class="button button-primary" onclick={goToStep2} disabled={saving}>
        下一步 <ChevronRight size={16} />
      </button>
    {:else}
      <button
        class="button button-ghost"
        onclick={() => {
          errorMsg = ''
          step = 1
        }}
        disabled={saving}
      >
        <ChevronLeft size={16} /> 上一步
      </button>
      <button class="button button-primary" onclick={save} disabled={saving}>
        <Save size={16} />
        {saving ? '保存中...' : '保存'}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  .match-form {
    display: flex;
    flex-direction: column;
    gap: 14px;
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
    transition: border-color 0.15s;
  }

  .input:focus {
    border-color: var(--accent-color, #4f46e5);
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

  .games-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .games-hint {
    margin: 0;
    font-size: 12px;
    color: var(--text-secondary);
    padding: 6px 10px;
    background: var(--bg-hover);
    border-radius: 8px;
  }

  .game-card {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: 10px;
    background: var(--bg-primary);
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

  .game-end-type {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .turn-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 10px;
  }

  .turn-toggle-label {
    font-size: 12px;
    color: var(--text-secondary);
    white-space: nowrap;
  }

  .end-type-btn {
    padding: 4px 10px;
    font-size: 12px;
    color: var(--text-secondary);
    background: transparent;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }

  .end-type-btn.active {
    color: #fff;
    background: var(--accent-color, #4f46e5);
    border-color: var(--accent-color, #4f46e5);
  }

  .game-remove {
    flex-shrink: 0;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s;
  }

  .icon-btn:hover {
    background: var(--bg-hover);
    color: var(--danger-color, #dc2626);
  }

  .score-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .score-input {
    width: 72px;
    text-align: center;
  }

  .score-sep {
    color: var(--text-secondary);
    font-weight: 700;
  }

  .result-toggle {
    display: flex;
    gap: 4px;
    flex: 1;
  }

  .result-badge {
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 700;
    border-radius: 999px;
    color: var(--text-secondary);
    background: var(--bg-hover);
    white-space: nowrap;
  }

  .result-badge.win {
    color: #fff;
    background: #16a34a;
  }

  .result-badge.loss {
    color: #fff;
    background: #dc2626;
  }

  .result-badge.draw {
    color: var(--text-secondary);
    background: var(--bg-hover);
  }

  .form-error {
    padding: 10px 12px;
    font-size: 13px;
    color: #dc2626;
    background: rgba(220, 38, 38, 0.08);
    border: 1px solid rgba(220, 38, 38, 0.3);
    border-radius: 8px;
  }

  .legend-field {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .legend-search {
    position: relative;
    display: flex;
    align-items: center;
  }

  :global(.legend-search-icon) {
    position: absolute;
    left: 10px;
    color: var(--text-secondary);
    pointer-events: none;
  }

  .legend-search .input {
    padding-left: 32px;
  }

  .legend-search .input:has(+ .legend-clear-btn) {
    padding-right: 36px;
  }

  .legend-clear-btn {
    position: absolute;
    right: 6px;
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
    padding: 6px 2px 10px;
    max-height: 176px;
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
    width: 64px;
    padding: 4px 4px 6px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .legend-item:hover {
    background: var(--bg-hover);
  }

  .legend-item.selected {
    border-color: var(--primary-color, #4f46e5);
    background: var(--bg-hover);
  }

  :global(.legend-thumb) {
    width: 44px;
    aspect-ratio: 744 / 1040;
    object-fit: cover;
    border-radius: 6px;
    flex-shrink: 0;
    background: var(--bg-hover);
  }

  @media (max-width: 520px) {
    .field-row {
      flex-direction: column;
      gap: 14px;
    }

    .game-end-type {
      flex-wrap: wrap;
    }
  }
</style>
