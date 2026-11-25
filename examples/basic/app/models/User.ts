import { Model, OneToMany } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column, type Relation } from "@laratype/database"
import Post from "./Post"

@Entity()
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
    posts: Relation<Post>[]
}
