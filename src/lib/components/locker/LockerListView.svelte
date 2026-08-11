<script lang="ts">
  import type { LockerSection } from '$lib/db'
  import CardSimpleImage from '../cards/CardSimpleImage.svelte'
  import { resolveLockerIcon } from './locker-icons'
  import { t } from '$lib/i18n'

  let {
    sections = [] as LockerSection[],
    onSectionClick = undefined as ((id: string) => void) | undefined,
  } = $props()

  function handleClick(e: KeyboardEvent | MouseEvent, id: string) {
    if (e instanceof KeyboardEvent) {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
    }
    onSectionClick?.(id)
  }
</script>

<div class="list-root">
  {#each sections as s (s.id)}
    <button
      class="list-row"
      style:--node-color={s.color ?? 'var(--accent-color)'}
      onclick={(e) => handleClick(e, s.id)}
      onkeydown={(e) => handleClick(e, s.id)}
    >
      <div class="row-main">
        <div class="row-top">
          <span class="row-name-row">
            {#if s.icon}
              <img class="row-icon" src={resolveLockerIcon(s.icon)} alt="" />
            {/if}
            <span class="row-name">{s.name ?? $t('locker.newSection')}</span>
          </span>
          <span class="row-count">{$t('locker.cards', { values: { count: s.totalQty } })}</span>
        </div>
        {#if s.description}
          <div class="row-desc">{s.description}</div>
        {/if}
        {#if s.tags && s.tags.length > 0}
          <div class="row-tags">
            {#each s.tags.slice(0, 3) as tag (tag)}
              <span class="row-tag">{tag}</span>
            {/each}
            {#if s.tags.length > 3}
              <span class="row-tag-more">+{s.tags.length - 3}</span>
            {/if}
          </div>
        {/if}
      </div>
      <span class="row-pull" aria-hidden="true"></span>
      {#if s.thumbs && s.thumbs.length > 0}
        <div class="row-thumbs">
          {#each s.thumbs as img (img.url)}
            <CardSimpleImage url={img.url} name={img.name} className="row-thumb" />
          {/each}
        </div>
      {/if}
    </button>
  {/each}
</div>

<style>
  .list-root {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 12px;
    padding: 24px;
    width: 100%;
    margin: 0 auto;
    max-width: 1200px;
  }

  .list-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border-color);
    border-left: 4px solid var(--node-color, var(--accent-color));
    border-radius: 10px;
    background: var(--surface);
    color: var(--text-primary);
    cursor: pointer;
    text-align: left;
    transition: all 0.15s ease;
  }

  .list-row:hover {
    border-color: var(--node-color, var(--accent-color));
    background: var(--bg-hover);
  }

  .row-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .row-name {
    font-size: var(--text-sm);
    font-weight: 700;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-name-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .row-icon {
    width: 18px;
    height: 18px;
    object-fit: contain;
    flex-shrink: 0;
  }

  .row-count {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    color: var(--node-color, var(--accent-color));
  }

  .row-desc {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .row-tag {
    padding: 1px 8px;
    border-radius: 999px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-hover);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-tag-more {
    padding: 1px 6px;
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .row-thumbs {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  :global(.row-thumb) {
    width: 32px;
    height: 44px;
    border-radius: 4px;
    object-fit: cover;
    border: 1px solid var(--border-color);
  }

  @media (max-width: 600.99px) {
    .row-pull {
      flex-shrink: 0;
      width: 28px;
      height: 6px;
      border-radius: 3px;
      background: var(--node-color, var(--accent-color));
      opacity: 0.85;
    }

    .row-thumbs {
      display: none;
    }
  }
</style>
