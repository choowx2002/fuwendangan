<script lang="ts">
  import { toastState, downloadState } from '$lib/stores/ui-store.svelte'
  import { CircleCheck, CircleAlert, Info } from '@lucide/svelte'
</script>

{#if toastState.show}
  <div
    class="toast"
    class:success={toastState.type === 'success'}
    class:error={toastState.type === 'error'}
    class:info={toastState.type === 'info'}
    class:above-download={downloadState.active}
  >
    <span class="toast-icon">
      {#if toastState.type === 'success'}
        <CircleCheck size={16} />
      {:else if toastState.type === 'error'}
        <CircleAlert size={16} />
      {:else}
        <Info size={16} />
      {/if}
    </span>
    <span>{toastState.msg}</span>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9500;
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: min(420px, calc(100vw - 32px));
    padding: 10px 16px;
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    background: var(--bg-secondary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
    color: var(--text-primary);
    font-size: var(--text-sm);
    animation: toast-in 0.2s ease;
  }

  .toast.above-download {
    bottom: 84px;
  }

  .toast-icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
  }

  .toast.success .toast-icon {
    color: #0f7b6c;
  }

  .toast.error .toast-icon {
    color: #e03e3e;
  }

  .toast.info .toast-icon {
    color: var(--accent-color);
  }

  @keyframes toast-in {
    from {
      opacity: 0;
      transform: translate(-50%, 10px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }
</style>
