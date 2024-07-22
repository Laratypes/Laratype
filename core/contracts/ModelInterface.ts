import { Prisma, PrismaClient } from "@prisma/client";

export default interface ModelInterface {

  model: typeof PrismaClient.prototype[Prisma.ModelName]
}