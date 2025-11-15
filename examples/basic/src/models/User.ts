import { UsePolicy } from "@laratype/auth"
import { Model, OneToMany } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column } from "@laratype/database"
import UserPolicy from "../policies/UserPolicy"
import Post from "./Post"

@Entity()
@UsePolicy(UserPolicy)
export default class User extends Model {
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

    @Column()
    isActive: boolean

    static readonly fillable = [
        'email',
        'password',
        'firstName',
        'lastName',
        'age',
        'isActive'
    ]

    @OneToMany(() => Post, post => post.user, { cascade: true })
    posts: Post[]
}

export default interface User extends UsePolicy<UserPolicy> {}
