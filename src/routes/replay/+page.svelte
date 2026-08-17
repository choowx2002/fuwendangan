<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { t } from '$lib/i18n'
  import { get } from 'svelte/store'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import {
    peekReplayBundle,
    setReplayBundle,
    setBoundDeckId,
    clearReplayBundle,
  } from '$lib/stores/replay-import.svelte'
  import { parseRiftExport, ReplayImportError } from '$lib/replay/import-parser'
  import type { ImportBundle } from '$lib/replay/types'
  import ReplayImportDropzone from '$lib/components/replay/ReplayImportDropzone.svelte'
  import DeckBindPanel, {
    type DeckBindSelection,
  } from '$lib/components/replay/DeckBindPanel.svelte'
  import ReplayGroupCard from '$lib/components/replay/ReplayGroupCard.svelte'
  import { FileUp, X } from '@lucide/svelte'

  let bundle = $state<ImportBundle | null>(null)
  let fileName = $state<string | null>(null)
  let errorText = $state<string | null>(null)
  let overlapsByGroup = $state<Map<string, number>>(new Map())

  $effect(() => {
    setTopbar({ title: $t('replay.title'), onBack: () => void goto('/') })
  })

  onMount(() => {
    const existing = peekReplayBundle()
    if (existing) {
      bundle = existing
    }
  })

  function onFile(text: string, name: string) {
    errorText = null
    try {
      const parsed = parseRiftExport(text, { fileName: name })
      bundle = parsed
      fileName = name
      setReplayBundle(parsed)
      setBoundDeckId(null)
      overlapsByGroup = new Map()
    } catch (e) {
      if (e instanceof ReplayImportError) {
        errorText = get(t)(
          e.code === 'not-json'
            ? 'replay.parseNotJson'
            : e.code === 'no-matches'
              ? 'replay.noMatches'
              : 'replay.parseFailed',
          { values: { error: e.message } }
        )
      } else {
        errorText = get(t)('replay.parseFailed', { values: { error: String(e) } })
      }
      bundle = null
    }
  }

  function onBindChanged(selection: DeckBindSelection) {
    setBoundDeckId(selection.deckId)
    overlapsByGroup = selection.overlaps
  }

  function resetImport() {
    bundle = null
    fileName = null
    errorText = null
    overlapsByGroup = new Map()
    clearReplayBundle()
  }

  const totalEvents = $derived(bundle ? bundle.groups.reduce((s, g) => s + g.totalEvents, 0) : 0)

  function fileInfoText(): string {
    if (!bundle) return ''
    const time = bundle.meta.exportedAt ? new Date(bundle.meta.exportedAt).toLocaleString() : '-'
    return get(t)('replay.fileInfo', {
      values: { file: fileName ?? '-', games: bundle.groups.length, events: totalEvents, time },
    })
  }
</script>

<div class="page">
  {#if !bundle}
    <ReplayImportDropzone {onFile} />
    {#if errorText}
      <div class="error-box">{errorText}</div>
    {/if}
  {:else}
    <div class="file-bar">
      <span class="file-info">{fileInfoText()}</span>
      <button class="reset-btn" onclick={resetImport} title={$t('replay.resetImport')}>
        <FileUp size={14} />
        <X size={14} />
      </button>
    </div>

    <DeckBindPanel groups={bundle.groups} onChanged={onBindChanged} />

    <div class="group-title">{$t('replay.groupTitle')} · {bundle.groups.length}</div>
    <div class="group-list">
      {#each bundle.groups as g (g.key)}
        <ReplayGroupCard
          group={g}
          deckOverlap={overlapsByGroup.get(g.key) ?? null}
          onReplay={() => goto(`/replay/${encodeURIComponent(g.key)}`)}
        />
      {/each}
    </div>

    {#if bundle.warnings.length > 0}
      <details class="warnings">
        <summary>{$t('replay.warnings')} ({bundle.warnings.length})</summary>
        <ul>
          {#each bundle.warnings as w (w)}
            <li>{w}</li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}
</div>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
    max-width: 860px;
    margin: 0 auto;
  }
  .error-box {
    margin-top: 10px;
    background: #fdecea;
    color: #b42318;
    border: 1px solid #f5b5ad;
    border-radius: var(--radius-lg);
    padding: 10px 12px;
    font-size: 13px;
  }
  .file-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--surface);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 8px 12px;
  }
  .file-info {
    font-size: 12px;
    color: var(--text-secondary);
    flex: 1;
  }
  .reset-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-muted);
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
    border-radius: var(--radius-md);
    padding: 4px 10px;
    cursor: pointer;
    font-size: 12px;
  }
  .reset-btn:hover {
    background: var(--bg-hover);
  }
  .group-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin-top: 4px;
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .warnings {
    font-size: 12px;
    color: var(--text-tertiary);
  }
  .warnings summary {
    cursor: pointer;
  }
  .warnings ul {
    margin: 6px 0 0;
    padding-left: 18px;
  }
</style>
