import { ManyToOne, Model } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from "@laratype/database"
import { User } from "./User"

@Entity()
export class Post extends Model {
    @PrimaryGeneratedColumn()
    id: number

    @Column({ type: 'text'})
    content: string

    @CreateDateColumn()
    created_at: Date

    @UpdateDateColumn()
    updated_at: Date

    @ManyToOne(() => User, user => user.posts)
    user: User

    static readonly fillable = [
        'content',
    ]
}

export interface Post {}
