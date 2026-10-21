import { timingSafeEqual } from 'crypto'
import { Request, Response, NextFunction } from 'express'

export function workerAuth(req: Request, res: Response, next: NextFunction) {
    const expected = process.env.WORKER_API_TOKEN || ''
    const actual = req.get('authorization')?.replace(/^Bearer /, '') || ''
    if (expected.length < 32 || actual.length !== expected.length ||
        !timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) return res.sendStatus(401)
    next()
}
