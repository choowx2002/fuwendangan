<script lang="ts">
  import type { CardPrint, CardWithOwned, CollectionLang } from '$lib/db'
  import { getCardCollection, upsertLangQty, getCustomLanguages } from '$lib/db'
  import { PRESET_LANGUAGE_CODES, languageDisplayName } from '$lib/db'
  import { X, Plus, Trash2, Pencil } from '@lucide/svelte'
  import CachedImage from '../cards/CachedImage.svelte'
  import FoilCard from '../cards/FoilCard.svelte'
  import CustomPrintModal from './CustomPrintModal.svelte'
  import {
    type VariantBucket,
    BUCKET_LABELS,
    classifyVariant,
  } from '$lib/cards/utils/variant-utils'
  import { isTauri } from '$lib/db/env'

  interface Props {
    card: (CardWithOwned & { card_prints?: CardPrint[] }) | null
    isOpen: boolean
    onClose: () => void
    onChanged: () => void
  }

  let { card, isOpen, onClose, onChanged }: Props = $props()

  interface VariantView {
    cardNoExtend: string
    prints: CardPrint[]
    bucket: VariantBucket
    isCustom: boolean
    hasFoil: boolean
    totalOwned: number
    langs: CollectionLang[]
  }

  let variants = $state<VariantView[]>([])
  let selectedNo = $state('')
  let newLangInput = $state('SC')
  let langOptions = $state<string[]>([...PRESET_LANGUAGE_CODES])
  let customLangNames = $state(new Map<string, string>())
  let showCustomForm = $state(false)
  let editCustomPrint = $state<CardPrint | null>(null)
  let loadId = 0

  const selectedVariant = $derived(variants.find((v) => v.cardNoExtend === selectedNo))

  const bucketRank: Record<VariantBucket, number> = {
    rune: 0,
    token: 1,
    base: 2,
    alt: 3,
    overnum: 4,
  }

  const sortedVariants = $derived(
    [...variants].sort(
      (a, b) =>
        bucketRank[a.bucket] - bucketRank[b.bucket] || a.cardNoExtend.localeCompare(b.cardNoExtend)
    )
  )

  async function loadData() {
    if (!card) return
    const customs = await getCustomLanguages()
    customLangNames = new Map(customs.map((c) => [c.code, c.name]))
    langOptions = [...PRESET_LANGUAGE_CODES, ...customs.map((c) => c.code)]
    const printList = card.card_prints ?? []
    const map = new Map<string, CardPrint[]>()
    for (const p of printList) {
      const no = p.card_no_extend ?? card.id
      if (!map.has(no)) map.set(no, [])
      map.get(no)!.push(p)
    }
    const langMap = await getCardCollection(card.id)

    let next: VariantView[] = Array.from(map.entries()).map(([no, prints]) => {
      const langs = langMap.get(no) ?? []
      const bucket = classifyVariant(card.card_category, prints[0]?.extend_rarity_name)
      return {
        cardNoExtend: no,
        prints,
        bucket,
        isCustom: prints.some((p) => p.is_custom),
        hasFoil: langs.some((l) => l.foil_qty > 0),
        totalOwned: langs.reduce((a, l) => a + (l.normal_qty ?? 0) + (l.foil_qty ?? 0), 0),
        langs,
      }
    })
    variants = next
    selectedNo = next.find((v) => v.hasFoil)?.cardNoExtend ?? next[0]?.cardNoExtend ?? ''
  }

  $effect(() => {
    if (!isOpen || !card) {
      variants = []
      selectedNo = ''
      showCustomForm = false
      editCustomPrint = null
      return
    }
    const id = ++loadId
    void loadData().then(() => {
      if (id !== loadId) return
    })
  })

  function saveAndReload(no: string, lang: string, patch: { normal?: number; foil?: number }) {
    void upsertLangQty(card!.id, no, lang, patch).then(() => {
      void loadData().then(() => {
        onChanged?.()
      })
    })
  }

  function addLangTo(v: VariantView) {
    const lang = newLangInput.trim()
    if (!lang) return
    if (v.langs.some((l) => l.language_code === lang)) return
    saveAndReload(v.cardNoExtend, lang, { normal: 0, foil: 0 })
    newLangInput = 'SC'
  }

  function openEdit(v: VariantView) {
    const custom = v.prints.find((p) => p.is_custom) ?? v.prints[0]
    editCustomPrint = custom
    showCustomForm = true
  }

  async function removeCustom(v: VariantView) {
    const custom = v.prints.find((p) => p.is_custom)
    if (!custom) return
    const { deleteCustomPrint } = await import('$lib/db')
    const token = await deleteCustomPrint(custom.id)
    if (token) {
      const { deleteCachedImage } = await import('$lib/services/db-file-service')
      await deleteCachedImage(token)
    }
    await loadData()
    onChanged?.()
  }

  function openCreateCustom() {
    editCustomPrint = null
    showCustomForm = true
  }
</script>

{#if isOpen && card}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" onclick={onClose} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="modal-content" onclick={(e) => e.stopPropagation()}>
      <button class="close-btn" onclick={onClose} aria-label="关闭">
        <X size={20} />
      </button>

      <div class="modal-header">
        <h2 class="card-title">{card.card_name_cn} <small>{card.card_name_en}</small></h2>
        <span class="card-no">{card.card_no}</span>
      </div>

      <div class="modal-body">
        <div class="preview-col">
          <div class="preview-card">
            {#if selectedVariant?.prints[0] && selectedVariant.hasFoil}
              <FoilCard
                print={selectedVariant.prints[0]}
                cardName={card.card_name_cn ?? ''}
                rarity={selectedVariant.prints[0]?.extend_rarity_name ?? card.rarity_name ?? ''}
                size="md"
              />
            {:else if selectedVariant?.prints[0]}
              <CachedImage
                src={selectedVariant.prints[0].img_cdn ?? selectedVariant.prints[0].tts_cdn ?? ''}
                name={`${card.id}-${selectedVariant.prints[0].id || 'default'}`}
                fit="cover"
                borderRadius="8px"
                isHover={false}
              />
            {:else}
              <div class="no-image">无图</div>
            {/if}
          </div>

          <div class="variant-tabs">
            {#each sortedVariants as v (v.cardNoExtend)}
              <button
                class="variant-tab"
                class:active={selectedNo === v.cardNoExtend}
                class:foil={v.hasFoil}
                onclick={() => (selectedNo = v.cardNoExtend)}
                title={`${v.cardNoExtend}${v.hasFoil ? '（有闪卡）' : ''}`}
              >
                {BUCKET_LABELS[v.bucket]}
                {#if v.isCustom}<em>*</em>{/if}
              </button>
            {/each}
          </div>
        </div>

        <div class="edit-col">
          {#if sortedVariants.length === 0}
            <p class="empty-tip">该卡暂无卡图打印，可新建自定打印。</p>
          {/if}

          {#each sortedVariants as v (v.cardNoExtend)}
            <div class="variant-block">
              <div class="variant-head">
                <button
                  class="variant-no"
                  class:active={selectedNo === v.cardNoExtend}
                  onclick={() => (selectedNo = v.cardNoExtend)}
                >
                  {v.cardNoExtend}
                </button>
                <span class="chip">{BUCKET_LABELS[v.bucket]}</span>
                {#if card.card_no && v.cardNoExtend.toUpperCase().slice(0, 3) !== card.card_no.toUpperCase().slice(0, 3)}
                  <span class="chip proto">原型 {card.card_no}</span>
                {/if}
                {#if v.isCustom}
                  <span class="chip promo">自定</span>
                {/if}
                <span class="chip">{v.totalOwned}</span>
              </div>

              {#if v.langs.length === 0}
                <p class="empty-langs-hint">暂无收藏数量，选择语言后点「添加语言」</p>
              {/if}

              {#each v.langs as l (l.id)}
                <div class="lang-row">
                  <span class="lang-name"
                    >{languageDisplayName(l.language_code, customLangNames)}</span
                  >
                  <div class="stepper">
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language_code, {
                          normal: (l.normal_qty ?? 0) - 1,
                        })}>-</button
                    >
                    <span class="qty">普卡 {l.normal_qty ?? 0}</span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language_code, {
                          normal: (l.normal_qty ?? 0) + 1,
                        })}>+</button
                    >
                    <span class="divider"></span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language_code, {
                          foil: (l.foil_qty ?? 0) - 1,
                        })}>-</button
                    >
                    <span class="qty qty-foil">闪卡 {l.foil_qty ?? 0}</span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language_code, {
                          foil: (l.foil_qty ?? 0) + 1,
                        })}>+</button
                    >
                  </div>
                </div>
              {/each}

              <div class="add-lang-row">
                <select
                  class="lang-input"
                  bind:value={newLangInput}
                  title="选择要添加的语言"
                >
                  {#each langOptions as code (code)}
                    {@const added = v.langs.some((l) => l.language_code === code)}
                    <option value={code} disabled={added}>
                      {languageDisplayName(code, customLangNames)}{added ? '（已添加）' : ''}
                    </option>
                  {/each}
                </select>
                <button
                  class="btn-mini"
                  onclick={() => addLangTo(v)}
                  disabled={v.langs.some((l) => l.language_code === newLangInput)}
                >
                  <Plus size={13} /> 添加语言
                </button>
              </div>

              {#if isTauri && v.isCustom}
                <div class="custom-actions">
                  <button class="btn-mini" onclick={() => openEdit(v)}>
                    <Pencil size={13} /> 编辑
                  </button>
                  <button class="btn-mini danger" onclick={() => removeCustom(v)}>
                    <Trash2 size={13} /> 删除
                  </button>
                </div>
              {/if}
            </div>
          {/each}

          <div class="toolbar">
            <button class="btn-mini" onclick={openCreateCustom}>
              <Plus size={13} /> 自定打印
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <CustomPrintModal
    cardId={card?.id ?? ''}
    cardNo={card?.card_no ?? ''}
    editPrint={editCustomPrint}
    isOpen={showCustomForm}
    onClose={() => {
      showCustomForm = false
      editCustomPrint = null
    }}
    onSaved={() => {
      void loadData()
      onChanged?.()
    }}
  />
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  .modal-content {
    background: var(--bg-primary);
    width: 100%;
    max-width: 880px;
    max-height: 90vh;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .close-btn {
    position: absolute;
    top: 14px;
    right: 14px;
    z-index: 10;
    background: rgba(255, 255, 255, 0.9);
    border: none;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    color: var(--text-primary);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 18px 24px 0;
  }

  .card-title {
    margin: 0;
    font-size: var(--text-2xl);
    color: var(--text-primary);
  }

  .card-title small {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-left: 6px;
  }

  .card-no {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .modal-body {
    display: flex;
    gap: 24px;
    padding: 18px 24px 24px;
    overflow-y: auto;
  }

  .preview-col {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  .no-image {
    width: 210px;
    height: 294px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: var(--bg-secondary);
    color: var(--text-tertiary);
  }

  .variant-tabs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .variant-tab {
    padding: 4px 10px;
    border-radius: 99px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .variant-tab.active {
    border-color: var(--accent-color);
    color: var(--accent-color);
    font-weight: 600;
  }

  .variant-tab.foil:not(.active) {
    border-color: #eab308;
    color: #eab308;
  }

  .edit-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  .empty-tip {
    color: var(--text-secondary);
  }

  .variant-block {
    border: 1px solid var(--border-color);
    border-radius: 10px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .variant-head {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .variant-no {
    font-weight: 600;
    font-size: var(--text-sm);
    cursor: pointer;
    border: none;
    background: transparent;
    padding: 0;
    color: var(--text-primary);
  }

  .variant-no.active {
    color: var(--accent-color);
  }

  .chip {
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: 99px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    color: var(--text-primary);
  }

  .chip.promo {
    border-color: rgba(168, 85, 247, 0.4);
    color: #a855f7;
  }

  .chip.proto {
    border-color: rgba(59, 130, 246, 0.4);
    color: #3b82f6;
  }

  .empty-langs-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    margin: 0;
  }

  .add-lang-row {
    display: flex;
    align-items: center;
    gap: 8px;
    border-top: 1px dashed var(--border-color);
    padding-top: 8px;
  }

  .add-lang-row .lang-input {
    flex: 1;
  }

  .lang-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .lang-name {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    min-width: 96px;
  }

  .stepper {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .stepper button {
    width: 26px;
    height: 26px;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background: var(--bg-secondary);
    color: var(--text-primary);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .stepper button:hover {
    border-color: var(--accent-color);
  }

  .qty {
    min-width: 56px;
    text-align: center;
    font-size: var(--text-sm);
  }

  .qty-foil {
    color: #eab308;
  }

  .divider {
    width: 1px;
    height: 18px;
    background: var(--border-color);
    margin: 0 6px;
  }

  .custom-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .btn-mini {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 10px;
    border-radius: 6px;
    border: 1px solid var(--border-color);
    background: transparent;
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .btn-mini:hover {
    color: var(--accent-color);
    border-color: var(--accent-color);
  }

  .btn-mini.danger:hover {
    color: #ef4444;
    border-color: #ef4444;
  }

  .btn-mini:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .lang-input {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  select.lang-input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .modal-content {
    background: var(--bg-primary);
    width: 100%;
    max-width: min(960px, 100%);
    max-height: 90vh;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
  }

  .modal-body {
    display: grid;
    grid-template-columns: minmax(210px, 240px) minmax(0, 1fr);
    gap: 24px;
    padding: 18px 24px 24px;
    overflow-y: auto;
    align-items: start;
  }

  .preview-col {
    width: 100%;
    min-width: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }

  /* 关键：固定卡图比例，标准卡牌比例一般是 63:88 */
  .preview-card {
    width: min(100%, 230px);
    aspect-ratio: 63 / 88;
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-secondary);
    flex-shrink: 0;
  }

  /* 强制子组件根节点填满容器，避免 FoilCard / CachedImage 内部固定尺寸撑开 */
  .preview-card > :global(*) {
    width: 100% !important;
    height: 100% !important;
    border-radius: inherit;
  }

  /* 图片、canvas 等媒体内容统一 cover */
  .preview-card :global(img),
  .preview-card :global(canvas),
  .preview-card :global(svg),
  .preview-card :global(video) {
    width: 100% !important;
    height: 100% !important;
    object-fit: cover;
    display: block;
  }

  .no-image {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 0;
    background: var(--bg-secondary);
    color: var(--text-tertiary);
  }

  .variant-tabs {
    width: min(100%, 230px);
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .edit-col {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-width: 0;
  }

  @media (max-width: 600.99px) {
    .modal-body {
      grid-template-columns: 1fr;
    }

    .preview-card {
      width: min(100%, 220px);
    }

    .variant-tabs {
      width: min(100%, 220px);
    }
  }

  @media (min-width: 601px) {
    .preview-col {
      position: sticky;
      top: 0;
    }
  }
</style>
