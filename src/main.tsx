import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Apply dark theme by default on initial load
if (typeof document !== 'undefined') {
  document.documentElement.classList.add('dark');
}
