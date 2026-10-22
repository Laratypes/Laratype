// D8 #115: Log is a facade over the container binding of LogManager
import { afterEach, describe, expect, it } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { Log, LogManager } from '../src'

/** Records the lines instead of writing the log file. */
class MemoryLog extends LogManager {
  lines: string[] = []
  override info(message: any) {
    this.lines.push(`info: ${message}`)
  }
  override error(message: any) {
    this.lines.push(`error: ${message}`)
  }
}

describe('Log facade', () => {
  afterEach(() => Facade.setFacadeApplication(undefined))

  it('works detached from the class', () => {
    const memory = new MemoryLog()
    const restore = Log.fake(memory)
    const info = Log.info
    info('detached')
    expect(memory.lines).toEqual(['info: detached'])
    restore()
  })

  it('app.swap() replaces the implementation', () => {
    const app = new Container()
    Facade.setFacadeApplication(app)
    const memory = new MemoryLog()
    const restore = app.swap(LogManager, memory)
    Log.info('hello')
    Log.error('boom')
    expect(memory.lines).toEqual(['info: hello', 'error: boom'])
    restore()
    expect(app.make(LogManager)).not.toBe(memory)
  })

  it('Log.fake() replaces the implementation', () => {
    const memory = new MemoryLog()
    const restore = Log.fake(memory)
    Log.info('faked')
    expect(memory.lines).toEqual(['info: faked'])
    restore()
    expect(Facade.getFacadeApplication().make(LogManager)).not.toBe(memory)
  })
})
