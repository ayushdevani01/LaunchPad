"use client"
import React, { useState } from 'react'
import { motion } from 'framer-motion'
import { fetchWithAuth } from '../../lib/api'
import ProtectedRoute from '../../components/ProtectedRoute'
import Link from 'next/link'

export default function LaunchPage() {
    const [gitURL, setGitURL] = useState('')
    const [project_name, setProjectName] = useState('')
    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [deployedUrl, setDeployedUrl] = useState('')
    const [errorMsg, setErrorMsg] = useState('')

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setStatus('loading')
        setErrorMsg('')
        setDeployedUrl('')

        try {
            const body: any = { gitURL }
            if (project_name.trim()) body.name = project_name.trim()

            const res = await fetchWithAuth('/projects', {
                method: 'POST',
                body: JSON.stringify(body)
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Failed to deploy project')
            }

            setStatus('success')

            if (data.data?.subdomain) {
                setDeployedUrl(`http://${data.data.subdomain}.launch-pad.dev`)
            } else if (data.data?.customDomain) {
                setDeployedUrl(`http://${data.data.customDomain}`)
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
                        <p className="text-white/70 text-center mb-8 text-lg">Enter your GitHub repository URL and we'll handle the rest.</p>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                            <div className="space-y-2">
                                <label htmlFor="gitURL" className="text-sm font-medium text-white/80 ml-1">GitHub Repository URL</label>
                                <input
                                    id="gitURL"
                                    type="url"
                                    required
                                    value={gitURL}
                                    onChange={(e) => setGitURL(e.target.value)}
                                    placeholder="https://github.com/username/repo"
                                    className="w-full h-14 bg-white/10 border border-white/10 rounded-xl px-5 font-medium placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white"
                                />
                            </div>

                            <div className="space-y-2">
                                <label htmlFor="project_name" className="text-sm font-medium text-white/80 ml-1">Project Name (Optional)</label>
                                <div className="relative">
                                    <input
                                        id="project_name"
                                        type="text"
                                        value={project_name}
                                        onChange={(e) => setProjectName(e.target.value)}
                                        placeholder="my-cool-project"
                                        className="w-full h-14 bg-white/10 border border-white/10 rounded-xl px-5 font-medium placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white pr-24"
                                    />
                                    <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 text-sm font-mono hidden sm:inline-block">.launch-pad.dev</span>
                                </div>
                            </div>

                            <button
                                disabled={status === 'loading'}
                                className="bg-white text-black h-14 rounded-xl px-5 font-bold text-lg mt-2 hover:bg-gray-200 transition-colors disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {status === 'loading' ? (
                                    <>
                                        <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                                        Launching...
                                    </>
                                ) : (
                                    '🚀 Launch Project'
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
                                <div className="mt-4">
                                    <Link href="/dashboard" className="text-sm text-purple-300 hover:text-white underline">
                                        Back to Dashboard
                                    </Link>
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                </div>
            </div>
        </ProtectedRoute>
    )
}
