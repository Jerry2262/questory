import { link, mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/** 空文档：从公开仓库 clone 下来、还没有 data/ 时，用它保证开箱可启动 */
const EMPTY_DOC = `${JSON.stringify({ version: 1, header: [], weeks: [] }, null, 2)}\n`

/** 数据文件不存在时原子创建一个合法空文档；返回是否创建 */
export async function ensureDataFile(dataFile: string): Promise<boolean> {
  await mkdir(dirname(dataFile), { recursive: true })
  const tmp = `${dataFile}.${process.pid}.tmp`
  await writeFile(tmp, EMPTY_DOC, 'utf8')
  try {
    await link(tmp, dataFile)
    return true
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
    return false
  } finally {
    await unlink(tmp).catch(() => undefined)
  }
}
