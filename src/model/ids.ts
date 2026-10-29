const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/** 短 id：够用、看得清 */
export function newId(length = 10): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  if (uuid) return uuid.replace(/-/g, '').slice(0, length)
  let out = ''
  for (let i = 0; i < length; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return out
}

/**
 * 由内容推出的稳定 id（FNV-1a 64bit → base36）。
 * 周没有自己的节点属性可用，就靠位置和标题算 id；改名会换 id，但不会每次保存都变。
 */
export function hashId(...parts: (string | number)[]): string {
  const input = parts.join('\u0001')
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (let i = 0; i < input.length; i += 1) {
    hash ^= BigInt(input.charCodeAt(i))
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  let value = hash
  let out = ''
  for (let i = 0; i < 10; i += 1) {
    out = ALPHABET[Number(value % 36n)] + out
    value /= 36n
  }
  return out
}
