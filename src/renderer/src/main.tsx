import { StrictMode, Component } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import { GlobalStateProvider } from './context/GlobalState'
import { ConversationProvider } from './context/ConversationContext'
import { NotesProvider } from './context/NotesContext'
import { ThemeProvider, applyInitialTheme } from './theme'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import './i18n'
import './index.css'
import App from './App.tsx'

// Apply theme synchronously before React mounts, to avoid a flash of the wrong palette.
applyInitialTheme()

// Catch unhandled promise rejections so they don't silently disappear
window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

// Block Font Awesome CDN injected by react-simplemde-editor (EasyMDE).
// The library dynamically inserts a <link> to maxcdn.bootstrapcdn.com which
// violates the CSP and triggers a console error. We intercept and remove it
// before it is applied — icons still render via our local fallback CSS.
if (typeof MutationObserver !== 'undefined') {
  const faObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node as Element).tagName === 'LINK' &&
          ((node as HTMLLinkElement).href || '').includes('font-awesome')
        ) {
          (node as HTMLLinkElement).remove();
        }
      }
    }
  });
  faObserver.observe(document.head, { childList: true });
}

// Prevent accidental file drops from navigating the Electron webview
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => { e.preventDefault(); });

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React Error Boundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          height: '100vh',
          width: '100vw',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'rgba(15,15,15,0.95)',
          color: '#e5e5e5',
          fontFamily: 'system-ui, sans-serif',
        }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#888', marginBottom: '1.5rem', maxWidth: 400, textAlign: 'center' }}>
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.5rem 1.5rem',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload Application
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <ThemeProvider>
        <GlobalStateProvider>
          <ToastProvider>
            <ConfirmProvider>
              <ConversationProvider>
                <NotesProvider>
                  <App />
                </NotesProvider>
              </ConversationProvider>
            </ConfirmProvider>
          </ToastProvider>
        </GlobalStateProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </StrictMode>,
)
