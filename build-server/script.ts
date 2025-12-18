import { exec } from 'child_process'
import path from 'path'
import fs from 'fs'
import { Storage } from '@google-cloud/storage'
import mime from 'mime-types'
import Redis from 'ioredis'

const publisher = new Redis('')

const storage = new Storage({
    //todo: add credentials
})

const BUCKET_NAME = 'vercel-clone-outputs'
const PROJECT_ID = process.env.PROJECT_ID

function publishLog(log: string) {
    publisher.publish(`logs:${PROJECT_ID}`, JSON.stringify({ log }))
}

async function init() {
    console.log('Executing script.js')
    publishLog('Build Started...')
    const outDirPath = path.join(__dirname, 'output')

    const p = exec(`cd ${outDirPath} && npm install && npm run build`)

    p.stdout?.on('data', function (data) {
        console.log(data.toString())
        publishLog(data.toString())
    })

    p.stdout?.on('error', function (data) {
        console.log('Error', data.toString())
        publishLog(`error: ${data.toString()}`)
    })

    p.on('close', async function () {
        console.log('Build Complete')
        publishLog(`Build Complete`)
        const distFolderPath = path.join(__dirname, 'output', 'dist')
        const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true })

        publishLog(`Starting to upload`)

        const bucket = storage.bucket(BUCKET_NAME);

        for (const file of distFolderContents) {
            const filePath = path.join(distFolderPath, file as string)
            if (fs.lstatSync(filePath).isDirectory()) continue;

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
    })
}


init()