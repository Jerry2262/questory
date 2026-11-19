import { stateOf } from '../src/model/derive'
import { QUADRANT_TITLES } from '../src/model/types'
import type { Quest, Week } from '../src/model/types'

const linesOf = (text: string): string[] => text.split(/\r\n|\r|\n/)

export function weekMarkdown(week: Week): string {
  const lines = [`# ${linesOf(week.label).join(' ')}`]

  function quote(text: string, indent = '') {
    for (const line of linesOf(text)) lines.push(`${indent}>${line ? ` ${line}` : ''}`)
  }

  function task(quest: Quest, indent = '') {
    const { done, voided } = stateOf(quest)
    const status = voided ? '已作废' : done ? '已完成' : '未关闭'
    lines.push(`${indent}- ${status}｜${linesOf(quest.title).join(' ')}`)
    const nested = `${indent}  `
    if (quest.note?.trim()) quote(quest.note, nested)
    for (const child of quest.children) task(child, nested)
  }

  if (week.kind === 'holiday') lines.push('', '假期周')
  if (week.note?.trim()) {
    lines.push('')
    quote(week.note)
  }
  const quadrants = week.quadrants.filter(({ children }) => children.length)
  if (!quadrants.length) lines.push('', '本周没有任务。')
  for (const { key, children } of quadrants) {
    lines.push('', `## ${QUADRANT_TITLES[key]}`, '')
    for (const quest of children) task(quest)
  }
  if (week.review?.trim()) {
    lines.push('', '## 周总结', '')
    quote(week.review)
  }
  return `${lines.join('\n')}\n`
}
