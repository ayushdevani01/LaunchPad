"use client"
import React, { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import ProtectedRoute from '../../../components/ProtectedRoute'
import { getProject, updateProject, deleteProject, redeployProject } from '../../../lib/api'
import LogViewer from '../../../components/LogViewer'

interface Project {
    _id: string
    name: string
    slug: string
    gitUrl: string
    status: string
    createdAt: string
}

export default function ProjectDetailsPage() {
    const params = useParams()
    const router = useRouter()
    const slug = params.slug as string

    const [project, setProject] = useState<Project | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [gitUrl, setGitUrl] = useState('')



    const [logKey, setLogKey] = useState(0) 
    useEffect(() => {
        const fetchProject = async () => {
            try {
                const data = await getProject(slug)
                setProject(data.project)
                setGitUrl(data.project.gitUrl)
            } catch (err: any) {
                setError(err.message || 'Failed to load project')
            } finally {
                setLoading(false)
            }
        }
        if (slug) fetchProject()
    }, [slug])


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
            <div className="min-h-screen bg-black text-white px-4 py-24 sm:px-6 lg:px-8">
                <div className="mx-auto max-w-4xl">
                    <div className="mb-8">
                        <Link href="/dashboard" className="text-zinc-400 hover:text-white mb-4 inline-block">
                            ← Back to Dashboard
                        </Link>
                        <div className="flex items-center gap-4">
                            <h1 className="text-3xl font-bold">{project.name || project.slug}</h1>
                        </div>
                        <p className="text-zinc-400 mt-2">
                            Deployed at: <a href={`http://${project.slug}.launch-pad.dev`} target="_blank" rel="noreferrer" className="text-purple-400 hover:underline">{project.slug}.launch-pad.dev</a>
                        </p>
                    </div>
                    <div className="grid gap-8">
                        <LogViewer key={logKey} slug={slug} />
                    </div>
                </div>
            </div>
        </ProtectedRoute>
    )
}
