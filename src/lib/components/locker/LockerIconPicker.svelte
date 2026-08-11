<script lang="ts">
  import {
    LOCKER_ICONS,
    LOCKER_ICON_CATEGORIES,
    DEFAULT_LOCKER_ICON,
    resolveLockerIcon,
  } from './locker-icons'
  import { t } from '$lib/i18n'

  let { value = null as string | null, onChange = undefined as ((icon: string | null) => void) | undefined } =
    $props()

  const categoryLabel = $derived<Record<string, string>>({
    rarities: $t('locker.iconRarities'),
    runes: $t('locker.iconRunes'),
    types: $t('locker.iconTypes'),
  })
</script>

<div class="icon-picker">
  <button
    class="icon-option icon-default"
    class:selected={!value}
    title={$t('locker.iconDefault')}
    onclick={() => onChange?.(null)}
  >
    <img class="icon-img" src={DEFAULT_LOCKER_ICON} alt="" />
    <span class="icon-default-text">{$t('locker.iconDefault')}</span>
  </button>

  {#each LOCKER_ICON_CATEGORIES as category (category)}
    <div class="icon-group">
      <span class="icon-group-label">{categoryLabel[category]}</span>
      <div class="icon-grid">
        {#each LOCKER_ICONS.filter((i) => i.category === category) as icon (icon.value)}
          <button
            class="icon-option"
            class:selected={value === icon.src}
            title={icon.label}
            onclick={() => onChange?.(icon.src)}
          >
            <img class="icon-img" src={resolveLockerIcon(icon.src)} alt={icon.label} />
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .icon-picker {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .icon-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .icon-group-label {
    font-size: var(--text-xs);
    color: var(--text-tertiary);
  }

  .icon-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .icon-option {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    padding: 4px;
    border-radius: 8px;
    border: 2px solid transparent;
    background: var(--bg-primary);
    cursor: pointer;
  }

  .icon-option:hover {
    background: var(--bg-hover);
  }

  .icon-option.selected {
    border-color: var(--accent-color);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent-color) 25%, transparent);
  }

  .icon-default {
    width: auto;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border-color);
  }

  .icon-default-text {
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .icon-img {
    width: 26px;
    height: 26px;
    object-fit: contain;
    pointer-events: none;
  }
</style>
