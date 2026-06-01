"use client"
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { getProject, fetchWithAuth } from '../../../lib/api'
import LogViewer from '../../../components/LogViewer'

interface Project {
    _id: string
    name: string
    slug: string
    gitUrl: string
    createdAt: string
    branch?: string
    installCommand?: string
    buildCommand?: string
    outputDir?: string
}

interface Deployment {
    _id: string
    projectId: string
    status: 'PENDING' | 'BUILDING' | 'SUCCESS' | 'FAILED'
    createdAt: string
}

export default function ProjectDetailsPage() {
    const params = useParams()
    const router = useRouter()
    const slug = params.slug as string

    const [project, setProject] = useState<Project | null>(null)
    const [deployments, setDeployments] = useState<Deployment[]>([])
    const [selectedDeployment, setSelectedDeployment] = useState<Deployment | null>(null)
    const [historicalLogs, setHistoricalLogs] = useState('')
    const [loadingLogs, setLoadingLogs] = useState(false)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [redeploying, setRedeploying] = useState(false)

    const fetchProjectAndDeployments = async () => {
        try {
            const data = await getProject(slug)
            setProject(data.project)

            const depRes = await fetchWithAuth(`/projects/${slug}/deployments`)
            if (depRes.ok) {
                const depData = await depRes.json()
                const deps = depData.deployments || []
                setDeployments(deps)
                if (deps.length > 0) {
                    setSelectedDeployment(deps[0])
                }
            }
        } catch (err: any) {
            setError(err.message || 'Failed to load project details')
        } finally {
            setLoading(false)
        }
    const handleRedeploy = async () => {
        if (redeploying) return
        setRedeploying(true)
        try {
            const res = await fetchWithAuth(`/projects/${slug}/redeploy`, {
                method: 'POST'
            })
            if (res.ok) {
                // Refresh deployments list
                await fetchProjectAndDeployments()
            } else {
                const data = await res.json()
                alert(data.error || 'Failed to trigger redeployment')
            }
        } catch (err: any) {
            console.error('Redeploy failed:', err)
            alert('Failed to trigger redeployment.')
        } finally {
            setRedeploying(false)
        }
    }

    useEffect(() => {
        if (slug) fetchProjectAndDeployments()
    }, [slug])

    useEffect(() => {
        if (!selectedDeployment) return
        if (selectedDeployment.status === 'BUILDING' || selectedDeployment.status === 'PENDING') {
            setHistoricalLogs('')
            return
        }

        const fetchS3Logs = async () => {
            setLoadingLogs(true)
            setHistoricalLogs('Loading logs from storage...')
            try {
                const res = await fetchWithAuth(`/projects/${slug}/deployments/${selectedDeployment._id}/logs`)
                if (res.ok) {
                    const data = await res.json()
                    setHistoricalLogs(data.logs || 'No logs recorded.')
                } else {
                    setHistoricalLogs('Failed to retrieve logs from storage.')
                }
            } catch (err) {
                setHistoricalLogs('Error retrieving logs.')
            } finally {
                setLoadingLogs(false)
            }
        }

        fetchS3Logs()
    }, [selectedDeployment, slug])

    if (loading) {
        return (
            <div className="min-h-screen bg-black text-white flex justify-center items-center">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
            </div>
        )
    }

    if (error || !project) {
        return (
            <div className="min-h-screen bg-black text-white flex justify-center items-center">
                <div className="text-red-400">Error: {error || 'Project not found'}</div>
            </div>
        )
    }

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-black text-white px-4 py-24 sm:px-6 lg:px-8 bg-[linear-gradient(to_bottom,#000,#200D42_34%,#4F21A1_65%,#A46EDB_82%)] relative overflow-clip">
                <div className="absolute h-[375px] w-[750px] sm:w-[1536px] sm:h-[768px] lg:w-[2400px] llg:h-[800px] rounded-[100%] bg-black left-1/2 -translate-x-1/2 border border-[#B48CDE] bg-[radial-gradient(closest-side,#000_82%,#9560EB)] top-[calc(100%-96px)] sm:top-[calc(100%-120px)] opacity-30"></div>

                <div className="mx-auto max-w-6xl relative z-10">
                    <div className="mb-8">
                        <Link href="/dashboard" className="text-zinc-400 hover:text-white mb-4 inline-block font-medium">
                            ← Back to Dashboard
                        </Link>
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div>
                                <h1 className="text-4xl font-bold tracking-tight text-white">{project.name || project.slug}</h1>
                                <p className="text-zinc-400 mt-2 text-base">
                                    Deployed at: <a href={`https://${project.slug}.launch-pad.dev`} target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">{project.slug}.launch-pad.dev</a>
                                </p>
                            </div>
                            <div className="flex flex-wrap items-center gap-4 self-start">
                                <div className="text-sm bg-white/5 border border-white/10 rounded-xl p-4">
                                    <span className="block text-zinc-500 font-medium">Repository URL</span>
                                    <a href={project.gitUrl} target="_blank" rel="noreferrer" className="text-zinc-300 hover:text-white truncate max-w-xs block font-mono mt-0.5">{project.gitUrl}</a>
                                </div>
                                <button
                                    onClick={handleRedeploy}
                                    disabled={redeploying}
                                    className="bg-[#9560EB] hover:bg-[#8040E0] disabled:bg-purple-900/40 disabled:text-zinc-400 text-white font-bold h-[58px] px-6 rounded-xl border border-white/10 shadow-lg shadow-purple-500/10 flex items-center gap-2 transition-all duration-150 active:scale-95 text-sm shrink-0"
                                >
                                    {redeploying ? (
                                        <>
                                            <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                            Redeploying...
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-base">↻</span>
                                            Redeploy
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                        {/* Deployment List Sidebar */}
                        <div className="bg-black/40 border border-white/10 rounded-2xl p-6 backdrop-blur-xl h-fit">
                            <h2 className="text-xl font-bold mb-4 text-white">Deployments</h2>
                            {deployments.length === 0 ? (
                                <p className="text-zinc-500 text-sm">No builds found.</p>
                            ) : (
                                <div className="space-y-3">
                                    {deployments.map((dep) => {
                                        const isSelected = selectedDeployment?._id === dep._id
                                        return (
                                            <div
                                                key={dep._id}
                                                onClick={() => setSelectedDeployment(dep)}
                                                className={`p-4 rounded-xl border transition-all cursor-pointer ${
                                                    isSelected 
                                                        ? 'bg-purple-600/20 border-purple-500 shadow-lg shadow-purple-500/10' 
                                                        : 'bg-white/5 border-white/10 hover:bg-white/10'
                                                }`}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="text-xs text-zinc-400 font-mono">
                                                        #{dep._id.slice(-6)}
                                                    </span>
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                                        dep.status === 'SUCCESS' ? 'bg-green-500/20 text-green-300' :
                                                        dep.status === 'FAILED' ? 'bg-red-500/20 text-red-300' :
                                                        'bg-yellow-500/20 text-yellow-300 animate-pulse'
                                                    }`}>
                                                        {dep.status}
                                                    </span>
                                                </div>
                                                <span className="text-xs text-zinc-500">
                                                    {new Date(dep.createdAt).toLocaleString()}
                                                </span>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Logs View Panel */}
                        <div className="lg:col-span-2 bg-black/40 border border-white/10 rounded-2xl p-6 backdrop-blur-xl flex flex-col min-h-[500px]">
                            {selectedDeployment ? (
                                <div className="flex-1 flex flex-col">
                                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/10">
                                        <div>
                                            <h3 className="text-lg font-bold text-white">
                                                Build Logs #{selectedDeployment._id.slice(-6)}
                                            </h3>
                                            <span className="text-xs text-zinc-400 font-mono">
                                                Status: {selectedDeployment.status}
                                            </span>
                                        </div>
                                        {(selectedDeployment.status === 'BUILDING' || selectedDeployment.status === 'PENDING') && (
                                            <span className="flex h-2.5 w-2.5 relative">
                                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-75"></span>
                                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-purple-500"></span>
                                            </span>
                                        )}
                                    </div>

                                    {/* Live logs vs S3 historical logs */}
                                    {selectedDeployment.status === 'BUILDING' || selectedDeployment.status === 'PENDING' ? (
                                        <div className="flex-1">
                                            <LogViewer slug={slug} />
                                        </div>
                                    ) : (
                                        <div className="flex-1 bg-black/80 rounded-xl p-4 border border-white/5 font-mono text-xs overflow-auto max-h-[500px]">
                                            {loadingLogs ? (
                                                <div className="flex justify-center items-center h-full py-20 text-zinc-500 gap-2">
                                                    <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                                    Retrieving logs...
                                                </div>
                                            ) : (
                                                <pre className="whitespace-pre-wrap text-zinc-300 select-text leading-relaxed">
                                                    {historicalLogs}
                                                </pre>
                                            )}
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="flex-1 flex justify-center items-center text-zinc-500">
                                    Select a deployment to view build details.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    )
}
