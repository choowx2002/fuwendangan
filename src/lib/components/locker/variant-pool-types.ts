import type { CollectionSort } from '$lib/db'

/** 变体卡池筛选状态（VariantPool 与调用方共享） */
export interface VariantPoolFilters {
  seriesCode: string
  bucket: string
  searchText: string
  sort: CollectionSort
}
