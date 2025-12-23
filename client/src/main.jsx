// Add error handler BEFORE any imports
window.addEventListener('error', (e) => {
  console.error('❌ PRE-IMPORT ERROR:', e.error);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `<div style="padding:20px;color:red;background:white;">
      <h1>JavaScript Error</h1>
      <p>${e.message}</p>
      <pre>${e.error?.stack || 'No stack'}</pre>
    </div>`;
  }
});

window.addEventListener('unhandledrejection', (e) => {
  console.error('❌ UNHANDLED PROMISE REJECTION:', e.reason);
  const root = document.getElementById('root');
  if (root && root.innerHTML.includes('React not mounted')) {
    root.innerHTML = `<div style="padding:20px;color:red;background:white;">
      <h1>Promise Rejection Error</h1>
      <p>${e.reason?.message || String(e.reason)}</p>
      <pre>${e.reason?.stack || 'No stack'}</pre>
    </div>`;
  }
});

console.log('1. Starting imports...');
import './polyfill.js';
console.log('2. Polyfill loaded');
import { StrictMode } from 'react';
console.log('3. React imported');
import { createRoot } from 'react-dom/client';
console.log('4. createRoot imported');
import { TonConnectUIProvider } from '@tonconnect/ui-react';
console.log('5. TonConnect imported');
import { Provider } from 'react-redux';
import { store } from './store/store.js';
console.log('6. Redux imported');
import { UserContextProvider } from './context/userSelectionContext.jsx';
import './index.css';
import App from './App.jsx';
import { TonClientProvider } from './context/TonClientContext';
console.log('7. All imports done');
// Note: Firebase client import happens here - if it fails, error is shown by firebase/client.js

// Initialize Telegram WebApp
if (window.Telegram?.WebApp) {
  const tg = window.Telegram.WebApp;
  tg.ready();
  tg.expand();
  // Enable closing confirmation
  tg.enableClosingConfirmation();
  // Set theme colors if available
  if (tg.themeParams) {
    document.documentElement.style.setProperty('--tg-theme-bg-color', tg.themeParams.bg_color || '#ffffff');
    document.documentElement.style.setProperty('--tg-theme-text-color', tg.themeParams.text_color || '#000000');
    document.documentElement.style.setProperty('--tg-theme-hint-color', tg.themeParams.hint_color || '#999999');
    document.documentElement.style.setProperty('--tg-theme-link-color', tg.themeParams.link_color || '#2481cc');
    document.documentElement.style.setProperty('--tg-theme-button-color', tg.themeParams.button_color || '#2481cc');
    document.documentElement.style.setProperty('--tg-theme-button-text-color', tg.themeParams.button_text_color || '#ffffff');
  }
}

// Get manifest URL for TON Connect
const manifestUrl = new URL('tonconnect-manifest.json', window.location.href).toString();
console.log('8. Manifest URL:', manifestUrl);

const rootElement = document.getElementById('root');
console.log('9. Root element:', rootElement);

if (!rootElement) {
  console.error('❌ ROOT ELEMENT NOT FOUND!');
  document.body.innerHTML = '<div style="padding:20px;color:red;background:white;"><h1>ERROR: Root element not found!</h1></div>';
} else {
  try {
    console.log('10. Creating React root...');
    const root = createRoot(rootElement);
    console.log('11. React root created, rendering...');
    
    root.render(
      <StrictMode>
        <Provider store={store}>
          <UserContextProvider>
            <TonConnectUIProvider manifestUrl={manifestUrl}>
              <TonClientProvider>
                <App />
              </TonClientProvider>
            </TonConnectUIProvider>
          </UserContextProvider>
        </Provider>
      </StrictMode>,
    );
    console.log('12. ✅ React rendered successfully!');
  } catch (error) {
    console.error('❌ ERROR RENDERING REACT:', error);
    rootElement.innerHTML = `<div style="padding:20px;color:red;background:white;">
      <h1>React Render Error</h1>
      <p>${error.message}</p>
      <pre>${error.stack || 'No stack trace'}</pre>
    </div>`;
  }
}
