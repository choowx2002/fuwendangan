<script lang="ts">
  import { onDestroy } from 'svelte'
  import { Camera, Trash2, Copy, RotateCcw, X, Download, Minus } from '@lucide/svelte'
  import {
    serializeSimState,
    parseSimImport,
    type SimState,
    type Snapshot,
  } from '$lib/simulator/chain'
  import { showToast } from '$lib/stores/ui-store.svelte'
  import { t } from '$lib/i18n'

  let {
    open = false,
    onClose,
    snapshots = [],
    currentState,
    onRecord,
    onApply,
    onDelete,
    onImport,
  }: {
    open?: boolean
    onClose?: () => void
    snapshots?: Snapshot[]
    currentState: SimState
    onRecord?: () => void
    onApply?: (id: string) => void
    onDelete?: (id: string) => void
    onImport?: (state: SimState) => void
  } = $props()

  let minimized = $state(false)
  let pos = $state({ x: 24, y: 80 })
  let drag: { startX: number; startY: number; origX: number; origY: number } | null = null
  let importText = $state('')

  function onPointerDown(e: PointerEvent) {
    if (minimized) return
    if ((e.target as HTMLElement).closest('button')) return
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return
    const nextX = drag.origX + e.clientX - drag.startX
    const nextY = drag.origY + e.clientY - drag.startY
    pos = {
      x: Math.min(Math.max(0, nextX), window.innerWidth - 320),
      y: Math.min(Math.max(0, nextY), window.innerHeight - 240),
    }
  }

  function onPointerUp() {
    drag = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  onDestroy(() => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  })

  function formatTime(iso: string) {
    const d = new Date(iso)
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  async function copyText(text: string, okMsg: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast(okMsg, 'success')
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
      showToast(okMsg, 'success')
    }
  }

  function exportJson(snap?: Snapshot) {
    const json = serializeSimState(snap?.state ?? currentState)
    void copyText(json, 'JSON 已复制')
  }

  function exportBase64(snap?: Snapshot) {
    const json = serializeSimState(snap?.state ?? currentState)
    const base64 = btoa(unescape(encodeURIComponent(json)))
    void copyText(base64, 'Base64 分享码已复制')
  }

  function doImport() {
    const text = importText.trim()
    if (!text) return
    let parsed = parseSimImport(text)
    if (!parsed && /^[A-Za-z0-9+/=]+$/.test(text)) {
      try {
        const json = decodeURIComponent(escape(atob(text)))
        parsed = parseSimImport(json)
      } catch {
        parsed = null
      }
    }
    if (!parsed) {
      showToast($t('simulator.importFailed'), 'error')
      return
    }
    onImport?.(parsed)
    importText = ''
  }
</script>

{#if open}
  <div
    class="snapshot-window"
    class:minimized={minimized}
    style="left: {pos.x}px; top: {pos.y}px;"
  >
    <header class="window-header" role="button" tabindex="0" onpointerdown={onPointerDown}>
      <span class="window-title">{$t('simulator.history')}</span>
      <div class="window-actions">
        <button
          type="button"
          title={minimized ? $t('simulator.history') : $t('simulator.minimize')}
          onclick={() => (minimized = !minimized)}
        >
          <Minus size={14} />
        </button>
        <button type="button" title={$t('simulator.close')} onclick={() => onClose?.()}>
          <X size={14} />
        </button>
      </div>
    </header>

    {#if !minimized}
      <div class="window-body">
        <div class="toolbar">
          <button type="button" class="btn" onclick={() => onRecord?.()}>
            <Camera size={15} /> {$t('simulator.recordSnapshot')}
          </button>
        </div>

        <div class="snapshot-list">
          {#each snapshots as snap, i (snap.id)}
            <div class="snapshot-item">
              <div class="snapshot-info">
                <span class="snapshot-label">{snap.label || `#${snapshots.length - i}`}</span>
                <span class="snapshot-time">{formatTime(snap.createdAt)}</span>
              </div>
              <div class="snapshot-actions">
                <button type="button" title={$t('simulator.apply')} onclick={() => onApply?.(snap.id)}>
                  <RotateCcw size={13} />
                </button>
                <button type="button" title={$t('simulator.exportJson')} onclick={() => exportJson(snap)}>
                  <Copy size={13} />
                </button>
                <button type="button" title={$t('simulator.exportBase64')} onclick={() => exportBase64(snap)}>
                  <Download size={13} />
                </button>
                <button type="button" title={$t('simulator.delete')} onclick={() => onDelete?.(snap.id)}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          {/each}

          {#if snapshots.length === 0}
            <div class="empty-hint">{$t('simulator.noSnapshots')}</div>
          {/if}
        </div>

        <div class="import-area">
          <textarea
            bind:value={importText}
            placeholder={$t('simulator.importPlaceholder')}
            rows="3"
          ></textarea>
          <button type="button" class="btn" onclick={doImport}>{$t('simulator.import')}</button>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .snapshot-window {
    position: fixed;
    z-index: 1200;
    width: 320px;
    max-width: calc(100vw - 24px);
    border: 1px solid var(--border-color);
    border-radius: 14px;
    background: var(--bg-primary);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.22);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    resize: both;
  }

  .snapshot-window.minimized {
    width: 220px;
    height: auto;
  }

  .window-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }

  .window-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .window-actions {
    display: flex;
    gap: 2px;
  }

  .window-actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .window-actions button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .window-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .toolbar {
    display: flex;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .btn:hover {
    border-color: var(--accent-color);
  }

  .snapshot-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .snapshot-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 8px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--surface);
  }

  .snapshot-info {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .snapshot-label {
    font-size: var(--text-xs);
    font-weight: 600;
  }

  .snapshot-time {
    font-size: 10px;
    color: var(--text-tertiary);
  }

  .snapshot-actions {
    display: flex;
    gap: 2px;
  }

  .snapshot-actions button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .snapshot-actions button:hover {
    background: var(--bg-hover);
    color: var(--text-primary);
  }

  .import-area {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .import-area textarea {
    width: 100%;
    resize: vertical;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    padding: 6px 8px;
    font-size: 11px;
    font-family: monospace;
  }

  .empty-hint {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    text-align: center;
    padding: 12px 0;
  }

  @media (max-width: 479.99px) {
    .snapshot-window {
      left: 8px !important;
      right: 8px;
      top: auto !important;
      bottom: calc(12px + env(safe-area-inset-bottom));
      width: auto;
      max-width: none;
    }
  }
</style>
