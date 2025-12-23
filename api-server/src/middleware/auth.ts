import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'


export function authMiddleware(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized: No token provided' })
    }

    const token = authHeader.split(' ')[1]
    const payload = verifyToken(token)

    if (!payload) {
        return res.status(401).json({ error: 'Unauthorized: Invalid token' })
    }

    res.locals.authUser = payload
    next()
}
