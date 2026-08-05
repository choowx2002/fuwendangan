-- =============================================================
-- Rune Archive 收藏系统迁移 001
-- 1) 语言标准化：collection_langs.language 自由文本 → language_code 标准码
-- 2) 收藏状态：collection_langs.status（owned / wishlist / ordered）
-- 3) 完整性清理：删除引用不存在卡图变体的孤儿收藏行
-- 4) 性能索引
--
-- 说明：应用内 database.ts 会以 PRAGMA 守卫形式自动执行同套逻辑；
-- 本文件用于手工执行 / 旧库迁移参考。
-- =============================================================

-- 1a) 自定义语言表（预设 EN/SC/TC/JP/KR 之外由用户注册）
CREATE TABLE IF NOT EXISTS custom_languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT,
  updated_at TEXT
);

-- 1b) 列重命名（老库；新装库直接以 language_code 建表，此步跳过）
ALTER TABLE collection_langs RENAME COLUMN language TO language_code;

-- 1c) 存量值规范化：旧别名 → 预设 5 码（无法映射的值暂保留，见 1d）
UPDATE collection_langs SET language_code = CASE
  WHEN upper(trim(language_code)) IN ('EN','SC','TC','JP','KR') THEN upper(trim(language_code))
  WHEN lower(trim(language_code)) IN ('zh','zhcn','zh-cn','中文','简体','简体中文','汉语') THEN 'SC'
  WHEN lower(trim(language_code)) IN ('zh-hant','zh-tw','繁中','繁体','繁体中文') THEN 'TC'
  WHEN lower(trim(language_code)) IN ('ja','japanese','日文','日本語') THEN 'JP'
  WHEN lower(trim(language_code)) IN ('ko','korean','韩文','한국어') THEN 'KR'
  WHEN lower(trim(language_code)) IN ('en','english','英语','英文') THEN 'EN'
  WHEN lower(trim(language_code)) IN ('fr','franch','法语','法文') THEN 'FR'
  ELSE trim(language_code)
END;

-- 1d) 无法映射的存量值自动注册为自定义语言（数据零丢失）
INSERT OR IGNORE INTO custom_languages (code, name, created_at, updated_at)
SELECT DISTINCT language_code, language_code, datetime('now'), datetime('now')
FROM collection_langs
WHERE language_code NOT IN ('EN','SC','TC','JP','KR'，'FR');

-- 2) 语言行状态（存量行默认 owned）
ALTER TABLE collection_langs ADD COLUMN status TEXT NOT NULL DEFAULT 'owned';

-- 3a) 清理孤儿语言行
DELETE FROM collection_langs WHERE collection_id NOT IN (SELECT id FROM collection);

-- 3b) 清理引用不存在 (card_id, card_no_extend) 卡图组合的收藏行
DELETE FROM collection WHERE NOT EXISTS (
  SELECT 1 FROM card_prints p
  WHERE p.card_id = collection.card_id AND p.card_no_extend = collection.card_no_extend
);

-- 4) 索引
CREATE INDEX IF NOT EXISTS idx_collection_langs_language ON collection_langs(language_code);
CREATE INDEX IF NOT EXISTS idx_collection_langs_status ON collection_langs(status);
