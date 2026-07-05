import { writable } from 'svelte/store'

// 初始化时读取 localStorage
const initialValue =
  typeof window !== 'undefined' ? localStorage.getItem('showForeignCardArt') === 'true' : false

export const showForeignCardArt = writable(initialValue)

// 订阅变化并同步到 localStorage
showForeignCardArt.subscribe((val) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('showForeignCardArt', val.toString())
  }
})
