// helpers/network.ts

export interface NetworkStatus {
  online: boolean
  metered: boolean
}

/**
 * 获取网络状态
 *
 * metered:
 * true  = 可能是移动数据或按流量计费网络
 * false = 普通网络（或无法判断）
 */
export async function getNetworkStatus(): Promise<NetworkStatus> {
  return {
    online: navigator.onLine,
    metered: false,
  }
}
