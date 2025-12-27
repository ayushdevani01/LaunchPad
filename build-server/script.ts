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

    const baseOutputPath = '/home/app/output'

    const sourceDir = (process.env.SOURCE_DIR || '').replace(/^\/+|\/+$/g, '')
    const outDirPath = sourceDir ? path.join(baseOutputPath, sourceDir) : baseOutputPath

    if (sourceDir) {
        publishLog(`Building from subfolder: ${sourceDir}`)
    }

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

        const possibleDirs = (process.env.BUILD_OUTPUT_DIR || 'dist,build,out,.next,public,www,output,.output,_site,public/build').split(',').map(d => d.trim())
        let distFolderPath = ''

        for (const dir of possibleDirs) {
            const fullPath = path.join(outDirPath, dir)
            if (fs.existsSync(fullPath) && fs.lstatSync(fullPath).isDirectory()) {
                distFolderPath = fullPath
                publishLog(`Found build output: ${dir}`)
                break
            }
        }

        if (!distFolderPath) {
            publishLog(`Error: Build output folder not found. Checked: ${possibleDirs.join(', ')}`)
            await publisher.quit()
            process.exit(1)
        }

        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })
        const bucket = storage.bucket(BUCKET_NAME)

        const files = distFolderContents.filter(file => {
            const filePath = path.join(distFolderPath, file as string)
            return !fs.lstatSync(filePath).isDirectory()
        })

        publishLog(`Uploading ${files.length} files...`)

        await Promise.all(files.map(async (file) => {
            const filePath = path.join(distFolderPath, file as string)
            const destination = `__outputs/${PROJECT_ID}/${file}`

            await bucket.upload(filePath, {
                destination,
                contentType: mime.lookup(filePath) || 'application/octet-stream'
            })
        }))

        publishLog(`Uploaded ${files.length} files`)
        console.log('Done...')

        await publisher.quit()
        process.exit(0)
    })
}

init()