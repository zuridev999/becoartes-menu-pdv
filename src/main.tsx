import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { AntigravityErrorBoundary } from './components/common/UI'

createRoot(document.getElementById('root')!).render(
  <AntigravityErrorBoundary>
    <App />
  </AntigravityErrorBoundary>,
)
