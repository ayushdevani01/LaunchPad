const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:9000'

export async function fetchWithAuth(path: string, options?: RequestInit) {
    const token = localStorage.getItem('token')
    return fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
            ...options?.headers,
            'Authorization': token ? `Bearer ${token}` : '',
            'Content-Type': 'application/json',
        },
    })
}

export async function login(email: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
    })
    if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Login failed')
    }
    return res.json()
}

export async function register(email: string, username: string, password: string) {
    const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, username, password }),
    })
    if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Registration failed')
    }
    return res.json()
}
