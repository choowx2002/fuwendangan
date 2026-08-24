<!-- src/routes/cards/show/[cardId]/+page.svelte -->
<script lang="ts">
  import { onMount } from 'svelte'
  import { goto } from '$app/navigation'
  import { page } from '$app/state'
  import { getCardById, getPrintsByCardId } from '$lib/db'
  import type { CardBase, CardPrint } from '$lib/db/types'
  import CardShowcase from '$lib/components/cards/CardShowcase.svelte'

  let card = $state<(CardBase & { card_prints?: CardPrint[] }) | null>(null)
  let loaded = $state(false)

  onMount(async () => {
    const cardId = page.params.cardId ?? ''
    try {
      const base = await getCardById(cardId)
      if (base) {
        const prints = await getPrintsByCardId(cardId)
        card = { ...base, card_prints: prints }
      }
    } catch (e) {
      console.error('[CardShow] 加载卡牌失败:', e)
    } finally {
      loaded = true
      if (!card) goto('/cards', { replaceState: true })
    }
  })
</script>

{#if card}
  <div class="show-page">
    <CardShowcase {card} />
  </div>
{/if}

<style>
  .show-page {
    height: 100dvh;
    overflow: hidden;
    background: transparent;
  }
</style>
