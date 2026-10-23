import mongoose, { Schema, Document } from 'mongoose'

export interface IProject extends Document {
    _id: mongoose.Types.ObjectId
    slug: string
    gitUrl: string
    sourceDir?: string
    userId: mongoose.Types.ObjectId
    buildCommand?: string
    startCommand?: string
    installCommand?: string
    outputDir?: string
    branch?: string
    envVars?: Map<string, string>
    currentDeployment?: mongoose.Types.ObjectId
    latestDeployment?: mongoose.Types.ObjectId
    githubRepositoryId?: number
    githubInstallationId?: number
    autoDeploy?: boolean
    watchPaths?: string[]
    deploymentTarget?: 'auto' | 'static' | 'nextjs-web' | 'nodejs-web'
    createdAt: Date
    updatedAt: Date
}

const ProjectSchema = new Schema<IProject>({
    slug: { type: String, required: true, unique: true },
    gitUrl: { type: String, required: true },
    sourceDir: { type: String },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    buildCommand: { type: String },
    startCommand: { type: String },
    installCommand: { type: String },
    outputDir: { type: String },
    branch: { type: String, default: 'main' },
    envVars: { type: Map, of: String },
    currentDeployment: { type: Schema.Types.ObjectId, ref: 'Deployment' },
    latestDeployment: { type: Schema.Types.ObjectId, ref: 'Deployment' },
    githubRepositoryId: Number,
    githubInstallationId: Number,
    autoDeploy: { type: Boolean, default: true },
    watchPaths: { type: [String], default: [] },
    deploymentTarget: { type: String, enum: ['auto', 'static', 'nextjs-web', 'nodejs-web'], default: 'auto' },
}, { timestamps: true })

ProjectSchema.index({ userId: 1 })

export const Project = mongoose.model<IProject>('Project', ProjectSchema)
