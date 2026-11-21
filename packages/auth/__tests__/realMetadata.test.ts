// A8 #350: the null/undefined composite-key rule against real TypeORM 0.3.26 metadata, not the in-memory fakeModel
import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Column, DataSource, Entity, Model, PrimaryColumn, type EntityMetadata } from '@laratype/database'
import { Facade } from '@laratype/core'
import { Hash } from '@laratype/support'
import { SHA256_SECRET, attempt } from './fixtures/login'

afterEach(() => Facade.setFacadeApplication(undefined))

/** A composite key part that lives in an embed, so its property path is `data.region`. */
class Region {
  @PrimaryColumn({ type: 'int' })
  region!: number
}

@Entity('a8_composite_account')
class Account extends Model {
  @PrimaryColumn({ type: 'int' })
  id!: number

  @Column({ type: 'varchar' })
  email!: string

  @Column({ type: 'varchar' })
  password!: string

  @Column(() => Region)
  data!: Region
}

/** The entity's real metadata, built from the decorators with no database connection (the buildMetadatas probe). */
const realMetadata = async (): Promise<EntityMetadata> => {
  const dataSource = new DataSource({
    type: 'mysql',
    host: 'localhost',
    username: 'laratype',
    password: 'laratype',
    database: 'laratype',
    entities: [Account],
    synchronize: false,
  })
  // buildMetadatas() is protected: the guard needs the metadata, not a connection
  await (dataSource as unknown as { buildMetadatas(): Promise<void> }).buildMetadatas()
  return dataSource.getMetadata(Account)
}

/**
 * A guard provider over `metadata` and one row, with the model's repository swapped for a spy: attempt() reads the
 * metadata, and only a rehash would reach the update.
 */
const wired = (metadata: EntityMetadata, row: Account) => {
  const update = vi.fn(async (_criteria: Record<string, unknown>, _values: { password: string }) => ({ affected: 1 }))
  const query = {
    where: vi.fn(() => query),
    addSelect: vi.fn(() => query),
    getOne: vi.fn(async () => row),
  }
  class Wired extends Account {}
  Object.assign(Wired, {
    getRepository: () => ({ metadata, update }),
    createQueryBuilder: () => query,
  })
  return { Wired, update }
}

const rowOf = (data: unknown, password: string) =>
  Object.assign(new Account(), { id: 7, email: 'old@example.com', password, data })

describe('the rehash over real TypeORM metadata', () => {
  it('keeps a null embedded part out of the update', async () => {
    const metadata = await realMetadata()
    const row = rowOf({ region: null }, SHA256_SECRET)
    // typeorm 0.3.26 keeps the null part in the nested id map; `= NULL` matches no row, so no update may run
    expect(metadata.getEntityIdMap(row)).toEqual({ id: 7, data: { region: null } })
    const { Wired, update } = wired(metadata, row)
    await expect(attempt(Wired, { email: 'old@example.com', password: 'secret' })).resolves.not.toBeNull()
    expect(update).not.toHaveBeenCalled()
    expect(row.password).toBe(SHA256_SECRET)
  })

  it('keeps a missing embedded part out of the update', async () => {
    const metadata = await realMetadata()
    const row = rowOf({}, SHA256_SECRET)
    // typeorm drops the whole id map when a primary column's property is missing
    expect(metadata.getEntityIdMap(row)).toBeUndefined()
    const { Wired, update } = wired(metadata, row)
    await expect(attempt(Wired, { email: 'old@example.com', password: 'secret' })).resolves.not.toBeNull()
    expect(update).not.toHaveBeenCalled()
    expect(row.password).toBe(SHA256_SECRET)
  })

  it('updates the row by its whole nested key when both parts are present', async () => {
    const metadata = await realMetadata()
    const row = rowOf({ region: 3 }, SHA256_SECRET)
    expect(metadata.getEntityIdMap(row)).toEqual({ id: 7, data: { region: 3 } })
    const { Wired, update } = wired(metadata, row)
    const user = await attempt(Wired, { email: 'old@example.com', password: 'secret' })
    expect(user).not.toBeNull()
    expect(update).toHaveBeenCalledTimes(1)
    const [criteria, values] = update.mock.calls[0]!
    // The real id map is nested by the embed's property path, and the update still matches the hash it checked
    expect(criteria).toEqual({ id: 7, data: { region: 3 }, password: SHA256_SECRET })
    expect(Hash.isHashed(values.password)).toBe(true)
    expect(Hash.check('secret', values.password)).toBe(true)
  })
})
