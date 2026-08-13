<script lang="ts">
  import type { RecentCollectionCard } from '$lib/db'
  import CachedImage from '../cards/CachedImage.svelte'
  import { t } from '$lib/i18n'

  let {
    recent = [] as RecentCollectionCard[],
    onSelect = undefined as ((c: RecentCollectionCard) => void) | undefined,
  }: {
    recent?: RecentCollectionCard[]
    onSelect?: (c: RecentCollectionCard) => void
  } = $props()
</script>

<div class="recent-col">
  <div class="recent-title">{$t('collection.recentAdded')}</div>
  {#if recent.length === 0}
    <p class="recent-empty">{$t('collection.noRecent')}</p>
  {:else}
    <div class="recent-list">
      {#each recent as r (r.cardId + r.cardNoExtend + r.langCode)}
        <button
          class="recent-item"
          onclick={() => onSelect?.(r)}
          title={`${r.cardNameCn ?? ''}（${r.cardNo ?? ''}）${r.langCode === 'SC' ? '' : ` · ${r.langCode}`}`}
        >
          <div class="recent-img">
            <CachedImage
              src={r.imgCdn ?? r.ttsCdn ?? ''}
              name={`${r.cardNoExtend}-${r.printLang ?? 'default'}`}
              borderRadius="6px"
              fit="cover"
              isLandscape={false}
            />
            {#if (r.ownedFoil ?? 0) > 0}
              <span class="mini-foil">{$t('collection.foilBadge')}</span>
            {/if}
            {#if r.langCode !== 'SC'}
              <span class="lang-badge">{r.langCode}</span>
            {/if}
          </div>
          <div class="recent-info">
            <span class="recent-name">{r.cardNameCn ?? r.cardNo ?? ''}</span>
            <span class="recent-no">{r.cardNo ?? ''}</span>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .recent-col {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .recent-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .recent-empty {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--text-tertiary);
    align-self: center;
    padding: 12px 0;
  }

  .recent-list {
    display: flex;
    gap: 10px;
    overflow-x: auto;
    padding-bottom: 4px;
  }

  .recent-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    min-width: 74px;
    max-width: 90px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-primary);
    cursor: pointer;
  }

  .recent-img {
    position: relative;
    width: 100%;
    border-radius: 6px;
    overflow: hidden;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.18);
  }

  .recent-item:hover .recent-img {
    transform: translateY(-2px);
  }

  .mini-foil {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 9px;
    font-weight: 700;
    border-radius: 50%;
    background: linear-gradient(135deg, #facc15, #f59e0b);
    color: #422006;
  }

  .lang-badge {
    position: absolute;
    bottom: 4px;
    left: 4px;
    padding: 1px 5px;
    font-size: 9px;
    font-weight: 700;
    line-height: 1.4;
    border-radius: 4px;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
  }

  .recent-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    min-width: 0;
    width: 100%;
  }

  .recent-name {
    font-size: var(--text-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100%;
  }

  .recent-no {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }
</style>
