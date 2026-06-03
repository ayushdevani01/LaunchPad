import 'dotenv/config'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import mime from 'mime-types'
import Redis from 'ioredis'
import { ChildProcess } from 'child_process'

const publisher = new Redis(process.env.REDIS_URL as string)

const getAwsEndpoint = (): string | undefined => {
    const ep = process.env.AWS_ENDPOINT
    if (!ep) return undefined
    const trimmed = ep.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.toLowerCase() === 'undefined' || trimmed.toLowerCase() === 'null') {
        return undefined
    }
    try {
        new URL(trimmed)
        return trimmed
    } catch (e) {
        console.warn(`[AWS_ENDPOINT] Ignoring invalid AWS_ENDPOINT URL in build-server: "${trimmed}"`)
        return undefined
    }
}

const awsEndpoint = getAwsEndpoint()

const s3Client = new S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    endpoint: awsEndpoint,
    forcePathStyle: awsEndpoint ? true : undefined,
    credentials: {
        accessKeyId: (process.env.AWS_ACCESS_KEY_ID || 'mock') as string,
        secretAccessKey: (process.env.AWS_SECRET_ACCESS_KEY || 'mock') as string,
    }
})

const BUCKET_NAME = process.env.AWS_BUCKET_NAME as string
const PROJECT_ID = process.env.CLIENT_PROJECT_ID as string
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID as string
const API_CALLBACK_URL = process.env.API_CALLBACK_URL as string

let logBuffer = ''

function publishLog(log: string) {
    console.log(log)
    logBuffer += log + '\n'
    publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log }))
}

async function uploadLogs() {
    try {
        publishLog('Uploading build logs to S3...')
        const logDestination = `__logs/${PROJECT_ID}/${DEPLOYMENT_ID}/build.log`
        
        await s3Client.send(new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: logDestination,
            Body: logBuffer,
            ContentType: 'text/plain'
        }))
        console.log('Build logs successfully uploaded.')
    } catch (err) {
        console.error('Failed to upload logs to S3:', err)
    }
}

async function sendCallback(status: 'SUCCESS' | 'FAILED') {
    if (!API_CALLBACK_URL) {
        console.log('No API_CALLBACK_URL configured, skipping callback.')
        return
    }
    try {
        console.log(`Sending callback to API server: ${status} at ${API_CALLBACK_URL}`)
        const response = await fetch(API_CALLBACK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status })
        })
        console.log(`Callback response status code: ${response.status}`)
    } catch (err) {
        console.error('Failed to send status callback:', err)
    }
}

async function init() {
    console.log('Executing script.js')
    publishLog('Build Started...')

    const baseOutputPath = '/home/app/output'
    const sourceDir = (process.env.SOURCE_DIR || '').replace(/^\/+|\/+$/g, '')
    const outDirPath = sourceDir ? path.join(baseOutputPath, sourceDir) : baseOutputPath

    if (sourceDir) {
        publishLog(`Building from subfolder: ${sourceDir}`)
    }

    // Merge user-defined custom environment variables into child process environment
    let userEnv = {}
    try {
        userEnv = JSON.parse(process.env.USER_ENV_VARS || '{}')
        const keys = Object.keys(userEnv)
        if (keys.length > 0) {
            publishLog(`Injecting custom environment variables: ${keys.join(', ')}`)
        }
    } catch (e) {
        publishLog('Warning: Failed to parse user environment variables.')
    }

    const buildEnv = { ...process.env, ...userEnv }

    const installCmd = process.env.INSTALL_COMMAND || 'npm install'
    const buildCmd = process.env.BUILD_COMMAND || 'npm run build'

    publishLog(`Executing install: ${installCmd}`)
    publishLog(`Executing build: ${buildCmd}`)

    const p: ChildProcess = exec(
        `cd ${outDirPath} && ${installCmd} && ${buildCmd}`,
        { env: buildEnv }
    )

    p.stdout?.on('data', function (data: Buffer) {
        publishLog(data.toString())
    })

    p.stderr?.on('data', function (data: Buffer) {
        publishLog(`error: ${data.toString()}`)
    })

    p.on('close', async function (code) {
        if (code !== 0) {
            publishLog(`Build failed with exit code ${code}`)
            await uploadLogs()
            await sendCallback('FAILED')
            await publisher.quit()
            process.exit(1)
        }

        publishLog('Build Complete')

        const customOutputDir = process.env.BUILD_OUTPUT_DIR?.trim()
        let distFolderPath = ''

        // 1. Check custom output directory if specified
        if (customOutputDir) {
            const fullPath = path.join(outDirPath, customOutputDir)
            if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
                distFolderPath = fullPath
                publishLog(`Using configured build output folder: ${customOutputDir}`)
            } else {
                publishLog(`Warning: Configured output folder '${customOutputDir}' not found. Scanning common alternatives...`)
            }
        }

        // 2. Fallback to scanning common directories
        if (!distFolderPath) {
            const possibleDirs = ['dist', 'build', 'out', '.next/out', '.next', 'public', 'www', 'output', '.output', '_site']
            for (const dir of possibleDirs) {
                const fullPath = path.join(outDirPath, dir)
                if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
                    distFolderPath = fullPath
                    publishLog(`Found build output: ${dir}`)
                    break
                }
            }
        }

        if (!distFolderPath) {
            publishLog('Error: Build output folder not found. Please configure the output directory in project settings.')
            await uploadLogs()
            await sendCallback('FAILED')
            await publisher.quit()
            process.exit(1)
        }

        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })
        const files = distFolderContents.filter(file => {
            const filePath = path.join(distFolderPath, file as string)
            return !fs.lstatSync(filePath).isDirectory()
        })

        publishLog(`Uploading ${files.length} production files to S3...`)

        // Upload production assets under deployment-specific folder for atomic swaps
        await Promise.all(files.map(async (file) => {
            const filePath = path.join(distFolderPath, file as string)
            const destination = `__outputs/${PROJECT_ID}/${DEPLOYMENT_ID}/${file}`
            const fileContent = fs.readFileSync(filePath)

            await s3Client.send(new PutObjectCommand({
                Bucket: BUCKET_NAME,
                Key: destination,
                Body: fileContent,
                ContentType: mime.lookup(filePath) || 'application/octet-stream'
            }))
        }))

        publishLog(`Successfully uploaded ${files.length} assets to S3.`)
        console.log('Build output deployment finished.')

        publishLog(`Deployment successful! Your site is live at: https://${PROJECT_ID}.launch-pad.dev 🎉`)

        await uploadLogs()
        await sendCallback('SUCCESS')

        await publisher.quit()
        process.exit(0)
    })
}

init()