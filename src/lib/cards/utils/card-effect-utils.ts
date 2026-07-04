import { getIcon } from '$lib/db/repository/icon-repository'

/**
 * 将卡牌效果文本中的 {{关键字}} 替换成图片或符号。
 * @param {string} text - 原始的 card_effect 文本
 * @returns {string} - 替换后的 HTML 字符串
 */
export async function renderCardEffect(text: string) {
  if (!text) return ''

  // 替换 {{关键字}}
  const regex = /\{\{(.*?)\}\}/g
  const matches = Array.from(text.matchAll(regex))

  const resolved = await Promise.all(
    matches.map(async (m) => {
      const match = m[0]
      const key = (m[1] || '').trim()

      const item = await getIcon(key)
      if (!item) return { start: m.index ?? 0, end: (m.index ?? 0) + match.length, value: match }

      // 如果是对象结构
      if (typeof item === 'object' && item.url) {
        if (item.url.startsWith('blob:') || /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(item.url)) {
          return {
            start: m.index ?? 0,
            end: (m.index ?? 0) + match.length,
            value:
              item.isWhite === 'true'
                ? `<img src="${item.url}" alt="${item.name_zh || key}" style="height: 15px;vertical-align: text-bottom; margin: 0 2px; mix-blend-mode: difference">`
                : `<img src="${item.url}" alt="${item.name_zh || key}" style="height: 15px;vertical-align: text-bottom; margin: 0 2px;">`,
          }
        }

        // 若是文本或外链，可选逻辑
        return {
          start: m.index ?? 0,
          end: (m.index ?? 0) + match.length,
          value: `<a href="${item.url}" target="_blank">${item.name_zh || key}</a>`,
        }
      }

      return { start: m.index ?? 0, end: (m.index ?? 0) + match.length, value: match }
    })
  )

  let html = ''
  let lastIndex = 0

  for (const r of resolved) {
    html += text.slice(lastIndex, r.start) + r.value
    lastIndex = r.end
  }
  html += text.slice(lastIndex)

  // 处理换行符
  html = html.replace(/\\r\\n|\\n|\\r/g, '<br>')

  return html.trim()
}
