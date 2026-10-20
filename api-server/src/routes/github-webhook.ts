import { Router, raw } from 'express'
import { GitHubDelivery } from '../models/GitHubConnection'
import { normalizeWebhook, validWebhookSignature } from '../lib/github-webhook'

const router = Router()
router.post('/github', raw({ type: 'application/json', limit: '26mb' }), async (req, res) => {
    if (!process.env.GITHUB_WEBHOOK_SECRET) return res.sendStatus(503)
    if (!Buffer.isBuffer(req.body) || !validWebhookSignature(req.body, req.get('x-hub-signature-256') || '', process.env.GITHUB_WEBHOOK_SECRET)) return res.sendStatus(401)
    const event = req.get('x-github-event') || ''
    const deliveryId = req.get('x-github-delivery') || ''
    if (event === 'ping') return res.sendStatus(200)
    if (!['push', 'installation', 'installation_repositories'].includes(event)) return res.sendStatus(204)
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(deliveryId)) return res.sendStatus(400)
    let payload
    try { payload = normalizeWebhook(event, JSON.parse(req.body.toString('utf8'))) }
    catch { return res.status(400).json({ error: 'Invalid GitHub webhook payload' }) }
    try {
        await GitHubDelivery.create({ deliveryId, event, payload })
        return res.sendStatus(202)
    } catch (err: any) {
        if (err.code === 11000) return res.sendStatus(202)
        return res.sendStatus(503)
    }
})
export default router
