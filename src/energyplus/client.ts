import type { ConversionResult, EngineRequest, EngineResponse } from './types'

export class ConversionError extends Error {
  constructor(message: string, readonly diagnostics: string[] = []) {
    super(message)
    this.name = 'ConversionError'
  }
}

/** One worker per job isolates native global state, exits, and failed allocations. */
export function convertIdf(
  text: string,
  options: {
    id: number
    assetBaseUrl: string
    signal: AbortSignal
    onProgress: (phase: string, pct: number) => void
  },
): Promise<ConversionResult> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) {
      reject(new DOMException('Import cancelled', 'AbortError'))
      return
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    const cleanup = (): void => {
      options.signal.removeEventListener('abort', abort)
      worker.terminate()
    }
    const abort = (): void => {
      cleanup()
      reject(new DOMException('Import cancelled', 'AbortError'))
    }
    options.signal.addEventListener('abort', abort, { once: true })
    worker.onmessage = (event: MessageEvent<EngineResponse>) => {
      const message = event.data
      if (message.id !== options.id) return
      if (message.protocol !== 2) {
        cleanup()
        reject(new ConversionError('Unsupported EnergyPlus worker protocol. Reload the page and retry.'))
        return
      }
      if (message.type === 'progress') {
        options.onProgress(message.phase, message.pct)
        return
      }
      cleanup()
      if (message.type === 'done') resolve(message.result)
      else reject(new ConversionError(message.message, message.diagnostics))
    }
    worker.onerror = (event) => {
      cleanup()
      reject(new ConversionError(event.message || 'The EnergyPlus conversion worker failed.'))
    }
    worker.onmessageerror = () => {
      cleanup()
      reject(new ConversionError('Could not read the EnergyPlus conversion result.'))
    }
    const request: EngineRequest = {
      protocol: 2, id: options.id, operation: 'convert', text, assetBaseUrl: options.assetBaseUrl,
    }
    try {
      worker.postMessage(request)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
