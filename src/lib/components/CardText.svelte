<script lang="ts">
  import { replaceKeywordsWithImages } from '$lib/helpers/cardText';

  let { text = '' } = $props();
  let processedText = $state('');
  let loading = $state(false);

  $effect(() => {
    if (text) {
      processText();
    }
  });

  async function processText() {
    loading = true;
    try {
      const result = await replaceKeywordsWithImages(text);
      processedText = result.text;
    } catch (error) {
      console.error('处理文本失败:', error);
      processedText = text;
    } finally {
      loading = false;
    }
  }
</script>

{#if loading}
  <span>{text}</span>
{:else}
  <!-- eslint-disable-next-line svelte/no-at-html-tags -->
  {@html processedText}
{/if}