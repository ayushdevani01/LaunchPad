import express, { Request, Response } from 'express'
import httpProxy from 'http-proxy'
import https from 'https'
import http from 'http'
import dotenv from 'dotenv'
import mongoose, { Schema } from 'mongoose'

dotenv.config()

const app = express()
const PORT = 8000

const BASE_PATH = process.env.BASE_PATH // e.g. https://my-bucket.s3.amazonaws.com
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/launchpad'

// Connect to MongoDB
mongoose.connect(MONGODB_URI)
    .then(() => console.log('Proxy connected to MongoDB'))
    .catch(err => console.error('Proxy failed to connect to MongoDB:', err))

// Minimal Mongoose model for Project resolution
interface IProject {
    slug: string
    currentDeployment?: mongoose.Types.ObjectId
}

const ProjectSchema = new Schema<IProject>({
    slug: { type: String, required: true, unique: true },
    currentDeployment: { type: Schema.Types.ObjectId }
})

const Project = mongoose.model<IProject>('Project', ProjectSchema)

const proxy = httpProxy.createProxy()

proxy.on('proxyReq', (proxyReq, req) => {
    if (req.url === '/') proxyReq.path += 'index.html'
})

// SPA fallback: intercept 404s for HTML requests and serve the deployment's index.html
proxy.on('proxyRes', (proxyRes, req, res) => {
    if (proxyRes.statusCode === 404) {
        const accept = req.headers['accept'] || ''
        if (accept.includes('text/html')) {
            const subdomain = (req.headers.host || '').split('.')[0]
            const deploymentId = (req as any).deploymentId
            
            if (!deploymentId) {
                proxyRes.destroy()
                res.writeHead(404)
                res.end('Not Found')
                return
            }

            const fallbackUrl = `${BASE_PATH}/__outputs/${subdomain}/${deploymentId}/index.html`
            const client = fallbackUrl.startsWith('https') ? https : http
            
            client.get(fallbackUrl, (fallbackRes) => {
                res.writeHead(200, {
                    'Content-Type': 'text/html',
                    ...fallbackRes.headers
                })
                fallbackRes.pipe(res)
            }).on('error', () => {
                res.writeHead(404)
                res.end('Not Found')
            })
            proxyRes.destroy()
            return
        }
    }
})

app.use(async (req: Request, res: Response) => {
    const subdomain = req.hostname.split('.')[0]
    
    try {
        const project = await Project.findOne({ slug: subdomain })
        if (!project || !project.currentDeployment) {
            return res.status(404).send('No active deployment found for this project.')
        }

        const deploymentId = (project.currentDeployment as any).toString()
        const target = `${BASE_PATH}/__outputs/${subdomain}/${deploymentId}`;
        
        // Attach deploymentId to the request object so proxyRes can access it for SPA fallback
        (req as any).deploymentId = deploymentId
        
        proxy.web(req, res, { target, changeOrigin: true })
    } catch (err) {
        console.error('Proxy routing error:', err)
        return res.status(500).send('Internal server error')
    }
})

app.listen(PORT, () => console.log(`Atomic S3 Reverse Proxy Running on port ${PORT}`))
