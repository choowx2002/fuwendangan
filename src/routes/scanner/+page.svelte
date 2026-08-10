<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { X, ScanLine, Settings, RefreshCw, LoaderCircle } from '@lucide/svelte'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { isTauri } from '$lib/db'
  import { isMobile } from '$lib/utils/os'
  import { startCameraQrScan } from '$lib/decks/deck-qr'
  import { setQrScanContent } from '$lib/stores/qr-scan.svelte'
  import {
    Format,
    scan,
    cancel,
    checkPermissions,
    requestPermissions,
    openAppSettings,
  } from '@tauri-apps/plugin-barcode-scanner'

  let videoEl = $state<HTMLVideoElement | null>(null)
  let mobile = $state(false)
  let platformChecked = $state(false)
  let scanning = $state(false)
  let nativeActive = $state(false)
  let errorMsg = $state('')
  let stopCamera: (() => void) | null = null
  let exitRequested = $state(false)

  const webcamActive = $derived(stopCamera !== null && !errorMsg)

  function stopWebcam() {
    if (stopCamera) {
      stopCamera()
      stopCamera = null
    }
  }

  async function exitScanner() {
    if (exitRequested) return
    exitRequested = true
    stopWebcam()
    if (nativeActive) {
      try {
        await cancel()
      } catch {
        /* ignore */
      }
      nativeActive = false
    }
    await goto('/decks')
  }

  async function handleDecoded(content: string) {
    setQrScanContent(content)
    await exitScanner()
  }

  async function startWebcam() {
    if (!videoEl || scanning || exitRequested) return
    errorMsg = ''
    scanning = true
    try {
      stopCamera = await startCameraQrScan(videoEl, handleDecoded)
    } catch (error) {
      errorMsg = error instanceof Error ? error.message : String(error)
    } finally {
      scanning = false
    }
  }

  async function startNative() {
    if (exitRequested) return
    errorMsg = ''
    try {
      let permission = await checkPermissions()
      if (permission !== 'granted') {
        permission = await requestPermissions()
      }
      if (permission !== 'granted') {
        errorMsg = get(t)('scanner.permissionDenied')
        return
      }
      nativeActive = true
      const scanned = await scan({ formats: [Format.QRCode], windowed: true })
      nativeActive = false
      if (exitRequested) return
      const content = scanned?.content
      if (content) await handleDecoded(content)
    } catch (error) {
      nativeActive = false
      if (exitRequested) return
      const message = error instanceof Error ? error.message : String(error)
      if (/cancelled|cancel/i.test(message)) return
      console.error('[Scanner] 原生扫码失败:', error)
      errorMsg = get(t)('decks.qrScanFailed')
    }
  }

  function openSettings() {
    openAppSettings().catch(() => {})
  }

  onMount(() => {
    init()
    return () => {
      stopWebcam()
      if (nativeActive) cancel().catch(() => {})
    }
  })

  async function init() {
    if (isTauri) {
      mobile = await isMobile()
    }
    platformChecked = true
    if (mobile) {
      startNative()
    } else {
      startWebcam()
    }
  }
</script>

<div class="scanner-page">
  <button class="exit-btn" onclick={exitScanner} aria-label={$t('scanner.exit')} title={$t('scanner.exit')}>
    <X size={22} />
  </button>

  <div class="viewport">
    {#if !mobile}
      <video class="camera" bind:this={videoEl} muted playsinline></video>
    {/if}
    <div class="scan-frame"></div>
  </div>

  <div class="status-bar">
    {#if errorMsg}
      <div class="status-error">
        <p class="status-text">{errorMsg}</p>
        <div class="status-actions">
          {#if isTauri && mobile}
            <button class="button button-ghost" onclick={openSettings}>
              <Settings size={16} />
              {$t('scanner.openSettings')}
            </button>
          {/if}
          <button class="button button-ghost" onclick={mobile ? startNative : startWebcam}>
            <RefreshCw size={16} />
            {$t('common.retry')}
          </button>
          <button class="button button-ghost" onclick={exitScanner}>
            {$t('scanner.exit')}
          </button>
        </div>
      </div>
    {:else if !platformChecked}
      <span class="status-text"><span class="spin"><LoaderCircle size={16} /></span>{$t('common.loading')}</span>
    {:else if mobile}
      {#if nativeActive}
        <span class="status-text"><span class="spin"><LoaderCircle size={16} /></span>{$t('scanner.recognizing')}</span>
      {:else}
        <div class="status-actions">
          <button class="button button-primary" onclick={startNative}>
            <ScanLine size={16} />
            {$t('scanner.startScan')}
          </button>
        </div>
      {/if}
    {:else if scanning || webcamActive}
      <span class="status-text"><span class="spin"><LoaderCircle size={16} /></span>{$t('scanner.recognizing')}</span>
      <span class="status-sub">{$t('scanner.hint')}</span>
    {:else}
      <div class="status-actions">
        <button class="button button-primary" onclick={startWebcam}>
          <ScanLine size={16} />
          {$t('scanner.startScan')}
        </button>
      </div>
    {/if}
  </div>
</div>

<style>
  .scanner-page {
    position: fixed;
    inset: 0;
    background: #000;
    display: flex;
    flex-direction: column;
    z-index: 100;
  }

  .exit-btn {
    position: absolute;
    top: calc(12px + env(safe-area-inset-top));
    left: 12px;
    z-index: 10;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: rgba(0, 0, 0, 0.5);
    color: #fff;
    cursor: pointer;
  }

  .exit-btn:hover {
    background: rgba(0, 0, 0, 0.7);
  }

  .viewport {
    position: relative;
    flex: 1;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .camera {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .scan-frame {
    position: absolute;
    inset: 0;
    margin: auto;
    width: min(72vw, 320px);
    height: min(72vw, 320px);
    border: 2px solid rgba(255, 255, 255, 0.7);
    border-radius: 16px;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
    pointer-events: none;
  }

  .scan-frame::before {
    content: '';
    position: absolute;
    left: 12px;
    right: 12px;
    top: 0;
    height: 2px;
    background: var(--accent-color, #4ade80);
    animation: scan-line 2s ease-in-out infinite;
  }

  @keyframes scan-line {
    0% {
      top: 0;
    }
    50% {
      top: calc(100% - 2px);
    }
    100% {
      top: 0;
    }
  }

  .status-bar {
    padding: 20px 24px calc(24px + env(safe-area-inset-bottom));
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    background: #000;
    color: #fff;
    min-height: 120px;
  }

  .status-text {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-base);
  }

  .status-sub {
    font-size: var(--text-sm);
    color: rgba(255, 255, 255, 0.6);
  }

  .status-error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 360px;
    text-align: center;
  }

  .status-error .status-text {
    color: var(--error-color, #f87171);
  }

  .status-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
  }

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
