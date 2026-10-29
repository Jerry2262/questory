import { QUADRANT_KEYS } from './types'
import { parseWeekLabel } from './week'

export interface ValidationIssue {
  path: string
  message: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isString = (value: unknown): value is string => typeof value === 'string'

const isStatus = (value: unknown): value is 'open' | 'done' | 'void' =>
  value === 'open' || value === 'done' || value === 'void'

/**
 * 写盘前的结构校验。只守住数据模型真正依赖的不变量：
 * 周/象限/任务的形状、id 唯一、父任务不存状态、普通周标签可解析。
 * 未知字段不拦，给以后留空间。
 */
export function validateQuestDoc(value: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const add = (path: string, message: string) => issues.push({ path, message })

  if (!isRecord(value)) return [{ path: '', message: '文档必须是对象' }]
  if (value.version !== 1) add('version', '必须是 1')
  if (!Array.isArray(value.header) || !value.header.every(isString)) {
    add('header', '必须是字符串数组')
  }
  if (!Array.isArray(value.weeks)) {
    add('weeks', '必须是数组')
    return issues
  }

  const weekIds = new Set<string>()
  const labels = new Set<string>()
  const questIds = new Set<string>()

  const walkQuest = (quest: unknown, path: string) => {
    if (!isRecord(quest)) {
      add(path, '必须是对象')
      return
    }
    if (!isString(quest.id) || !quest.id) add(`${path}.id`, '必须是非空字符串')
    else if (questIds.has(quest.id)) add(`${path}.id`, '任务 id 重复')
    else questIds.add(quest.id)

    if (!isString(quest.title)) add(`${path}.title`, '必须是字符串')
    if (quest.note !== undefined && !isString(quest.note)) add(`${path}.note`, '必须是字符串')
    if (quest.voided !== undefined && typeof quest.voided !== 'boolean') {
      add(`${path}.voided`, '必须是布尔值')
    }
    if (!Array.isArray(quest.children)) {
      add(`${path}.children`, '必须是数组')
      return
    }

    if (quest.children.length === 0) {
      if (quest.voided !== undefined) {
        add(`${path}.voided`, '叶子任务不能有 voided，用 status 表示状态')
      }
      if (quest.status !== undefined && !isStatus(quest.status)) {
        add(`${path}.status`, '必须是 open / done / void')
      }
    } else if (quest.status !== undefined) {
      add(`${path}.status`, '父任务不存 status，状态由子任务推导')
    }

    quest.children.forEach((child, index) => walkQuest(child, `${path}.children[${index}]`))
  }

  value.weeks.forEach((week, wi) => {
    const path = `weeks[${wi}]`
    if (!isRecord(week)) {
      add(path, '必须是对象')
      return
    }

    if (!isString(week.id) || !week.id) add(`${path}.id`, '必须是非空字符串')
    else if (weekIds.has(week.id)) add(`${path}.id`, '周 id 重复')
    else weekIds.add(week.id)

    if (!isString(week.label) || !week.label.trim()) add(`${path}.label`, '必须是非空字符串')
    else if (labels.has(week.label)) add(`${path}.label`, '周标签重复')
    else labels.add(week.label)

    if (week.kind !== 'normal' && week.kind !== 'holiday') {
      add(`${path}.kind`, '必须是 normal 或 holiday')
    }
    if (week.note !== undefined && !isString(week.note)) add(`${path}.note`, '必须是字符串')
    if (week.review !== undefined && !isString(week.review)) add(`${path}.review`, '必须是字符串')

    if (week.kind === 'normal' && isString(week.label) && !parseWeekLabel(week.label)) {
      add(`${path}.label`, '普通周的标签无法解析')
    }

    if (!Array.isArray(week.quadrants)) {
      add(`${path}.quadrants`, '必须是数组')
      return
    }

    const keys = new Set<string>()
    week.quadrants.forEach((quadrant, qi) => {
      const qPath = `${path}.quadrants[${qi}]`
      if (!isRecord(quadrant)) {
        add(qPath, '必须是对象')
        return
      }

      const key = quadrant.key
      if (!isString(key) || !(QUADRANT_KEYS as readonly string[]).includes(key)) {
        add(`${qPath}.key`, `必须是 ${QUADRANT_KEYS.join(' / ')} 之一`)
      } else if (keys.has(key)) {
        add(`${qPath}.key`, '同一周内象限重复')
      } else {
        keys.add(key)
      }

      if (!Array.isArray(quadrant.children)) {
        add(`${qPath}.children`, '必须是数组')
        return
      }

      quadrant.children.forEach((quest, ti) => walkQuest(quest, `${qPath}.children[${ti}]`))
    })
  })

  return issues
}
