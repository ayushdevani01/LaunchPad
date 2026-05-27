import mongoose, { Schema, Document } from 'mongoose'

export interface IProject extends Document {
    _id: mongoose.Types.ObjectId
    slug: string
    gitUrl: string
    sourceDir?: string
    userId: mongoose.Types.ObjectId
    buildCommand?: string
    installCommand?: string
    outputDir?: string
    branch?: string
    envVars?: Map<string, string>
    currentDeployment?: mongoose.Types.ObjectId
    createdAt: Date
    updatedAt: Date
}

const ProjectSchema = new Schema<IProject>({
    slug: { type: String, required: true, unique: true },
    gitUrl: { type: String, required: true },
    sourceDir: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    buildCommand: { type: String },
    installCommand: { type: String },
    outputDir: { type: String },
    branch: { type: String, default: 'main' },
    envVars: { type: Map, of: String },
    currentDeployment: { type: Schema.Types.ObjectId, ref: 'Deployment' },
}, { timestamps: true })

ProjectSchema.index({ userId: 1 })

export const Project = mongoose.model<IProject>('Project', ProjectSchema)
