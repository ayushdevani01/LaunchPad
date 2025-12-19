import 'dotenv/config'
import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { Storage } from '@google-cloud/storage'
import mime from 'mime-types'
import Redis from 'ioredis'
import { ChildProcess } from 'child_process'

// Redis publisher for build logs
const publisher = new Redis(process.env.REDIS_URL as string)

const storage = new Storage({
    projectId: process.env.GCP_PROJECT_ID,
    credentials: JSON.parse(process.env.GCP_SERVICE_ACCOUNT as string),
})

const BUCKET_NAME = process.env.BUCKET_NAME as string
const PROJECT_ID = process.env.CLIENT_PROJECT_ID

function publishLog(log: string) {
    console.log(log)
    publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log }))
}

async function init() {
    console.log('Executing script.js')
    publishLog('Build Started...')
    const outDirPath = '/home/app/output'

    const p: ChildProcess = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout?.on('data', function (data: Buffer) {
        console.log(data.toString())
        publishLog(data.toString())
    })

    p.stderr?.on('data', function (data: Buffer) {
        console.log('Error', data.toString())
        publishLog(`error: ${data.toString()}`)
    })

    p.on('close', async function (code) {
        if (code !== 0) {
            console.error(`Build failed with exit code ${code}`)
            publishLog(`Build failed with exit code ${code}`)
            await publisher.quit()
            process.exit(1)
        }
        console.log('Build Complete')
        publishLog(`Build Complete`)
        const distFolderPath = '/home/app/output/build'
        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

        publishLog(`Starting to upload`)

        const bucket = storage.bucket(BUCKET_NAME)

        for (const file of distFolderContents) {
            const filePath = path.join(distFolderPath, file as string)
            if (fs.lstatSync(filePath).isDirectory()) continue

            console.log('uploading', filePath)
            publishLog(`uploading ${file}`)

            const destination = `__outputs/${PROJECT_ID}/${file}`

            await bucket.upload(filePath, {
                destination: destination,
                contentType: mime.lookup(filePath) || 'application/octet-stream'
            })

            publishLog(`uploaded ${file}`)
            console.log('uploaded', filePath)
        }

        publishLog(`Done`)
        console.log('Done...')

        await publisher.quit()
        process.exit(0)
    })
}

init()