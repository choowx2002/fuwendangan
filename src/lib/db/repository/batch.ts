/**
 * 批量写入工具：把整表同步的逐行 INSERT 合并为多行 VALUES 语句。
 * 每块是一条独立语句（SQLite 单语句自带隐式事务），不涉及跨语句 BEGIN/COMMIT，
 * 兼容插件多连接池；参数总量压在上限内，避免触及 SQLITE_MAX_VARIABLE_NUMBER。
 */

const MAX_PARAMS_PER_STATEMENT = 900

export interface BatchStatement {
  sql: string
  params: unknown[]
}

/**
 * 生成分块的 `INSERT OR REPLACE INTO ... VALUES (...),(...)...` 语句。
 * @param table 目标表
 * @param columns 列名（顺序与每行参数一致）
 * @param rows 每行一个与 columns 等长的参数数组
 */
export function buildUpsertStatements(
  table: string,
  columns: string[],
  rows: unknown[][]
): BatchStatement[] {
  if (rows.length === 0) return []

  const rowsPerChunk = Math.max(1, Math.floor(MAX_PARAMS_PER_STATEMENT / columns.length))
  const rowPlaceholders = `(${columns.map(() => '?').join(', ')})`
  const statements: BatchStatement[] = []

  for (let i = 0; i < rows.length; i += rowsPerChunk) {
    const chunk = rows.slice(i, i + rowsPerChunk)
    statements.push({
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES ${chunk
        .map(() => rowPlaceholders)
        .join(', ')}`,
      params: chunk.flat(),
    })
  }

  return statements
}
