"use client"
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { fetchWithAuth } from '../../lib/api'
import ProtectedRoute from '../../components/ProtectedRoute'
import { useAuth } from '../../context/AuthContext'

interface Project {
    _id: string
    name: string
    gitURL: string
    subdomain: string
    customDomain?: string
    createdAt: string
    deploymentStatus: 'pending' | 'success' | 'failed'
}

export default function DashboardPage() {
    const [projects, setProjects] = useState<Project[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const { logout } = useAuth()

    useEffect(() => {
        const loadProjects = async () => {
            try {
                const res = await fetchWithAuth('/projects')
                if (!res.ok) throw new Error('Failed to fetch projects')
                const data = await res.json()
                setProjects(data.data || [])
            } catch (err) {
                setError('Could not load projects')
                console.error(err)
            } finally {
                setLoading(false)
            }
        }

        loadProjects()
    }, [])

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-black text-white px-4 py-24 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-7xl">
                    <div className="flex items-center justify-between mb-8">
                        <h1 className="text-3xl font-bold">Your Projects</h1>
                        <div className="flex items-center gap-4">
                            <button
                                onClick={logout}
                                className="rounded-md bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 border border-white/10"
                            >
                                Logout
                            </button>
                            <Link
                                href="/launch"
                                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-500 shadow-[0_0_24px_rgba(34,_42,_53,_0.06),_0_1px_1px_rgba(0,_0,_0,_0.05),_0_0_0_1px_rgba(34,_42,_53,_0.04),_0_0_4px_rgba(34,_42,_53,_0.08),_0_16px_68px_rgba(47,_48,_55,_0.05),_0_1px_0_rgba(255,_255,_255,_0.1)_inset]"
                            >
                                New Project
                            </Link>
                        </div>
                    </div>

                    {loading ? (
                        <div className="flex justify-center py-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
                        </div>
                    ) : error ? (
                        <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-red-200">
                            {error}
                        </div>
                    ) : projects.length === 0 ? (
                        <div className="text-center py-12 rounded-xl border border-white/10 bg-zinc-900/50">
                            <h3 className="mt-2 text-sm font-semibold text-white">No projects</h3>
                            <p className="mt-1 text-sm text-zinc-400">Get started by creating a new project.</p>
                            <div className="mt-6">
                                <Link
                                    href="/launch"
                                    className="inline-flex items-center rounded-md bg-purple-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-purple-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-600"
                                >
                                    Deploy Project
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                            {projects.map((project) => (
                                <div
                                    key={project._id}
                                    className="group relative rounded-xl border border-white/10 bg-zinc-900/50 p-6 transition-all hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10"
                                >
                                    <div className="flex items-center justify-between mb-4">
                                        <h3 className="text-lg font-semibold text-white truncate pr-4">
                                            {project.name}
                                        </h3>
                                        <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ring-1 ring-inset ${project.deploymentStatus === 'success' ? 'bg-green-500/10 text-green-400 ring-green-500/20' :
                                            project.deploymentStatus === 'failed' ? 'bg-red-500/10 text-red-400 ring-red-500/20' :
                                                'bg-yellow-500/10 text-yellow-400 ring-yellow-500/20'
                                            }`}>
                                            {project.deploymentStatus}
                                        </span>
                                    </div>

                                    <div className="space-y-2 text-sm text-zinc-400">
                                        <div className="flex items-center gap-2">
                                            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                                            <span className="truncate">{project.gitURL}</span>
                                        </div>
                                        {project.subdomain && (
                                            <div className="flex items-center gap-2">
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" /></svg>
                                                <a
                                                    href={`http://${project.subdomain}.launch-pad.dev`}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="hover:text-purple-400 hover:underline truncate"
                                                >
                                                    {project.subdomain}.launch-pad.dev
                                                </a>
                                            </div>
                                        )}
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-white/5 flex justify-between items-center text-xs text-zinc-500">
                                        <span>Created {new Date(project.createdAt).toLocaleDateString()}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </ProtectedRoute>
    )
}
