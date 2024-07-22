import { Prisma, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient();


export default function ModelKernel<T extends Prisma.ModelName>(model: Prisma.ModelName extends `${infer U}` ? `${U}` extends `${Prisma.ModelName}` ? U : never : never) {
  abstract class ModelKernel {
    static getModel() {
      return prisma[model];
    }

    static findMany(fields?: Prisma.TypeMap['model'][T]['operations']['findMany']['args']): ReturnType<typeof prisma[T]['findMany']> {
      // @ts-ignore
      return this.getModel().findMany(fields);
    }

    static createMany(data: Prisma.TypeMap['model'][T]['operations']['createMany']['args']): ReturnType<typeof prisma[T]['createMany']> {
      // @ts-ignore
      return this.getModel().createMany(data);
    }

    static create(data: Prisma.TypeMap['model'][T]['operations']['create']['args']): ReturnType<typeof prisma[T]['create']> {
      // @ts-ignore
      return this.getModel().create(data);
    }
  }

  return ModelKernel;
}