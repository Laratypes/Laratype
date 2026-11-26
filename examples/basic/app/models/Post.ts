import { ManyToOne, Model } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, type Relation } from "@laratype/database"
import User from "./User"

@Entity()
export default class Post extends Model {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ type: 'text'})
    content: string

    @CreateDateColumn()
    created_at: Date

    @UpdateDateColumn()
    updated_at: Date

    @ManyToOne(() => User, user => user.posts)
    user: Relation<User>

    static readonly fillable = [
        'content',
    ]
}

export default interface Post {}
