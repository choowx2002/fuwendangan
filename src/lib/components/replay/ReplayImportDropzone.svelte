<script lang="ts">
  import { t } from '$lib/i18n'
  import { isTauri } from '$lib/db/env'
  import { readTextFile } from '$lib/services/db-file-service'
  import { Upload } from '@lucide/svelte'

  interface Props {
    onFile: (text: string, name: string) => void
  }
  let { onFile }: Props = $props()

  let fileInput = $state<HTMLInputElement | null>(null)
  let dragging = $state(false)

  async function handleText(text: string, name: string) {
    onFile(text, name)
  }

  async function pickFile() {
    if (isTauri) {
      try {
        const { open } = await import('@tauri-apps/plugin-dialog')
        const src = await open({
          multiple: false,
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
        if (!src || Array.isArray(src)) return
        const text = await readTextFile(String(src))
        const parts = String(src).split(/[\\/]/)
        await handleText(text, parts[parts.length - 1] ?? 'replay.json')
      } catch {
        // Tauri 对话框失败时回退到文件输入
        fileInput?.click()
      }
      return
    }
    fileInput?.click()
  }

  function onInputChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return
    file.text().then((text) => handleText(text, file.name))
    input.value = ''
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragging = false
    const file = e.dataTransfer?.files?.[0]
    if (!file) return
    file.text().then((text) => handleText(text, file.name))
  }
</script>

<div
  class="dropzone"
  class:dragging
  role="button"
  tabindex="0"
  onclick={pickFile}
  onkeydown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      pickFile()
    }
  }}
  ondragover={(e) => {
    e.preventDefault()
    dragging = true
  }}
  ondragleave={() => (dragging = false)}
  ondrop={onDrop}
>
  <span class="dz-icon"><Upload size={22} /></span>
  <div class="dz-text">{$t('replay.dropHint')}</div>
  <button
    class="dz-btn"
    onclick={(e) => {
      e.stopPropagation()
      pickFile()
    }}
  >
    {$t('replay.chooseFile')}
  </button>
  <input
    bind:this={fileInput}
    type="file"
    accept=".json,application/json"
    style="display:none"
    onchange={onInputChange}
  />
</div>

<style>
  .dropzone {
    margin: auto;
    text-align: center;
    color: var(--text-tertiary);
    border: 2px dashed var(--border-color);
    border-radius: 16px;
    padding: 40px 32px;
    cursor: pointer;
    width: min(520px, 92%);
    font-size: 14px;
    line-height: 2;
    background: var(--surface);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
  }
  .dropzone:hover,
  .dropzone.dragging {
    border-color: var(--accent-color);
    color: var(--text-secondary);
  }
  .dz-icon {
    color: var(--text-tertiary);
  }
  .dz-text {
    white-space: pre-line;
  }
  .dz-btn {
    background: var(--surface-muted);
    color: var(--text-primary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 5px 14px;
    cursor: pointer;
    font-size: 13px;
  }
  .dz-btn:hover {
    background: var(--bg-hover);
  }
</style>
