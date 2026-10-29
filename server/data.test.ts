import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { validateQuestDoc } from '../src/model/validate'
import { ensureDataFile } from './data'

let dir: string | null = null

async function workspace(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'questory-data-'))
  return dir
}

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
})

describe('首次运行初始化数据文件', () => {
  it('没有数据文件时创建合法空文档，目录不存在也一起创建', async () => {
    const root = await workspace()
    const data = join(root, 'nested', 'quests.json')

    await expect(ensureDataFile(data)).resolves.toBe(true)

    const doc = JSON.parse(await readFile(data, 'utf8'))
    expect(doc).toEqual({ version: 1, header: [], weeks: [] })
    expect(validateQuestDoc(doc)).toEqual([])
  })

  it('已有数据文件时不覆盖', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')
    const existing = '{"version":1,"header":["保留"],"weeks":[]}\n'
    await writeFile(data, existing, 'utf8')

    await expect(ensureDataFile(data)).resolves.toBe(false)
    expect(await readFile(data, 'utf8')).toBe(existing)
  })

  it('创建后不留下临时文件', async () => {
    const root = await workspace()
    const data = join(root, 'quests.json')

    await ensureDataFile(data)

    const files = await readdir(root)
    expect(files).toEqual(['quests.json'])
  })
})
