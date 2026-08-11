/** 画布节点类型（CanvasView 与调用方共享） */
export interface CanvasNode {
  id: string
  title: string
  subtitle?: string | null
  color?: string | null
  countText?: string
  images?: { url: string; name: string }[]
  pos_x?: number | null
  pos_y?: number | null
}
