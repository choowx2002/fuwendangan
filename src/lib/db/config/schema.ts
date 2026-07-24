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
      updated_at TEXT,
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

  icons: `
    CREATE TABLE IF NOT EXISTS icons (
      id TEXT PRIMARY KEY,
      name_zh TEXT,
      name_en TEXT,
      url TEXT,
      url_en TEXT,
      isWhite INTEGER,
      storage_type TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  decks: `
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      format TEXT,
      cover_image TEXT,
      is_favorite INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  deck_versions: `
      CREATE TABLE IF NOT EXISTS deck_versions (
        id TEXT PRIMARY KEY,
        deck_id TEXT NOT NULL,
        version_number INTEGER NOT NULL,
        note TEXT,
        created_at TEXT,
        FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE,
        UNIQUE(deck_id, version_number)
      )
    `,

  deck_cards: `
    CREATE TABLE IF NOT EXISTS deck_cards (
      id TEXT PRIMARY KEY,
      deck_version_id TEXT NOT NULL,
      card_id TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      zone TEXT NOT NULL,
      created_at TEXT,
      FOREIGN KEY(deck_version_id) REFERENCES deck_versions(id) ON DELETE CASCADE,
      FOREIGN KEY(card_id) REFERENCES card_prints(id),
      UNIQUE(deck_version_id, card_id, zone)
    )
  `,

  rules: `
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT NOT NULL,
    rule_number TEXT NOT NULL,
    parent_number TEXT,
    level INTEGER NOT NULL,
    is_heading INTEGER DEFAULT 0,
    text_en TEXT,
    text_zh TEXT,
    sort_order INTEGER NOT NULL,
    rules_book TEXT NOT NULL DEFAULT 'CRD',
    updated_at TEXT,
    PRIMARY KEY (id)
  )
  `,

  DROP: `
    DROP TABLE IF EXISTS version;
    DROP TABLE IF EXISTS decks;
    DROP TABLE IF EXISTS deck_versions;
    DROP TABLE IF EXISTS deck_cards;
    DROP TABLE IF EXISTS card_prints;
    DROP TABLE IF EXISTS cards_base;
    DROP TABLE IF EXISTS icons;
  `,
} as const
