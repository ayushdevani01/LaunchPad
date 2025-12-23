import mongoose, { Schema, Document } from 'mongoose'

export interface IProject extends Document {
    _id: mongoose.Types.ObjectId
    slug: string
    gitUrl: string
    status: string
    userId: mongoose.Types.ObjectId
    createdAt: Date
    updatedAt: Date
}

const ProjectSchema = new Schema<IProject>({
    slug: { type: String, required: true, unique: true },
    gitUrl: { type: String, required: true },
    status: { type: String, default: 'queued' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true })

ProjectSchema.index({ userId: 1 })

export const Project = mongoose.model<IProject>('Project', ProjectSchema)
