"use client"
import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

interface LogEvent {
    id: string
    log: string
    sequence?: number
    timestamp?: string
    stage?: string
    level?: string
    deploymentId?: string
}

export default function LogViewer({ slug, deploymentId }: { slug: string; deploymentId: string }) {
    const [logs, setLogs] = useState<LogEvent[]>([])
    const [status, setStatus] = useState('connecting')
    const [warning, setWarning] = useState('')
    const logsEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
        setLogs([])
        setStatus('connecting')
        setWarning('')
        let pending: LogEvent[] = []
        let legacySequence = 0
        const socket = io(process.env.NEXT_PUBLIC_LOGS_URL || 'http://localhost:9002', {
            auth: { token: localStorage.getItem('token') || '' }
        })
        const subscribe = () => socket.emit('subscribe', `logs:${slug}:${deploymentId}`)
        const receive = (raw: string) => {
            try {
                const event = JSON.parse(raw)
                if (event.deploymentId && event.deploymentId !== deploymentId) return
                if (typeof event.log !== 'string') return
                pending.push({ ...event, id: event.id || `legacy:${++legacySequence}` })
                pending = pending.slice(-4000)
            } catch { /* Ignore invalid messages rather than rendering protocol data. */ }
        }
        socket.on('connect', () => { setStatus('subscribing'); subscribe() })
        socket.on('subscribed', () => setStatus('connected'))
        socket.on('disconnect', () => setStatus('reconnecting'))
        socket.on('connect_error', error => { setStatus('disconnected'); setWarning(error.message) })
        socket.on('error', message => { setStatus('disconnected'); setWarning(String(message)) })
        socket.on('log_warning', message => setWarning(String(message)))
        socket.on('logs:resync', subscribe)
        socket.on('message', receive)
        socket.on('history', (entries: string[]) => { if (Array.isArray(entries)) entries.forEach(receive) })
        // Batch updates so verbose builds do not render the entire viewer per line.
        const flush = setInterval(() => {
            if (!pending.length) return
            const batch = pending
            pending = []
            setLogs(previous => {
                const merged = new Map(previous.map(event => [event.id, event]))
                batch.forEach(event => merged.set(event.id, event))
                return Array.from(merged.values()).sort((a, b) => (a.sequence || 0) - (b.sequence || 0)).slice(-2000)
            })
        }, 100)
        return () => { clearInterval(flush); socket.disconnect() }
    }, [slug, deploymentId])

    useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }, [logs])

    return (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-6 flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Deployment Logs</h2>
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-green-500' : 'bg-yellow-500'}`} />
                    <span className="text-xs text-zinc-500 uppercase">{status}</span>
                </div>
            </div>
            {warning && <p role="status" className="text-xs text-amber-300 mb-2">{warning}</p>}
            <div role="log" aria-label="Build output" className="flex-1 bg-black rounded-lg border border-white/5 p-4 font-mono text-sm overflow-y-auto">
                {logs.length === 0 ? <p className="text-zinc-600 italic">Waiting for the build worker to start...</p> : logs.map(event => (
                    <div key={event.id} className={`whitespace-pre-wrap break-words pb-1 ${event.level === 'error' ? 'text-red-300' : event.level === 'warn' ? 'text-amber-300' : 'text-zinc-300'}`}>
                        <span className="text-zinc-500 mr-2">{event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : ''} {event.stage ? `[${event.stage}]` : ''}</span>
                        {event.log}
                    </div>
                ))}
                <div ref={logsEndRef} />
            </div>
        </div>
    )
}
