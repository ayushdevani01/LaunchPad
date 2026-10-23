import dotenv from 'dotenv'
import mongoose, { Schema } from 'mongoose'
import { Readable } from 'stream'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { createApp } from './app'
import { forwardWeb } from './web'

dotenv.config()
const Project = mongoose.model('Project', new Schema({ slug: String, currentDeployment: Schema.Types.ObjectId }))
const Deployment = mongoose.model('Deployment', new Schema({ projectId: Schema.Types.ObjectId, runtime: Schema.Types.Mixed }))
const region = process.env.AWS_REGION || 'ap-south-1'
const endpoint = process.env.AWS_ENDPOINT || undefined
const s3 = new S3Client({ region, endpoint, forcePathStyle: !!endpoint, ...(endpoint ? { credentials: { accessKeyId: 'mock', secretAccessKey: 'mock' } } : {}) })
const app = createApp({
    async resolve(slug) {
        const project = await Project.findOne({ slug }).lean()
        if (!project?.currentDeployment) return null
        const deployment = await Deployment.findOne({ _id: project.currentDeployment, projectId: project._id }).lean()
        return { slug, deploymentId: project.currentDeployment.toString(), runtime: deployment?.runtime }
    },
    async asset(key) {
        const output = await s3.send(new GetObjectCommand({ Bucket: process.env.AWS_BUCKET_NAME || 'launchpad-assets', Key: key }), { abortSignal: AbortSignal.timeout(30000) })
        return { body: output.Body as Readable, contentType: output.ContentType, cacheControl: output.CacheControl, etag: output.ETag }
    },
    forward: forwardWeb
})

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/launchpad')
    .then(() => app.listen(Number(process.env.PORT || 8000), () => console.log('LaunchPad deployment proxy listening')))
    .catch(() => { console.error('Proxy cannot connect to MongoDB'); process.exitCode = 1 })
