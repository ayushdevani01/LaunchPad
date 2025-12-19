import express, { Request, Response } from 'express'
import httpProxy from 'http-proxy'
import dotenv from 'dotenv'
dotenv.config()
const app = express()
const PORT = 8000

const BASE_PATH = process.env.BASE_PATH
const proxy = httpProxy.createProxy()

proxy.on('proxyReq', (proxyReq, req) => {
    if (req.url === '/') proxyReq.path += 'index.html'
})

app.use((req: Request, res: Response) => {
    const subdomain = req.hostname.split('.')[0]
    const target = `${BASE_PATH}/${subdomain}`
    proxy.web(req, res, { target, changeOrigin: true })
})

app.listen(PORT, () => console.log(`Reverse Proxy Running..${PORT}`))
