"use client"
import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
// import { verifyToken } from '@/lib/api' 
import { useAuth } from '@/context/AuthContext'

export default function AuthCallback() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get('token')
    const { user } = useAuth() // Access context to force re-evaluation if needed

    useEffect(() => {
        if (token) {
            // Simple JWT decode to get user info without another request
            // But for safety and consistency, let's use the token and reloading the page/context will handle it
            localStorage.setItem('token', token)

            // We need to fetch user info to store in localStorage as 'user'
            // or just redirect and let AuthContext handle init (which it does on mount)
            // But AuthContext init only runs on mount.
            // We should probably force a reload or manual fetch.

            // Let's manually fetch the user details using the new token
            fetchWithToken(token)
        } else {
            router.push('/login?error=No token received')
        }
    }, [token, router])

    const fetchWithToken = async (token: string) => {
        try {
            // We don't have a direct "me" endpoint configured in api.ts yet, 
            // but let's assume valid token means valid login. 
            // However, AuthContext expects 'user' in localStorage for optimistic load.
            // We can just reload the window to force AuthContext to re-init and fetch if we had a /me endpoint.
            // Since we don't have a /me endpoint yet, we rely on the backend sending the user object 
            // OR we just decode the token if it has the info.

            // The current backend design for Google only sends a token in query param. 
            // Let's decode the JWT on client side to get the user info to save to localStorage

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

            // Force hard reload to update context or use router.push and hope context updates?
            // Context updates only on mount.
            // Let's just redirect to dashboard.
            window.location.href = '/dashboard'

        } catch (e) {
            console.error('Callback error', e)
            router.push('/login?error=Callback failed')
        }
    }

    return (
        <div className="flex min-h-screen items-center justify-center bg-black text-white">
            <div className="flex flex-col items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-500 border-t-transparent"></div>
                <p className="text-zinc-400">Authenticating...</p>
            </div>
        </div>
    )
}
