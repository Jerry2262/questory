/**
 * 跨周检查的响应判定。
 *
 * 请求发出后本页可能又开始或完成了一次保存（保存序号在保存开始时即推进），
 * 这时响应里的版本已经过期：必须忽略它、等下一轮重检；
 * 否则会把自己的保存误判成「别的页面改了数据」并锁住编辑。
 */
export type WeekCheckOutcome = 'stale' | 'created' | 'conflict' | 'ok'

export function weekCheckOutcome(input: {
  startedSeq: number
  currentSeq: number
  created: boolean
  payloadRevision: string | null
  knownRevision: string | null
}): WeekCheckOutcome {
  if (input.startedSeq !== input.currentSeq) return 'stale'
  if (input.created) return 'created'
  if (input.knownRevision && input.payloadRevision !== input.knownRevision) return 'conflict'
  return 'ok'
}
