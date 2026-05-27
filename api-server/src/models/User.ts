import mongoose, { Schema, Document } from 'mongoose'

export interface IUser extends Document {
    _id: mongoose.Types.ObjectId
    email: string
    username: string
    password: string
    githubToken?: string
    createdAt: Date
    updatedAt: Date
}

const UserSchema = new Schema<IUser>({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    githubToken: { type: String },
}, { timestamps: true })

export const User = mongoose.model<IUser>('User', UserSchema)
