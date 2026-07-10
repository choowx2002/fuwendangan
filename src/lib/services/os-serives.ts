import { platform } from '@tauri-apps/plugin-os'

export async function isMobile() {
    const p = await platform()
    return p === 'android' || p === 'ios'
}