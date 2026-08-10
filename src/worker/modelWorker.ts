/**
 * Parses an epJSON file off the main thread: JSON.parse → normalized model →
 * triangulated GPU buffers, streamed back with coarse progress messages.
 * Buffer ArrayBuffers are transferred, not copied.
 */

import { buildGeometry } from '../core/buildBuffers'
import { parseEpjson } from '../core/parse'
import type { EpModel, GeometryBundle } from '../core/types'

export interface WorkerRequest {
  id: number
  fileName: string
  text: string
}

export type WorkerResponse =
  | { id: number; type: 'progress'; phase: string; pct: number }
  | { id: number; type: 'done'; model: EpModel; bundle: GeometryBundle }
  | { id: number; type: 'error'; message: string }

const post = (msg: WorkerResponse, transfer?: Transferable[]): void => {
  ;(self as unknown as { postMessage(m: unknown, t?: Transferable[]): void }).postMessage(msg, transfer)
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, fileName, text } = e.data
  try {
    post({ id, type: 'progress', phase: 'Parsing JSON', pct: 10 })
    const json: unknown = JSON.parse(text)

    post({ id, type: 'progress', phase: 'Reading geometry', pct: 35 })
    const model = parseEpjson(json, fileName)

    post({ id, type: 'progress', phase: 'Triangulating surfaces', pct: 60 })
    const { bundle, warnings } = buildGeometry(model)
    model.warnings.push(...warnings)

    post({ id, type: 'progress', phase: 'Building scene', pct: 90 })
    const transfer: Transferable[] = []
    for (const g of Object.values(bundle.groups)) {
      if (g) transfer.push(g.positions.buffer, g.normals.buffer, g.triSurface.buffer, g.edges.buffer)
    }
    post({ id, type: 'done', model, bundle }, transfer)
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
