import mongoose, { Schema, Document } from 'mongoose'

export interface IUser extends Document {
    _id: mongoose.Types.ObjectId
    email: string
    username: string
    password: string
    githubToken?: string
    githubRefreshToken?: string
    githubTokenExpiresAt?: Date
    githubRefreshExpiresAt?: Date
    createdAt: Date
    updatedAt: Date
}

const UserSchema = new Schema<IUser>({
    email: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    password: { type: String, required: true },
    githubToken: { type: String },
    githubRefreshToken: { type: String },
    githubTokenExpiresAt: { type: Date },
    githubRefreshExpiresAt: { type: Date },
}, { timestamps: true })

export const User = mongoose.model<IUser>('User', UserSchema)
