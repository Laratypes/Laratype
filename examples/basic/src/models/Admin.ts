import { UsePolicy } from "@laratype/auth"
import { Model } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column } from "@laratype/database"
import AdminPolicy from "../policies/AdminPolicy"

@Entity()
@UsePolicy(AdminPolicy)
export class Admin extends Model {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ unique: true })
    email: string

    @Column({ select: false })
    password: string

    @Column()
    firstName: string

    @Column()
    lastName: string

    @Column()
    age: number

    static readonly fillable = [
      'email',
      'password',
      'firstName',
      'lastName',
      'age',
    ]
}

export interface Admin extends UsePolicy<AdminPolicy> {}