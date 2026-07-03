/**
 * 数据库表结构定义
 */

export const TABLE_DEFINITIONS = {
  cards_base: `
    CREATE TABLE IF NOT EXISTS cards_base (
      id TEXT PRIMARY KEY,
      card_no TEXT UNIQUE,
      card_name_cn TEXT, card_name_en TEXT,
      sub_title_cn TEXT, sub_title_en TEXT,
      card_category TEXT,
      card_color_list TEXT, region TEXT, tag TEXT, keyword TEXT, advanced_tag TEXT,
      champion_tag TEXT,
      effect_cn TEXT, effect_en TEXT,
      energy INTEGER, return_energy INTEGER, power INTEGER,
      rarity_name TEXT, series_name TEXT,
      flavor_text_cn TEXT, flavor_text_en TEXT,
      is_banned INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    )
  `,

  card_prints: `
    CREATE TABLE IF NOT EXISTS card_prints (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      card_no_extend TEXT NOT NULL,
      rarity_name TEXT,
      extend_rarity_name TEXT,
      back_image TEXT,
      language TEXT NOT NULL,
      img_cdn TEXT,
      tts_cdn TEXT,
      artist TEXT,
      print_order INTEGER,
      is_default INTEGER,
      created_at TEXT,
      FOREIGN KEY(card_id) REFERENCES cards_base(id) ON DELETE CASCADE
    )
  `,

  filter_options: `
    CREATE TABLE IF NOT EXISTS filter_options (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      regions TEXT, tags TEXT, keywords TEXT, advanced_tags TEXT, colors TEXT,
      categories TEXT, series TEXT, rarities TEXT, champions TEXT,
      energy_min INTEGER, energy_max INTEGER,
      power_min INTEGER, power_max INTEGER,
      return_energy_min INTEGER, return_energy_max INTEGER,
      updated_at TEXT
    )
  `,

  version: `
    CREATE TABLE IF NOT EXISTS version (
      id INTEGER PRIMARY KEY,
      name TEXT,
      updated_at TEXT
    )
  `,
} as const
