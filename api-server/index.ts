import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
dotenv.config()

import { connectDB } from './src/lib/db'
import authRoutes from './src/routes/auth'
import projectRoutes from './src/routes/projects'


const app = express()
const PORT = process.env.PORT || 9000


const FRONTEND_URL = process.env.FRONTEND_URL || 'https://launch-pad.dev'
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:3000'],
    credentials: true,
}))

app.use(express.json())

app.use('/auth', authRoutes)
app.use('/projects', projectRoutes)

app.get('/health', (req, res) => {
    res.json({ status: 'ok' })
})

connectDB()
    .then(() => {
        app.listen(PORT, () => console.log(`API Server running on port ${PORT}`))
    })
