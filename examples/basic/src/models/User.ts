import { Model } from "@laratype/database"
import { Entity, PrimaryGeneratedColumn, Column, SaveOptions } from "typeorm"

@Entity()
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