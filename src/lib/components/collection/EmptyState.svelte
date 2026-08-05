<script lang="ts">
  import type { Component } from 'svelte'
  import { SearchX } from '@lucide/svelte'

  let {
    icon = SearchX as Component,
    title = '',
    description = '',
    actionLabel = undefined as string | undefined,
    onAction = undefined as (() => void) | undefined,
  } = $props()
</script>

<div class="empty-state">
  {#if icon}
    {@const Icon = icon}
    <Icon size={36} class="empty-icon" />
  {/if}
  {#if title}
    <p class="empty-title">{title}</p>
  {/if}
  {#if description}
    <p class="empty-desc">{description}</p>
  {/if}
  {#if actionLabel && onAction}
    <button class="button button-primary empty-action" onclick={onAction}>
      {actionLabel}
    </button>
  {/if}
</div>

<style>
  .empty-state {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 72px 16px;
    color: var(--text-secondary);
    text-align: center;
  }

  .empty-state :global(.empty-icon) {
    color: var(--text-tertiary);
  }

  .empty-title {
    margin: 0;
    font-size: var(--text-md);
    font-weight: 600;
    color: var(--text-primary);
  }

  .empty-desc {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    max-width: 320px;
  }

  .empty-action {
    margin-top: 6px;
  }
</style>
