import mongoose, { Schema, Document } from 'mongoose'

export interface IUser extends Document {
    _id: mongoose.Types.ObjectId
    email: string
    username: string
    password: string
    githubToken?: string
    githubId?: number
    githubTokenKind?: 'app' | 'oauth'
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
    githubId: { type: Number, unique: true, sparse: true },
    githubTokenKind: { type: String, enum: ['app', 'oauth'] },
    githubRefreshToken: { type: String },
    githubTokenExpiresAt: { type: Date },
    githubRefreshExpiresAt: { type: Date },
}, { timestamps: true })

export const User = mongoose.model<IUser>('User', UserSchema)
