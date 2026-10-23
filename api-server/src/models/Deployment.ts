import mongoose, { Schema, Document } from 'mongoose'

export interface IGitHubReport {
    installationId: number
    repositoryId: number
    owner: string
    repo: string
    environment: string
    logUrl: string
    siteUrl: string
    remoteId?: number
    createAttempted?: boolean
    sentStates: string[]
    pendingState?: string
    attempts: number
    nextAttemptAt: Date
    leaseUntil?: Date
    leaseToken?: string
    done: boolean
    lastError?: string
}

const GitHubReportSchema = new Schema<IGitHubReport>({
    installationId: { type: Number, required: true },
    repositoryId: { type: Number, required: true },
    owner: { type: String, required: true },
    repo: { type: String, required: true },
    environment: { type: String, required: true },
    logUrl: { type: String, required: true },
    siteUrl: { type: String, required: true },
    remoteId: Number,
    createAttempted: Boolean,
    sentStates: { type: [String], default: [] },
    pendingState: String,
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: Date.now },
    leaseUntil: Date,
    leaseToken: String,
    done: { type: Boolean, default: false },
    lastError: String,
}, { _id: false })

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
    githubReport?: IGitHubReport
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
    githubReport: { type: GitHubReportSchema, select: false },
}, { timestamps: true })

DeploymentSchema.index({ projectId: 1 })
DeploymentSchema.index({ status: 1, queuePublishedAt: 1 })
DeploymentSchema.index({ 'githubReport.done': 1, 'githubReport.nextAttemptAt': 1 })
DeploymentSchema.index({ projectId: 1, commitHash: 1, trigger: 1 }, { unique: true, partialFilterExpression: { trigger: 'push', commitHash: { $type: 'string' } } })

DeploymentSchema.set('toJSON', { transform(_doc, value) { delete value.githubReport; return value } })

export const Deployment = mongoose.model<IDeployment>('Deployment', DeploymentSchema)
