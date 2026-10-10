/**
 * Does TypeORM (packages/database, ^0.3.20) still work if sauf turns SWC `decoratorMetadata` off?
 * A bare `@Column()` (as in examples/basic/app/src/models) infers its type from `design:type`.
 * Entity goes through the DI transform + SWC (warmup.ts options, metadata on/off), then Node ESM imports it.
 * Usage: TYPEORM_PATH=<typeorm/index.mjs> node scripts/typeorm-check.ts
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transformSync } from '@swc/core';
import { transform } from '../src/transform.ts';
import { warmupSwcOptions } from './swc-options.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const typeorm = process.env.TYPEORM_PATH
  ?? 'D:/Laratype/Laratype/node_modules/.bun/typeorm@0.3.26+6e23d336aa29114e/node_modules/typeorm/index.mjs';
const reflect = join(root, '../node_modules/reflect-metadata/Reflect.js');

const entity = `import 'reflect-metadata';
import { Entity, PrimaryGeneratedColumn, Column, getMetadataArgsStorage } from 'typeorm';

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  createdAt!: Date;

  constructor(name: string) {
    this.name = name;
  }
}

const cols = getMetadataArgsStorage().columns.filter((c) => c.target === User);
console.log(cols.map((c) => c.propertyName + ':' + (typeof c.options.type === 'function' ? c.options.type.name : c.options.type)).join(', '));
`;

for (const decoratorMetadata of [true, false]) {
  const dir = join(root, 'out', `typeorm-metadata-${decoratorMetadata ? 'on' : 'off'}`);
  mkdirSync(dir, { recursive: true });
  const di = transform(entity, 'entity.ts', { helperId: pathToFileURL(join(root, 'out/runtime.js')).href })!;
  const js = transformSync(di.code, { ...warmupSwcOptions({ decoratorMetadata }), filename: 'entity.ts' }).code
    .replace(`'typeorm'`, JSON.stringify(pathToFileURL(typeorm).href))
    .replace(`"typeorm"`, JSON.stringify(pathToFileURL(typeorm).href))
    .replace(`'reflect-metadata'`, JSON.stringify(pathToFileURL(reflect).href))
    .replace(`"reflect-metadata"`, JSON.stringify(pathToFileURL(reflect).href));
  writeFileSync(join(dir, 'entity.js'), js);
  const r = spawnSync(process.execPath, [join(dir, 'entity.js')], { encoding: 'utf8' });
  const result = r.status === 0
    ? `ok -> ${r.stdout.trim()}`
    : (r.stderr.split('\n').find((l) => /Error/.test(l)) ?? r.stderr.trim()).trim();
  console.log(`decoratorMetadata ${decoratorMetadata ? 'ON ' : 'OFF'}: ${result}`);
}
