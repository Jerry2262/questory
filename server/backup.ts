import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * 数据备份：data/backups/YYYY-MM-DD.json（Asia/Shanghai），保留最近 30 份。
 * 同一天只留第一次的快照；服务启动和当天第一次写盘前各尝试一次。
 */
const KEEP = 30
const TIME_ZONE = 'Asia/Shanghai'

function todayStamp(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())

  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export async function backupToday(dataFile: string, raw?: string): Promise<string | null> {
  const snapshot = raw ?? (await readFile(dataFile, 'utf8'))
  const dir = join(dirname(dataFile), 'backups')
  await mkdir(dir, { recursive: true })

  const target = join(dir, `${todayStamp()}.json`)
  // 先完整写到临时文件，再用硬链接原子发布：不会有半截快照，也不会覆盖当天第一份
  const tmp = `${target}.${process.pid}.tmp`
  try {
    await writeFile(tmp, snapshot, 'utf8')
    try {
      await link(tmp, target)
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    }
  } finally {
    await unlink(tmp).catch(() => undefined)
  }

  await prune(dir)
  return target
}

async function prune(dir: string): Promise<void> {
  const files = (await readdir(dir))
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .sort()
    .reverse()

  await Promise.all(
    files.slice(KEEP).map((name) => unlink(join(dir, name)).catch(() => undefined)),
  )
}
