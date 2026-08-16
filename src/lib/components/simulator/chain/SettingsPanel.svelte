<script lang="ts">
  import type { SimulatorSettings, DisplayMode } from '$lib/simulator/chain'
  import { t } from '$lib/i18n'

  let {
    settings,
    playerCount,
    battlefieldCount,
    onchange,
    onZoneModeChange,
    onAllZoneModeChange,
    onPlayerCountChange,
    onBattlefieldCountChange,
    onreset,
  }: {
    settings: SimulatorSettings
    playerCount: number
    battlefieldCount: number
    onchange?: (patch: Partial<SimulatorSettings>) => void
    onZoneModeChange?: (key: string, mode: DisplayMode) => void
    onAllZoneModeChange?: (mode: DisplayMode) => void
    onPlayerCountChange?: (n: number) => void
    onBattlefieldCountChange?: (n: number) => void
    onreset?: () => void
  } = $props()

  const zoneOptions: { key: string; labelKey: string }[] = [
    { key: 'chain', labelKey: 'simulator.zone.chain' },
    { key: 'resolving', labelKey: 'simulator.zone.resolving' },
    { key: 'pending', labelKey: 'simulator.zone.pending' },
    { key: 'battlefield', labelKey: 'simulator.zone.battlefield' },
    { key: 'base', labelKey: 'simulator.zone.base' },
    { key: 'discard', labelKey: 'simulator.zone.discard' },
    { key: 'banish', labelKey: 'simulator.zone.banish' },
  ]
</script>

<div class="settings-panel">
  <section class="field-group">
    <span class="group-title"
      >{$t('simulator.playerCount')} / {$t('simulator.battlefieldCount')}</span
    >
    <div class="row">
      <label class="field">
        <span>{$t('simulator.playerCount')}</span>
        <select
          value={playerCount}
          onchange={(e) =>
            onPlayerCountChange?.(Number((e.currentTarget as HTMLSelectElement).value) || 2)}
        >
          <option value="2">2 位玩家</option>
          <option value="3">3 位玩家</option>
          <option value="4">4 位玩家</option>
        </select>
      </label>
      <label class="field">
        <span>{$t('simulator.battlefieldCount')}</span>
        <select
          value={battlefieldCount}
          onchange={(e) =>
            onBattlefieldCountChange?.(Number((e.currentTarget as HTMLSelectElement).value) || 2)}
        >
          <option value="1">1 个战场</option>
          <option value="2">2 个战场</option>
          <option value="3">3 个战场</option>
        </select>
      </label>
    </div>
  </section>

  <section class="field-group">
    <span class="group-title">{$t('simulator.allZones')}</span>
    <div class="bulk-row">
      {#each ['text', 'image'] as mode (mode)}
        <button
          type="button"
          class:active={Object.values(settings.zoneModes).every((m) => m === mode)}
          onclick={() => onAllZoneModeChange?.(mode as DisplayMode)}
        >
          {mode === 'text' ? $t('simulator.bulkText') : $t('simulator.bulkImage')}
        </button>
      {/each}
    </div>
  </section>

  <section class="field-group">
    <span class="group-title">{$t('simulator.zoneModes')}</span>
    <div class="zone-mode-list">
      {#each zoneOptions as opt (opt.key)}
        <div class="zone-mode-row">
          <span class="zone-label">{$t(opt.labelKey)}</span>
          <div class="segmented">
            {#each ['text', 'image'] as mode (mode)}
              <button
                type="button"
                class:active={settings.zoneModes[opt.key] === mode}
                onclick={() => onZoneModeChange?.(opt.key, mode as DisplayMode)}
              >
                {mode === 'text' ? $t('simulator.bulkText') : $t('simulator.bulkImage')}
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </section>

  <section class="field-group">
    <span class="group-title">{$t('simulator.otherSettings')}</span>
    <label class="field check">
      <input
        type="checkbox"
        checked={settings.snapToGrid}
        onchange={(e) => onchange?.({ snapToGrid: (e.currentTarget as HTMLInputElement).checked })}
      />
      <span>{$t('simulator.snapToGrid')}</span>
    </label>

    <label class="field">
      <span>{$t('simulator.autoSnapshotInterval')}</span>
      <input
        type="number"
        min="0"
        max="3600"
        value={settings.autoSnapshotIntervalSec}
        onchange={(e) =>
          onchange?.({
            autoSnapshotIntervalSec: Number((e.currentTarget as HTMLInputElement).value) || 0,
          })}
      />
    </label>
  </section>

  <button type="button" class="reset-btn" onclick={() => onreset?.()}>
    {$t('simulator.resetGame')}
  </button>
</div>

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 4px 0;
  }

  .field-group {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .group-title {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text-primary);
  }

  .row {
    display: flex;
    gap: 10px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--text-secondary);
    flex: 1;
  }

  .field.check {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  .field select,
  .field input {
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-primary);
    font-size: var(--text-sm);
  }

  .bulk-row {
    display: flex;
    gap: 6px;
  }

  .bulk-row button,
  .segmented button {
    flex: 1;
    padding: 6px 8px;
    border: 1px solid var(--border-color);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-secondary);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .bulk-row button.active,
  .segmented button.active {
    color: var(--accent-color);
    border-color: var(--accent-color);
    background: color-mix(in srgb, var(--accent-color) 10%, transparent);
  }

  .zone-mode-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .zone-mode-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .zone-label {
    width: 110px;
    flex-shrink: 0;
    font-size: var(--text-xs);
    color: var(--text-secondary);
  }

  .segmented {
    display: flex;
    flex: 1;
    gap: 4px;
  }

  .reset-btn {
    padding: 8px;
    border: 1px solid var(--danger-color, #e5484d);
    border-radius: 8px;
    background: transparent;
    color: var(--danger-color, #e5484d);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .reset-btn:hover {
    background: color-mix(in srgb, var(--danger-color, #e5484d) 10%, transparent);
  }
</style>
