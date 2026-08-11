<script lang="ts">
  import { X } from '@lucide/svelte'
  import { t } from '$lib/i18n'

  let {
    value = [] as string[],
    placeholder = '',
    onChange = undefined as ((tags: string[]) => void) | undefined,
  } = $props()

  let text = $state('')

  function add() {
    const tag = text.trim().replace(/,$/, '').trim()
    if (!tag || value.includes(tag)) {
      text = ''
      return
    }
    onChange?.([...value, tag])
    text = ''
  }

  function remove(tag: string) {
    onChange?.(value.filter((v) => v !== tag))
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && text === '' && value.length > 0) {
      remove(value[value.length - 1])
    }
  }
</script>

<div class="tag-input">
  {#each value as tag (tag)}
    <span class="tag-chip">
      {tag}
      <button
        type="button"
        class="tag-remove"
        aria-label={$t('common.clear')}
        onclick={() => remove(tag)}
      >
        <X size={12} />
      </button>
    </span>
  {/each}
  <input
    class="tag-field"
    bind:value={text}
    placeholder={value.length === 0 ? placeholder : ''}
    onkeydown={onKeydown}
    onblur={add}
  />
</div>

<style>
  .tag-input {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border-radius: 8px;
    border: 1px solid var(--border-color);
    background: var(--bg-primary);
    cursor: text;
  }

  .tag-input:focus-within {
    border-color: var(--accent-color);
  }

  .tag-chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 4px 2px 8px;
    border-radius: 999px;
    background: var(--bg-hover);
    border: 1px solid var(--border-subtle);
    color: var(--text-primary);
    font-size: var(--text-xs);
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tag-remove {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-tertiary);
    cursor: pointer;
    flex-shrink: 0;
  }

  .tag-remove:hover {
    color: var(--text-primary);
    background: var(--bg-active);
  }

  .tag-field {
    flex: 1;
    min-width: 80px;
    border: none;
    background: transparent;
    color: var(--text-primary);
    font-size: var(--text-sm);
    outline: none;
    padding: 2px 0;
  }
</style>
