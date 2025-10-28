import { UsePolicy } from "@laratype/auth"
import { Model } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column } from "@laratype/database"
import UserPolicy from "../policies/UserPolicy"

@Entity()
@UsePolicy(UserPolicy)
export class User extends Model {
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

export interface User extends UsePolicy<UserPolicy> {}
