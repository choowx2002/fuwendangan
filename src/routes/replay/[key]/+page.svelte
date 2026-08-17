<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { t } from '$lib/i18n'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { peekReplayBundle } from '$lib/stores/replay-import.svelte'
  import type { ReplayGroup } from '$lib/replay/types'
  import ReplayViewer from '$lib/components/replay/ReplayViewer.svelte'

  let group = $state<ReplayGroup | null>(null)
  let ready = $state(false)

  $effect(() => {
    setTopbar({
      title: $t('replay.viewerTitle'),
      description: group?.roomCode ?? undefined,
      onBack: () => void goto('/replay'),
    })
  })

  onMount(() => {
    const bundle = peekReplayBundle()
    const key = decodeURIComponent(page.params.key ?? '')
    const found = bundle?.groups.find((g) => g.key === key) ?? null
    if (!bundle || !found) {
      goto('/replay', { replaceState: true })
      return
    }
    group = found
    ready = true
  })
</script>

{#if ready && group}
  <ReplayViewer {group} />
{/if}
