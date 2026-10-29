export type QuestStatus = 'open' | 'done' | 'void'

export interface Quest {
  id: string
  title: string
  /** 只对叶子有意义；有子任务时状态由子任务推导，不写这个字段 */
  status?: QuestStatus
  /** 备注，纯文本，可多行 */
  note?: string
  /** 父任务的显式作废覆盖；子任务状态保留，取消后按子任务重算 */
  voided?: boolean
  children: Quest[]
}

export const QUADRANT_KEYS = ['urgent-important', 'important', 'urgent', 'neither'] as const

export type QuadrantKey = (typeof QUADRANT_KEYS)[number]

export const QUADRANT_TITLES: Record<QuadrantKey, string> = {
  'urgent-important': '重要且紧急',
  important: '重要但不紧急',
  urgent: '紧急但不重要',
  neither: '不紧急也不重要',
}

export interface Quadrant {
  key: QuadrantKey
  children: Quest[]
}

export interface Week {
  id: string
  /** 周标题，如 `2026 10.26-11.1` */
  label: string
  /** 标题里的括注，如 `项目冲刺` */
  note?: string
  kind: 'normal' | 'holiday'
  quadrants: Quadrant[]
  /** 每周一段总结（原先是每象限一段，迁移时按象限顺序合并） */
  review?: string
}

export interface QuestDoc {
  version: 1
  /** 旧文件顶部那几行说明，原样保留 */
  header: string[]
  /** 最新一周在最前面，和旧文件顺序一致 */
  weeks: Week[]
}
