import { describe, expect, it } from 'vitest'

import { weekCheckOutcome } from './saveGuard'

const base = {
  startedSeq: 3,
  currentSeq: 3,
  created: false,
  payloadRevision: 'rev-a',
  knownRevision: 'rev-a',
}

describe('跨周检查响应判定', () => {
  it('请求期间本页保存过：响应过期，忽略', () => {
    expect(weekCheckOutcome({ ...base, currentSeq: 4 })).toBe('stale')
  })

  it('别的页面改了数据：判定冲突', () => {
    expect(weekCheckOutcome({ ...base, payloadRevision: 'rev-b' })).toBe('conflict')
  })

  it('响应里有新建周：提示重新载入', () => {
    expect(weekCheckOutcome({ ...base, created: true })).toBe('created')
  })

  it('版本一致且没新建：继续后面的判断', () => {
    expect(weekCheckOutcome(base)).toBe('ok')
  })

  it('还不知道当前版本时不误判冲突', () => {
    expect(weekCheckOutcome({ ...base, knownRevision: null })).toBe('ok')
  })
})
