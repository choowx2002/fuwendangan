<script lang="ts">
  import { page } from '$app/state'
  import PurchaseListEditor from '$lib/components/collection/PurchaseListEditor.svelte'

  const listId = $derived(page.params.listId ?? '')
</script>

<PurchaseListEditor mode="edit" {listId} />
