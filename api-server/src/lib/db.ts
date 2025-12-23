import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI as string

export async function connectDB() {
    try {
        await mongoose.connect(MONGODB_URI)
        console.log('MongoDB connected')
    } catch (error) {
        console.error('MongoDB connection error:', error)
        process.exit(1)
    }
}
