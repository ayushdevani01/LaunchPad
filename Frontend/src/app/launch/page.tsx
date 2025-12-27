"use client"
import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { fetchWithAuth } from '../../lib/api'
import ProtectedRoute from '../../components/ProtectedRoute'
import Link from 'next/link'

export default function LaunchPage() {
    const [gitURL, setGitURL] = useState('')
    const [project_name, setProjectName] = useState('')
    const [sourceDir, setSourceDir] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [deployedUrl, setDeployedUrl] = useState('')
    const [projectSlug, setProjectSlug] = useState('')
    const [errorMsg, setErrorMsg] = useState('')
    const [isValidating, setIsValidating] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [urlError, setUrlError] = useState('')

    const validateProjectNameLocal = (name: string) => {
        if (!name) {
            setValidationError('')
            return
        }
        // Regex Check: Lowercase, numbers, hyphens only
        const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        if (!slugRegex.test(name)) {
            setValidationError('Project name must be lowercase, alphanumeric, and can contain hyphens (but not start/end with them).')
        } else {
            setValidationError('')
        }
    }

    const validateGitHubUrl = (url: string) => {
        if (!url) {
            setUrlError('')
            return
        }
        const githubRegex = /^https?:\/\/(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i
        if (!githubRegex.test(url)) {
            setUrlError('Only GitHub repository URLs are supported')
        } else {
            setUrlError('')
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (urlError) return
        if (validationError || isValidating) return
        setStatus('loading')
        setErrorMsg('')
        setDeployedUrl('')

        try {
            const body: any = { gitURL }
            if (project_name.trim()) body.project_name = project_name.trim()
            if (sourceDir.trim()) body.sourceDir = sourceDir.trim()

            const res = await fetchWithAuth('/projects', {
                method: 'POST',
                body: JSON.stringify(body)
            })

            const data = await res.json()

            if (!res.ok) {
                if (res.status === 400 && data.error === 'Project name already taken') {
                    setValidationError('Project name is already taken.')
                    setStatus('idle')
                    return
                }
                throw new Error(data.error || 'Failed to deploy project')
            }

            setStatus('success')

            const slug = data.data?.projectSlug || ''
            setProjectSlug(slug)

            if (data.data?.url) {
                setDeployedUrl(data.data.url)
            } else if (slug) {
                setDeployedUrl(`https://${slug}.launch-pad.dev`)
            }

        } catch (err: any) {
            console.error(err)
            setStatus('error')
            setErrorMsg(err.message || 'Something went wrong')
        }
    }

    return (
        <ProtectedRoute>
            <div className="min-h-screen bg-black text-white bg-[linear-gradient(to_bottom,#000,#200D42_34%,#4F21A1_65%,#A46EDB_82%)] py-[72px] sm:py-24 relative overflow-clip flex items-center justify-center">
                <div className="absolute h-[375px] w-[750px] sm:w-[1536px] sm:h-[768px] lg:w-[2400px] llg:h-[800px] rounded-[100%] bg-black left-1/2 -translate-x-1/2 border border-[#B48CDE] bg-[radial-gradient(closest-side,#000_82%,#9560EB)] top-[calc(100%-96px)] sm:top-[calc(100%-120px)] opacity-50"></div>

                <div className="container relative z-10 px-4">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.5 }}
                        className="max-w-xl mx-auto bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-8 sm:p-12 shadow-2xl"
                    >
                        <div className="flex justify-between items-center mb-6">
                            <h1 className="text-4xl sm:text-5xl font-bold tracking-tighter text-center">Deploy your Project</h1>
                        </div>
                        <p className="text-white/70 text-center mb-8 text-lg">Enter your GitHub repository URL and we&apos;ll handle the rest.</p>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                            <div className="space-y-2">
                                <label htmlFor="gitURL" className="text-sm font-medium text-white/80 ml-1">GitHub Repository URL</label>
                                <input
                                    id="gitURL"
                                    type="url"
                                    required
                                    value={gitURL}
                                    onChange={(e) => setGitURL(e.target.value)}
                                    onBlur={(e) => validateGitHubUrl(e.target.value)}
                                    placeholder="https://github.com/username/repo"
                                    className={`w-full h-14 bg-white/10 border ${urlError ? 'border-red-500' : 'border-white/10'} rounded-xl px-5 font-medium placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white`}
                                />
                                {urlError && (
                                    <p className="text-red-400 text-sm ml-1">{urlError}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="project_name" className="text-sm font-medium text-white/80 ml-1">Project Name (Optional)</label>
                                <div className="relative">
                                    <input
                                        id="project_name"
                                        type="text"
                                        value={project_name}
                                        onChange={(e) => {
                                            const val = e.target.value
                                            setProjectName(val)
                                            validateProjectNameLocal(val)
                                        }}
                                        placeholder="my-cool-project"
                                        className={`w-full h-14 bg-white/10 border ${validationError ? 'border-red-500' : 'border-white/10'} rounded-xl px-5 font-medium placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white pr-24`}
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-mono hidden sm:inline-block">.launch-pad.dev</span>
                                </div>
                                {validationError && (
                                    <p className="text-red-400 text-sm ml-1">{validationError}</p>
                                )}
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="sourceDir" className="text-sm font-medium text-white/80 ml-1">Source Directory (Optional)</label>
                                <input
                                    id="sourceDir"
                                    type="text"
                                    value={sourceDir}
                                    onChange={(e) => setSourceDir(e.target.value)}
                                    placeholder="frontend or packages/web"
                                    className="w-full h-14 bg-white/10 border border-white/10 rounded-xl px-5 font-medium placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white"
                                />
                                <p className="text-white/40 text-xs ml-1">For monorepos: path to your frontend folder</p>
                            </div>

                            <button
                                disabled={status === 'loading' || !!validationError || !!urlError || isValidating}
                                className="bg-white text-black h-14 rounded-xl px-5 font-bold text-lg mt-2 hover:bg-gray-200 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {status === 'loading' ? (
                                    <>
                                        <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                                        {isValidating ? 'Validating...' : 'Launching...'}
                                    </>
                                ) : (
                                    'Launch Project'
                                )}
                            </button>
                        </form>

                        {status === 'error' && (
                            <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: 'auto' }}
                                className="mt-6 p-4 bg-red-500/20 border border-red-500/50 rounded-lg text-red-200 text-center text-sm"
                            >
                                ⚠️ {errorMsg}
                            </motion.div>
                        )}

                        {status === 'success' && (
                            <motion.div
                                initial={{ opacity: 0, scale: 0.95 }}
                                animate={{ opacity: 1, scale: 1 }}
                                className="mt-8 p-6 bg-[#9560EB]/20 border border-[#9560EB]/50 rounded-xl text-center"
                            >
                                <h3 className="text-xl font-bold text-white mb-2">🎉 Project Queued!</h3>
                                <p className="text-white/70 text-sm mb-4">Your project is building. It will be available shortly at:</p>
                                <a
                                    href={deployedUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-block py-2 px-4 bg-[#9560EB] text-white rounded-lg font-medium hover:bg-[#8040E0] transition-colors break-all"
                                >
                                    {deployedUrl}
                                </a>
                                <p className="text-xs text-white/50 mt-4">(It may take a few minutes for the build to complete)</p>
                                <div className="mt-4 flex gap-4 justify-center">
                                    <Link
                                        href={`/project/${projectSlug}`}
                                        className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-500"
                                    >
                                        View Project Details
                                    </Link>
                                    <Link href="/dashboard" className="text-sm text-purple-300 hover:text-white underline flex items-center">
                                        Back to Dashboard
                                    </Link>
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                </div>
            </div>
        </ProtectedRoute >
    )
}
