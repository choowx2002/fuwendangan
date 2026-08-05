<script lang="ts">
  import type { CardPrint, CardWithOwned, CollectionLang } from '$lib/db'
  import { getCardCollection, upsertLangQty } from '$lib/db'
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
  let showCustomForm = $state(false)
  let editCustomPrint = $state<CardPrint | null>(null)
  let loadId = 0

  const selectedVariant = $derived(variants.find((v) => v.cardNoExtend === selectedNo))

  const bucketRank: Record<VariantBucket, number> = { rune: 0, token: 1, base: 2, alt: 3, overnum: 4 }

  const sortedVariants = $derived(
    [...variants].sort(
      (a, b) =>
        bucketRank[a.bucket] - bucketRank[b.bucket] || a.cardNoExtend.localeCompare(b.cardNoExtend)
    )
  )

  async function loadData() {
    if (!card) return
    const printList = card.card_prints ?? []
    const map = new Map<string, CardPrint[]>()
    for (const p of printList) {
      const no = p.card_no_extend ?? card.id
      if (!map.has(no)) map.set(no, [])
      map.get(no)!.push(p)
    }
    const langMap = await getCardCollection(card.id)

    const next: VariantView[] = Array.from(map.entries()).map(([no, prints]) => {
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

  function saveAndReload(
    no: string,
    lang: string,
    patch: { normal?: number; foil?: number }
  ) {
    void upsertLangQty(card!.id, no, lang, patch).then(() => {
      void loadData().then(() => {
        onChanged?.()
      })
    })
  }

  function addLangTo(v: VariantView) {
    const lang = newLangInput.trim()
    if (!lang) return
    if (v.langs.some((l) => l.language === lang)) return
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
          {#if selectedVariant?.prints[0] && selectedVariant.hasFoil}
            <FoilCard
              print={selectedVariant.prints[0]}
              cardName={card.card_name_cn ?? ''}
              rarity={(selectedVariant.prints[0]?.extend_rarity_name ?? card.rarity_name) ?? ''}
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
                {#if v.isCustom}
                  <span class="chip promo">自定</span>
                {/if}
                <span class="chip">{v.totalOwned}</span>
              </div>

              {#each v.langs as l (l.id)}
                <div class="lang-row">
                  <span class="lang-name">{l.language}</span>
                  <div class="stepper">
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language, {
                          normal: (l.normal_qty ?? 0) - 1,
                        })
                      }
                    >-</button>
                    <span class="qty">普 {(l.normal_qty ?? 0)}</span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language, {
                          normal: (l.normal_qty ?? 0) + 1,
                        })
                      }
                    >+</button>
                    <span class="divider"></span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language, {
                          foil: (l.foil_qty ?? 0) - 1,
                        })
                      }
                    >-</button>
                    <span class="qty qty-foil">闪 {(l.foil_qty ?? 0)}</span>
                    <button
                      onclick={() =>
                        saveAndReload(v.cardNoExtend, l.language, {
                          foil: (l.foil_qty ?? 0) + 1,
                        })
                      }
                    >+</button>
                  </div>
                </div>
              {/each}

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
            <input
              class="lang-input"
              placeholder="新语言，如 EN"
              bind:value={newLangInput}
              disabled={!selectedVariant}
              onkeydown={(e) => {
                if (e.key === 'Enter' && selectedVariant) addLangTo(selectedVariant)
              }}
            />
            <button
              class="btn-mini"
              onclick={() => selectedVariant && addLangTo(selectedVariant)}
              disabled={!selectedVariant}
            >
              <Plus size={13} /> 语言
            </button>
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

  .lang-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .lang-name {
    font-size: var(--text-sm);
    color: var(--text-secondary);
    min-width: 32px;
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
    min-width: 44px;
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

  @media (max-width: 600.99px) {
    .modal-body {
      flex-direction: column;
    }

    .preview-col {
      align-items: center;
    }
  }
</style>