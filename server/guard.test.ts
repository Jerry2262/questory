import { describe, expect, it } from 'vitest'

import { hostnameOf, isLocalHost, isTrustedWrite } from './guard'

describe('请求来源校验', () => {
  it('接受本机 Host', () => {
    expect(isLocalHost('127.0.0.1:5199')).toBe(true)
    expect(isLocalHost('localhost:5199')).toBe(true)
    expect(isLocalHost('[::1]:5199')).toBe(true)
  })

  it('拒绝其它 Host（DNS rebinding）', () => {
    expect(isLocalHost('evil.example')).toBe(false)
    expect(isLocalHost(undefined)).toBe(false)
    expect(isLocalHost('')).toBe(false)
  })

  it('写请求接受同源 Origin', () => {
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'http://127.0.0.1:5199' })).toBe(true)
  })

  it('写请求拒绝跨源 Origin：域名、协议、端口任一不同都不算同源', () => {
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'https://evil.example' })).toBe(false)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'http://127.0.0.1:8000' })).toBe(false)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'https://127.0.0.1:5199' })).toBe(false)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'http://localhost:5199' })).toBe(false)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', origin: 'http://127.0.0.1:5199' })).toBe(true)
  })

  it('没有 Origin 时用 Fetch Metadata 判别跨站', () => {
    expect(isTrustedWrite({ host: '127.0.0.1:5199', secFetchSite: 'cross-site' })).toBe(false)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', secFetchSite: 'same-origin' })).toBe(true)
    expect(isTrustedWrite({ host: '127.0.0.1:5199', secFetchSite: 'none' })).toBe(true)
    expect(isTrustedWrite({ host: '127.0.0.1:5199' })).toBe(true)
  })

  it('Host 非本机时写请求一律拒绝', () => {
    expect(isTrustedWrite({ host: 'evil.example', origin: 'http://evil.example' })).toBe(false)
  })

  it('能从不同写法里取出主机名', () => {
    expect(hostnameOf('127.0.0.1:5199')).toBe('127.0.0.1')
    expect(hostnameOf('[::1]:5199')).toBe('::1')
    expect(hostnameOf(undefined)).toBe('')
  })
})
