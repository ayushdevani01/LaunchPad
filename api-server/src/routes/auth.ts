import { Router } from 'express'
import bcrypt from 'bcrypt'
import { User } from '../models/User'
import { signToken } from '../lib/jwt'
import axios from 'axios'
import { randomBytes, timingSafeEqual } from 'crypto'
import { tokenFields } from '../lib/github-token'
import { appConfigured } from '../lib/github-app'

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
    const GITHUB_CLIENT_ID = appConfigured() ? process.env.GITHUB_APP_CLIENT_ID : process.env.GITHUB_CLIENT_ID
    const REDIRECT_URI = appConfigured() ? (process.env.GITHUB_APP_CALLBACK_URL || 'https://api.launch-pad.dev/auth/github-app/callback') : (process.env.GITHUB_CALLBACK_URL || 'http://localhost:9000/auth/github/callback')

    if (!GITHUB_CLIENT_ID || !(appConfigured() ? process.env.GITHUB_APP_CLIENT_SECRET : process.env.GITHUB_CLIENT_SECRET)) return res.status(503).json({error: 'GitHub sign-in is not configured'})
    const state = randomBytes(32).toString('hex')
    const secure = REDIRECT_URI.startsWith('https://')
    res.cookie(secure ? '__Host-launchpad_oauth' : 'launchpad_oauth', state, {httpOnly:true, secure, sameSite:'lax', path:'/', maxAge:600000})
    const url = `https://github.com/login/oauth/authorize?${new URLSearchParams({client_id: GITHUB_CLIENT_ID, redirect_uri: REDIRECT_URI, ...(appConfigured() ? {} : {scope:'user:email'}), state})}`
    res.redirect(url)
})

router.get(['/github/callback', '/github-app/callback'], async (req, res) => {
    const { code } = req.query
    const GITHUB_CLIENT_ID = appConfigured() ? process.env.GITHUB_APP_CLIENT_ID : process.env.GITHUB_CLIENT_ID
    const GITHUB_CLIENT_SECRET = appConfigured() ? process.env.GITHUB_APP_CLIENT_SECRET : process.env.GITHUB_CLIENT_SECRET
    const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000'

    const secure = (appConfigured() ? (process.env.GITHUB_APP_CALLBACK_URL || 'https://api.launch-pad.dev/auth/github-app/callback') : (process.env.GITHUB_CALLBACK_URL || '')).startsWith('https://')
    const cookieName = secure ? '__Host-launchpad_oauth' : 'launchpad_oauth'
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(v=>v.trim().split('=')))
    const expected = cookies[cookieName]
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    res.clearCookie(cookieName, {httpOnly:true, secure, sameSite:'lax', path:'/'})
    if (!/^[a-f0-9]{64}$/.test(expected || '') || !/^[a-f0-9]{64}$/.test(state) || !timingSafeEqual(Buffer.from(expected),Buffer.from(state)) || typeof code !== 'string') return res.status(400).json({error:'Invalid GitHub sign-in state. Start sign-in again.'})

    try {
        const { data } = await axios.post('https://github.com/login/oauth/access_token', {
            client_id: GITHUB_CLIENT_ID,
            client_secret: GITHUB_CLIENT_SECRET,
            code,
        }, {
            headers: { Accept: 'application/json' }, timeout: 15000
        })

        const fields = tokenFields(data)
        const access_token = fields.githubToken

        const { data: userProfile } = await axios.get('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${access_token}` },
        })

        const { data: emails } = await axios.get('https://api.github.com/user/emails', {
            headers: { Authorization: `Bearer ${access_token}` },
        })

        const primaryEmail = emails.find((e: any) => e.primary && e.verified)?.email || emails.find((e: any) => e.verified)?.email
        if (!primaryEmail) throw new Error('A verified GitHub email is required')

        if (!Number.isSafeInteger(userProfile.id)) throw new Error('Invalid GitHub identity')
        let user = await User.findOne({ githubId: userProfile.id })
        if (!user) {
            const legacy = await User.findOne({ email: primaryEmail })
            if (legacy) {
                // Migration requires proof of the old GitHub identity, not just
                // a matching email address from another authentication method.
                if (!legacy.githubToken || legacy.githubId) throw new Error('Sign in to your existing account to link GitHub')
                const previous = await axios.get('https://api.github.com/user', {
                    headers: { Authorization: `Bearer ${legacy.githubToken}` }, timeout: 15000
                })
                if (previous.data.id !== userProfile.id) throw new Error('GitHub identity does not match')
                user = legacy
            }
        }
        const identity: { githubId: number; githubTokenKind: 'app' | 'oauth' } = { githubId: userProfile.id, githubTokenKind: appConfigured() ? 'app' : 'oauth' }


        if (!user) {
            user = await User.create({
                email: primaryEmail,
                username: userProfile.login,
                password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
                ...fields,
                ...identity,
            })
        } else {
            Object.assign(user, fields, identity)
            await user.save()
        }

        const token = signToken({
            userId: user._id.toString(),
            email: user.email,
            username: user.username,
        })

        res.redirect(`${FRONTEND_URL}/auth/callback?token=${token}`)

    } catch (error: any) {
        console.error('GitHub authentication failed')
        res.redirect(`${FRONTEND_URL}/login?error=GitHub auth failed`)
    }
})

export default router
