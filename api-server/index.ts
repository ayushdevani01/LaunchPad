import express from 'express'
import { generateSlug } from 'random-word-slugs'
import { JobsClient } from '@google-cloud/run'
import dotenv from 'dotenv'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 9000

const jobsClient = new JobsClient()

app.use(express.json())

app.post('/project', async (req, res) => {
    const { gitURL, slug } = req.body

    if (!gitURL) {
        return res.status(400).json({ error: 'gitURL is required' })
    }

    const projectSlug = slug ? slug : generateSlug()

    try {

        const jobPath = process.env.CLOUD_RUN_JOB_PATH as string

        const [execution] = await jobsClient.runJob({
            name: jobPath,
            overrides: {
                containerOverrides: [
                    {
                        env: [
                            { name: 'GIT_REPOSITORY__URL', value: gitURL },
                            { name: 'CLIENT_PROJECT_ID', value: projectSlug },
                            { name: 'REDIS_URL', value: process.env.REDIS_URL }
                        ]
                    }
                ]
            }
        })

        console.log(`Build started for project: ${projectSlug}`)
        console.log(`Execution name: ${execution.name}`)

        return res.json({
            status: 'queued',
            data: {
                projectSlug,
                url: `http://${projectSlug}.localhost:8000`,
                executionName: execution.name
            }
        })
    } catch (error) {
        console.error('Failed to start Cloud Run Job:', error)
        return res.status(500).json({ error: 'Failed to start build' })
    }
})

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
})

app.listen(PORT, () => console.log(`API Server running on port ${PORT}`))
