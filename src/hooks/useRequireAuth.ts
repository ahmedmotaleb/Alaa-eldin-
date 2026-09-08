import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../store/AuthContext'

export function useRequireAuth() {
  const { user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    if (!loading && !user) navigate('/login', { replace: true, state: { from: location.pathname } })
  }, [loading, user, navigate, location.pathname])

  return { user, loading }
}
