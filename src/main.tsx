import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { initDataService } from './services/dataService'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import './index.css'

// Boots Supabase Auth + sync when VITE_SUPABASE_* is configured; a no-op otherwise. A wire that
// cannot be set up is a degraded app, never an empty one: the store keeps working on its cache.
initDataService()

const container = document.getElementById('root') ?? document.body;

// The last line of defence: a failure anywhere below this still gets a recovery screen rather
// than a white window. Screens have their own boundaries inside, so this one is rarely seen.
ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)
