import { invoke } from '@tauri-apps/api/core'

/**
 * 数据库文件 / 数据文件操作服务
 * 封装 Tauri 文件相关 command（copy_file / write_text_file / read_text_file）
 */

export async function copyFile(source: string, dest: string): Promise<void> {
  await invoke('copy_file', { source, dest })
}

export async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke('write_text_file', { path, content })
}

export async function readTextFile(path: string): Promise<string> {
  return await invoke<string>('read_text_file', { path })
}
