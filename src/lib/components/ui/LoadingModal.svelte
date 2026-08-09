<script lang="ts">
  import { hideLoading, uiState } from '$lib/stores/ui-store.svelte'
  import { CircleCheck, CircleAlert, RefreshCw, X } from '@lucide/svelte'
  import { t } from 'svelte-i18n'

  interface Props {
    status: 'loading' | 'syncing' | 'downloading' | 'success' | 'error'
    text?: string
    subtext?: string
    progress?: number
    onRetry?: () => void
    onCancel?: () => void
  }

  let { status, text, subtext, progress = 0, onRetry, onCancel }: Props = $props()

  const config = $derived.by(() => {
    switch (status) {
      case 'loading':
        return {
          text: text?.trim() ?? $t('loading.init'),
          subtext: subtext?.trim() ?? $t('loading.initSub'),
          showGif: true,
        }

      case 'syncing':
        return {
          text: text?.trim() ?? $t('loading.syncing'),
          subtext: subtext?.trim() ?? $t('loading.syncingSub'),
          showGif: true,
        }

      case 'success':
        return {
          text: text?.trim() ?? $t('loading.success'),
          subtext: subtext?.trim() ?? $t('loading.successSub'),
          showGif: false,
        }

      case 'error':
        return {
          text: text?.trim() ?? $t('loading.error'),
          subtext: subtext?.trim() ?? $t('loading.errorSub'),
          showGif: false,
        }

      case 'downloading':
        return {
          text: text?.trim() ?? $t('loading.downloading'),
          subtext: subtext?.trim() ?? $t('loading.downloadingSub'),
          showGif: true,
        }
    }
  })
</script>

<div class="modal-overlay">
  <div class="modal-card">
    {#if config.showGif}
      <div class="gif-container">
        <!-- 替换为你的 GIF 路径 -->
        <img src="/loading.gif" alt="Loading" class="loading-gif" />
        {#if status === 'downloading'}
          <div class="progress-wrapper">
            <div class="progress-info">
              <span>{$t('loading.progress')}</span>
              <span>{Math.round(progress)}%</span>
            </div>

            <div class="progress-bar">
              <div class="progress-value" style={`width: ${Math.min(progress, 100)}%`}></div>
            </div>
          </div>
        {/if}
      </div>
    {:else if status === 'success'}
      <div class="icon-container success">
        <CircleCheck size={48} strokeWidth={1.5} />
      </div>
    {:else if status === 'error'}
      <div class="icon-container error">
        <CircleAlert size={48} strokeWidth={1.5} />
      </div>
    {/if}

    <div class="content">
      <h2 class="title">{config.text}</h2>
      <p class="subtitle">{config.subtext}</p>
    </div>

    {#if status === 'error' && onRetry}
      <button class="button button-secondary" onclick={onRetry}>
        <RefreshCw size={16} />
        <span>{$t('common.retry')}</span>
      </button>
    {/if}

    {#if status === 'error'}
      <button class="button button-secondary" onclick={hideLoading}>
        <X size={16} />
        <span>{$t('common.close')}</span>
      </button>
    {/if}

    {#if status === 'downloading' && onCancel}
      <button class="button button-text" onclick={onCancel}>
        <X size={16} />
        <span>{$t('common.cancelDownload')}</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10001;
    animation: fadeIn 0.2s ease;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal-card {
    background: var(--bg-primary);
    border-radius: 12px;
    padding: 40px;
    max-width: 400px;
    width: 90%;
    text-align: center;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    animation: slideUp 0.3s ease;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .gif-container {
    margin-bottom: 24px;
    overflow: hidden;
  }

  .loading-gif {
    width: 50%;
    min-width: 300px;
    /* height: 120px; */
    object-fit: cover;
  }

  .icon-container {
    margin-bottom: 24px;
    display: flex;
    justify-content: center;
  }

  .icon-container.success {
    color: #0f7b6c;
  }

  .icon-container.error {
    color: #e03e3e;
  }

  .content {
    margin-bottom: 24px;
  }

  .title {
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px 0;
  }

  .subtitle {
    font-size: var(--text-base);
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }

  .progress-wrapper {
    margin: 20px 0 24px;
  }

  .progress-info {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    margin-bottom: 8px;
  }

  .progress-bar {
    height: 8px;
    width: 100%;
    background: var(--bg-secondary);
    border-radius: 999px;
    overflow: hidden;
  }

  .progress-value {
    height: 100%;
    background: var(--text-primary);
    border-radius: inherit;
    transition: width 0.2s ease;
  }
</style>
