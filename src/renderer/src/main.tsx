import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { GlobalStateProvider } from './context/GlobalState'
import { ConversationProvider } from './context/ConversationContext'
import { NotesProvider } from './context/NotesContext'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <GlobalStateProvider>
      <ConversationProvider>
        <NotesProvider>
          <App />
        </NotesProvider>
      </ConversationProvider>
    </GlobalStateProvider>
  </StrictMode>,
)
