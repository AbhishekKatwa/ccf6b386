import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initDataService } from './services/dataService'
import './index.css'

// Boots Supabase Auth + sync when VITE_SUPABASE_* is configured; a no-op otherwise.
initDataService()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
