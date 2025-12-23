import { Router } from 'express'
import bcrypt from 'bcrypt'
import { User } from '../models/User'
import { signToken } from '../lib/jwt'
import axios from 'axios'

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

router.get('/google', (req, res) => {
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
    const REDIRECT_URI = process.env.GITHUB_CALLBACK_URL?.replace('github', 'google') || 'http://localhost:9000/auth/google/callback'

    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${GOOGLE_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&response_type=code&scope=profile email`
    res.redirect(url)
})

router.get('/google/callback', async (req, res) => {
    const { code } = req.query
    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
    const REDIRECT_URI = process.env.GITHUB_CALLBACK_URL?.replace('github', 'google') || 'http://localhost:9000/auth/google/callback'
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

    try {
        const { data } = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            code,
            redirect_uri: REDIRECT_URI,
            grant_type: 'authorization_code',
        })

        const { access_token, id_token } = data

        const { data: profile } = await axios.get('https://www.googleapis.com/oauth2/v1/userinfo', {
            headers: { Authorization: `Bearer ${access_token}` },
        })

        // Check if user exists
        let user = await User.findOne({ email: profile.email })

        if (!user) {
            user = await User.create({
                email: profile.email,
                username: profile.name || profile.email.split('@')[0],
                password: Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8), // Random password
            })
        }

        const token = signToken({
            userId: user._id.toString(),
            email: user.email,
            username: user.username,
        })

        res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)

    } catch (error: any) {
        console.error('Google Auth Error:', error.response?.data || error.message)
        res.redirect(`${FRONTEND_URL}/login?error=Google auth failed`)
    }
})

router.get('/github', (req, res) => {
    const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
    const REDIRECT_URI = process.env.GITHUB_CALLBACK_URL || 'http://localhost:9000/auth/github/callback'

    const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=user:email`
    res.redirect(url)
})

router.get('/github/callback', async (req, res) => {
    const { code } = req.query
    const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID
    const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

    try {
        const { data } = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
        }, {
            headers: { Accept: 'application/json' }
        })

        const { access_token } = data

        const { data: userProfile } = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${access_token}` },
        })

        const { data: emails } = await axios.get('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${access_token}` },
        })

        const primaryEmail = emails.find((e: any) => e.primary)?.email || userProfile.email

        // Check if user exists
        let user = await User.findOne({ email: primaryEmail })

        if (!user) {
            user = await User.create({
                email: primaryEmail,
                username: userProfile.login,
                password: Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8), // Random password
            })
        }

        const token = signToken({
            userId: user._id.toString(),
            email: user.email,
            username: user.username,
        })

        res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)

    } catch (error: any) {
        console.error('GitHub Auth Error:', error.response?.data || error.message)
        res.redirect(`${FRONTEND_URL}/login?error=GitHub auth failed`)
    }
})

export default router
