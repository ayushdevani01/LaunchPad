import { Router } from 'express'
import bcrypt from 'bcrypt'
import { User } from '../models/User'
import { signToken } from '../lib/jwt'

const router = Router()

router.post('/register', async (req, res) => {
    try {
        const { email, username, password } = req.body

        if (!email || !username || !password) {
            return res.status(400).json({ error: 'Email, username, and password are required' })
        }

        const existingUser = await User.findOne({ email })
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' })
        }
        const hashedPassword = await bcrypt.hash(password, 10)

        const user = await User.create({
            email,
            username,
            password: hashedPassword,
        })

        const token = signToken({
            userId: user._id.toString(),
            email: user.email,
            username: user.username,
        })

        res.status(201).json({
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                username: user.username,
            },
        })
    } catch (error) {
        console.error('Registration error:', error)
        res.status(500).json({ error: 'Registration failed' })
    }
})

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' })
        }

        const user = await User.findOne({ email })
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }
        const isValidPassword = await bcrypt.compare(password, user.password)
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid email or password' })
        }

        const token = signToken({
            userId: user._id.toString(),
            email: user.email,
            username: user.username,
        })

        res.json({
            token,
            user: {
                id: user._id.toString(),
                email: user.email,
                username: user.username,
            },
        })
    } catch (error) {
        console.error('Login error:', error)
        res.status(500).json({ error: 'Login failed' })
    }
})

export default router
