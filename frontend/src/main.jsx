import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './App.css'

import { Buffer } from 'buffer'
import process from 'process'

window.Buffer = Buffer
window.process = process
window.global = window

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
