import { useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import Portal from './pages/Portal'
import Pricing from './pages/Pricing'
import Login from './pages/Login'
import Register from './pages/Register'
import Gallery from './pages/Gallery'
import Discover from './pages/Discover'
import Credits from './pages/Credits'
import Recharge from './pages/Recharge'
import Models from './pages/Models'
import Settings from './pages/Settings'
import AIWorkbench from './pages/AIWorkbench'
import AIEffects from './pages/AIEffects'
import VideoStudio from './pages/VideoStudio'
import MotionImitation from './pages/MotionImitation'
import Vid2Vid from './pages/Vid2Vid'
import OmniWeaverPro from './pages/OmniWeaverPro'
import AgentStudio from './pages/AgentStudio'
import DouyinCallback from './pages/DouyinCallback'
import { useAuthStore } from './store/auth.store'
import { useCreditStore } from './store/credit.store'

function App() {
  const { isAuthenticated, user, setAuth, hydrated } = useAuthStore()
  const { fetchBalance } = useCreditStore()

  // Initialize auth state from localStorage on app start
  useEffect(() => {
    const token = localStorage.getItem('access_token')
    const tenantId = localStorage.getItem('tenant_id')
    
    if (token && tenantId && !isAuthenticated && !user) {
      // 如果有 token 但 store 中没有用户信息，需要验证 token 的有效性
      // 这里我们简单地假设 token 有效，实际应用中应该验证 token
      console.log('Token found in localStorage but user not in store - state may be inconsistent')
    }
  }, [])

  // Fetch credits when user is authenticated or app loads
  useEffect(() => {
    // Only fetch balance if authenticated AND we have a valid token AND store is hydrated
    const token = localStorage.getItem('access_token')
    if (hydrated && isAuthenticated && token) {
      fetchBalance()
    }
  }, [isAuthenticated, fetchBalance, hydrated])

  // Show loading screen while hydrating
  if (!hydrated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={isAuthenticated ? <Navigate to="/gallery" /> : <Portal />} />
        <Route path="/pricing" element={<Pricing />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/gallery" /> : <Login />} />
        <Route path="/register" element={isAuthenticated ? <Navigate to="/gallery" /> : <Register />} />
        
        <Route
          path="/gallery"
          element={isAuthenticated ? <Gallery /> : <Navigate to="/login" />}
        />
        <Route
          path="/discover"
          element={isAuthenticated ? <Discover /> : <Navigate to="/login" />}
        />
        <Route
          path="/dashboard"
          element={<Navigate to="/gallery" replace />}
        />
        <Route
          path="/image-generation"
          element={isAuthenticated ? <AIWorkbench /> : <Navigate to="/login" />}
        />
        <Route
          path="/video-generation"
          element={isAuthenticated ? <AIWorkbench /> : <Navigate to="/login" />}
        />
        <Route
          path="/3d-models"
          element={isAuthenticated ? <AIWorkbench /> : <Navigate to="/login" />}
        />
        <Route
          path="/short-video"
          element={isAuthenticated ? <VideoStudio mode="short_video" /> : <Navigate to="/login" />}
        />
        <Route
          path="/video-to-video"
          element={isAuthenticated ? <Vid2Vid /> : <Navigate to="/login" />}
        />
        <Route
          path="/motion-imitation"
          element={isAuthenticated ? <MotionImitation /> : <Navigate to="/login" />}
        />
        <Route
          path="/video-edit"
          element={isAuthenticated ? <VideoStudio mode="video_edit" /> : <Navigate to="/login" />}
        />
        <Route
          path="/ai-effects"
          element={isAuthenticated ? <AIEffects /> : <Navigate to="/login" />}
        />
        <Route
          path="/drama"
          element={<Navigate to="/omni-weaver" replace />}
        />
        <Route
          path="/omni-weaver"
          element={isAuthenticated ? <OmniWeaverPro /> : <Navigate to="/login" />}
        />
        <Route
          path="/agent-studio"
          element={isAuthenticated ? <AgentStudio /> : <Navigate to="/login" />}
        />
        <Route path="/douyin/callback" element={<DouyinCallback />} />
        <Route
          path="/credits"
          element={isAuthenticated ? <Credits /> : <Navigate to="/login" />}
        />
        <Route
          path="/recharge"
          element={isAuthenticated ? <Recharge /> : <Navigate to="/login" />}
        />
        <Route
          path="/models"
          element={isAuthenticated ? <Models /> : <Navigate to="/login" />}
        />
        <Route
          path="/settings"
          element={isAuthenticated ? <Settings /> : <Navigate to="/login" />}
        />
        
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Router>
  )
}

export default App
