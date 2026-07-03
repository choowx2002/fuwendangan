/**
 * 将卡牌效果文本中的 {{关键字}} 替换成图片或符号。
 * @param {string} text - 原始的 card_effect 文本
 * @returns {string} - 替换后的 HTML 字符串
 */
function renderCardEffect(text: string) {
    if (!text) return "";

    let urlMap = new Map();

    // 替换 {{关键字}}
    let html = text.replace(/\{\{(.*?)\}\}/g, (match, key) => {
        key = key.trim();

        const item = urlMap.get(key);
        if (!item) return match;

        // 如果是对象结构
        if (typeof item === "object" && item.url) {
            if (
                item.url.startsWith("blob:") ||
                /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(item.url)
            ) {
                return `<img src="${item.url}" alt="${item.label || key}" style="height: 16px;vertical-align: text-bottom; margin: 0 2px;">`;
            } else {
                // 若是文本或外链，可选逻辑
                return `<a href="${item.url}" target="_blank">${item.label || key}</a>`;
            }
        }

        // 如果是字符串，可能是纯 URL
        if (typeof item === "string") {
            if (
                item.startsWith("blob:") ||
                /\.(png|jpe?g|gif|webp|svg|ico)$/i.test(item)
            ) {
                return `<img src="${item}" alt="${key}" style="height:1em;vertical-align:middle;">`;
            } else {
                return item;
            }
        }

        return match;
    });

    // 处理换行符
    html = html.replace(/\\r\\n|\\n|\\r/g, "<br>");

    return html.trim();
}