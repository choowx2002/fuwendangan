<script lang="ts">
  import { downloadState, dismissDownload, toggleDownloadExpanded } from '$lib/stores/ui-store.svelte'
  import { cancelCardImageDownload } from '$lib/services/card-image-download-service'
  import { t } from 'svelte-i18n'
  import { Download, Minus, X, CircleCheck, CircleAlert, Ban } from '@lucide/svelte'

  let cancelling = $state(false)

  let autoHideTimer: ReturnType<typeof setTimeout> | undefined

  $effect(() => {
    if (
      downloadState.active &&
      (downloadState.status === 'success' || downloadState.status === 'cancelled')
    ) {
      autoHideTimer = setTimeout(() => dismissDownload(), 4000)
      return () => {
        if (autoHideTimer) clearTimeout(autoHideTimer)
      }
    }
  })

  $effect(() => {
    if (downloadState.status !== 'downloading') {
      cancelling = false
    }
  })

  function handleCancel() {
    cancelling = true
    cancelCardImageDownload()
  }

  const percent = $derived(
    downloadState.total > 0
      ? Math.min((downloadState.completed / downloadState.total) * 100, 100)
      : 0
  )

  const isFinish = $derived(downloadState.status !== 'downloading')

  const finishTitle = $derived.by(() => {
    switch (downloadState.status) {
      case 'success':
        return $t('download.finishSuccess')
      case 'partial':
        return $t('download.finishPartial')
      case 'cancelled':
        return $t('download.finishCancelled')
      case 'error':
        return $t('download.finishError')
    }
  })

  const finishSub = $derived.by(() => {
    const success = downloadState.completed - downloadState.failed
    switch (downloadState.status) {
      case 'success':
        return $t('download.subSuccess', { values: { count: downloadState.completed } })
      case 'partial':
        return $t('download.subPartial', { values: { success, failed: downloadState.failed } })
      case 'cancelled':
        return $t('download.subCancelled', { values: { count: downloadState.completed } })
      case 'error':
        return $t('download.subError')
    }
  })
</script>

{#if downloadState.active}
  {#if isFinish}
    <div class="download-bar" class:finish={isFinish}>
      <div
        class="finish-card"
        class:success={downloadState.status === 'success'}
        class:partial={downloadState.status === 'partial'}
        class:cancelled={downloadState.status === 'cancelled'}
        class:error={downloadState.status === 'error'}
      >
        <div class="finish-icon">
          {#if downloadState.status === 'success'}
            <CircleCheck size={28} />
          {:else if downloadState.status === 'cancelled'}
            <Ban size={28} />
          {:else}
            <CircleAlert size={28} />
          {/if}
        </div>
        <div class="finish-info">
          <strong>{finishTitle}</strong>
          <span>{finishSub}</span>
        </div>
        <button class="finish-close" aria-label={$t('common.close')} onclick={dismissDownload}>
          <X size={16} />
        </button>
      </div>
    </div>
  {:else if downloadState.expanded}
    <div class="download-bar">
      <div class="progress-card">
        <div class="bar-header">
          <span class="bar-icon"><Download size={16} /></span>
          <span class="bar-title">{$t('download.title')}</span>
          <span class="bar-percent">{Math.round(percent)}%</span>
          <button
            class="minimize-btn"
            aria-label={$t('download.minimize')}
            title={$t('download.minimize')}
            onclick={toggleDownloadExpanded}
          >
            <Minus size={14} />
          </button>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style={`width: ${percent}%`}></div>
        </div>

        <div class="bar-footer">
          <button class="cancel-btn" disabled={cancelling} onclick={handleCancel}>
            <X size={14} />
            {cancelling ? $t('download.cancelling') : $t('download.cancel')}
          </button>
        </div>
      </div>
    </div>
  {:else}
    <button
      class="min-circle"
      title={$t('download.expand')}
      aria-label={$t('download.expand')}
      onclick={toggleDownloadExpanded}
    >
      {Math.round(percent)}%
    </button>
  {/if}
{/if}

<style>
  .download-bar {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9000;
    animation: slideUp 0.25s ease;
  }

  /* 移动端上移到底部导航之上（BottomNav 高 56px + safe-area） */
  @media (max-width: 767.99px) {
    .download-bar {
      bottom: calc(56px + env(safe-area-inset-bottom) + 12px);
    }
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translate(-50%, 12px);
    }
    to {
      opacity: 1;
      transform: translate(-50%, 0);
    }
  }

  .progress-card {
    width: min(320px, calc(100vw - 32px));
    padding: 12px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  }

  .bar-header {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .bar-icon {
    display: inline-flex;
    align-items: center;
    color: var(--accent-color);
  }

  .bar-title {
    font-weight: 600;
  }

  .bar-percent {
    margin-left: auto;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .minimize-btn {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 50%;
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
    transition:
      color 0.15s,
      background 0.15s;
  }

  .minimize-btn:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .min-circle {
    position: fixed;
    right: 16px;
    bottom: 20px;
    z-index: 9000;
    width: 56px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--accent-color);
    color: white;
    font-size: var(--text-sm);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    cursor: pointer;
    animation: popIn 0.25s ease;
  }

  @media (max-width: 767.99px) {
    .min-circle {
      bottom: calc(56px + env(safe-area-inset-bottom) + 12px);
    }
  }

  @keyframes popIn {
    from {
      opacity: 0;
      transform: scale(0.6);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .progress-track {
    height: 8px;
    margin: 10px 0 12px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--bg-hover);
  }

  .progress-fill {
    height: 100%;
    border-radius: inherit;
    background: var(--accent-color);
    transition: width 0.25s ease;
  }

  .bar-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
  }

  .cancel-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid color-mix(in oklab, var(--accent-color) 30%, transparent);
    border-radius: var(--radius-md);
    color: var(--accent-color);
    background: color-mix(in oklab, var(--accent-color) 8%, var(--surface));
    font-size: var(--text-sm);
    cursor: pointer;
    white-space: nowrap;
  }

  .cancel-btn:hover:not(:disabled) {
    background: color-mix(in oklab, var(--accent-color) 15%, var(--surface));
  }

  .cancel-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .finish-card {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 300px;
    padding: 12px 14px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-lg);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  }

  .finish-icon {
    flex: 0 0 auto;
    display: inline-flex;
  }

  .finish-card.success .finish-icon {
    color: #0f7b6c;
  }

  .finish-card.partial .finish-icon,
  .finish-card.error .finish-icon {
    color: #e03e3e;
  }

  .finish-card.cancelled .finish-icon {
    color: var(--text-tertiary);
  }

  .finish-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .finish-info strong {
    font-size: var(--text-base);
    color: var(--text-primary);
  }

  .finish-info span {
    font-size: var(--text-sm);
    color: var(--text-secondary);
  }

  .finish-close {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .finish-close:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }
</style>
