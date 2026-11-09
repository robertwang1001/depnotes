import type { AddressInfo } from 'node:net'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import test from 'node:test'
import { createScanJournal } from '../src/scan-journal.js'

interface TestEvent {
  type: string
  index?: number
  total?: number
}
test('a late subscriber receives completed progress then live results in order', () => {
  const journal = createScanJournal<TestEvent>()
  journal.begin()
  journal.publish({ type: 'start', total: 3 })
  journal.publish({ type: 'item', index: 0 })
  const a: TestEvent[] = []
  const unsubscribe = journal.subscribe(event => a.push(event))
  journal.publish({ type: 'item', index: 1 })
  assert.deepEqual(a.map(event => event.index ?? event.type), ['start', 0, 1])
  assert.equal(journal.subscriberCount, 1)
  unsubscribe()
  journal.publish({ type: 'item', index: 2 })
  assert.equal(a.length, 3)
})
test('separate scans cannot replay data from previous scan', () => {
  const journal = createScanJournal<TestEvent>()
  journal.begin()
  journal.publish({ type: 'start', total: 1 })
  journal.publish({ type: 'item', index: 0 })
  journal.end()
  journal.begin()
  journal.publish({ type: 'start', total: 2 })
  const received: TestEvent[] = []
  journal.subscribe(e => received.push(e))
  assert.deepEqual(received, [
    { type: 'start', total: 2 },
  ])
})
test('long-running scans keep bounded history and always retain initial metadata', () => {
  const journal = createScanJournal<TestEvent>({ limit: 4 })
  journal.begin()
  journal.publish({ type: 'start', total: 20 })
  for (let i = 0; i < 20; i++)
    journal.publish({ type: 'item', index: i })
  assert.equal(journal.size, 4)
  const all: TestEvent[] = []
  journal.subscribe(e => all.push(e))
  assert.equal(all[0].type, 'start')
  assert.deepEqual(all.slice(1).map(e => e.index), [17, 18, 19])
})
test('SSE streams deliver replayed and live events, and handle disconnect', async () => {
  const journal = createScanJournal<TestEvent>()
  journal.begin()
  journal.publish({ type: 'start', total: 2 })
  journal.publish({ type: 'item', index: 0 })
  const server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const unsubscribe = journal.subscribe(event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`))
    response.on('close', unsubscribe)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let text = ''
    const first = await reader.read()
    text += decoder.decode(first.value)
    assert.match(text, /"type":"start"/)
    assert.match(text, /"index":0/)
    journal.publish({ type: 'item', index: 1 })
    const second = await reader.read()
    text += decoder.decode(second.value)
    assert.match(text, /"index":1/)
    await reader.cancel()
    // Allow the HTTP server to observe the closed socket.
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(journal.subscriberCount <= 1)
  }
  finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error
      ? reject(error)
      : resolve()))
  }
})
