import jwt from 'jsonwebtoken'

const JWT_SECRET = process.env.JWT_SECRET as string

export interface JWTPayload {
    userId: string
    email: string
    username: string
}

export function signToken(payload: JWTPayload): string {
    return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token: string): JWTPayload | null {
    try {
        return jwt.verify(token, JWT_SECRET) as JWTPayload
    } catch {
        return null
    }
}
