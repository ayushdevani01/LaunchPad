# Frontend Implementation Plan

This document outlines the frontend changes needed to integrate with the new backend authentication.

---

## Overview

The backend now supports:
- **Email/Password Registration** at `POST /auth/register`
- **Email/Password Login** at `POST /auth/login`
- **User session** via JWT (stored in localStorage)
- **Protected routes**: `/projects` (POST, GET)

---

## Required Changes

### 1. Auth Context & Hook

#### [NEW] `src/context/AuthContext.tsx`
Create a React context to manage auth state:
```tsx
interface User {
  id: string
  email: string
  username: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, username: string, password: string) => Promise<void>
  logout: () => void
}
```

- On mount, check localStorage for JWT token and decode user info
- `login()` calls `POST /auth/login` with email/password
- `register()` calls `POST /auth/register` with email/username/password
- `logout()` clears localStorage

---

### 2. New Pages

#### [NEW] `src/app/login/page.tsx`
Login page with email/password form:
- Email input field
- Password input field
- Submit button
- Link to register page
- If already logged in, redirect to `/dashboard`

#### [NEW] `src/app/register/page.tsx`
Registration page:
- Email input field (required, unique)
- Username input field (required, can be duplicate)
- Password input field
- Submit button
- Link to login page

#### [NEW] `src/app/dashboard/page.tsx`  
Protected page showing user's projects:
- Call `GET /projects` to list projects
- Display project name, status, URL, created date
- Link to deploy new project

---

### 3. Modify Existing Pages

#### [MODIFY] `src/app/launch/page.tsx`
- Wrap with auth check: if not logged in, redirect to `/login`
- Update API call to `POST /projects` (was `/project`)
- Add Authorization header with JWT token
- Remove manual slug generation (backend handles it)
- After success, redirect to `/dashboard`

#### [MODIFY] `src/components/LandingNavbar.tsx`
- If logged in: show username, "Dashboard" link, "Logout" button
- If not logged in: show "Login" button

---

### 4. API Configuration

#### [NEW] `src/lib/api.ts`
Central API client with:
```ts
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'https://api.launch-pad.dev'

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
  return res.json()
}

export async function register(email: string, username: string, password: string) {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, username, password }),
  })
  return res.json()
}
```

---

### 5. Environment Variables

Add to `.env.local`:
```
NEXT_PUBLIC_API_URL=https://api.launch-pad.dev
```

---

### 6. Protected Route Wrapper

#### [NEW] `src/components/ProtectedRoute.tsx`
HOC or wrapper component:
```tsx
function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  
  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading])
  
  if (loading) return <LoadingSpinner />
  if (!user) return null
  return children
}
```

---

## Page Flow

```mermaid
graph TD
    A[Landing /] --> B{Logged In?}
    B -->|No| C[Click Login]
    C --> D[/login]
    D -->|Has Account| E[Enter Email/Password]
    D -->|New User| F[Go to /register]
    F --> G[Enter Email/Username/Password]
    G -->|Success| H[/dashboard]
    E -->|Success| H
    B -->|Yes| H
    H --> I[View Projects]
    H --> J[Deploy New /launch]
    J -->|Success| H
```

---

## API Endpoints Reference

| Method | Endpoint | Auth | Request Body | Description |
|--------|----------|------|--------------|-------------|
| POST | `/auth/register` | No | `{email, username, password}` | Create new account |
| POST | `/auth/login` | No | `{email, password}` | Authenticate user |
| GET | `/projects` | Yes | - | List user's projects |
| POST | `/projects` | Yes | `{gitUrl}` | Create new project/deployment |
| GET | `/projects/:slug` | Yes | - | Get project details |

---

## Summary Checklist

- [ ] Create `AuthContext` and `useAuth` hook
- [ ] Create `/login` page with email/password form
- [ ] Create `/register` page with email/username/password form
- [ ] Create `/dashboard` page  
- [ ] Create `ProtectedRoute` component
- [ ] Create `src/lib/api.ts` helper
- [ ] Update `/launch` page (require auth, use new endpoint)
- [ ] Update `LandingNavbar` (show login/logout based on state)
- [ ] Add `NEXT_PUBLIC_API_URL` to environment
- [ ] Test full auth flow