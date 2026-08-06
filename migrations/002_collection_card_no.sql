-- =============================================================
-- Rune Archive 收藏系统迁移 002
-- 收藏变体引用改为稳定基础卡编号：collection.card_id → collection.card_no
-- (cards_base.card_no 唯一，不依赖远端 id，同步重建 id 后收藏不失效)
--
-- 说明：应用内 database.ts 的 migrateCollectionCardNo 会以 PRAGMA 守卫形式
-- 自动执行同套逻辑；本文件用于手工执行 / 旧库迁移参考。
-- =============================================================

-- 1) 新增 card_no 列（新装库直接建表包含此列，此步跳过）
ALTER TABLE collection ADD COLUMN card_no TEXT;

-- 2) 按旧 card_id 回填稳定编号
UPDATE collection SET card_no = (
  SELECT cb.card_no FROM cards_base cb WHERE cb.id = collection.card_id
);

-- 3) 无法回填（card_id 已被远端重建）的孤儿行删除
DELETE FROM collection WHERE card_no IS NULL OR card_no = '';
DELETE FROM collection_langs WHERE collection_id NOT IN (SELECT id FROM collection);

-- 4) 删除旧外键列（SQLite >= 3.35 支持；低版本失败可保留空列，不影响逻辑）
ALTER TABLE collection DROP COLUMN card_id;

-- 5) 唯一约束（新装库由建表语句保证；老库迁移后如需强制唯一可重建表，
--    应用层已按 (card_no, card_no_extend) SELECT 后写入，非唯一也可正确运行）
-- CREATE UNIQUE INDEX IF NOT EXISTS uq_collection_card ON collection(card_no, card_no_extend);
