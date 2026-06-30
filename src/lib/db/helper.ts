/**
 * 辅助函数：将 SQLite 行数据反序列化为前端使用的 CardBase 模型
 */
export function mapRowToCard(row: any): CardBase {
  return {
    ...row,
    // 将 JSON 字符串解析回数组
    card_color_list: row.card_color_list
      ? JSON.parse(row.card_color_list)
      : null,
    region: row.region ? JSON.parse(row.region) : null,
    tag: row.tag ? JSON.parse(row.tag) : null,
    keyword: row.keyword ? JSON.parse(row.keyword) : null,
    advanced_tag: row.advanced_tag ? JSON.parse(row.advanced_tag) : null,
    // 将 0/1 转回 boolean
    is_banned: row.is_banned === 1,
  };
}
