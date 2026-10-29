// D8 #115: Log is a facade over the container binding of LogManager; F1 #160: the channels are manager drivers
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Container, Facade } from '@laratype/core'
import { Config } from '@laratype/support'
import type { LaratypeConfig } from '@laratype/support'
import { Log, LogManager } from '../src'
import type Logger from '../src/Logger'

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

type Channel = LaratypeConfig.Logging.CHANNEL

/** A LogManager whose `single` channel is `logger`, so a test never creates the log file. */
const managerWith = (logger: Logger): LogManager =>
  new (class extends LogManager {
    protected override createDriver(name: Channel): Logger {
      return name === 'single' ? logger : super.createDriver(name)
    }
  })()

/** The value a throwing call threw: DriverNotImplement throws a plain object, not an Error. */
const caught = (fn: () => unknown): unknown => {
  try {
    fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to throw')
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

describe('LogManager drivers', () => {
  const configs = globalThis.__laratype_config
  afterEach(() => Config.setConfigs(configs))

  const logger = (): Logger => ({ log: vi.fn() }) as unknown as Logger

  it('resolves the driver of logging.default and caches it', () => {
    Config.setConfigs({ env: 'test', logging: { default: 'single', channels: {} } })
    const single = logger()
    const manager = managerWith(single)
    expect(manager.getLogger()).toBe(single)
    expect(manager.driver()).toBe(single)
    manager.info('hello')
    expect(single.log).toHaveBeenCalledWith('info', 'hello')
  })

  it('throws DriverNotImplement for the channels 0.5 does not implement', () => {
    Config.setConfigs({ env: 'test', logging: { default: 'single', channels: {} } })
    const manager = managerWith(logger())
    expect(caught(() => manager.driver('stack'))).toMatchObject({ code: 'DRIVER_NOT_IMPLEMENT' })
    expect(caught(() => manager.driver('daily'))).toMatchObject({ code: 'DRIVER_NOT_IMPLEMENT' })
  })

  it('throws DriverNotImplement when logging.default is not set', () => {
    Config.setConfigs({ env: 'test', logging: { channels: {} } })
    const manager = managerWith(logger())
    expect(caught(() => manager.driver())).toMatchObject({ code: 'DRIVER_NOT_IMPLEMENT' })
  })

  it('extend() replaces a channel factory', () => {
    Config.setConfigs({ env: 'test', logging: { default: 'single', channels: {} } })
    const original = logger()
    const extended = logger()
    const manager = managerWith(original).extend('single', () => extended)
    expect(manager.getLogger()).toBe(extended)
  })
})
