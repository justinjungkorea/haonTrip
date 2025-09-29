import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// ✅ PWA service worker 자동 등록
// main.jsx
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // 프로덕션 + 보안 컨텍스트(https 또는 localhost)에서만 등록
    const isSecure = location.protocol === 'https:' || location.hostname === 'localhost';
    if (import.meta.env.PROD && isSecure) {
      navigator.serviceWorker.register('/sw.js').catch((e) => {
        console.debug('SW registration skipped:', e);
      });
    }
  });
}


createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
