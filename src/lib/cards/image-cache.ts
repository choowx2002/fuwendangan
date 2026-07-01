import { resolveResource, appDataDir, join } from "@tauri-apps/api/path";
import {
  exists,
  readFile,
  writeFile,
  mkdir,
  remove,
  BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { fetch } from "@tauri-apps/plugin-http";
// ==================== 类型定义 ====================

export interface ImageItem {
  url: string;
  name: string;
}

export type ObjectFitType =
  "cover" | "contain" | "fill" | "none" | "scale-down";

// ==================== 常量与内存缓存 ====================

export const CARD_IMAGE = "cardImages";
const cache = new Map<string, string>();

// ==================== 工具函数 ====================

function safeSegment(str: string): string {
  return str.replace(/[<>:"/\|?*\x00-\x1F]/g, "_");
}

function urlToFilename(dataUrl: string, name: string = "undefined"): string {
  // 移除末尾的斜杠，获取文件名部分
  const cleanUrl = dataUrl.replace(/\/$/, "");
  const id = cleanUrl.split("/").pop()?.split(".")[0] || "file";
  const filename = `${name}-${id}`;
  return safeSegment(filename);
}

async function safeRead(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path, {
      baseDir: BaseDirectory.AppLocalData,
    });
  } catch {
    return null;
  }
}

export const ensureDir = async (dir: string): Promise<void> => {
  const ok = await exists(dir, {
    baseDir: BaseDirectory.AppLocalData,
  });
  if (!ok) {
    await mkdir(dir, {
      baseDir: BaseDirectory.AppLocalData,
      recursive: true,
    });
  }
};

// ==================== 外部资源加载 ====================

export async function loadExternalImage(
  fileName: string,
  folder: string = "card_img",
): Promise<string> {
  if (cache.has(fileName)) return cache.get(fileName)!;

  try {
    const paths = await resolveResource(
      `resources/external/${folder}/${fileName}`,
    );
    const bytes = await readFile(paths);
    const blob = new Blob([bytes]);
    const url = URL.createObjectURL(blob);
    cache.set(fileName, url);
    return url;
  } catch (err) {
    console.warn("[Cache] 加载图片失败:", fileName, err);
    return "";
  }
}

// ==================== 图片缓存管理 ====================

const saveImageToAppFolder = async (dataUrl: string, filename: string) => {
  try {
    const response = await fetch(dataUrl);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const imagesDir = CARD_IMAGE;

    await ensureDir(imagesDir);

    await writeFile(`${imagesDir}/${filename}`, new Uint8Array(arrayBuffer), {
      baseDir: BaseDirectory.AppLocalData,
    });

    console.log("[Cache] 保存图片到本地缓存成功:", filename);
  } catch (error) {
    console.error("[Cache] 保存图片到本地缓存失败:", error);
  }
};

export const loadImageFromAppFolder = async (
  url: string,
  name: string,
): Promise<string | null> => {
  if (!url) return null;

  const filename = urlToFilename(url, name);
  const targetPath = await join(CARD_IMAGE, filename);

  let bytes = await safeRead(targetPath);
  if (!bytes) {
    await saveImageToAppFolder(url, filename);

    bytes = await safeRead(targetPath);
    if (!bytes) return null;
  }

  const arrayBuffer = bytes.slice().buffer;
  const blob = new Blob([arrayBuffer], { type: "image/*" });
  return URL.createObjectURL(blob);
};

// ==================== 缓存管理功能 ====================

/**
 * 清除内存缓存
 */
export const clearMemoryCache = (): void => {
  cache.forEach((url) => {
    URL.revokeObjectURL(url);
  });
  cache.clear();
  console.log("[Cache] 内存缓存已清除");
};

/**
 * 从缓存中移除特定项
 */
export const removeFromCache = (fileName: string): void => {
  const url = cache.get(fileName);
  if (url) {
    URL.revokeObjectURL(url);
    cache.delete(fileName);
  }
};

/**
 * 获取缓存大小
 */
export const getCacheSize = (): number => {
  return cache.size;
};

/**
 * 检查缓存中是否存在某个文件
 */
export const isInCache = (fileName: string): boolean => {
  return cache.has(fileName);
};

/**
 * 删除本地存储的图片
 */
export const deleteLocalImage = async (filename: string): Promise<boolean> => {
  try {
    const targetPath = await join(CARD_IMAGE, filename);
    await remove(targetPath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    return true;
  } catch (error) {
    console.error("[Cache] 删除图片失败:", error);
    return false;
  }
};

/**
 * 清除所有本地缓存图片
 */
export const clearLocalCache = async (): Promise<boolean> => {
  try {
    const imagesDir = CARD_IMAGE;
    const existsDir = await exists(imagesDir, {
      baseDir: BaseDirectory.AppLocalData,
    });

    if (existsDir) {
      await remove(imagesDir, {
        baseDir: BaseDirectory.AppLocalData,
        recursive: true,
      });
      await ensureDir(imagesDir);
      console.log("[Cache] 本地缓存已清除");
      return true;
    }
    return false;
  } catch (error) {
    console.error("[Cache] 清除本地缓存失败:", error);
    return false;
  }
};

/**
 * 获取缓存目录路径
 */
export const getCacheDirPath = async (): Promise<string> => {
  return await join(CARD_IMAGE);
};

/**
 * 预加载图片到缓存
 */
export const preloadImage = async (
  url: string,
  name: string,
): Promise<string | null> => {
  if (!url) return null;
  const filename = urlToFilename(url, name);

  if (isInCache(filename)) {
    return cache.get(filename)!;
  }

  const targetPath = await join(CARD_IMAGE, filename);
  let bytes = await safeRead(targetPath);

  if (!bytes) {
    await saveImageToAppFolder(url, filename);
    bytes = await safeRead(targetPath);
    if (!bytes) return null;
  }

  if (bytes) {
    const arrayBuffer = bytes.slice().buffer;
    const blob = new Blob([arrayBuffer], { type: "image/*" });
    const objectUrl = URL.createObjectURL(blob);
    cache.set(filename, objectUrl);
    return objectUrl;
  }

  return null;
};

/**
 * 批量预加载图片
 */
export const preloadImages = async (
  imageList: ImageItem[],
): Promise<(string | null)[]> => {
  const promises = imageList.map(({ url, name }) => preloadImage(url, name));
  return Promise.all(promises);
};

/**
 * 获取所有缓存的文件名列表
 */
export const getCachedFileNames = (): string[] => {
  return Array.from(cache.keys());
};

/**
 * 刷新缓存中的某个图片（重新从源加载）
 */
export const refreshCache = async (
  url: string,
  name: string,
): Promise<string | null> => {
  if (!url) return null;
  const filename = urlToFilename(url, name);

  removeFromCache(filename);
  await deleteLocalImage(filename);

  return await preloadImage(url, name);
};
