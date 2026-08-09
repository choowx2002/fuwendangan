<script lang="ts">
  import { downloadState, dismissDownload } from '$lib/stores/ui-store.svelte'
  import { cancelCardImageDownload } from '$lib/services/card-image-download-service'
  import { formatBytes } from '$lib/db'
  import { t } from 'svelte-i18n'
  import {
    Download,
    X,
    Gauge,
    Timer,
    HardDrive,
    Image,
    CircleCheck,
    CircleAlert,
    Ban,
    ChevronDown,
  } from '@lucide/svelte'

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

  const speedText = $derived(
    downloadState.speedBps > 0 ? `${formatBytes(downloadState.speedBps, 1)}/s` : $t('common.calculating')
  )

  const downloadedText = $derived(formatBytes(downloadState.bytesDownloaded, 1))

  function formatEta(seconds: number): string {
    if (!seconds || seconds <= 0 || !isFinite(seconds)) return $t('common.calculating')
    if (seconds < 60) return $t('download.etaSeconds', { values: { count: Math.ceil(seconds) } })
    if (seconds < 3600) return $t('download.etaMinutes', { values: { count: Math.ceil(seconds / 60) } })
    return $t('download.etaHours', { values: { count: (seconds / 3600).toFixed(1) } })
  }

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
  <div class="download-bar" class:collapsed={!downloadState.expanded} class:finish={isFinish}>
    {#if isFinish}
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
    {:else if downloadState.expanded}
      <div class="progress-card">
        <div class="bar-header">
          <span class="bar-icon"><Download size={16} /></span>
          <span class="bar-title">{$t('download.title')}</span>
          <span class="bar-percent">{Math.round(percent)}%</span>
          <button
            class="bar-collapse"
            aria-label={$t('download.collapse')}
            onclick={() => (downloadState.expanded = false)}
          >
            <ChevronDown size={16} />
          </button>
        </div>

        <div class="progress-track">
          <div class="progress-fill" style={`width: ${percent}%`}></div>
        </div>

        <div class="stats-grid">
          <div class="stat">
            <span class="stat-icon"><Gauge size={14} /></span>
            <span>{speedText}</span>
          </div>
          <div class="stat">
            <span class="stat-icon"><Timer size={14} /></span>
            <span>{formatEta(downloadState.etaSeconds)}</span>
          </div>
          <div class="stat">
            <span class="stat-icon"><HardDrive size={14} /></span>
            <span>{downloadedText}</span>
          </div>
          <div class="stat">
            <span class="stat-icon"><Image size={14} /></span>
            <span>
              {downloadState.completed} / {downloadState.total}{#if downloadState.failed > 0}
                · {$t('download.failedCount', { values: { count: downloadState.failed } })}
              {/if}
            </span>
          </div>
        </div>

        <div class="bar-footer">
          <span class="bar-sub">{$t('download.hint')}</span>
          <button class="cancel-btn" disabled={cancelling} onclick={handleCancel}>
            <X size={14} />
            {cancelling ? $t('download.cancelling') : $t('download.cancel')}
          </button>
        </div>
      </div>
    {:else}
      <button
        class="pill"
        aria-label={$t('download.expand')}
        onclick={() => (downloadState.expanded = true)}
      >
        <span class="pill-icon"><Download size={16} /></span>
        <span class="pill-percent">{Math.round(percent)}%</span>
        <span class="pill-count">{downloadState.completed} / {downloadState.total}</span>
        <span class="pill-speed">{speedText}</span>
      </button>
    {/if}
  </div>
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
    width: min(380px, calc(100vw - 32px));
    padding: 14px 16px;
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

  .bar-collapse {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: 0;
    border-radius: var(--radius-sm);
    color: var(--text-tertiary);
    background: transparent;
    cursor: pointer;
  }

  .bar-collapse:hover {
    color: var(--text-primary);
    background: var(--bg-hover);
  }

  .progress-track {
    height: 8px;
    margin: 12px 0 14px;
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

  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 16px;
    margin-bottom: 12px;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--text-secondary);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
  }

  .stat-icon {
    flex: 0 0 auto;
    color: var(--text-tertiary);
  }

  .stat span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    border-top: 1px solid var(--border-color);
    padding-top: 10px;
  }

  .bar-sub {
    color: var(--text-tertiary);
    font-size: 11px;
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

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: var(--bg-secondary);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
    color: var(--text-primary);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .pill-icon {
    display: inline-flex;
    align-items: center;
    color: var(--accent-color);
  }

  .pill-percent {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .pill-count {
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
  }

  .pill-speed {
    padding: 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
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
