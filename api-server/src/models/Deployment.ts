import mongoose, { Schema, Document } from 'mongoose'

export interface IDeployment extends Document {
    _id: mongoose.Types.ObjectId
    projectId: mongoose.Types.ObjectId
    status: 'PENDING' | 'BUILDING' | 'SUCCESS' | 'FAILED'
    logUrl?: string
    commitHash?: string
    taskArn?: string
    runtime?: Record<string, any>
    failureReason?: string
    trigger?: 'manual' | 'push'
    queuePublishedAt?: Date
    queueLeaseUntil?: Date
    dispatchLeaseUntil?: Date
    dispatchAttempts?: number
    dispatchRequest?: Record<string, any>
    cloneAuthHash?: string
    cloneAuthExpiresAt?: Date
    cloneAuthConsumedAt?: Date
    createdAt: Date
    updatedAt: Date
}

const DeploymentSchema = new Schema<IDeployment>({
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true },
    status: { type: String, enum: ['PENDING', 'BUILDING', 'SUCCESS', 'FAILED'], default: 'PENDING' },
    logUrl: { type: String },
    commitHash: { type: String },
    taskArn: { type: String },
    runtime: { type: Schema.Types.Mixed },
    failureReason: { type: String },
    trigger: { type: String, enum: ['manual', 'push'], default: 'manual' },
    queuePublishedAt: Date,
    queueLeaseUntil: Date,
    dispatchLeaseUntil: Date,
    dispatchAttempts: { type: Number, default: 0 },
    dispatchRequest: { type: Schema.Types.Mixed, select: false },
    cloneAuthHash: { type: String, select: false },
    cloneAuthExpiresAt: { type: Date, select: false },
    cloneAuthConsumedAt: { type: Date, select: false },
}, { timestamps: true })

DeploymentSchema.index({ projectId: 1 })
DeploymentSchema.index({ status: 1, queuePublishedAt: 1 })
DeploymentSchema.index({ projectId: 1, commitHash: 1, trigger: 1 }, { unique: true, partialFilterExpression: { trigger: 'push', commitHash: { $type: 'string' } } })

export const Deployment = mongoose.model<IDeployment>('Deployment', DeploymentSchema)
