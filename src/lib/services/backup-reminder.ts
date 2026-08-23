/**
 * 备份提醒服务
 * 启动时（Tauri 桌面端）检测：本机已有数据但「从未备份」或「距上次备份超过 7 天」时，
 * 弹一次提醒引导用户前往设置页备份；同一提醒 7 天内不重复弹。
 */

import { get } from 'svelte/store'
import { openConfirm } from '$lib/stores/confirm-store.svelte'
import { goto } from '$app/navigation'
import { isTauri, getDbStats } from '$lib/db'
import {
  lastBackupAt,
  lastBackupReminderAt,
  backupReminderEnabled,
  backupReminderDays,
} from '$lib/stores/settings'
import { t } from '$lib/i18n'

const DAY_MS = 24 * 60 * 60 * 1000

export async function maybePromptBackup(): Promise<void> {
  if (!isTauri) return
  // 提醒默认关闭；用户在设置里开启后才启用
  if (!get(backupReminderEnabled)) return

  try {
    const stats = await getDbStats()
    const deckCount = stats.tables.find((x) => x.name === 'decks')?.count ?? 0
    const collectionCount = stats.tables.find((x) => x.name === 'collection')?.count ?? 0
    if (deckCount === 0 && collectionCount === 0) return

    const intervalMs = Math.max(1, Math.floor(get(backupReminderDays) || 7)) * DAY_MS

    const now = Date.now()
    const last = get(lastBackupAt)
    const lastReminder = get(lastBackupReminderAt)
    const lastTs = last ? new Date(last).getTime() : 0

    const needsBackup = !lastTs || now - lastTs > intervalMs
    if (!needsBackup) return

    if (lastReminder && now - new Date(lastReminder).getTime() < intervalMs) return
    lastBackupReminderAt.set(new Date().toISOString())

    const days = lastTs ? Math.max(1, Math.floor((now - lastTs) / DAY_MS)) : 0
    const ok = await openConfirm(
      days > 0
        ? get(t)('settings.backupReminderStale', { values: { days } })
        : get(t)('settings.backupReminderNever'),
      {
        title: get(t)('settings.backupReminderTitle'),
        okLabel: get(t)('settings.backupReminderGo'),
        cancelLabel: get(t)('common.cancel'),
      }
    )
    if (ok) await goto('/settings')
  } catch (e) {
    console.error('[BackupReminder] 备份提醒检查失败:', e)
  }
}
