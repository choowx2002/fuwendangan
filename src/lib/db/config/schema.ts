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
      deck_limit INTEGER,
      created_at TEXT, updated_at TEXT
    )
  `,

  card_prints: `
    CREATE TABLE IF NOT EXISTS card_prints (
      id TEXT PRIMARY KEY,
      card_id TEXT,
      card_no TEXT,
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
      is_promo INTEGER DEFAULT 0,
      is_custom INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY(card_id) REFERENCES cards_base(id) ON DELETE CASCADE
    )
  `,

  collection: `
    CREATE TABLE IF NOT EXISTS collection (
      id TEXT PRIMARY KEY,
      card_no TEXT NOT NULL,
      card_no_extend TEXT NOT NULL,
      series_code TEXT,
      last_edited_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(card_no, card_no_extend)
    )
  `,

  collection_langs: `
    CREATE TABLE IF NOT EXISTS collection_langs (
      id TEXT PRIMARY KEY,
      collection_id TEXT NOT NULL REFERENCES collection(id) ON DELETE CASCADE,
      language_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'owned',
      normal_qty INTEGER DEFAULT 0,
      foil_qty INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      UNIQUE(collection_id, language_code)
    )
  `,

  idx_collection_series: `
    CREATE INDEX IF NOT EXISTS idx_collection_series ON collection(series_code, last_edited_at)
  `,

  idx_card_prints_variant: `
    CREATE INDEX IF NOT EXISTS idx_card_prints_variant ON card_prints(card_id, card_no_extend)
  `,

  idx_collection_langs_collection: `
    CREATE INDEX IF NOT EXISTS idx_collection_langs_collection ON collection_langs(collection_id)
  `,

  custom_languages: `
    CREATE TABLE IF NOT EXISTS custom_languages (
      code TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  idx_collection_langs_language: `
    CREATE INDEX IF NOT EXISTS idx_collection_langs_language ON collection_langs(language_code)
  `,

  idx_collection_langs_status: `
    CREATE INDEX IF NOT EXISTS idx_collection_langs_status ON collection_langs(status)
  `,

  series: `
    CREATE TABLE IF NOT EXISTS series (
      code TEXT PRIMARY KEY,
      name_cn TEXT,
      name_en TEXT,
      release_order INTEGER DEFAULT 0,
      is_standard INTEGER DEFAULT 1,
      is_active INTEGER DEFAULT 1,
      base_count INTEGER DEFAULT 0,
      alt_count INTEGER DEFAULT 0,
      overnum_count INTEGER DEFAULT 0,
      rune_count INTEGER DEFAULT 0,
      token_count INTEGER DEFAULT 0,
      cover_image TEXT,
      created_at TEXT,
      updated_at TEXT
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

  idx_version_name: `
    CREATE UNIQUE INDEX IF NOT EXISTS idx_version_name ON version(name)
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
      tags TEXT,
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
      print_code TEXT,
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

  match_records: `
    CREATE TABLE IF NOT EXISTS match_records (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      player_name TEXT,
      group_name TEXT,
      opponent_name TEXT,
      opponent_deck TEXT,
      opp_legend_id TEXT,
      opp_legend_print_id TEXT,
      opp_legend_name TEXT,
      opp_legend_image TEXT,
      deck_version_id TEXT,
      deck_version_number INTEGER,
      best_of INTEGER,
      note TEXT,
      played_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    )
  `,

  match_games: `
    CREATE TABLE IF NOT EXISTS match_games (
      id TEXT PRIMARY KEY,
      match_id TEXT NOT NULL,
      game_number INTEGER NOT NULL,
      my_score INTEGER,
      opp_score INTEGER,
      win_type TEXT NOT NULL DEFAULT 'normal',
      is_win INTEGER NOT NULL,
      is_first INTEGER,
      win_reason TEXT,
      log TEXT,
      created_at TEXT,
      FOREIGN KEY(match_id) REFERENCES match_records(id) ON DELETE CASCADE,
      UNIQUE(match_id, game_number)
    )
  `,

  collection_history: `
    CREATE TABLE IF NOT EXISTS collection_history (
      id TEXT PRIMARY KEY,
      op_type TEXT NOT NULL,
      source TEXT NOT NULL,
      note TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      is_undoable INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `,

  collection_history_items: `
    CREATE TABLE IF NOT EXISTS collection_history_items (
      id TEXT PRIMARY KEY,
      history_id TEXT NOT NULL REFERENCES collection_history(id) ON DELETE CASCADE,
      card_no TEXT NOT NULL,
      card_no_extend TEXT NOT NULL,
      language_code TEXT NOT NULL,
      action TEXT NOT NULL,
      old_status TEXT,
      old_normal_qty INTEGER,
      old_foil_qty INTEGER,
      new_status TEXT,
      new_normal_qty INTEGER,
      new_foil_qty INTEGER,
      created_at TEXT NOT NULL
    )
  `,

  collection_stats_snapshots: `
    CREATE TABLE IF NOT EXISTS collection_stats_snapshots (
      id TEXT PRIMARY KEY,
      trigger TEXT NOT NULL,
      overall_owned INTEGER NOT NULL,
      overall_count INTEGER NOT NULL,
      promo_owned INTEGER NOT NULL DEFAULT 0,
      foil_owned INTEGER NOT NULL DEFAULT 0,
      series_stats TEXT,
      created_at TEXT NOT NULL
    )
  `,

  idx_collection_history_created: `
    CREATE INDEX IF NOT EXISTS idx_collection_history_created ON collection_history(created_at)
  `,

  idx_collection_history_items_history: `
    CREATE INDEX IF NOT EXISTS idx_collection_history_items_history ON collection_history_items(history_id)
  `,

  idx_collection_stats_snapshots_created: `
    CREATE INDEX IF NOT EXISTS idx_collection_stats_snapshots_created ON collection_stats_snapshots(created_at)
  `,

  lockers: `
    CREATE TABLE IF NOT EXISTS lockers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      is_favorite INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  locker_sections: `
    CREATE TABLE IF NOT EXISTS locker_sections (
      id TEXT PRIMARY KEY,
      locker_id TEXT NOT NULL REFERENCES lockers(id) ON DELETE CASCADE,
      name TEXT,
      description TEXT,
      color TEXT,
      pos_x REAL,
      pos_y REAL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  locker_cards: `
    CREATE TABLE IF NOT EXISTS locker_cards (
      id TEXT PRIMARY KEY,
      section_id TEXT NOT NULL REFERENCES locker_sections(id) ON DELETE CASCADE,
      card_no TEXT NOT NULL,
      card_no_extend TEXT,
      language TEXT,
      quantity INTEGER DEFAULT 1,
      note TEXT,
      created_at TEXT,
      updated_at TEXT
    )
  `,

  idx_locker_sections_locker: `
    CREATE INDEX IF NOT EXISTS idx_locker_sections_locker ON locker_sections(locker_id, sort_order)
  `,

  idx_locker_cards_section: `
    CREATE INDEX IF NOT EXISTS idx_locker_cards_section ON locker_cards(section_id)
  `,

  idx_locker_cards_card: `
    CREATE INDEX IF NOT EXISTS idx_locker_cards_card ON locker_cards(card_no)
  `,

  DROP: `
    DROP TABLE IF EXISTS version;
    DROP TABLE IF EXISTS match_games;
    DROP TABLE IF EXISTS match_records;
    DROP TABLE IF EXISTS decks;
    DROP TABLE IF EXISTS deck_versions;
    DROP TABLE IF EXISTS deck_cards;
    DROP TABLE IF EXISTS collection_langs;
    DROP TABLE IF EXISTS collection;
    DROP TABLE IF EXISTS custom_languages;
    DROP TABLE IF EXISTS series;
    DROP TABLE IF EXISTS card_prints;
    DROP TABLE IF EXISTS cards_base;
    DROP TABLE IF EXISTS icons;
    DROP TABLE IF EXISTS collection_stats_snapshots;
    DROP TABLE IF EXISTS collection_history_items;
    DROP TABLE IF EXISTS collection_history;
    DROP TABLE IF EXISTS locker_cards;
    DROP TABLE IF EXISTS locker_sections;
    DROP TABLE IF EXISTS lockers;
  `,
} as const
