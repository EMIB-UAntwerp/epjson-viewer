import type { EngineRegistry } from './types'

export const versionFamily = (version: string): string => version.split('.').slice(0, 2).join('.')

// This detects Version only. Object parsing belongs to the upstream converter.
export function modelVersion(text: string): string {
  const declarations = [...text.replace(/!.*$/gm, '').matchAll(/(?:^|(?<=;))\s*Version\b([^;]*)(?:;|$)/gi)]
  const value = declarations.length === 1 ? /^\s*,\s*(\d+)\.(\d+)(?:\.(\d+))?\s*$/.exec(declarations[0]![1]!) : null
  if (!value) throw new Error('The IDF must declare exactly one valid Version object before it can be converted.')
  return value.slice(1).filter((part) => part !== undefined).map(Number).join('.')
}

export function upgradePath(registry: EngineRegistry, source: string, target: string): NonNullable<EngineRegistry['transitions']> | null {
  const start = versionFamily(source)
  const from = start.split('.').map(Number), to = target.split('.').map(Number)
  if (!/^\d+\.\d+$/.test(target) || !(to[0]! > from[0]! || (to[0] === from[0] && to[1]! > from[1]!))) return null
  const queue = [{ version: start, path: [] as NonNullable<EngineRegistry['transitions']> }]
  const visited = new Set<string>()
  while (queue.length) {
    const current = queue.shift()!
    if (current.version === target) return current.path
    if (visited.has(current.version)) continue
    visited.add(current.version)
    for (const edge of registry.transitions ?? []) {
      if (edge.fromVersion !== current.version || !/^\d+\.\d+$/.test(edge.toVersion)) continue
      const a = edge.fromVersion.split('.').map(Number), b = edge.toVersion.split('.').map(Number)
      if (b[0]! > a[0]! || (b[0] === a[0] && b[1]! > a[1]!)) queue.push({ version: edge.toVersion, path: [...current.path, edge] })
    }
  }
  return null
}
