<script lang="ts">
  import { X } from '@lucide/svelte'

  interface Props {
    open: boolean
    title?: string
    subtitle?: string
    /** 是否显示右上角关闭按钮 */
    closable?: boolean
    /** 点击遮罩是否关闭 */
    closeOnOverlay?: boolean
    footerCentered?: boolean
    /** 关闭回调 */
    onclose?: () => void
    /** 自定义 header 区域（覆盖默认 title/subtitle） */
    header?: import('svelte').Snippet
    /** 主体内容 */
    children: import('svelte').Snippet
    /** 底部操作栏 */
    footer?: import('svelte').Snippet
  }

  let {
    open,
    title = '',
    subtitle = '',
    closable = true,
    closeOnOverlay = true,
    footerCentered = false,
    onclose,
    header,
    children,
    footer,
  }: Props = $props()

  function handleOverlayClick() {
    if (closeOnOverlay) {
      onclose?.()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && closable) {
      onclose?.()
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="modal-overlay"
    role="presentation"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
  >
    <!-- svelte-ignore a11y_interactive_supports_focus -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label={title || undefined}
      onclick={(e) => e.stopPropagation()}
    >
      <!-- Header -->
      {#if header}
        {@render header()}
      {:else if title || closable}
        <div class="modal-header">
          <div class="modal-header-text">
            {#if title}
              <div class="modal-title">{title}</div>
            {/if}
            {#if subtitle}
              <div class="modal-subtitle">{subtitle}</div>
            {/if}
          </div>

          {#if closable}
            <button class="modal-close" aria-label="关闭" onclick={() => onclose?.()}>
              <X size={20} />
            </button>
          {/if}
        </div>
      {/if}

      <!-- Content -->
      <div class="modal-content">
        {@render children()}
      </div>

      <!-- Footer -->
      {#if footer}
        <div class="modal-footer" class:footerCentered>
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 10000;

    display: flex;
    align-items: center;
    justify-content: center;

    padding: 20px;

    background: rgba(55, 53, 47, 0.4);
    backdrop-filter: blur(4px);

    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  .modal {
    width: min(460px, 100%);
    max-height: min(90svh, 900px);

    display: flex;
    flex-direction: column;

    overflow: hidden;

    background: var(--bg-primary);
    border: 1px solid var(--border-color, #e5e7eb);
    border-radius: 12px;

    box-shadow:
      0 20px 50px rgba(0, 0, 0, 0.18),
      0 4px 12px rgba(0, 0, 0, 0.08);

    animation: slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes slideUp {
    from {
      transform: translateY(20px) scale(0.98);
      opacity: 0;
    }
    to {
      transform: translateY(0) scale(1);
      opacity: 1;
    }
  }

  .modal-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;

    padding: 20px;

    border-bottom: 1px solid var(--border-color, #e5e7eb);
  }

  .modal-header-text {
    min-width: 0;
  }

  .modal-title {
    font-size: 18px;
    font-weight: 700;
    color: var(--text-primary);
  }

  .modal-subtitle {
    margin-top: 4px;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .modal-close {
    width: 32px;
    height: 32px;

    display: flex;
    align-items: center;
    justify-content: center;

    flex-shrink: 0;

    border: none;
    border-radius: 6px;

    background: transparent;
    color: var(--text-secondary);

    cursor: pointer;
    transition: all 0.15s;
  }

  .modal-close:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .modal-content {
    display: flex;
    flex-direction: column;
    gap: 18px;

    padding: 20px;

    overflow-y: auto;
    flex: 1;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;

    padding: 16px 20px;

    border-top: 1px solid var(--border-color, #e5e7eb);
  }

  .modal-footer.footerCentered {
    justify-content: center;
  }

  /* 移动端：底部弹出抽屉风格 */
  @media (max-width: 479.99px) {
    .modal-overlay {
      align-items: flex-end;
      padding: 0;
    }

    .modal {
      width: 100%;
      max-height: 90svh;

      border-radius: 14px 14px 0 0;
      border-bottom: none;
    }

    .modal-header {
      padding: 18px 16px;
    }

    .modal-content {
      padding: 18px 16px;
    }

    .modal-footer {
      padding: 14px 16px;
      padding-bottom: max(14px, env(safe-area-inset-bottom));
    }
  }
</style>
