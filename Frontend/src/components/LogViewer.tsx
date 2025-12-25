"use client"
import { useEffect, useRef, useState } from 'react'
import { io, Socket } from 'socket.io-client'

interface LogViewerProps {
    slug: string
}

export default function LogViewer({ slug }: LogViewerProps) {
    const [logs, setLogs] = useState<string[]>([])
    const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
    const socketRef = useRef<Socket | null>(null)
    const logsEndRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
       
        const socketUrl = process.env.NEXT_PUBLIC_LOGS_URL || 'http://localhost:9002'

        socketRef.current = io(socketUrl)

        socketRef.current.on('connect', () => {
            console.log('Connected to log service')
            setStatus('connected')
            socketRef.current?.emit('subscribe', `logs:${slug}`)
        })

        socketRef.current.on('disconnect', () => {
            console.log('Disconnected from log service')
            setStatus('disconnected')
        })

        socketRef.current.on('message', (data: string) => {
            try {
                const parsed = JSON.parse(data)
                setLogs(prev => [...prev, parsed.log || parsed.message || JSON.stringify(parsed)])
            } catch {
                setLogs(prev => [...prev, data])
            }
        })

        return () => {
            socketRef.current?.disconnect()
        }
    }, [slug])

    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [logs])

    return (
        <div className="rounded-xl border border-white/10 bg-zinc-900/50 p-6 flex flex-col h-[400px]">
            <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-semibold">Deployment Logs</h2>
                <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${status === 'connected' ? 'bg-green-500 animate-pulse' :
                        status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                        }`}></span>
                    <span className="text-xs text-zinc-500 uppercase">{status}</span>
                </div>
            </div>
            <div className="flex-1 bg-black rounded-lg border border-white/5 p-4 font-mono text-sm overflow-y-auto">
                {logs.length === 0 ? (
                    <p className="text-zinc-600 italic">Waiting for logs...</p>
                ) : (
                    logs.map((log, index) => (
                        <div key={index} className="text-zinc-300 break-words border-b border-white/5 pb-1 mb-1 last:border-0">
                            <span className="text-zinc-500 select-none mr-2">$</span>
                            {log}
                        </div>
                    ))
                )}
                <div ref={logsEndRef} />
            </div>
        </div>
    )
}
