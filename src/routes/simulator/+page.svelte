<script lang="ts">
  import { goto } from '$app/navigation'
  import PackOpener from '$lib/components/simulator/PackOpener.svelte'
  import { setTopbar } from '$lib/stores/ui-store.svelte'
  import { t } from '$lib/i18n'

  $effect(() => {
    setTopbar({
      title: $t('simulator.title'),
      onBack: () => void goto('/'),
    })
  })
</script>

<div class="page">
  <PackOpener title={$t('simulator.packTitle')} />
</div>

<style>
  .page {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    overflow-y: auto;
    width: 100%;
    padding: 24px;
  }
</style>
