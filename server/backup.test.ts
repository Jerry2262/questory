import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { backupToday } from './backup'

let dir: string | null = null

async function workspace(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'questory-backup-'))
  return dir
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('每日备份', () => {
  it('当天第一次调用生成快照，之后再调用不覆盖', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')
    await writeFile(data, 'first', 'utf8')

    const target = await backupToday(data)
    expect(target).not.toBeNull()
    expect(await readFile(target!, 'utf8')).toBe('first')

    await writeFile(data, 'second', 'utf8')
    await backupToday(data)
    expect(await readFile(target!, 'utf8')).toBe('first')
  })

  it('发布后不留下临时文件，且当天已有快照时不覆盖', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')
    await writeFile(data, 'first', 'utf8')

    const target = await backupToday(data)
    await backupToday(data, 'second')

    expect(await readFile(target!, 'utf8')).toBe('first')
    const files = await readdir(join(root, 'backups'))
    expect(files.filter((name) => name.includes('.tmp'))).toEqual([])
  })

  it('用写盘前的 raw 生成快照，而不是事后读文件', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')
    await writeFile(data, 'on-disk', 'utf8')

    const target = await backupToday(data, 'in-memory-before-write')
    expect(await readFile(target!, 'utf8')).toBe('in-memory-before-write')
  })

  it('只保留最近 30 份', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')
    await writeFile(data, 'today', 'utf8')

    const backups = join(root, 'backups')
    await mkdir(backups, { recursive: true })
    for (let i = 1; i <= 35; i += 1) {
      const day = String(i).padStart(2, '0')
      await writeFile(join(backups, `2000-01-${day}.json`), `old-${i}`, 'utf8')
    }

    await backupToday(data)

    const files = (await readdir(backups)).filter((name) => name.endsWith('.json'))
    expect(files).toHaveLength(30)
    expect(files).toContain('2000-01-35.json')
    expect(files).toContain('2000-01-07.json')
    expect(files).not.toContain('2000-01-06.json')
    expect(files).not.toContain('2000-01-01.json')
  })
})
