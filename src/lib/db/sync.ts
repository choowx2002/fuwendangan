// src/lib/db/sync.ts
import { isTauri } from "./env";
import * as remoteDb from "./supabase";
import * as localDb from "./sqlite";

export async function initializeDatabase() {
  // 1. 环境隔离：Web 端不需要初始化本地 SQLite
  if (!isTauri) {
    console.log("[DB] Web 环境：跳过本地数据库初始化，直接使用 Supabase");
    return;
  }

  console.log("[DB] Tauri 环境：开始检查本地数据库同步状态...");
  try {
    // 2. 获取远端最新版本
    const remoteVersion = await remoteDb.fetchLatestVersion();
    if (!remoteVersion) {
      console.warn("[DB] 未获取到远端版本信息，跳过同步");
      return;
    }

    // 3. 获取本地版本
    const localVersion = await localDb.getLocalVersion();

    // 4. 核心逻辑：比对时间戳
    const remoteTime = new Date(remoteVersion.updated_at).getTime();
    const localTime = localVersion
      ? new Date(localVersion.updated_at).getTime()
      : 0;
    const needsSync = remoteTime > localTime;
    // const needsSync = true;

    if (needsSync) {
      console.log(
        `[DB] 发现新版本 (远端: ${remoteVersion.updated_at})，开始同步数据...`,
      );
      await performSync(remoteVersion);
    } else {
      console.log("[DB] 本地数据已是最新，无需同步");
    }
  } catch (error) {
    console.error("[DB] 数据库初始化/同步失败:", error);
    // TODO: 这里可以触发一个 Svelte Store 更新，在 UI 上提示用户“离线模式”或“同步失败”
  }
}

async function performSync(remoteVersion: any) {
  // 拉取数据
  const cards = await remoteDb.fetchAllCards();
  const prints = await remoteDb.fetchAllPrints();

  // 写入本地 (事务保护)
  await localDb.saveCards(cards);
  await localDb.savePrints(prints);

  //更新Filter Options
  const db = await localDb.getLocalDb();
  await localDb.updateFilterOptions(db);

  // 更新本地版本号
  await localDb.saveVersion(remoteVersion);
  console.log(
    `[DB] 同步完成！共更新 ${cards.length} 张卡牌，${prints.length} 个卡图。`,
  );
}
