<script lang="ts">
  import { Check, Plus, Trash2, X } from '@lucide/svelte'
  import { t } from '$lib/i18n'

  let {
    selectedCount = 0,
    busy = false,
    onMark = undefined as (() => void) | undefined,
    onIncrement = undefined as (() => void) | undefined,
    onDelete = undefined as (() => void) | undefined,
    onCancel = undefined as (() => void) | undefined,
  } = $props()
</script>

<div class="batch-toolbar">
  <span class="batch-info"
    >{$t('collection.batchSelected', { values: { count: selectedCount } })}</span
  >
  <div class="batch-actions">
    <button class="batch-btn" onclick={onMark} disabled={busy || selectedCount === 0}>
      <Check size={14} />
      {$t('collection.batchMark')}
    </button>
    <button class="batch-btn" onclick={onIncrement} disabled={busy || selectedCount === 0}>
      <Plus size={14} />
      {$t('collection.batchNormalInc')}
    </button>
    <button class="batch-btn danger" onclick={onDelete} disabled={busy || selectedCount === 0}>
      <Trash2 size={14} />
      {$t('collection.batchDelete')}
    </button>
    <button class="batch-btn" onclick={onCancel} disabled={busy}>
      <X size={14} />
      {$t('common.cancel')}
    </button>
  </div>
</div>

<style>
  .batch-toolbar {
    position: sticky;
    bottom: 12px;
    z-index: 20;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    flex-wrap: wrap;
    padding: 10px 16px;
    border-radius: 12px;
    border: 1px solid var(--accent-color);
    background: var(--bg-secondary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
    margin: 0 2px 12px;
  }

  .batch-info {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--accent-color);
  }

  .batch-actions {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .batch-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
    transition: all 0.15s;
  }

  .batch-btn:hover:not(:disabled) {
    border-color: var(--accent-color);
    color: var(--accent-color);
  }

  .batch-btn.danger:hover:not(:disabled) {
    border-color: #ef4444;
    color: #ef4444;
  }

  .batch-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
