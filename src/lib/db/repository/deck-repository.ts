/**
 * 卡组数据仓储层
 */

import type { Deck, SqliteDeck } from '../types'
import { mapRowToDeck, mapRowToDeckCard, toSqliteDeck, toSqliteDeckCard } from '../helper'
import { getDatabase } from './database'
import { TABLES } from '../config/constants'
import { Snowflake } from '@theinternetfolks/snowflake'

export interface DeckInput {
  name: string;
  description?: string | null;
  format?: string | null;
  cover_image?: string | null;
  is_favorite?: number;
}

/**
 * 获取当前时间戳（ISO 8601）
 */
function now(): string {
  return new Date().toISOString()
}

 /**
  * 1. Create: 创建套牌
  */
 export async function createDeck(input: DeckInput): Promise<string> {
   const db = await getDatabase();
   const id = Snowflake.generate();
   const timestamp = now();

   const sql = `
     INSERT INTO ${TABLES.DECKS} (id, name, description, format, cover_image, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   `;

   await db.execute(sql, [
     id,
     input.name,
     input.description ?? null,
     input.format ?? null,
     input.cover_image ?? null,
     input.is_favorite ?? 0, // 默认不收藏
     timestamp,
     timestamp
   ]);

   return id;
 }

 /**
  * 2. Read: 根据 ID 获取套牌详情
  */
 export async function getDeckById(id: string): Promise<Deck | null> {
   const db = await getDatabase();
   const sql = `SELECT * FROM ${TABLES.DECKS} WHERE id = ?`;

   const results = await db.select<Deck[]>(sql, [id]);
   return results.length > 0 ? results[0] : null;
 }

 /**
  * 3. Read: 获取套牌列表 (支持简单过滤和排序)
  */
 export async function getDecks(options?: {
   is_favorite?: number;
   format?: string;
   search?: string;
  }): Promise<Deck[]> {
   const db = await getDatabase();

   let sql = `SELECT * FROM ${TABLES.DECKS}`;
   const conditions: string[] = [];
   const params: any[] = [];

   if (options?.is_favorite !== undefined) {
     conditions.push(`is_favorite = ?`);
     params.push(options.is_favorite);
   }

   if (options?.format) {
     conditions.push(`format = ?`);
     params.push(options.format);
   }

   if (options?.search) {
     conditions.push(`name LIKE ?`);
     params.push(`%${options.search}%`);
   }

   if (conditions.length > 0) {
     sql += ` WHERE ` + conditions.join(' AND ');
   }

   // 默认按更新时间倒序排列
   sql += ` ORDER BY updated_at DESC`;

   return await db.select<Deck[]>(sql, params);
 }

 /**
  * 4. Update: 更新套牌信息 (动态拼接字段)
  */
 export async function updateDeck(id: string, input: Partial<DeckInput>): Promise<boolean> {
   const db = await getDatabase();
   const timestamp = now();

   const fields: string[] = [];
   const params: any[] = [];

   // 动态构建 SET 子句
   if (input.name !== undefined) { fields.push(`name = ?`); params.push(input.name); }
   if (input.description !== undefined) { fields.push(`description = ?`); params.push(input.description); }
   if (input.format !== undefined) { fields.push(`format = ?`); params.push(input.format); }
   if (input.cover_image !== undefined) { fields.push(`cover_image = ?`); params.push(input.cover_image); }
   if (input.is_favorite !== undefined) { fields.push(`is_favorite = ?`); params.push(input.is_favorite); }

   // 如果没有需要更新的字段，直接返回
   if (fields.length === 0) return true;

   // 追加 updated_at
   fields.push(`updated_at = ?`);
   params.push(timestamp);

   // 最后追加 WHERE 条件的参数
   params.push(id);

   const sql = `UPDATE ${TABLES.DECKS} SET ${fields.join(', ')} WHERE id = ?`;

   await db.execute(sql, params);
   return true;
 }

 /**
  * 5. Delete: 删除套牌
  */
 export async function deleteDeck(id: string): Promise<boolean> {
   const db = await getDatabase();
   const sql = `DELETE FROM ${TABLES.DECKS} WHERE id = ?`;

   await db.execute(sql, [id]);
   return true;
 }

 export async function toggleFavorite(id: string): Promise<boolean> {
   const db = await getDatabase();
   const timestamp = now();

   // SQLite 中翻转 0/1 的优雅写法： 1 - is_favorite
   const sql = `UPDATE ${TABLES.DECKS} SET is_favorite = 1 - is_favorite, updated_at = ? WHERE id = ?`;

   await db.execute(sql, [timestamp, id]);
   return true;
 }

 //DECK VERSION
 export interface DeckCardInput {
   cardPrintId: string;
   quantity: number;
   zone: string;
 }

 export interface DeckVersion {
   id: string;
   deck_id: string;
   version_number: number;
   note: string | null;
   created_at: string;
 }

 export interface DeckCard {
   id: string;
   deck_id: string;
   card_id: string; // 注意：这里实际存的是 card_prints 的 id
   quantity: number;
   zone: string;    // 例如 'main', 'sideboard'
   created_at: string;
 }

 export interface DeckCardDetail extends DeckCard {
   card_name_cn: string;
   card_name_en: string;
   energy: number;
   power: number;
   card_color_list: string;
   print_code: string;
   img_cdn: string;
   rarity_name: string;
 }

 export async function saveDeckAsNewVersion(
   deckId: string,
   cards: DeckCardInput[],
   note?: string
 ): Promise<string> { // 返回新版本的 ID
   const db = await getDatabase();
   const timestamp = now();

   const maxVersionResult = await db.select<{ max_v: number | null }[]>(
       `SELECT MAX(version_number) as max_v FROM deck_versions WHERE deck_id = ?`,
       [deckId]
     );
   const currentMax = maxVersionResult[0]?.max_v || 0;
   const newVersionNumber = currentMax + 1;

   const newVersionId = Snowflake.generate();

   // 2. 开启事务
   await db.execute('BEGIN TRANSACTION');
   try {
     // 3. 插入新版本记录
     await db.execute(
       `INSERT INTO deck_versions (id, deck_id, version_number, note, created_at) VALUES (?, ?, ?, ?, ?)`,
       [newVersionId, deckId, newVersionNumber, note || null, timestamp]
     );

     // 4. 批量插入卡牌到新版本
     if (cards.length > 0) {
       const insertSql = `
         INSERT INTO deck_cards (id, deck_version_id, card_id, quantity, zone, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
       `;
       for (const card of cards) {
         if (card.quantity > 0) {
           await db.execute(insertSql, [
             Snowflake.generate(),
             newVersionId,
             card.cardPrintId,
             card.quantity,
             card.zone,
             timestamp
           ]);
         }
       }
     }

     await db.execute('COMMIT');
     return newVersionId;
   } catch (error) {
     await db.execute('ROLLBACK');
     throw error;
   }
 }

 /**
   * 使用 WITH (CTE) 语法，优雅地找出最新版本并关联查询
  */
 export async function getLatestDeckCards(deckId: string): Promise<DeckCardDetail[]> {
   const db = await getDatabase();

   const sql = `
     WITH LatestVersion AS (
       SELECT id FROM deck_versions
       WHERE deck_id = ?
       ORDER BY version_number DESC
       LIMIT 1
     )
     SELECT
       dc.id, dc.card_id, dc.quantity, dc.zone,
       cb.card_name_cn, cb.card_name_en, cb.energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name
     FROM deck_cards dc
     JOIN card_prints cp ON dc.card_id = cp.id
     JOIN cards_base cb ON cp.card_id = cb.id
     JOIN LatestVersion lv ON dc.deck_version_id = lv.id
     ORDER BY
       CASE dc.zone WHEN 'main' THEN 1 WHEN 'sideboard' THEN 2 ELSE 3 END,
       cb.card_name_cn
   `;

   const results = await db.select<DeckCardDetail[]>(sql, [deckId])
   return results ?? []
 }


  export async function getDeckVersions(deckId: string): Promise<DeckVersion[]> {
    const db = await getDatabase();
    const sql = `
      SELECT id, deck_id, version_number, note, created_at
      FROM deck_versions
      WHERE deck_id = ?
      ORDER BY version_number DESC
    `;
    return await db.select<DeckVersion[]>(sql, [deckId]);
  }

 /**
  * 🔍 获取【指定版本】的卡牌快照 (用于查看历史或对比)
  */
 export async function getDeckCardsByVersion(versionId: string): Promise<DeckCardDetail[]> {
   const db = await getDatabase();
   const sql = `
     SELECT
       dc.id, dc.card_id, dc.quantity, dc.zone,
       cb.card_name_cn, cb.card_name_en, cb.energy, cb.power, cb.card_color_list,
       cp.card_no_extend as print_code, cp.img_cdn, cp.rarity_name
     FROM deck_cards dc
     JOIN card_prints cp ON dc.card_id = cp.id
     JOIN cards_base cb ON cp.card_id = cb.id
     WHERE dc.deck_version_id = ?
     ORDER BY
       CASE dc.zone WHEN 'main' THEN 1 WHEN 'sideboard' THEN 2 ELSE 3 END,
       cb.card_name_cn
   `;
   return await db.select<DeckCardDetail[]>(sql, [versionId]);
   }
