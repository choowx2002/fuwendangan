<script lang="ts">
  import CommonModal from '../ui/CommonModal.svelte'
  import { t } from '$lib/i18n'

  interface WritebackVariantOption {
    cardNoExtend: string
    rarityName?: string | null
    extendRarityName?: string | null
    isCustom?: boolean
  }

  let {
    open,
    title = '',
    subtitle = '',
    cardName = '',
    cardNo = '',
    cardNoExtend = '',
    defaultQty = 1,
    ownedQty = 0,
    loanNote = '',
    variants = [] as WritebackVariantOption[],
    confirmLabel = '',
    onConfirm = null,
    onClose = null,
  }: {
    open: boolean
    title?: string
    subtitle?: string
    cardName?: string
    cardNo?: string
    /** 默认选中的印刷；为空时取 variants 第一项 */
    cardNoExtend?: string
    defaultQty?: number
    ownedQty?: number
    loanNote?: string
    variants?: WritebackVariantOption[]
    confirmLabel?: string
    onConfirm?: ((payload: { qty: number; cardNoExtend: string }) => void) | null
    onClose?: (() => void) | null
  } = $props()

  let qty = $state(1)
  let selectedVariant = $state('')

  $effect(() => {
    if (open) {
      qty = defaultQty
      selectedVariant = cardNoExtend || variants[0]?.cardNoExtend || ''
    }
  })

  function variantLabel(v: WritebackVariantOption): string {
    const parts = [v.cardNoExtend]
    if (v.extendRarityName) parts.push(v.extendRarityName)
    else if (v.rarityName) parts.push(v.rarityName)
    if (v.isCustom) parts.push($t('writeback.customPrint'))
    return parts.join(' · ')
  }

  function confirm() {
    const payload = {
      qty: Math.max(1, Number(qty) || 1),
      cardNoExtend: selectedVariant || variants[0]?.cardNoExtend || cardNoExtend,
    }
    if (!payload.cardNoExtend) return
    onConfirm?.(payload)
  }
</script>

<CommonModal
  {open}
  {title}
  {subtitle}
  closeOnOverlay={false}
  onclose={() => onClose?.()}
>
  <div class="wb-card">
    <div class="wb-name">{cardName || cardNo}</div>
    <div class="wb-owned">
      {ownedQty > 0
        ? $t('writeback.ownedHint', { values: { owned: ownedQty } })
        : $t('writeback.notOwnedHint')}
      {#if loanNote}
        <span class="wb-loan">{loanNote}</span>
      {/if}
    </div>
  </div>

  <div class="wb-field">
    <label class="wb-label" for="wb-qty">{$t('writeback.qty')}</label>
    <input class="wb-input" id="wb-qty" type="number" min="1" bind:value={qty} />
  </div>

  <div class="wb-field">
    <label class="wb-label" for="wb-variant">{$t('writeback.variant')}</label>
    <select class="wb-select" id="wb-variant" bind:value={selectedVariant}>
      {#each variants as v (v.cardNoExtend)}
        <option value={v.cardNoExtend}>{variantLabel(v)}</option>
      {/each}
    </select>
  </div>

  {#snippet footer()}
    <button class="button button-ghost" onclick={() => onClose?.()}>
      {$t('common.cancel')}
    </button>
    <button
      class="button button-primary"
      onclick={confirm}
      disabled={!(selectedVariant || variants[0])}
    >
      {confirmLabel || $t('common.confirm')}
    </button>
  {/snippet}
</CommonModal>

<style>
  .wb-card {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .wb-name {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-primary);
  }

  .wb-owned {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .wb-loan {
    color: #d97706;
  }

  .wb-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .wb-label {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .wb-input,
  .wb-select {
    padding: 9px 10px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-sm);
    background: var(--bg-secondary);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }
</style>
