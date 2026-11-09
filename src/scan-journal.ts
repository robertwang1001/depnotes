import type { ScanEvent } from './types.js'
/** A single active scan's bounded progress history. */
export function createScanJournal<T extends {
  type: string
} = ScanEvent>({ limit = 10000 } = {}) {
  limit = Math.max(2, Math.trunc(limit) || 10000)
  let active = false
  let history: T[] = []
  const listeners = new Set<(event: T) => void>()
  return {
    begin() {
      active = true
      history = []
    },
    publish(event: T) {
      if (!active)
        return
      // Keep the start event while bounding memory on unusually large workspaces.
      if (history.length >= limit)
        history.splice(1, 1)
      history.push(event)
      for (const send of [...listeners]) {
        try {
          send(event)
        }
        catch {
          listeners.delete(send)
        }
      }
    },
    subscribe(send: (event: T) => void, { replay = true } = {}) {
      // JavaScript executes this synchronously: replay and subscriber registration
      // cannot race with another scan callback in the same event loop.
      if (replay) {
        for (const event of history)
          send(event)
      }
      listeners.add(send)
      return () => listeners.delete(send)
    },
    end() {
      active = false
      listeners.clear()
    },
    get active() {
      return active
    },
    get size() {
      return history.length
    },
    get subscriberCount() {
      return listeners.size
    },
  }
}
