import mongoose, { Schema, Document } from 'mongoose'

export interface IDeployment extends Document {
    _id: mongoose.Types.ObjectId
    projectId: mongoose.Types.ObjectId
    status: 'PENDING' | 'BUILDING' | 'SUCCESS' | 'FAILED'
    logUrl?: string
    commitHash?: string
    taskArn?: string
    createdAt: Date
    updatedAt: Date
}

const DeploymentSchema = new Schema<IDeployment>({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: ['PENDING', 'BUILDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    logUrl: { type: String },
    commitHash: { type: String },
    taskArn: { type: String },
}, { timestamps: true })

DeploymentSchema.index({ projectId: 1 })

export const Deployment = mongoose.model<IDeployment>('Deployment', DeploymentSchema)
