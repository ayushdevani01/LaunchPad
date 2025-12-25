"use client"
import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function AuthCallbackContent() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get('token')

    useEffect(() => {
        const fetchWithToken = async (token: string) => {
            try {
                const base64Url = token.split('.')[1]
                const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/')
                const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function (c) {
                    return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                }).join(''))

                const payload = JSON.parse(jsonPayload)

                const user = {
                    id: payload.userId,
                    email: payload.email,
                    username: payload.username
                }

                localStorage.setItem('user', JSON.stringify(user))

                window.location.href = '/dashboard'

            } catch (e) {
                console.error('Callback error', e)
                router.push('/login?error=Callback failed')
            }
        }

        if (token) {
            localStorage.setItem('token', token)
            fetchWithToken(token)
        } else {
            router.push('/login?error=No token received')
        }
    }, [token, router])

    return (
        <div className="flex min-h-screen items-center justify-center bg-black text-white">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
                <p className="text-zinc-400">Authenticating...</p>
            </div>
        </div>
    )
}

export default function AuthCallback() {
    return (
        <Suspense fallback={
            <div className="flex min-h-screen items-center justify-center bg-black text-white">
                <div className="flex flex-col items-center gap-4">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
                    <p className="text-zinc-400">Authenticating...</p>
                </div>
            </div>
        }>
            <AuthCallbackContent />
        </Suspense>
    )
}
