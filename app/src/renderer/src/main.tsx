import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

// Phase 3 step 3: read the persisted theme synchronously via the
// preload-exposed value (additionalArguments) BEFORE first paint so there is
// no flash of the wrong theme. Falls back to 'light' when the preload is not
// present (e.g. Vitest) because bare :root already equals the light palette.
const apiTheme = (window as unknown as { api?: { initialTheme?: string } }).api?.initialTheme
document.documentElement.dataset.theme =
  apiTheme === 'dark' || apiTheme === 'light' ? apiTheme : 'light'

// Phase 3 step 13: same for stealthMode — available synchronously for the
// overlay's initial minimal rendering (step 14 consumes this; step 13 just primes it).
const apiStealth = (window as unknown as { api?: { initialStealthMode?: boolean } }).api
  ?.initialStealthMode
document.documentElement.dataset.stealth = apiStealth ? '1' : '0'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
