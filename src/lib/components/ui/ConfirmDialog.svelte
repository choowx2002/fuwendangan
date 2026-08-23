<script lang="ts">
  import { dialogState, closeDialog, type DialogMode } from '$lib/stores/confirm-store.svelte'
  import CommonModal from './CommonModal.svelte'
  import { CircleAlert, Info, CircleCheck } from '@lucide/svelte'

  const mode: DialogMode = $derived(dialogState.mode)

  function handleClose() {
    closeDialog(false)
  }
</script>

<CommonModal
  open={dialogState.open}
  title={dialogState.title}
  width="380px"
  closeOnOverlay={false}
  onclose={handleClose}
>
  <div class="dialog-body">
    <div class="dialog-icon" class:danger={dialogState.danger}>
      {#if dialogState.icon === 'success'}
        <CircleCheck size={28} strokeWidth={1.75} />
      {:else if dialogState.icon === 'warning' || dialogState.icon === 'error'}
        <CircleAlert size={28} strokeWidth={1.75} />
      {:else}
        <Info size={28} strokeWidth={1.75} />
      {/if}
    </div>
    <p class="dialog-message">{dialogState.message}</p>
  </div>

  {#snippet footer()}
    {#if mode === 'confirm'}
      <button class="button button-ghost" onclick={handleClose}>{dialogState.cancelLabel}</button>
      <button
        class="button {dialogState.danger ? 'button-danger' : 'button-primary'}"
        onclick={() => closeDialog(true)}
      >
        {dialogState.okLabel}
      </button>
    {:else}
      <button class="button button-primary" onclick={() => closeDialog(true)}>
        {dialogState.okLabel}
      </button>
    {/if}
  {/snippet}
</CommonModal>

<style>
  .dialog-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    text-align: center;
  }

  .dialog-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: var(--bg-hover, rgba(0, 0, 0, 0.05));
    color: var(--text-secondary);
  }

  .dialog-icon.danger {
    color: #e03e3e;
    background: rgba(224, 62, 62, 0.12);
  }

  .dialog-message {
    margin: 0;
    font-size: var(--text-base, 14px);
    line-height: 1.6;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
  }
</style>
