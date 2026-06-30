// src/lib/db/index.ts
export { initializeDatabase } from './sync';
export { isTauri, isWeb } from './env';
// 后续可以在此处导出供 UI 层调用的查询方法，例如：
// export { getCardsFromLocal } from './sqlite';