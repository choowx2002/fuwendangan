<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { t } from '$lib/i18n'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { peekReplayBundle } from '$lib/stores/replay-import.svelte'
  import { loadLibrary } from '$lib/services/replay-library-service'
  import type { RiftAtlasMatchRecord } from '$lib/replay/types'
  import ReplayViewer from '$lib/components/replay/ReplayViewer.svelte'

  let group = $state<RiftAtlasMatchRecord | null>(null)
  let ready = $state(false)

  $effect(() => {
    setTopbar({
      title: $t('replay.viewerTitle'),
      description: group?.meta?.roomCode ?? undefined,
      onBack: () => void goto('/replay'),
    })
  })

  onMount(async () => {
    const key = decodeURIComponent(page.params.key ?? '')
    const bundle = peekReplayBundle()
    const found = bundle?.groups.find((g) => g.key === key) ?? null
    if (found) {
      group = found
      ready = true
      return
    }
    // 持久化库兜底：库按导入时间倒序，取最新文件里的同名 room
    const res = await loadLibrary()
    for (const f of res.files) {
      const g = f.groups.find((x) => x.key === key)
      if (g) {
        group = g
        ready = true
        return
      }
    }
    goto('/replay', { replaceState: true })
  })
</script>

{#if ready && group}
  <ReplayViewer {group} />
{/if}
