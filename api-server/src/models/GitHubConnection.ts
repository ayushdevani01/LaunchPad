import mongoose, { Schema } from 'mongoose'

export const GitHubConnection = mongoose.model('GitHubConnection', new Schema({
    stateHash: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectSlug: String,
    expiresAt: { type: Date, required: true, expires: 0 }
}))

export const GitHubInstallation = mongoose.model('GitHubInstallation', new Schema({
    installationId: { type: Number, required: true, unique: true },
    suspended: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false }
}, { timestamps: true }))

export const GitHubDelivery = mongoose.model('GitHubDelivery', new Schema({
    deliveryId: { type: String, required: true, unique: true },
    event: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    processedAt: Date,
    leaseUntil: Date,
    attempts: { type: Number, default: 0 },
    retryAt: Date,
    lastError: String
}, { timestamps: true }))
