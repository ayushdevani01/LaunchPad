"use client"
import React, { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { fetchWithAuth } from '../../lib/api'
import ProtectedRoute from '../../components/ProtectedRoute'
import Link from 'next/link'

export default function LaunchPage() {
    const [repos, setRepos] = useState<any[]>([])
    const [selectedRepo, setSelectedRepo] = useState<any | null>(null)
    const [branches, setBranches] = useState<string[]>([])
    
    const [reposLoading, setReposLoading] = useState(true)
    const [branchesLoading, setBranchesLoading] = useState(false)
    const [isRepoOpen, setIsRepoOpen] = useState(false)
    const [isBranchOpen, setIsBranchOpen] = useState(false)
    const [repoSearch, setRepoSearch] = useState('')

    const [project_name, setProjectName] = useState('')
    const [sourceDir, setSourceDir] = useState('')
    const [installCommand, setInstallCommand] = useState('')
    const [buildCommand, setBuildCommand] = useState('')
    const [outputDir, setOutputDir] = useState('')
    const [branch, setBranch] = useState('main')
    const [envVars, setEnvVars] = useState<{ key: string, value: string }[]>([])
    const [showAdvanced, setShowAdvanced] = useState(false)
    
    // Detection state
    const [detecting, setDetecting] = useState(false)
    const [detectionResult, setDetectionResult] = useState<any | null>(null)

    const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
    const [deployedUrl, setDeployedUrl] = useState('')
    const [projectSlug, setProjectSlug] = useState('')
    const [errorMsg, setErrorMsg] = useState('')
    const [validationError, setValidationError] = useState('')
    const [nameChecking, setNameChecking] = useState(false)
    const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)

    // Load GitHub repositories on mount
    useEffect(() => {
        const loadRepos = async () => {
            setReposLoading(true)
            try {
                const res = await fetchWithAuth('/projects/github/repos')
                if (res.ok) {
                    const data = await res.json()
                    setRepos(data.repos || [])
                } else {
                    setErrorMsg('Failed to load GitHub repositories. Please ensure you are logged in via GitHub.')
                }
            } catch (err) {
                console.error(err)
                setErrorMsg('Error loading repositories.')
            } finally {
                setReposLoading(false)
            }
        }
        loadRepos()
    }, [])

    // Load branches when repository is selected
    useEffect(() => {
        if (!selectedRepo) {
            setBranches([])
            setBranch('main')
            return
        }

        const [owner, repo] = selectedRepo.fullName.split('/')
        const loadBranches = async () => {
            setBranchesLoading(true)
            try {
                const res = await fetchWithAuth(`/projects/github/branches?owner=${owner}&repo=${repo}`)
                if (res.ok) {
                    const data = await res.json()
                    setBranches(data.branches || [])
                    if (data.branches?.includes(selectedRepo.defaultBranch)) {
                        setBranch(selectedRepo.defaultBranch)
                    } else if (data.branches?.length > 0) {
                        setBranch(data.branches[0])
                    }
                }
            } catch (e) {
                console.error('Failed to load branches', e)
            } finally {
                setBranchesLoading(false)
            }
        }
        loadBranches()
    }, [selectedRepo])

    // Framework detection hook
    useEffect(() => {
        if (!selectedRepo || !branch) {
            setDetectionResult(null)
            return
        }

        const [owner, repo] = selectedRepo.fullName.split('/')
        const triggerDetection = async () => {
            setDetecting(true)
            try {
                const res = await fetchWithAuth(`/projects/github/detect?owner=${owner}&repo=${repo}&branch=${branch}&path=${sourceDir}`)
                if (res.ok) {
                    const data = await res.json()
                    const detection = data.detection
                    setDetectionResult(detection)

                    // Autofill commands if supported
                    if (detection.supported !== 'NO') {
                        setInstallCommand(detection.installCommand || '')
                        setBuildCommand(detection.buildCommand || '')
                        setOutputDir(detection.outputDir || '')
                    } else {
                        setInstallCommand('')
                        setBuildCommand('')
                        setOutputDir('')
                    }
                }
            } catch (e) {
                console.error('Failed to analyze repository', e)
            } finally {
                setDetecting(false)
            }
        }

        const delayDebounce = setTimeout(() => {
            triggerDetection()
        }, 800)

        return () => clearTimeout(delayDebounce)
    }, [selectedRepo, branch, sourceDir])

    const handleAddEnvVar = () => {
        setEnvVars([...envVars, { key: '', value: '' }])
    }

    const handleRemoveEnvVar = (index: number) => {
        setEnvVars(envVars.filter((_, i) => i !== index))
    }

    const handleEnvVarChange = (index: number, field: 'key' | 'value', val: string) => {
        const updated = [...envVars]
        updated[index][field] = val
        setEnvVars(updated)
    }

    const validateProjectNameLocal = (name: string) => {
        setNameAvailable(null)
        if (!name) {
            setValidationError('')
            return
        }
        const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
        if (!slugRegex.test(name)) {
            setValidationError('Project name must be lowercase, alphanumeric, and can contain hyphens (but not start/end with them).')
        } else {
            setValidationError('')
        }
    }

    const checkNameAvailability = async () => {
        if (!project_name.trim() || validationError) return
        setNameChecking(true)
        setNameAvailable(null)
        try {
            const res = await fetchWithAuth(`/projects/check-name?name=${encodeURIComponent(project_name.trim())}`)
            if (res.ok) {
                const data = await res.json()
                setNameAvailable(data.available)
            } else {
                const data = await res.json()
                setErrorMsg(data.error || 'Failed to check name availability')
            }
        } catch (err) {
            console.error('Error checking project name:', err)
            setErrorMsg('Failed to check name availability.')
        } finally {
            setNameChecking(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!selectedRepo) return
        if (validationError || status === 'loading') return
        setStatus('loading')
        setErrorMsg('')
        setDeployedUrl('')

        try {
            const body: any = {
                gitURL: selectedRepo.gitUrl,
                project_name: project_name.trim() || undefined,
                sourceDir: sourceDir.trim() || undefined,
                installCommand: installCommand.trim() || undefined,
                buildCommand: buildCommand.trim() || undefined,
                outputDir: outputDir.trim() || undefined,
                branch: branch.trim() || 'main'
            }
            
            if (envVars.length > 0) {
                body.envVars = Object.fromEntries(
                    envVars.filter(e => e.key.trim()).map(e => [e.key.trim(), e.value.trim()])
                )
            }

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
            setDeployedUrl(data.data?.url || `https://${slug}.launch-pad.dev`)

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
                        <p className="text-white/70 text-center mb-8 text-lg">Select a repository from your GitHub account to deploy.</p>

                        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                            <div className="space-y-2 relative">
                                <label className="text-sm font-medium text-white/80 ml-1">Select GitHub Repository</label>
                                
                                <style>{`
                                    .custom-dropdown-scrollbar::-webkit-scrollbar {
                                        width: 6px;
                                    }
                                    .custom-dropdown-scrollbar::-webkit-scrollbar-track {
                                        background: transparent;
                                    }
                                    .custom-dropdown-scrollbar::-webkit-scrollbar-thumb {
                                        background: rgba(149, 96, 235, 0.5);
                                        border-radius: 99px;
                                    }
                                    .custom-dropdown-scrollbar::-webkit-scrollbar-thumb:hover {
                                        background: rgba(149, 96, 235, 0.8);
                                    }
                                `}</style>

                                {/* Custom Trigger Button */}
                                <button
                                    type="button"
                                    onClick={() => setIsRepoOpen(!isRepoOpen)}
                                    className="w-full h-14 bg-white/10 border border-white/10 rounded-xl px-5 flex items-center justify-between font-medium focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white text-left shadow-lg hover:bg-white/15 active:scale-[0.99] duration-150"
                                >
                                    <span className={selectedRepo ? "text-white" : "text-white/40"}>
                                        {selectedRepo ? selectedRepo.fullName : '-- Select Repository --'}
                                    </span>
                                    <span className="text-white/40 text-xs transition-transform duration-200" style={{ transform: isRepoOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                                </button>

                                {isRepoOpen && (
                                    <div 
                                        className="fixed inset-0 z-40 bg-black/0 cursor-default" 
                                        onClick={() => setIsRepoOpen(false)}
                                    />
                                )}

                                {isRepoOpen && (
                                    <div 
                                        onWheel={(e) => e.stopPropagation()}
                                        style={{ backgroundColor: '#000000' }}
                                        className="absolute z-50 w-full mt-2 border border-white/15 rounded-xl shadow-[0_8px_32px_0_rgba(149,96,235,0.3)] overflow-hidden ring-1 ring-black/20 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-auto"
                                    >
                                        <div className="max-h-64 overflow-y-auto overscroll-y-contain p-2.5 flex flex-col gap-1 custom-dropdown-scrollbar">
                                        <div className="relative mb-2 shrink-0">
                                            <input
                                                type="text"
                                                value={repoSearch}
                                                onChange={(e) => setRepoSearch(e.target.value)}
                                                placeholder="Search repositories..."
                                                className="w-full h-10 bg-white/5 border border-white/5 rounded-lg px-3.5 text-sm text-white focus:outline-none focus:ring-1 focus:ring-[#9560EB]/50 placeholder:text-white/30"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                            {repoSearch && (
                                                <button 
                                                    type="button"
                                                    onClick={() => setRepoSearch('')}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 hover:text-white"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </div>

                                        {reposLoading ? (
                                            <div className="flex flex-col gap-2 p-1">
                                                {[1, 2, 3, 4].map((n) => (
                                                    <div key={n} className="h-10 bg-white/5 rounded-lg animate-pulse flex items-center px-3 justify-between">
                                                        <div className="h-3.5 bg-white/10 rounded w-2/3"></div>
                                                        <div className="h-3 bg-white/10 rounded w-10"></div>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (() => {
                                            const filtered = repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
                                            if (filtered.length === 0) {
                                                return <div className="text-center text-sm py-5 text-white/40">No matching repositories</div>
                                            }
                                            return filtered.map((repo) => (
                                                <button
                                                    key={repo.fullName}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedRepo(repo)
                                                        setIsRepoOpen(false)
                                                        setRepoSearch('')
                                                    }}
                                                    className={`w-full h-10 px-3 rounded-lg text-left text-sm font-medium hover:bg-[#9560EB]/20 transition-all flex items-center justify-between duration-100 ${
                                                        selectedRepo?.fullName === repo.fullName 
                                                            ? 'bg-[#9560EB]/35 border border-[#9560EB]/50 text-purple-200 shadow-inner' 
                                                            : 'text-white/80 hover:text-white'
                                                    }`}
                                                >
                                                    <span className="truncate">{repo.fullName}</span>
                                                    {repo.private && (
                                                        <span className="text-[9px] bg-white/15 text-white/60 px-1.5 py-0.5 rounded font-bold uppercase tracking-wider scale-90">Private</span>
                                                    )}
                                                </button>
                                            ))
                                        })()}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Git Branch Selection */}
                            {selectedRepo && (
                                <div className="space-y-2 relative">
                                    <label className="text-sm font-medium text-white/80 ml-1">Git Branch</label>
                                    
                                    {/* Custom Branch Trigger Button */}
                                    <button
                                        type="button"
                                        onClick={() => setIsBranchOpen(!isBranchOpen)}
                                        className="w-full h-14 bg-white/10 border border-white/10 rounded-xl px-5 flex items-center justify-between font-medium focus:outline-none focus:ring-2 focus:ring-[#9560EB]/50 transition-all text-white text-left shadow-lg hover:bg-white/15 active:scale-[0.99] duration-150"
                                    >
                                        <span className="flex items-center gap-2">
                                            {branchesLoading && <span className="w-3.5 h-3.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>}
                                            {branch}
                                        </span>
                                        <span className="text-white/40 text-xs transition-transform duration-200" style={{ transform: isBranchOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>▼</span>
                                    </button>

                                    {/* Dropdown Backing Click-Away Overlay */}
                                    {isBranchOpen && (
                                        <div 
                                            className="fixed inset-0 z-40 bg-black/0 cursor-default" 
                                            onClick={() => setIsBranchOpen(false)}
                                        />
                                    )}

                                    {/* Custom Floating Dropdown Menu for Branches */}
                                    {isBranchOpen && (
                                        <div 
                                            onWheel={(e) => e.stopPropagation()}
                                            style={{ backgroundColor: '#000000' }}
                                            className="absolute z-50 w-full mt-2 border border-white/15 rounded-xl shadow-[0_8px_32px_0_rgba(149,96,235,0.25)] overflow-hidden ring-1 ring-black/20 animate-in fade-in slide-in-from-top-2 duration-150 pointer-events-auto"
                                        >
                                            <div className="max-h-52 overflow-y-auto overscroll-y-contain p-2 flex flex-col gap-1 custom-dropdown-scrollbar">
                                            {branchesLoading ? (
                                                <div className="flex flex-col gap-1.5 p-1">
                                                    {[1, 2].map((n) => (
                                                        <div key={n} className="h-9 bg-white/5 rounded-lg animate-pulse flex items-center px-3">
                                                            <div className="h-3 bg-white/10 rounded w-1/3"></div>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : branches.length === 0 ? (
                                                <div className="text-center text-sm py-4 text-white/40">No branches loaded</div>
                                            ) : (
                                                branches.map((b) => (
                                                    <button
                                                        key={b}
                                                        type="button"
                                                        onClick={() => {
                                                            setBranch(b)
                                                            setIsBranchOpen(false)
                                                        }}
                                                        className={`w-full h-9 px-3 rounded-lg text-left text-sm font-medium hover:bg-[#9560EB]/20 transition-all flex items-center duration-100 ${
                                                            branch === b 
                                                                ? 'bg-[#9560EB]/35 border border-[#9560EB]/50 text-purple-200 shadow-inner' 
                                                                : 'text-white/80 hover:text-white'
                                                        }`}
                                                    >
                                                        {b}
                                                    </button>
                                                ))
                                            )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Source Directory */}
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

                            {/* Framework Detection Panel */}
                            {detecting && (
                                <div className="p-4 bg-white/5 border border-white/10 rounded-xl text-center text-sm text-zinc-400 flex items-center justify-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>
                                    Analyzing repository framework...
                                </div>
                            )}

                            {detectionResult && !detecting && (
                                <div className={`p-5 rounded-xl border flex flex-col gap-2 ${
                                    detectionResult.supported === 'YES' ? 'bg-green-500/10 border-green-500/25' :
                                    detectionResult.supported === 'PARTIAL' ? 'bg-yellow-500/10 border-yellow-500/25' :
                                    'bg-red-500/10 border-red-500/25'
                                }`}>
                                    <div className="flex justify-between items-center">
                                        <span className="text-sm font-medium text-white/60">Detected Framework</span>
                                        <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                                            detectionResult.supported === 'YES' ? 'bg-green-500/20 text-green-300' :
                                            detectionResult.supported === 'PARTIAL' ? 'bg-yellow-500/20 text-yellow-300' :
                                            'bg-red-500/20 text-red-300'
                                        }`}>
                                            {detectionResult.framework} ({detectionResult.supported === 'YES' ? 'Supported' : detectionResult.supported === 'PARTIAL' ? 'Warnings' : 'Unsupported'})
                                        </span>
                                    </div>
                                    <p className="text-xs text-zinc-400 leading-relaxed mt-1">
                                        {detectionResult.notes}
                                    </p>
                                </div>
                            )}

                            {/* Project Name (Domain) */}
                            <div className="space-y-2">
                                <div className="flex justify-between items-center ml-1">
                                    <label htmlFor="project_name" className="text-sm font-medium text-white/80">Project Name (Optional)</label>
                                    {project_name.trim() !== '' && !validationError && (
                                        <button
                                            type="button"
                                            onClick={checkNameAvailability}
                                            disabled={nameChecking}
                                            className="text-xs bg-[#9560EB]/20 border border-[#9560EB]/40 hover:bg-[#9560EB]/40 text-purple-200 px-3 py-1 rounded-lg font-medium transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                                        >
                                            {nameChecking && <span className="w-2.5 h-2.5 border-2 border-white/20 border-t-white rounded-full animate-spin"></span>}
                                            {nameChecking ? 'Checking...' : 'Check Availability'}
                                        </button>
                                    )}
                                </div>
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
                                {nameAvailable !== null && !validationError && project_name.trim() !== '' && (
                                    <p className={`text-xs ml-1 font-medium flex items-center gap-1.5 ${nameAvailable ? 'text-emerald-400' : 'text-rose-400'}`}>
                                        {nameAvailable ? (
                                            <>
                                                <span>✓</span>
                                                Domain name is available!
                                            </>
                                        ) : (
                                            <>
                                                <span>✕</span>
                                                Project name is already taken.
                                            </>
                                        )}
                                    </p>
                                )}
                            </div>

                            {/* Advanced Settings Collapsible */}
                            <div className="border border-white/10 rounded-xl overflow-hidden bg-white/5">
                                <button
                                    type="button"
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="w-full h-12 px-5 flex items-center justify-between text-sm font-semibold text-white/80 hover:bg-white/5 transition-colors"
                                >
                                    <span>Advanced Build Settings</span>
                                    <span>{showAdvanced ? '▲' : '▼'}</span>
                                </button>
                                {showAdvanced && (
                                    <div className="p-5 border-t border-white/10 space-y-4">
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-xs text-white/60">Output Directory</label>
                                                <input
                                                    type="text"
                                                    value={outputDir}
                                                    onChange={(e) => setOutputDir(e.target.value)}
                                                    placeholder="dist"
                                                    className="w-full h-10 bg-white/10 border border-white/10 rounded-lg px-3 text-sm focus:outline-none text-white"
                                                />
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-xs text-white/60">Install Command</label>
                                                <input
                                                    type="text"
                                                    value={installCommand}
                                                    onChange={(e) => setInstallCommand(e.target.value)}
                                                    placeholder="npm install"
                                                    className="w-full h-10 bg-white/10 border border-white/10 rounded-lg px-3 text-sm focus:outline-none text-white"
                                                />
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-xs text-white/60">Build Command</label>
                                            <input
                                                type="text"
                                                value={buildCommand}
                                                onChange={(e) => setBuildCommand(e.target.value)}
                                                placeholder="npm run build"
                                                className="w-full h-10 bg-white/10 border border-white/10 rounded-lg px-3 text-sm focus:outline-none text-white"
                                            />
                                        </div>

                                        <div className="space-y-2 pt-2">
                                            <div className="flex justify-between items-center">
                                                <label className="text-xs text-white/60 font-medium">Environment Variables</label>
                                                <button
                                                    type="button"
                                                    onClick={handleAddEnvVar}
                                                    className="text-xs text-purple-400 hover:text-purple-300 underline font-medium"
                                                >
                                                    + Add Variable
                                                </button>
                                            </div>
                                            {envVars.map((item, idx) => (
                                                <div key={idx} className="flex gap-2 items-center">
                                                    <input
                                                        type="text"
                                                        value={item.key}
                                                        onChange={(e) => handleEnvVarChange(idx, 'key', e.target.value)}
                                                        placeholder="KEY"
                                                        className="flex-1 h-9 bg-white/10 border border-white/10 rounded-lg px-3 text-xs text-white focus:outline-none"
                                                    />
                                                    <input
                                                        type="text"
                                                        value={item.value}
                                                        onChange={(e) => handleEnvVarChange(idx, 'value', e.target.value)}
                                                        placeholder="VALUE"
                                                        className="flex-1 h-9 bg-white/10 border border-white/10 rounded-lg px-3 text-xs text-white focus:outline-none"
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handleRemoveEnvVar(idx)}
                                                        className="text-red-400 hover:text-red-300 text-xs px-2"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <button
                                disabled={
                                    status === 'loading' || 
                                    !selectedRepo || 
                                    !!validationError || 
                                    (project_name.trim() !== '' && nameAvailable === false) ||
                                    (detectionResult && detectionResult.supported === 'NO')
                                }
                                className="bg-white text-black h-14 rounded-xl px-5 font-bold text-lg mt-2 hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                            >
                                {status === 'loading' ? (
                                    <>
                                        <span className="w-5 h-5 border-2 border-black/30 border-t-black rounded-full animate-spin"></span>
                                        Launching...
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
                                        className="text-sm bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-500 font-medium"
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
        </ProtectedRoute>
    )
}
