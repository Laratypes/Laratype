import { Prisma } from "@prisma/client";
import { JsonResource } from "@laratype/core";

type WrapResource<T> = Array<T> 

export default class UserResource<T extends WrapResource<Prisma.usersGetPayload<{}>>> extends JsonResource<T> {
  public toJson() {
    return this.data.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
    }))
  }
}