/**
 * 本地服务的请求来源校验：
 * - 只接受本机 Host（防 DNS rebinding 用别的域名读到本地数据）
 * - 写请求要求同源 Origin，或没有 Origin 时 Fetch Metadata 不是跨站
 */
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

/** 从 Host / Origin 里取出主机名（去掉端口与 IPv6 方括号） */
export function hostnameOf(header: string | undefined): string {
  if (!header) return ''
  const value = header.trim().toLowerCase()
  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    return end === -1 ? '' : value.slice(1, end)
  }
  return value.split(':')[0] ?? ''
}

export function isLocalHost(host: string | undefined): boolean {
  return LOCAL_HOSTS.has(hostnameOf(host))
}

export function isTrustedWrite(input: {
  host?: string
  origin?: string
  secFetchSite?: string
}): boolean {
  if (!isLocalHost(input.host)) return false

  if (input.origin) {
    // 同源 = 协议 + 主机 + 端口都一致；本服务只跑 http，所以直接和 Host 拼出的源比
    return input.origin === `http://${input.host}`
  }

  // 没有 Origin（curl、同源表单等）：看浏览器给的 Fetch Metadata，跨站一律拒绝
  if (input.secFetchSite && input.secFetchSite !== 'same-origin' && input.secFetchSite !== 'none') {
    return false
  }
  return true
}
