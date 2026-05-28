import './style.css';
import './app.css';

import {
  SelectDirectory,
  ScanAndStartServer,
  AutoCompileSlidePDF,
  AutoCompileDeckPDF,
  ListCompiledPDFs,
  DeleteCompiledPDF,
  CompileSlidesToIDML,
  SelectIDMLSavePath,
  ListCombinedDecks,
  CombineCompiledPDFs,
  AutomateDeck,
  AutomateActiveSlide,
  ScanActiveSlide,
  CompileSlideFromCaptures,
  CompileDeckFromCaptures,
  StartPDFSession,
  CompileSingleStateToPDF,
  EndPDFSession,
  GenerateDeckAutoSavePath,
  GenerateNextSequentialPDFPath
} from '../wailsjs/go/main/App';

import { EventsOn } from '../wailsjs/runtime/runtime';

window.crawlerLogs = [];
window.logToTextFile = function(msg) {
  const timestamp = new Date().toLocaleTimeString();
  const logMsg = `[${timestamp}] ${msg}`;
  window.crawlerLogs.push(logMsg);
  console.log(logMsg);
};

window.downloadCrawlerLogs = function() {
  if (window.crawlerLogs.length === 0) return;
  const blob = new Blob([window.crawlerLogs.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'crawler_log.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
};

// Helper to show modern confirmation modal for scanned automation triggers
const showConfirmModal = (items, onConfirm, onCancel) => {
  const backdrop = document.createElement('div');
  backdrop.id = 'confirm-modal-backdrop';
  backdrop.style.cssText = `
    position: fixed;
    top: 0; left: 0; width: 100vw; height: 100vh;
    background: rgba(10, 15, 30, 0.7);
    backdrop-filter: blur(12px);
    display: flex; align-items: center; justify-content: center;
    z-index: 999999;
    opacity: 0; transition: opacity 0.3s ease;
  `;
  
  const copiableText = items.join('\n');
  
  const content = document.createElement('div');
  content.style.cssText = `
    background: linear-gradient(135deg, rgba(20, 30, 55, 0.95), rgba(10, 15, 30, 0.98));
    border: 1px solid rgba(0, 242, 254, 0.15);
    border-radius: 16px;
    padding: 24px;
    width: 90%; max-width: 500px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), inset 0 0 20px rgba(0, 242, 254, 0.05);
    transform: translateY(20px); transition: transform 0.3s ease;
    color: #e2e8f0;
    font-family: 'Inter', sans-serif;
  `;
  
  content.innerHTML = `
    <h3 style="margin: 0 0 12px 0; color: #00f2fe; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 8px;">
      🔍 Scan Results: Slide Automation
    </h3>
    <p style="margin: 0 0 16px 0; font-size: 14px; color: #94a3b8; line-height: 1.5;">
      We scanned the slide and detected the following states to capture. Please review the selectors/buttons below:
    </p>
    <div style="position: relative; margin-bottom: 20px;">
      <textarea id="scan-list-textarea" readonly style="
        width: 100%; height: 180px;
        background: rgba(5, 10, 20, 0.5);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px;
        padding: 12px;
        color: #38bdf8;
        font-family: 'Courier New', monospace;
        font-size: 13px;
        resize: none;
        outline: none;
        box-sizing: border-box;
      ">${copiableText}</textarea>
      <button id="btn-copy-scan-list" style="
        position: absolute; right: 10px; bottom: 15px;
        background: rgba(56, 189, 248, 0.15);
        border: 1px solid rgba(56, 189, 248, 0.3);
        color: #38bdf8;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 11px;
        cursor: pointer;
        transition: all 0.2s ease;
      ">📋 Copy List</button>
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 12px;">
      <button id="btn-modal-cancel" style="
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #94a3b8;
        padding: 10px 20px;
        border-radius: 8px;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s ease;
      ">Cancel</button>
      <button id="btn-modal-proceed" style="
        background: linear-gradient(90deg, #0072ff, #00f2fe);
        border: none;
        color: #fff;
        padding: 10px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 4px 15px rgba(0, 242, 254, 0.3);
        transition: all 0.2s ease;
      ">Proceed</button>
    </div>
  `;
  
  backdrop.appendChild(content);
  document.body.appendChild(backdrop);
  
  // Animate in
  setTimeout(() => {
    backdrop.style.opacity = '1';
    content.style.transform = 'translateY(0)';
  }, 10);
  
  const closeModal = () => {
    backdrop.style.opacity = '0';
    content.style.transform = 'translateY(20px)';
    setTimeout(() => {
      document.body.removeChild(backdrop);
    }, 300);
  };
  
  const copyBtn = content.querySelector('#btn-copy-scan-list');
  copyBtn.addEventListener('click', () => {
    const textarea = content.querySelector('#scan-list-textarea');
    textarea.select();
    document.execCommand('copy');
    copyBtn.innerText = '✅ Copied!';
    setTimeout(() => {
      copyBtn.innerText = '📋 Copy List';
    }, 2000);
  });
  
  content.querySelector('#btn-modal-cancel').addEventListener('click', () => {
    closeModal();
    onCancel();
  });
  
  content.querySelector('#btn-modal-proceed').addEventListener('click', () => {
    closeModal();
    onConfirm();
  });
};

// ─── App State ───────────────────────────────────────────────────────────────
let state = {
  rootDirectory: '',
  slides: [],
  currentSlideIndex: -1,
  compiledPDFs: [],
  combinedDecks: [],
  currentViewerPDFIndex: -1,
  isCompiling: false,
  sleepMs: 800
};


// ─── Scaffold HTML ───────────────────────────────────────────────────────────
document.querySelector('#app').innerHTML = `
  <!-- Top Header Bar -->
  <div class="top-bar">
    <div class="brand-section">
      <div class="brand-logo">P</div>
      <div class="brand-title">eDA PDF Compiler</div>
    </div>
    
    <button class="btn-select-dir" id="btn-select-dir">📁 Select Folder</button>
    <div class="dir-path-display" id="dir-path-display">No directory selected</div>
    
    <div class="settings-compact">
      <label>Settle: <span id="sleep-val">800ms</span></label>
      <input type="range" id="input-sleep" min="300" max="3000" step="100" value="800" />
    </div>
  </div>

  <!-- Main 3-Panel Layout -->
  <div class="main-content">
    <!-- Left Panel: Slides -->
    <div class="panel-left">
      <div class="panel-header">
        Slides Deck
        <span class="count-badge" id="slides-count">0</span>
      </div>
      <div class="slide-list" id="slide-list">
        <div class="slide-empty">No presentation loaded</div>
      </div>
    </div>

    <!-- Center Panel: Preview -->
    <div class="panel-center">
      <div class="welcome-overlay" id="welcome-view">
        <div class="welcome-icon">✨</div>
        <div class="welcome-title">Interactive eDA PDF Compiler</div>
        <div class="welcome-desc">
          Select an eDA campaign folder containing slide subfolders (like _001, _002, etc.) and a sibling "shared" assets folder to begin.
        </div>
      </div>
      
      <div class="canvas-frame" id="canvas-frame" style="display: none;">
        <iframe id="slide-iframe"></iframe>
      </div>
      
      <div class="floating-controls" id="floating-toolbar" style="display: none;">
        <button class="nav-btn" id="btn-prev">👈 Prev</button>
        <div class="nav-divider"></div>
        <span class="slide-counter" id="slide-counter">1 / 1</span>
        <div class="nav-divider"></div>
        <button class="nav-btn" id="btn-next">Next 👉</button>
      </div>
    </div>

    <!-- Right Panel: Compiled PDFs & Combined Decks -->
    <div class="panel-right" style="display: flex; flex-direction: column; height: 100%;">
      <!-- Compiled PDFs (Single Slides) -->
      <div style="display: flex; flex-direction: column; flex: 1; min-height: 0; padding-bottom: 8px;">
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span>Compiled PDFs</span>
          <span class="count-badge" id="pdf-count">0</span>
        </div>
        <div class="pdf-list" id="pdf-list" style="flex: 1; overflow-y: auto;">
          <div class="pdf-empty">No PDFs compiled yet.<br/>Compile slides to see them here.</div>
        </div>
      </div>

      <!-- Divider line -->
      <div style="height: 1px; background: var(--border-color); margin: 4px 0; opacity: 0.5;"></div>

      <!-- Combined Decks -->
      <div style="display: flex; flex-direction: column; flex: 1; min-height: 0; padding-top: 8px;">
        <div class="panel-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <span>Combined Decks</span>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button class="compile-btn" id="btn-combine-pdf" style="padding: 4px 10px; border-radius: 6px; font-size: 0.72rem; background: linear-gradient(135deg, #00f2fe, #4facfe); border: none; color: #080c14; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 4px; box-shadow: 0 4px 12px rgba(0, 242, 254, 0.2); transition: all 0.2s; height: 26px; line-height: 26px;" disabled>
              🔗 Combine
            </button>
            <span class="count-badge" id="deck-count">0</span>
          </div>
        </div>
        <div class="pdf-list" id="deck-list" style="flex: 1; overflow-y: auto;">
          <div class="pdf-empty">No combined decks created yet.</div>
        </div>
      </div>
    </div>
  </div>

  <!-- PDF Viewer Overlay -->
  <div class="pdf-viewer-overlay" id="pdf-viewer" style="display: none;">
    <div class="pdf-viewer-header">
      <div class="pdf-viewer-title">📄 <span id="pdf-viewer-title-text">Document.pdf</span></div>
      <div style="display: flex; gap: 12px; align-items: center; justify-content: center; flex: 1; max-width: 400px; margin: 0 auto;">
        <button class="nav-btn" id="btn-pdf-prev" style="padding: 6px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; margin: 0;">👈 Prev PDF</button>
        <span id="pdf-viewer-counter" style="color: var(--text-muted); font-size: 0.85rem; font-family: monospace; font-weight: 600; min-width: 60px; text-align: center;">1 / 1</span>
        <button class="nav-btn" id="btn-pdf-next" style="padding: 6px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; margin: 0;">Next PDF 👉</button>
      </div>
      <button class="btn-close-viewer" id="btn-close-viewer">✕ Close</button>
    </div>
    <iframe class="pdf-viewer-frame" id="pdf-viewer-frame" src=""></iframe>
  </div>

  <!-- Metadata Viewer Modal -->
  <div class="pdf-viewer-overlay" id="metadata-viewer" style="display: none; z-index: 10000; align-items: center; justify-content: center; background: rgba(4, 6, 10, 0.82); backdrop-filter: blur(16px);">
    <div class="metadata-modal-wrapper">
      <div class="metadata-header">
        <h3 class="metadata-title-text">📄 PDF Metadata Details</h3>
        <button class="metadata-close-btn" id="btn-close-metadata">✕</button>
      </div>
      <div class="metadata-scroll-content" id="metadata-content">
        <!-- Filled dynamically -->
      </div>
    </div>
  </div>

  <!-- Bottom Compile Bar -->
  <div class="bottom-bar">
    <div class="progress-section" id="progress-area">
      <div class="progress-info">
        <div id="progress-status-text">Preparing renderer...</div>
        <div id="progress-percentage">0%</div>
      </div>
      <div class="progress-bar-container">
        <div class="progress-bar" id="progress-indicator"></div>
      </div>
    </div>
    
    <div class="compile-buttons">
      <button class="compile-btn" id="btn-idml" style="background: linear-gradient(135deg, #00f2fe, #4facfe); box-shadow: 0 4px 16px rgba(79, 172, 254, 0.3);" disabled>
        📁 Export IDML
      </button>
      <button class="compile-btn" id="btn-screenshot" style="background: linear-gradient(135deg, var(--accent-pink), var(--accent-purple)); box-shadow: 0 4px 16px rgba(255, 121, 198, 0.3);" disabled>
        📄 Compile Slide
      </button>
      <button class="compile-btn" id="btn-compile" disabled>
        🚀 Compile Deck
      </button>
      <button class="compile-btn" id="btn-automate-slide" style="background: linear-gradient(135deg, #ff9a9e, #fecfef); box-shadow: 0 4px 16px rgba(255, 154, 158, 0.3); color: #080c14; font-weight: 700;" disabled>
        🤖 Automate Slide
      </button>
      <button class="compile-btn" id="btn-automate" style="background: linear-gradient(135deg, #a18cd1, #fbc2eb); box-shadow: 0 4px 16px rgba(161, 140, 209, 0.3);" disabled>
        🤖 Automate Deck
      </button>
    </div>
  </div>
`;

// ─── DOM Selectors ───────────────────────────────────────────────────────────
const btnSelectDir = document.querySelector('#btn-select-dir');
const btnCompile = document.querySelector('#btn-compile');
const btnScreenshot = document.querySelector('#btn-screenshot');
const btnIdml = document.querySelector('#btn-idml');
const btnAutomate = document.querySelector('#btn-automate');
const btnAutomateSlide = document.querySelector('#btn-automate-slide');
const inputSleep = document.querySelector('#input-sleep');
const sleepVal = document.querySelector('#sleep-val');
const slideList = document.querySelector('#slide-list');
const dirPathDisplay = document.querySelector('#dir-path-display');
const slidesCount = document.querySelector('#slides-count');
const welcomeView = document.querySelector('#welcome-view');
const canvasFrame = document.querySelector('#canvas-frame');
const slideIframe = document.querySelector('#slide-iframe');
const floatingToolbar = document.querySelector('#floating-toolbar');
const slideCounter = document.querySelector('#slide-counter');
const btnPrev = document.querySelector('#btn-prev');
const btnNext = document.querySelector('#btn-next');
const pdfList = document.querySelector('#pdf-list');
const pdfCount = document.querySelector('#pdf-count');
const btnCombinePdf = document.querySelector('#btn-combine-pdf');
const deckCount = document.querySelector('#deck-count');
const deckList = document.querySelector('#deck-list');
const pdfViewer = document.querySelector('#pdf-viewer');
const pdfViewerTitleText = document.querySelector('#pdf-viewer-title-text');
const pdfViewerFrame = document.querySelector('#pdf-viewer-frame');
const btnCloseViewer = document.querySelector('#btn-close-viewer');
const progressArea = document.querySelector('#progress-area');
const progressStatusText = document.querySelector('#progress-status-text');
const progressPercentage = document.querySelector('#progress-percentage');
const progressIndicator = document.querySelector('#progress-indicator');

// ─── Settings ────────────────────────────────────────────────────────────────
inputSleep.addEventListener('input', (e) => {
  state.sleepMs = parseInt(e.target.value, 10);
  sleepVal.innerText = `${state.sleepMs}ms`;
});

// ─── Directory Selection ─────────────────────────────────────────────────────
btnSelectDir.addEventListener('click', async () => {
  try {
    const dir = await SelectDirectory();
    if (dir) loadDirectory(dir);
  } catch (err) {
    console.error('Directory selection failed:', err);
  }
});

async function loadDirectory(dirPath) {
  try {
    dirPathDisplay.innerHTML = `Loading: <span>${dirPath}</span>`;
    const result = await ScanAndStartServer(dirPath);
    
    state.rootDirectory = result.parentPath;
    state.slides = result.slides;
    state.currentSlideIndex = -1;
    
    dirPathDisplay.innerHTML = `<span>${state.rootDirectory}</span>`;
    slidesCount.innerText = state.slides.length;
    
    if (state.slides.length > 0) {
      renderSlideList();
      btnCompile.removeAttribute('disabled');
      btnScreenshot.removeAttribute('disabled');
      btnIdml.removeAttribute('disabled');
      btnAutomate.removeAttribute('disabled');
      btnAutomateSlide.removeAttribute('disabled');
      loadSlide(0);
    } else {
      slideList.innerHTML = '<div class="slide-empty">No slide subfolders found.</div>';
      btnCompile.setAttribute('disabled', 'true');
      btnScreenshot.setAttribute('disabled', 'true');
      btnIdml.setAttribute('disabled', 'true');
      btnAutomate.setAttribute('disabled', 'true');
      btnAutomateSlide.setAttribute('disabled', 'true');
    }
    
    // Refresh PDF list for this presentation
    refreshPDFList();
  } catch (err) {
    console.error('Failed to load directory:', err);
    dirPathDisplay.innerText = 'Failed to load directory';
  }
}

// ─── Slide List Rendering ────────────────────────────────────────────────────
function renderSlideList() {
  slideList.innerHTML = '';
  state.slides.forEach((slide, idx) => {
    const item = document.createElement('div');
    item.className = `slide-item ${idx === state.currentSlideIndex ? 'active' : ''}`;
    item.id = `slide-item-${idx}`;
    item.innerHTML = `<div class="slide-name">${slide.name}</div>`;
    item.addEventListener('click', () => loadSlide(idx));
    slideList.appendChild(item);
  });
}

// ─── Slide Loading ───────────────────────────────────────────────────────────
function loadSlide(idx) {
  if (idx < 0 || idx >= state.slides.length) return;
  state.currentSlideIndex = idx;
  
  // Highlight active sidebar item
  document.querySelectorAll('.slide-item').forEach((item) => item.classList.remove('active'));
  const activeItem = document.querySelector(`#slide-item-${idx}`);
  if (activeItem) activeItem.classList.add('active');
  
  const slide = state.slides[idx];
  
  // Switch to canvas view
  welcomeView.style.display = 'none';
  canvasFrame.style.display = 'block';
  floatingToolbar.style.display = 'flex';
  
  // Update counter
  slideCounter.innerText = `${idx + 1} / ${state.slides.length}`;
  
  // Toggle vertical styling
  const isVertical = slide.folderName && slide.folderName.toLowerCase().includes('vertical');
  if (isVertical) {
    canvasFrame.classList.add('vertical');
  } else {
    canvasFrame.classList.remove('vertical');
  }
  
  // Load slide URL
  slideIframe.src = slide.url;
}

// ─── Cross-Origin Navigation Listener ────────────────────────────────────────
// Captures secure postMessage slide navigation alerts sent by our bridge script inside the iframe.
// This completely bypasses CORS restrictions and eliminates layout/indexing race conditions!
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'iframe_log') {
    if (window.logToTextFile) window.logToTextFile("[IFRAME] " + e.data.message);
    try { window.go.main.App.LogCrawlerStatus("[IFRAME] " + e.data.message); } catch(_) {}
    return;
  }
  if (e.data && e.data.type === 'iframe_navigation') {
    const loadedUrl = e.data.url;
    if (!loadedUrl || loadedUrl === 'about:blank') return;

    // 1. Try exact URL match
    let matchIdx = state.slides.findIndex((s) => {
      try { return new URL(s.url).href === loadedUrl; } catch (_) { return false; }
    });

    // 2. Try boundary-safe case-insensitive folder name regex match (handles slashes, dashes, hashes, queries)
    if (matchIdx === -1) {
      matchIdx = state.slides.findIndex((s) => {
        if (!s.folderName) return false;
        const cleanFolder = s.folderName.replace(/^_+|_+$/g, '').toLowerCase(); // e.g. "001"
        const lowerUrl = loadedUrl.toLowerCase();
        const regex = new RegExp('[\\/_]' + cleanFolder + '([\\/_\\?\\.#]|$)');
        return regex.test(lowerUrl);
      });
    }

    if (matchIdx !== -1 && matchIdx !== state.currentSlideIndex) {
      state.currentSlideIndex = matchIdx;
      document.querySelectorAll('.slide-item').forEach((item) => item.classList.remove('active'));
      const activeItem = document.querySelector(`#slide-item-${matchIdx}`);
      if (activeItem) {
        activeItem.classList.add('active');
        activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
      slideCounter.innerText = `${matchIdx + 1} / ${state.slides.length}`;
    }
  }
});

// ─── Navigation ──────────────────────────────────────────────────────────────
btnPrev.addEventListener('click', () => {
  if (state.currentSlideIndex > 0) loadSlide(state.currentSlideIndex - 1);
});

btnNext.addEventListener('click', () => {
  if (state.currentSlideIndex < state.slides.length - 1) loadSlide(state.currentSlideIndex + 1);
});

// ─── Auto-Capture Current Iframe State ───────────────────────────────────────
// Captures the live DOM of the current iframe (including any open popups)
// by sending the bridge script's 'request_html' message and waiting for response
function captureCurrentSlideState() {
  return new Promise((resolve) => {
    // Timeout fallback: if no response in 3s, resolve with empty (compile from URL)
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve('');
    }, 3000);
    
    const handler = (e) => {
      if (e.data && e.data.type === 'captured_html') {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(e.data.html);
      }
    };
    
    window.addEventListener('message', handler);
    
    try {
      slideIframe.contentWindow.postMessage('request_html', '*');
    } catch (_) {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve('');
    }
  });
}

// ─── Compile Single Slide PDF ────────────────────────────────────────────────
btnScreenshot.addEventListener('click', async () => {
  if (state.currentSlideIndex === -1 || state.isCompiling) return;
  
  const activeSlide = state.slides[state.currentSlideIndex];
  
  try {
    // Start compile UI
    setCompileUIState(true);
    progressStatusText.innerText = 'Auto-capturing slide state...';
    
    // Auto-capture current iframe state (includes any open popups)
    const capturedHtml = await captureCurrentSlideState();
    
    progressStatusText.innerText = 'Compiling slide PDF...';
    
    const job = {
      slideName: activeSlide.name,
      folderName: activeSlide.folderName,
      url: activeSlide.url,
      customHtml: capturedHtml
    };
    
    const resultPath = await AutoCompileSlidePDF(job, state.sleepMs);
    
    progressStatusText.innerHTML = `📄 Saved: <span style="color: var(--accent-green); font-family: monospace;">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
    
    // Refresh PDF list
    await refreshPDFList();
  } catch (err) {
    console.error('Slide compilation failed:', err);
    progressStatusText.innerHTML = `❌ Failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
  } finally {
    setCompileUIState(false);
  }
});

// ─── Compile Entire Deck PDF ─────────────────────────────────────────────────
btnCompile.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;
  
  try {
    setCompileUIState(true);
    progressStatusText.innerText = 'Opening background engine...';
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';
    
    // Build jobs for all slides (no custom state — compile from URL)
    const jobs = state.slides.map((slide) => ({
      slideName: slide.name,
      folderName: slide.folderName,
      url: slide.url,
      customHtml: ''
    }));
    
    const resultPath = await AutoCompileDeckPDF(jobs, state.sleepMs);
    
    progressStatusText.innerHTML = `🎉 Deck compiled: <span style="color: var(--accent-green); font-family: monospace;">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-green)';
    
    await refreshPDFList();
  } catch (err) {
    console.error('Deck compilation failed:', err);
    progressStatusText.innerHTML = `❌ Failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
  } finally {
    setCompileUIState(false);
  }
});

// ─── Iframe Automation Helpers ───────────────────────────────────────────────
// These use the bridge script's postMessage handlers to interact with the live iframe

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Execute arbitrary JS inside the iframe and get the result back
function executeInIframe(code) {
  return new Promise((resolve, reject) => {
    const id = Date.now() + '_' + Math.random().toString(36).slice(2);
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Iframe execute timed out'));
    }, 8000);
    
    const handler = (e) => {
      if (e.data && e.data.type === 'iframe_execute_result' && e.data.id === id) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        if (e.data.error) reject(new Error(e.data.error));
        else resolve(e.data.result);
      }
    };
    
    window.addEventListener('message', handler);
    try {
      slideIframe.contentWindow.postMessage({ type: 'iframe_execute', id, code }, '*');
    } catch (err) {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      reject(err);
    }
  });
}

// Click an element inside the iframe by CSS selector
function clickInIframe(selector) {
  return executeInIframe(`(function() {
    var el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false;
    
    // Dispatch Touch events
    var dispatchTouch = function(element, type) {
      try {
        var touch = {
          identifier: Date.now(),
          target: element,
          clientX: 0,
          clientY: 0,
          screenX: 0,
          screenY: 0,
          pageX: 0,
          pageY: 0
        };
        var touchList = [touch];
        var evt;
        try {
          evt = new TouchEvent(type, {
            bubbles: true,
            cancelable: true,
            touches: type === 'touchstart' ? touchList : [],
            targetTouches: type === 'touchstart' ? touchList : [],
            changedTouches: touchList
          });
        } catch(e) {
          evt = document.createEvent('TouchEvent');
          evt.initEvent(type, true, true);
          Object.defineProperty(evt, 'touches', { value: type === 'touchstart' ? touchList : [] });
          Object.defineProperty(evt, 'targetTouches', { value: type === 'touchstart' ? touchList : [] });
          Object.defineProperty(evt, 'changedTouches', { value: touchList });
        }
        element.dispatchEvent(evt);
      } catch(err) {}
    };
    dispatchTouch(el, 'touchstart');
    dispatchTouch(el, 'touchend');

    // Dispatch Mouse events
    var opts = { bubbles: true, cancelable: true, view: window };
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
    
    try { el.click(); } catch(_) {}
    return true;
  })()`);
}

// Close all open dialogs inside the iframe
function closeIframeDialogs() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(false);
    }, 4000);
    
    const handler = async (e) => {
      if (e.data && e.data.type === 'iframe_close_result') {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        
        // Wait for active dialogs to actually finish their close transitions (display: none)
        let attempts = 0;
        while (attempts < 20) {
          const anyOpen = await executeInIframe(`(function() {
            var selectors = ['.ui-dialog', '.dialog', '[role="dialog"]', '#references', '#ref', '#pi', '#isi', '#si', '#bi'];
            for (var i = 0; i < selectors.length; i++) {
              var els = document.querySelectorAll(selectors[i]);
              for (var j = 0; j < els.length; j++) {
                var el = els[j];
                var style = window.getComputedStyle(el);
                if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1) {
                  var rect = el.getBoundingClientRect();
                  if (rect.width > 150 && rect.height > 150) return true;
                }
              }
            }
            return false;
          })()`);
          if (!anyOpen) break;
          await sleep(50);
          attempts++;
        }
        resolve(e.data.success);
      }
    };
    
    window.addEventListener('message', handler);
    try {
      slideIframe.contentWindow.postMessage({ type: 'iframe_close_dialogs' }, '*');
    } catch (_) {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(false);
    }
  });
}

// ─── Reusable: Automate One Slide via Live Iframe ────────────────────────────
// Loads a slide in the iframe, scans triggers, clicks each, captures states on-the-fly.
async function automateOneSlideViaIframe(slide, slideIndex, totalSlides, settleMs) {
  if (window.logToTextFile) {
    window.logToTextFile(`======================================================================`);
    window.logToTextFile(`🚀 STARTING AUTOMATION RUN FOR SLIDE: ${slide.name} (Index ${slideIndex})`);
    window.logToTextFile(`======================================================================`);
  }
  const isFirstSlide = slideIndex === 0;
  const logLines = [];
  
  const updateProgress = (detail) => {
    const pct = Math.round((slideIndex / totalSlides) * 100);
    progressPercentage.innerText = `${pct}%`;
    progressIndicator.style.width = `${pct}%`;
    progressStatusText.innerText = `[${slideIndex + 1}/${totalSlides}] ${slide.name}: ${detail}`;
  };

  // Helper: load slide in iframe and wait for it
  const loadSlideInIframe = () => new Promise((resolve) => {
    slideIframe.onload = () => { slideIframe.onload = null; resolve(); };
    slideIframe.src = slide.url;
  });

  // Helper: ensure all dialogs/popups inside iframe are closed before proceeding
  const ensureAllClosed = async () => {
    let attempts = 0;
    while (attempts < 3) {
      const anyOpen = await executeInIframe(`(function() {
        var selectors = ['.ui-dialog', '.dialog', '[role="dialog"]', '#references', '#ref', '#pi', '#isi', '#si', '#bi'];
        for (var i = 0; i < selectors.length; i++) {
          var els = document.querySelectorAll(selectors[i]);
          for (var j = 0; j < els.length; j++) {
            var el = els[j];
            var style = window.getComputedStyle(el);
            if (style.display !== 'none' && style.visibility !== 'hidden' && parseFloat(style.opacity) > 0.1) {
              var rect = el.getBoundingClientRect();
              if (rect.width > 150 && rect.height > 150) return true;
            }
          }
        }
        return false;
      })()`);
      if (!anyOpen) return true;
      await closeIframeDialogs();
      await sleep(300);
      attempts++;
    }
    return false;
  };

  const captureAndCompileState = async (desc) => {
    const statusStr = await executeInIframe(`(function() {
      var nav = document.querySelector('.navBottom');
      var bnav = document.querySelector('.bottomnav');
      var statusStr = "PDF CRAWLER STATE [${desc}]:";
      if (!nav) {
        statusStr += " [navBottom NOT FOUND]";
      } else {
        var cs = window.getComputedStyle(nav);
        statusStr += " [navBottom parent=" + nav.parentNode.tagName + (nav.parentNode.id ? "#" + nav.parentNode.id : "") + " display=" + cs.display + " visibility=" + cs.visibility + " opacity=" + cs.opacity + " zIndex=" + cs.zIndex + "]";
      }
      if (!bnav) {
        statusStr += " [bottomnav NOT FOUND]";
      } else {
        var cs2 = window.getComputedStyle(bnav);
        statusStr += " [bottomnav parent=" + bnav.parentNode.tagName + " display=" + cs2.display + " visibility=" + cs2.visibility + " opacity=" + cs2.opacity + " zIndex=" + cs2.zIndex + "]";
      }
      return statusStr;
    })()`);
    console.log(statusStr);
    try { window.go.main.App.LogCrawlerStatus(statusStr); } catch(_) {}
    const html = await captureCurrentSlideState();
    if (!html) return;
    const job = {
      slideName: slide.name,
      folderName: slide.folderName,
      url: slide.url,
      customHtml: html
    };
    updateProgress(`📸 Rendering to PDF: ${desc}...`);
    await CompileSingleStateToPDF(job, settleMs);
  };
  
  // Toggle vertical styling
  const isVertical = slide.folderName && slide.folderName.toLowerCase().includes('vertical');
  if (isVertical) {
    canvasFrame.classList.add('vertical');
  } else {
    canvasFrame.classList.remove('vertical');
  }
  
  // Load the slide once
  updateProgress('Loading slide...');
  await loadSlideInIframe();
  await sleep(settleMs);
  
  // A. Capture base slide state
  updateProgress('📄 Capturing base state...');
  await captureAndCompileState('Base Slide');
  logLines.push(`📄 [${slide.name}] Base Slide`);

  // B. If first slide: shared overlays (pi, references, menu, etc.)
  if (isFirstSlide) {
    const sharedIds = ['pi', 'references', 'menu', 'flowSelector', 'email', 'objection', 'quickres'];
    for (const sid of sharedIds) {
      try {
        const isVisible = await executeInIframe(`(function() {
          var el = document.querySelector('#${sid}');
          if (!el) return false;
          if (el.classList.contains('inactive') || el.classList.contains('disabled')) return false;
          var style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false;
          if (parseFloat(style.opacity) < 0.6) return false;
          var rect = el.getBoundingClientRect();
          if (rect.width <= 5 || rect.height <= 5) return false;
          return true;
        })()`);
        
        if (isVisible) {
          updateProgress(`🔗 Opening #${sid}...`);
          
          // Exception for first slide: reload for 'pi' and 'references' to restore clean state before opening
          if (sid === 'pi' || sid === 'references') {
            await loadSlideInIframe();
            await sleep(settleMs);
          } else {
            await ensureAllClosed();
          }
          
          await clickInIframe('#' + sid);
          await sleep(settleMs);
          
          updateProgress(`📸 Capturing #${sid}...`);
          await captureAndCompileState(`Shared #${sid}`);
          logLines.push(`🔗 [${slide.name}] Shared: #${sid}`);
          
          await closeIframeDialogs();
          await sleep(400);
        }
      } catch (_) {}
    }
  } else {
    // C. Non-first slides: Slide-level references
    try {
      const hasRef = await executeInIframe(`(function() {
        var ref = document.querySelector('#references');
        if (ref) {
          var isInactive = ref.classList.contains('inactive') || ref.classList.contains('disabled');
          var style = window.getComputedStyle(ref);
          var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
          if (!isInactive && !isHidden) return 'nav';
        }
        var ref2 = document.querySelector('.gotoRef, [data-reftarget]');
        if (!ref2) return false;
        if (ref2.closest('.dialog') || ref2.closest('.ui-dialog')) return false;
        return 'gotoRef';
      })()`);
      
      if (hasRef) {
        updateProgress('📚 Opening references...');
        
        // Ensure clean state before clicking (reload slide)
        await loadSlideInIframe();
        await sleep(settleMs);
        
        const refSelector = hasRef === 'nav' ? '#references' : '.gotoRef, [data-reftarget]';
        await clickInIframe(refSelector);
        await sleep(settleMs);
        
        updateProgress('📸 Capturing references...');
        await captureAndCompileState('References');
        logLines.push(`📚 [${slide.name}] References`);
        
        await closeIframeDialogs();
        await sleep(400);
      }
    } catch (_) {}
  }
  

  
  // D. Tab Buttons (Internal Switches) & Dialog Popups (for ALL slides)
  // activateTabInfo: { selector, dataTab, dataNum } — from the outer tab scan
  let currentTabInfo = null; // set before each scanAndProcessDialogs call
  const activateTabIfNeeded = async (tabSelector) => {
    if (!tabSelector) return;
    // Strategy 1: Use data-tab attribute for reliable, class-independent switching
    // (avoids breakage from dynamically-added 'needsclick' or state classes after reload)
    const switched = await executeInIframe(`(function() {
      var info = ${JSON.stringify(currentTabInfo || {})};
      var el = null;
      // Try data-tab first (most reliable)
      if (info.dataTab) {
        el = document.querySelector('[data-tab="' + info.dataTab + '"]');
      }
      // Try data-num as fallback
      if (!el && info.dataNum) {
        el = document.querySelector('[data-num="' + info.dataNum + '"]');
      }
      // Fall back to original CSS selector
      if (!el) {
        try { el = document.querySelector(info.selector || ''); } catch(_) {}
      }
      if (!el) return false;
      
      // If already active, do not click/trigger to avoid toggling off (e.g. toggleClass)
      var isAlreadyActive = el.classList.contains('active') || 
                            el.classList.contains('active_tab') || 
                            el.classList.contains('tabActive') || 
                            el.classList.contains('selected') || 
                            el.className.indexOf('active') !== -1;
      if (isAlreadyActive) return true;

      // Dispatch events to trigger jQuery handler
      var opts = { bubbles: true, cancelable: true, view: window };
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      try { el.click(); } catch(_) {}
      return true;
    })()`);
    // Wait for tab content to settle (animations, show/hide transitions)
    await sleep(Math.max(settleMs, 600));
  };

  const scanAndProcessDialogs = async (contextLabel, tabSelector) => {
    const triggers = await executeInIframe(`(function() {
      var sharedIDs = ['pi', 'references', 'menu', 'flowSelector', 'email', 'objection', 'quickres', 'home'];
      var elements = Array.from(document.querySelectorAll('.openDialog, [data-dialog], .dialog-btn, .boxtxtbtn_click, .boxtxtbtn')).filter(function(el) {
        if (sharedIDs.indexOf(el.id) !== -1) return false;
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return false;
        return true;
      });
      var seenTargets = {};
      var uniqueTriggers = [];
      function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        var path = [];
        var curr = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE) {
          var selector = curr.nodeName.toLowerCase();
          if (curr.id) {
            selector = '#' + curr.id;
            path.unshift(selector);
            break;
          }
          if (curr.className) {
            var classes = Array.from(curr.classList).filter(function(c) {
              c = c.trim();
              if (c === '') return false;
              var lower = c.toLowerCase();
              return !(
                lower === 'needsclick' ||
                lower === 'trackingsubmitted' ||
                lower.indexOf('active') !== -1 ||
                lower.indexOf('current') !== -1 ||
                lower.indexOf('next') !== -1 ||
                lower.indexOf('prev') !== -1 ||
                lower.indexOf('disabled') !== -1 ||
                lower.indexOf('inactive') !== -1 ||
                lower.indexOf('focus') !== -1 ||
                /^tab\d+$/.test(lower)
              );
            }).join('.');
            if (classes) selector += '.' + classes;
          }
          var sibling = curr;
          var nth = 1;
          while (sibling = sibling.previousElementSibling) {
            if (sibling.nodeName === curr.nodeName) nth++;
          }
          selector += ":nth-of-type(" + nth + ")";
          path.unshift(selector);
          curr = curr.parentNode;
        }
        return path.join(' > ');
      }
      elements.forEach(function(el) {
        var target = el.getAttribute('data-dialog') || el.getAttribute('data-target') || "";
        if (!target) {
          var href = el.getAttribute('href') || "";
          if (href.startsWith('#')) target = href;
        }
        if (!target) target = "generic_" + (el.id || el.className || Math.random());
        if (!seenTargets[target]) {
          seenTargets[target] = true;
          uniqueTriggers.push({
            selector: getUniqueSelector(el),
            id: el.id || "",
            targetDialog: target,
            description: el.getAttribute('data-description') || el.innerText || ""
          });
        }
      });
      return uniqueTriggers;
    })()`);

    if (triggers && triggers.length > 0) {
      for (let i = 0; i < triggers.length; i++) {
        const t = triggers[i];
        const label = t.description || t.id || t.targetDialog || `Popup ${i + 1}`;
        
        updateProgress(`💬 Popup ${i + 1}/${triggers.length} (${contextLabel}): ${label}...`);
        
        // Ensure perfect clean state before clicking this dialog trigger (reload slide)
        await loadSlideInIframe();
        await sleep(settleMs);
        // Make sure tab is active
        await activateTabIfNeeded(tabSelector);
        
        await clickInIframe(t.selector);
        await sleep(settleMs);

        const clickDialogTab = async (tabInfo) => {
          if (!tabInfo) return;
          
          // Log start of process
          try {
            window.go.main.App.LogCrawlerStatus("[CRAWLER] clickDialogTab starting for: " + tabInfo.label + " | selector=" + tabInfo.selector + " | dataTab=" + tabInfo.dataTab);
          } catch(_) {}

          const clicked = await executeInIframe(`(function() {
            var info = ${JSON.stringify(tabInfo)};
            var el = null;
            var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
              return window.getComputedStyle(d).display !== 'none';
            })[0];
            var searchRoot = openDialog || document;

            if (info.id) el = document.getElementById(info.id);
            if (!el && info.dataTab) {
              el = searchRoot.querySelector('[data-tab="' + info.dataTab + '"], [data-num="' + info.dataTab + '"]');
            }
            if (!el && info.selector) {
              try { el = searchRoot.querySelector(info.selector); } catch(_) {}
              if (!el) {
                try { el = document.querySelector(info.selector); } catch(_) {}
              }
            }
            // Fallback: search by data-description or text content within the active dialog
            if (!el && info.label) {
              var candidates = searchRoot.querySelectorAll('.Page_tabBtn, .tabBtn, .tab-btn, .tab-button, .toptab, .bottomtab, .pop3tab, .tabSwitch div, [data-tab], [data-num], [class*="tab"], [data-description]');
              for (var idx = 0; idx < candidates.length; idx++) {
                var cand = candidates[idx];
                var candDesc = cand.getAttribute('data-description') || cand.getAttribute('data-desc') || "";
                if (candDesc && (candDesc === info.label || info.label.indexOf(candDesc) !== -1 || candDesc.indexOf(info.label) !== -1)) {
                  el = cand;
                  break;
                }
                var candText = cand.innerText.trim();
                if (candText && (candText === info.label || info.label.indexOf(candText) !== -1 || candText.indexOf(info.label) !== -1)) {
                  el = cand;
                  break;
                }
              }
            }
            
            if (!el) {
              try {
                window.parent.postMessage({
                  type: 'iframe_log',
                  message: 'Element NOT found for tab ' + info.label + '. Candidates inside open dialog: ' + 
                    Array.from(searchRoot.querySelectorAll('.Page_tabBtn, .tabBtn, .tab-btn, .tab-button, .toptab, .bottomtab, .pop3tab, .tabSwitch div')).map(function(c) {
                      return "'" + c.innerText.trim() + "' (" + c.className + ")";
                    }).join(', ')
                }, '*');
              } catch(_) {}
              return false;
            }
            
            // If already active, do not click/trigger to avoid toggling off (e.g. toggleClass)
            var isAlreadyActive = el.classList.contains('active') || 
                                  el.classList.contains('active_tab') || 
                                  el.classList.contains('tabActive') || 
                                  el.classList.contains('selected') || 
                                  el.className.indexOf('active') !== -1;
            
            try {
              window.parent.postMessage({
                type: 'iframe_log',
                message: 'Element FOUND: tagName=' + el.tagName + ' className="' + el.className + '" isAlreadyActive=' + isAlreadyActive
              }, '*');
            } catch(_) {}

            if (isAlreadyActive) return true;

            // Dispatch Touch events
            var dispatchTouch = function(element, type) {
              try {
                var touch = {
                  identifier: Date.now(),
                  target: element,
                  clientX: 0,
                  clientY: 0,
                  screenX: 0,
                  screenY: 0,
                  pageX: 0,
                  pageY: 0
                };
                var touchList = [touch];
                var evt;
                try {
                  evt = new TouchEvent(type, {
                    bubbles: true,
                    cancelable: true,
                    touches: type === 'touchstart' ? touchList : [],
                    targetTouches: type === 'touchstart' ? touchList : [],
                    changedTouches: touchList
                  });
                } catch(e) {
                  evt = document.createEvent('TouchEvent');
                  evt.initEvent(type, true, true);
                  Object.defineProperty(evt, 'touches', { value: type === 'touchstart' ? touchList : [] });
                  Object.defineProperty(evt, 'targetTouches', { value: type === 'touchstart' ? touchList : [] });
                  Object.defineProperty(evt, 'changedTouches', { value: touchList });
                }
                element.dispatchEvent(evt);
              } catch(err) {}
            };
            dispatchTouch(el, 'touchstart');
            dispatchTouch(el, 'touchend');

            var opts = { bubbles: true, cancelable: true, view: window };
            el.dispatchEvent(new MouseEvent('mousedown', opts));
            el.dispatchEvent(new MouseEvent('mouseup', opts));
            el.dispatchEvent(new MouseEvent('click', opts));
            try { el.click(); } catch(_) {}
            return true;
          })()`);
          return clicked;
        };

        // Helper: restore dialog and re-click correct page/subtab to get a 100% clean slide state
        const restoreDialogAndOpenDot = async (dotSelector = null, subTabInfo = null, tabsAreInner = false, targetDotIdx = null) => {
          updateProgress(`🔄 Restoring clean dialog state...`);
          await loadSlideInIframe();
          await sleep(settleMs);
          await activateTabIfNeeded(tabSelector);
          await clickInIframe(t.selector);
          await sleep(settleMs);
          
          const waitForDotTransition = async (targetIdx) => {
            if (targetIdx === null) return;
            await executeInIframe(`(function() {
              return new Promise(function(resolve) {
                var targetIdx = ${targetIdx};
                var deadline = Date.now() + 1500; // max 1.5s wait
                function check() {
                  var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                    return window.getComputedStyle(d).display !== 'none';
                  })[0];
                  if (!openDialog) { resolve(); return; }
                  var slides = Array.from(openDialog.querySelectorAll('.swiper-slide'));
                  var activeIdx = slides.findIndex(function(s) { return s.classList.contains('swiper-slide-active'); });
                  if (activeIdx === targetIdx || Date.now() > deadline) {
                    resolve();
                  } else {
                    setTimeout(check, 50);
                  }
                }
                check();
              });
            })()`);
          };

          if (tabsAreInner) {
            // Dots (slides) are Outer, Tabs are Inner -> Click Slide dot first, then click Tab!
            if (dotSelector) {
              await clickInIframe(dotSelector);
              await waitForDotTransition(targetDotIdx);
              await sleep(settleMs);
            }
            if (subTabInfo) {
              if (typeof subTabInfo === 'string') {
                await clickInIframe(subTabInfo);
              } else {
                await clickDialogTab(subTabInfo);
              }
              await sleep(settleMs);
            }
          } else {
            // Tabs are Outer, Dots are Inner -> Click Tab first, then click Slide dot!
            if (subTabInfo) {
              if (typeof subTabInfo === 'string') {
                await clickInIframe(subTabInfo);
              } else {
                await clickDialogTab(subTabInfo);
              }
              await sleep(settleMs);
            }
            if (dotSelector) {
              await clickInIframe(dotSelector);
              await waitForDotTransition(targetDotIdx);
              await sleep(settleMs);
            }
          }
        };

        // Helper: Check and capture nested references inside current active state
        const checkAndCaptureNestedRef = async (stateLabel) => {
          try {
            const checkNested = await executeInIframe(`(function() {
              var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                return window.getComputedStyle(d).display !== 'none';
              })[0];
              if (!openDialog) return { hasNestedRef: false, isCurrentDialogRefOrPi: false };
              
              var id = openDialog.id || "";
              var classes = openDialog.className || "";
              var isRefOrPi = (
                id === 'references' || id === 'ref' || id === 'pi' || id === 'isi' || id === 'si' || id === 'bi' ||
                classes.indexOf('references') !== -1 || classes.indexOf('pi') !== -1
              );
              
              var refBtn = openDialog.querySelector('.gotoRef, [data-reftarget]');
              return {
                hasNestedRef: refBtn !== null,
                isCurrentDialogRefOrPi: isRefOrPi
              };
            })()`);
            
            if (checkNested && checkNested.hasNestedRef && !checkNested.isCurrentDialogRefOrPi) {
              updateProgress(`📚 Nested ref in ${stateLabel}...`);
              
              // Click the global bottom navigation references button to perfectly match manual execution
              await clickInIframe('#references');
              await sleep(settleMs);
              
              await captureAndCompileState(`Nested Ref in ${stateLabel}`);
              logLines.push(`📚 [${slide.name}] Nested Ref in ${stateLabel} (${contextLabel})`);
              
              // Close ONLY the references dialog specifically so the parent dialog remains untouched
              updateProgress(`📚 Closing nested reference...`);
              await executeInIframe(`(function() {
                var refDlg = document.querySelector('#references, #ref');
                if (refDlg) {
                  var closeBtn = refDlg.closest('.ui-dialog') ? refDlg.closest('.ui-dialog').querySelector('.ui-dialog-titlebar-close') : null;
                  if (closeBtn) {
                    closeBtn.click();
                  } else {
                    var btn = refDlg.querySelector('.close, .closeBtn, [class*="close"], .dialog-close');
                    if (btn) {
                      btn.click();
                    } else {
                      refDlg.style.display = 'none';
                      var overlay = document.querySelector('.ui-widget-overlay');
                      if (overlay) overlay.style.display = 'none';
                    }
                  }
                }
              })()`);
              await sleep(500);
            }
          } catch (_) {}
        };
        
        // Advanced Dialog Internal Crawler: Discover and click tabs / dots inside the dialog!
        let hasInternalCrawl = false;
        try {
          const navInfo = await executeInIframe(`(function() {
            var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
              return window.getComputedStyle(d).display !== 'none';
            })[0];
            if (!openDialog) return null;
            
            var tabSelectors = [
              '.Page_tabBtn', '.tabBtn', '.tab-btn', '.tab-button',
              '.toptab', '.bottomtab', '.pop3tab', '.tabSwitch',
              '[data-tab]', '[data-num]',
              '[class*="tabBtn"]', '[class*="tab-btn"]', '[class*="Page_tab"]',
              '[class*="bottomtab"]', '[class*="toptab"]', '[class*="pop3tab"]', '[class*="tabSwitch"]'
            ];
            
            var dotSelectors = [
              '.slider_dot', '.dot', '.slick-dots li', '.owl-dot',
              '.swiper-pagination-bullet', '.swiper-pagination span', '.swiper-pagination > *',
              '[class*="slider_dot"]', '[class*="slider-dot"]',
              '[class*="dotActive"]', '[class*="active_dot"]'
            ];
            
            var tabs = [];
            tabSelectors.forEach(function(sel) {
              openDialog.querySelectorAll(sel).forEach(function(el) {
                if (el.classList.contains('gotoSlide') || el.hasAttribute('data-slide')) return;
                var style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                var rect = el.getBoundingClientRect();
                if (rect.width <= 2 || rect.height <= 2) return;
                
                // Exclude parent tab containers/wrappers
                var className = el.className || "";
                var lowerClass = className.toLowerCase();
                if (lowerClass.indexOf('tabs') !== -1 || lowerClass.indexOf('container') !== -1 || lowerClass.indexOf('wrapper') !== -1 || lowerClass.indexOf('switch') !== -1) {
                  if (el.children.length > 1) return;
                }
                
                tabs.push(el);
              });
            });
            
            var dots = [];
            dotSelectors.forEach(function(sel) {
              openDialog.querySelectorAll(sel).forEach(function(el) {
                var style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                var rect = el.getBoundingClientRect();
                if (rect.width <= 1 || rect.height <= 1) return;
                
                // Exclude static text bullets (spans with inner text like •, ·, *, -, o)
                var text = el.innerText.trim();
                if (text === '•' || text === '·' || text === 'o' || text === '*' || text === '-' || text === '▪') return;
                if (text.length > 3) return; // real dots are numbers or empty
                
                dots.push(el);
              });
            });
            
            tabs = Array.from(new Set(tabs));
            dots = Array.from(new Set(dots));
            
            function getUniqueSelector(el) {
              if (el.id) return '#' + el.id;
              var path = [];
              var curr = el;
              while (curr && curr.nodeType === Node.ELEMENT_NODE) {
                var selector = curr.nodeName.toLowerCase();
                if (curr.id) {
                  selector = '#' + curr.id;
                  path.unshift(selector);
                  break;
                }
                if (curr.className) {
                  var classes = Array.from(curr.classList).filter(function(c) {
                    c = c.trim();
                    if (c === '') return false;
                    var lower = c.toLowerCase();
                    return !(
                      lower === 'needsclick' ||
                      lower === 'trackingsubmitted' ||
                      lower.indexOf('active') !== -1 ||
                      lower.indexOf('current') !== -1 ||
                      lower.indexOf('next') !== -1 ||
                      lower.indexOf('prev') !== -1 ||
                      lower.indexOf('disabled') !== -1 ||
                      lower.indexOf('inactive') !== -1 ||
                      lower.indexOf('focus') !== -1 ||
                      /^tab\d+$/.test(lower)
                    );
                  }).join('.');
                  if (classes) selector += '.' + classes;
                }
                var sibling = curr;
                var nth = 1;
                while (sibling = sibling.previousElementSibling) {
                  if (sibling.nodeName === curr.nodeName) nth++;
                }
                selector += ":nth-of-type(" + nth + ")";
                path.unshift(selector);
                curr = curr.parentNode;
              }
              return path.join(' > ');
            }
            
            var tabsAreInner = false;
            if (tabs.length > 0 && dots.length > 0) {
              var firstTab = tabs[0];
              var slideContainer = firstTab.closest('.swiper-slide, .slick-slide, .owl-item, [class*="swiper-slide"], [class*="slick-slide"]');
              if (slideContainer) {
                tabsAreInner = true;
              }
            }
            
            return {
              hasTabs: tabs.length > 0,
              hasDots: dots.length > 0,
              tabsAreInner: tabsAreInner,
              tabs: tabs.map(function(el, idx) {
                return {
                  selector: getUniqueSelector(el),
                  id: el.id || "",
                  dataTab: el.getAttribute('data-tab') || el.getAttribute('data-num') || "",
                  label: el.getAttribute('data-description') || el.innerText.trim() || "SubTab " + (idx + 1)
                };
              }),
              dots: dots.map(function(el, idx) {
                return {
                  selector: getUniqueSelector(el),
                  label: "Page " + (idx + 1)
                };
              })
            };
          })()`);

          if (navInfo) {
            // Case 1: Both exist and Dots are Outer, Tabs are Inner
            if (navInfo.hasTabs && navInfo.hasDots && navInfo.tabsAreInner) {
              hasInternalCrawl = true;
              for (let dIdx = 0; dIdx < navInfo.dots.length; dIdx++) {
                const dot = navInfo.dots[dIdx];
                updateProgress(`🔄 Dialog Slider Page ${dIdx + 1}/${navInfo.dots.length} inside ${label}...`);
                if (dIdx > 0) {
                  await restoreDialogAndOpenDot(dot.selector, null, true, dIdx);
                } else {
                  await clickInIframe(dot.selector);
                  await sleep(settleMs);
                }

                // ── Wait for Swiper transition to fully complete before querying active slide ──
                // After clicking the dot, Swiper's CSS transition (~300ms) may not settle within
                // settleMs. Poll until swiper-slide-active has moved to the expected index (dIdx).
                await executeInIframe(`(function() {
                  return new Promise(function(resolve) {
                    var targetIdx = ${dIdx};
                    var deadline = Date.now() + 1500; // max 1.5s wait
                    function check() {
                      var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                        return window.getComputedStyle(d).display !== 'none';
                      })[0];
                      if (!openDialog) { resolve(); return; }
                      var slides = Array.from(openDialog.querySelectorAll('.swiper-slide'));
                      var activeIdx = slides.findIndex(function(s) { return s.classList.contains('swiper-slide-active'); });
                      if (activeIdx === targetIdx || Date.now() > deadline) {
                        resolve();
                      } else {
                        setTimeout(check, 50);
                      }
                    }
                    check();
                  });
                })()`);

                // Fetch active tabs on this active slide specifically
                const activeTabs = await executeInIframe(`(function() {
                  var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                    return window.getComputedStyle(d).display !== 'none';
                  })[0];
                  if (!openDialog) return [];
                  
                  // Try swiper-slide-active first; fall back to expected slide index (${dIdx}) if transition hasn't settled
                  var activeSlide = openDialog.querySelector('.swiper-slide-active, .slick-active, .owl-item.active, [class*="swiper-slide-active"], [class*="slick-active"]');
                  if (!activeSlide) {
                    var allSlides = openDialog.querySelectorAll('.swiper-slide, .slick-slide, .owl-item');
                    if (allSlides[${dIdx}]) activeSlide = allSlides[${dIdx}];
                  }
                  // Secondary fallback: if active slide has no tabs, try the slide at our target index
                  if (activeSlide) {
                    var hasTabs = activeSlide.querySelectorAll('.pop3tab, [data-num], .tabBtn, .tab-btn, .tab-button').length > 0;
                    if (!hasTabs) {
                      var allSlides = openDialog.querySelectorAll('.swiper-slide, .slick-slide, .owl-item');
                      if (allSlides[${dIdx}]) activeSlide = allSlides[${dIdx}];
                    }
                  }
                  if (!activeSlide) return [];
                  
                  var tabSelectors = [
                    '.Page_tabBtn', '.tabBtn', '.tab-btn', '.tab-button',
                    '.toptab', '.bottomtab', '.pop3tab', '.tabSwitch',
                    '[data-tab]', '[data-num]',
                    '[class*="tabBtn"]', '[class*="tab-btn"]', '[class*="Page_tab"]',
                    '[class*="bottomtab"]', '[class*="toptab"]', '[class*="pop3tab"]', '[class*="tabSwitch"]'
                  ];
                  var tabs = [];
                  tabSelectors.forEach(function(sel) {
                    activeSlide.querySelectorAll(sel).forEach(function(el) {
                      if (el.classList.contains('gotoSlide') || el.hasAttribute('data-slide')) return;
                      var style = window.getComputedStyle(el);
                      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                      var rect = el.getBoundingClientRect();
                      if (rect.width <= 2 || rect.height <= 2) return;
                      
                      // Exclude parent tab containers/wrappers
                      var className = el.className || "";
                      var lowerClass = className.toLowerCase();
                      if (lowerClass.indexOf('tabs') !== -1 || lowerClass.indexOf('container') !== -1 || lowerClass.indexOf('wrapper') !== -1 || lowerClass.indexOf('switch') !== -1) {
                        if (el.children.length > 1) return;
                      }
                      
                      tabs.push(el);
                    });
                  });
                  
                  tabs = Array.from(new Set(tabs));
                  
                  function getUniqueSelector(el) {
                    if (el.id) return '#' + el.id;
                    var path = [];
                    var curr = el;
                    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
                      var selector = curr.nodeName.toLowerCase();
                      if (curr.id) {
                        selector = '#' + curr.id;
                        path.unshift(selector);
                        break;
                      }
                      if (curr.className) {
                        var classes = Array.from(curr.classList).filter(function(c) {
                          c = c.trim();
                          if (c === "") return false;
                          var lower = c.toLowerCase();
                          return !(
                            lower === 'needsclick' ||
                            lower === 'trackingsubmitted' ||
                            lower.indexOf('active') !== -1 ||
                            lower.indexOf('current') !== -1 ||
                            lower.indexOf('next') !== -1 ||
                            lower.indexOf('prev') !== -1 ||
                            lower.indexOf('disabled') !== -1 ||
                            lower.indexOf('inactive') !== -1 ||
                            lower.indexOf('focus') !== -1 ||
                            /^tab\d+$/.test(lower)
                          );
                        }).join('.');
                        if (classes) selector += '.' + classes;
                      }
                      var sibling = curr;
                      var nth = 1;
                      while (sibling = sibling.previousElementSibling) {
                        if (sibling.nodeName === curr.nodeName) nth++;
                      }
                      selector += ":nth-of-type(" + nth + ")";
                      path.unshift(selector);
                      curr = curr.parentNode;
                    }
                    return path.join(' > ');
                  }
                  
                  return tabs.map(function(el, idx) {
                    return {
                      selector: getUniqueSelector(el),
                      id: el.id || "",
                      dataTab: el.getAttribute('data-tab') || el.getAttribute('data-num') || "",
                      label: el.getAttribute('data-description') || el.innerText.trim() || "SubTab " + (idx + 1)
                    };
                  });
                })()`);

                if (activeTabs && activeTabs.length > 0) {
                  for (let tIdx = 0; tIdx < activeTabs.length; tIdx++) {
                    const subTab = activeTabs[tIdx];
                    updateProgress(`🔄 Dialog SubTab ${tIdx + 1}/${activeTabs.length} on Page ${dIdx + 1}: ${subTab.label}...`);
                    if (tIdx > 0) {
                      await restoreDialogAndOpenDot(dot.selector, subTab, true, dIdx);
                    } else {
                      await clickDialogTab(subTab);
                      await sleep(settleMs);
                    }
                    await captureAndCompileState(`Popup: ${label} - Page: ${dIdx + 1} - SubTab: ${subTab.label}`);
                    logLines.push(`💬 [${slide.name}] Dialog: ${label} -> Page ${dIdx + 1} -> SubTab: ${subTab.label}`);
                    await checkAndCaptureNestedRef(`Popup: ${label} - Page: ${dIdx + 1} - SubTab: ${subTab.label}`);
                  }
                } else {
                  await captureAndCompileState(`Popup: ${label} - Page: ${dIdx + 1}`);
                  logLines.push(`💬 [${slide.name}] Dialog: ${label} -> Page ${dIdx + 1}`);
                  await checkAndCaptureNestedRef(`Popup: ${label} - Page: ${dIdx + 1}`);
                }
              }
            }
            // Case 2: Both exist and Tabs are Outer, Dots are Inner
            else if (navInfo.hasTabs && navInfo.hasDots && !navInfo.tabsAreInner) {
              hasInternalCrawl = true;
              for (let tIdx = 0; tIdx < navInfo.tabs.length; tIdx++) {
                const subTab = navInfo.tabs[tIdx];
                updateProgress(`🔄 Dialog SubTab ${tIdx + 1}/${navInfo.tabs.length}: ${subTab.label}...`);
                if (tIdx > 0) {
                  await restoreDialogAndOpenDot(null, subTab);
                } else {
                  await clickDialogTab(subTab);
                  await sleep(settleMs);
                }

                // Fetch active dots on this active tab panel specifically
                const activeDots = await executeInIframe(`(function() {
                  var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                    return window.getComputedStyle(d).display !== 'none';
                  })[0];
                  if (!openDialog) return [];
                  
                  var activePanel = openDialog.querySelector('.tab-panel.active, .tab-content:not(.hidden), .active-panel, [class*="active-panel"]');
                  var container = activePanel ? activePanel : openDialog;
                  
                  var dotSelectors = [
                    '.slider_dot', '.dot', '.slick-dots li', '.owl-dot',
                    '.swiper-pagination-bullet', '.swiper-pagination span', '.swiper-pagination > *',
                    '[class*="slider_dot"]', '[class*="slider-dot"]',
                    '[class*="dotActive"]', '[class*="active_dot"]'
                  ];
                  var dots = [];
                  dotSelectors.forEach(function(sel) {
                    container.querySelectorAll(sel).forEach(function(el) {
                      var style = window.getComputedStyle(el);
                      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;
                      var rect = el.getBoundingClientRect();
                      if (rect.width <= 1 || rect.height <= 1) return;
                      
                      // Exclude static text bullets
                      var text = el.innerText.trim();
                      if (text === '•' || text === '·' || text === 'o' || text === '*' || text === '-' || text === '▪') return;
                      if (text.length > 3) return;
                      
                      dots.push(el);
                    });
                  });
                  
                  dots = Array.from(new Set(dots));
                  
                  function getUniqueSelector(el) {
                    if (el.id) return '#' + el.id;
                    var path = [];
                    var curr = el;
                    while (curr && curr.nodeType === Node.ELEMENT_NODE) {
                      var selector = curr.nodeName.toLowerCase();
                      if (curr.id) {
                        selector = '#' + curr.id;
                        path.unshift(selector);
                        break;
                      }
                      if (curr.className) {
                        var classes = Array.from(curr.classList).filter(function(c) {
                          c = c.trim();
                          if (c === "") return false;
                          var lower = c.toLowerCase();
                          return !(
                            lower === 'needsclick' ||
                            lower === 'trackingsubmitted' ||
                            lower.indexOf('active') !== -1 ||
                            lower.indexOf('current') !== -1 ||
                            lower.indexOf('next') !== -1 ||
                            lower.indexOf('prev') !== -1 ||
                            lower.indexOf('disabled') !== -1 ||
                            lower.indexOf('inactive') !== -1 ||
                            lower.indexOf('focus') !== -1 ||
                            /^tab\d+$/.test(lower)
                          );
                        }).join('.');
                        if (classes) selector += '.' + classes;
                      }
                      var sibling = curr;
                      var nth = 1;
                      while (sibling = sibling.previousElementSibling) {
                        if (sibling.nodeName === curr.nodeName) nth++;
                      }
                      selector += ":nth-of-type(" + nth + ")";
                      path.unshift(selector);
                      curr = curr.parentNode;
                    }
                    return path.join(' > ');
                  }
                  
                  return dots.map(function(el, idx) {
                    return {
                      selector: getUniqueSelector(el),
                      label: "Page " + (idx + 1)
                    };
                  });
                })()`);

                if (activeDots && activeDots.length > 0) {
                  for (let dIdx = 0; dIdx < activeDots.length; dIdx++) {
                    const dot = activeDots[dIdx];
                    updateProgress(`🔄 Dialog Slider Page ${dIdx + 1}/${activeDots.length} on SubTab ${subTab.label}...`);
                    if (dIdx > 0) {
                      await restoreDialogAndOpenDot(dot.selector, subTab, false, dIdx);
                    } else {
                      await clickInIframe(dot.selector);
                      await sleep(settleMs);
                    }
                    await captureAndCompileState(`Popup: ${label} - SubTab: ${subTab.label} - Page: ${dIdx + 1}`);
                    logLines.push(`💬 [${slide.name}] Dialog: ${label} -> SubTab: ${subTab.label} -> Page ${dIdx + 1}`);
                    await checkAndCaptureNestedRef(`Popup: ${label} - SubTab: ${subTab.label} - Page: ${dIdx + 1}`);
                  }
                } else {
                  await captureAndCompileState(`Popup: ${label} - SubTab: ${subTab.label}`);
                  logLines.push(`💬 [${slide.name}] Dialog: ${label} -> SubTab: ${subTab.label}`);
                  await checkAndCaptureNestedRef(`Popup: ${label} - SubTab: ${subTab.label}`);
                }
              }
            }
            // Case 3: Dots only
            else if (navInfo.hasDots) {
              hasInternalCrawl = true;
              for (let dIdx = 0; dIdx < navInfo.dots.length; dIdx++) {
                const dot = navInfo.dots[dIdx];
                updateProgress(`🔄 Dialog Slider Page ${dIdx + 1}/${navInfo.dots.length} inside ${label}...`);
                if (dIdx > 0) {
                  await restoreDialogAndOpenDot(dot.selector, null, false, dIdx);
                } else {
                  await clickInIframe(dot.selector);
                  await sleep(settleMs);
                }
                await captureAndCompileState(`Popup: ${label} - Page: ${dIdx + 1}`);
                logLines.push(`💬 [${slide.name}] Dialog: ${label} -> Page ${dIdx + 1}`);
                await checkAndCaptureNestedRef(`Popup: ${label} - Page: ${dIdx + 1}`);
              }
            }
            // Case 4: Tabs only
            else if (navInfo.hasTabs) {
              hasInternalCrawl = true;
              for (let tIdx = 0; tIdx < navInfo.tabs.length; tIdx++) {
                const subTab = navInfo.tabs[tIdx];
                updateProgress(`🔄 Dialog SubTab ${tIdx + 1}/${navInfo.tabs.length} inside ${label}: ${subTab.label}...`);
                if (tIdx > 0) {
                  await restoreDialogAndOpenDot(null, subTab);
                } else {
                  await clickDialogTab(subTab);
                  await sleep(settleMs);
                }
                await captureAndCompileState(`Popup: ${label} - SubTab: ${subTab.label}`);
                logLines.push(`💬 [${slide.name}] Dialog: ${label} -> SubTab: ${subTab.label}`);
                await checkAndCaptureNestedRef(`Popup: ${label} - SubTab: ${subTab.label}`);
              }
            }
          }
        } catch(err) {
          console.warn("Advanced nested dialog crawler failed:", err);
        }

        // Fallback: If no sub-tabs or dots found inside the open dialog, capture standard state
        if (!hasInternalCrawl) {
          updateProgress(`📸 Capturing popup: ${label}...`);
          await captureAndCompileState(`Popup: ${label}`);
          logLines.push(`💬 [${slide.name}] Dialog: ${label} (${contextLabel})`);
          await checkAndCaptureNestedRef(`Popup: ${label}`);
        }
        
        await closeIframeDialogs();
        await sleep(400);
      }
    }
  };

  try {
    // Ensure clean state to scan tabs
    await ensureAllClosed();
    const tabs = await executeInIframe(`(function() {
      var selectors = [
        '.Page_tabBtn', '.tabBtn', '.tab-btn', '.tab-button',
        '[class*="tabBtn"]', '[class*="tab-btn"]', '[class*="Page_tab"]',
        '.toptab', '.bottomtab', '.pop3tab', '.tabSwitch',
        '[class*="bottomtab"]', '[class*="toptab"]', '[class*="pop3tab"]', '[class*="tabSwitch"]',
        '[data-tab]', '[data-num]',
        '.logClick[class*="tab"]', '.logClick[class*="Tab"]',
        '[class$="tab"]', '[class$="Tab"]',
        '[class*="tab_"]', '[class*="Tab_"]'
      ];
      
      var elements = [];
      selectors.forEach(function(sel) {
        try {
          document.querySelectorAll(sel).forEach(function(el) {
            if (elements.indexOf(el) === -1) elements.push(el);
          });
        } catch(_) {}
      });

      elements = elements.filter(function(el) {
        var style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        var rect = el.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) return false;
        
        // Exclude elements that navigate to another slide (slide navigation, not tab switches)
        if (el.classList.contains('gotoSlide') || el.hasAttribute('data-slide')) return false;
        
        // Exclude large parent tab containers (like .bottomtabs or .toptabs wrappers)
        var className = el.className || "";
        if (className.indexOf('tabs') !== -1 || className.indexOf('Tabs') !== -1) {
          if (el.children.length > 1) return false;
        }
        
        return true;
      });
      
      function getUniqueSelector(el) {
        if (el.id) return '#' + el.id;
        var path = [];
        var curr = el;
        while (curr && curr.nodeType === Node.ELEMENT_NODE) {
          var selector = curr.nodeName.toLowerCase();
          if (curr.id) {
            selector = '#' + curr.id;
            path.unshift(selector);
            break;
          }
          if (curr.className) {
            // Strip dynamic/state classes that change after reload (FastClick 'needsclick',
            // active state 'tabActive', 'tab1'...'tab5', 'active', 'current', 'next', 'prev')
            var classes = Array.from(curr.classList).filter(function(c) {
              c = c.trim();
              if (c === '') return false;
              var lower = c.toLowerCase();
              return !(
                lower === 'needsclick' ||
                lower === 'trackingsubmitted' ||
                lower.indexOf('active') !== -1 ||
                lower.indexOf('current') !== -1 ||
                lower.indexOf('next') !== -1 ||
                lower.indexOf('prev') !== -1 ||
                lower.indexOf('disabled') !== -1 ||
                lower.indexOf('inactive') !== -1 ||
                lower.indexOf('focus') !== -1 ||
                /^tab\d+$/.test(lower)
              );
            }).join('.');
            if (classes) selector += '.' + classes;
          }
          var sibling = curr;
          var nth = 1;
          while (sibling = sibling.previousElementSibling) {
            if (sibling.nodeName === curr.nodeName) nth++;
          }
          selector += ":nth-of-type(" + nth + ")";
          path.unshift(selector);
          curr = curr.parentNode;
        }
        return path.join(' > ');
      }

      return elements.map(function(el) {
        return {
          selector: getUniqueSelector(el),
          id: el.id || "",
          dataTab: el.getAttribute('data-tab') || "",
          dataNum: el.getAttribute('data-num') || "",
          description: el.getAttribute('data-description') || el.innerText || ""
        };
      });
    })()`);

    if (tabs && tabs.length > 0) {
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const label = tab.description || tab.id || `Tab ${i + 1}`;
        
        updateProgress(`🔄 Tab ${i + 1}/${tabs.length}: ${label}...`);
        
        // Set currentTabInfo so activateTabIfNeeded uses data-tab for reliable switching
        currentTabInfo = tab;
        
        // Ensure perfect clean state before switching main slide tabs (reload slide)
        await loadSlideInIframe();
        await sleep(settleMs);
        
        // Use reliable tab activation (data-tab first, then fallback to selector)
        await activateTabIfNeeded(tab.selector);
        
        updateProgress(`📸 Capturing tab base state: ${label}...`);
        await captureAndCompileState(`Tab: ${label}`);
        logLines.push(`🔄 [${slide.name}] Internal Switch: ${label}`);
        
        // Open references/abbreviations of this tab first before scanning popups
        try {
          const hasRef = await executeInIframe(`(function() {
            var ref = document.querySelector('#references');
            if (ref) {
              var isInactive = ref.classList.contains('inactive') || ref.classList.contains('disabled');
              var style = window.getComputedStyle(ref);
              var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
              if (!isInactive && !isHidden) return 'nav';
            }
            var ref2 = document.querySelector('.gotoRef, [data-reftarget]');
            if (!ref2) return false;
            if (ref2.closest('.dialog') || ref2.closest('.ui-dialog')) return false;
            return 'gotoRef';
          })()`);
          
          if (hasRef) {
            updateProgress(`📚 Opening references for tab: ${label}...`);
            const refSelector = hasRef === 'nav' ? '#references' : '.gotoRef, [data-reftarget]';
            await clickInIframe(refSelector);
            await sleep(settleMs);
            
            updateProgress(`📸 Capturing tab references: ${label}...`);
            await captureAndCompileState(`Nested Ref in Tab: ${label}`);
            logLines.push(`📚 [${slide.name}] Nested Ref in Tab: ${label}`);
            
            updateProgress(`📚 Closing tab references...`);
            await closeIframeDialogs();
            await sleep(400);
            
            // Restore tab state before scanning dialog popups
            updateProgress(`🔄 Restoring tab state: ${label}...`);
            await loadSlideInIframe();
            await sleep(settleMs);
            await activateTabIfNeeded(tab.selector);
          }
        } catch (refErr) {
          console.warn(`Failed to capture references for tab ${label}:`, refErr);
        }
        
        // Scan dialog popups specifically while this tab is active
        await scanAndProcessDialogs(`Tab: ${label}`, tab.selector);
      }
    } else {
      // Standard slide (no tabs) -> just scan dialogs normally
      await scanAndProcessDialogs('Base Slide', null);
    }
  } catch (err) {
    console.warn(`Internal switch / dialog scanning failed for ${slide.name} (continuing):`, err);
  }
  
  return { logLines };
}

// ─── Automated Single Slide Crawl (via Live Iframe) ──────────────────────────
btnAutomateSlide.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;
  if (state.currentSlideIndex === -1) return;
  
  const currentSlide = state.slides[state.currentSlideIndex];
  const settleMs = state.sleepMs || 800;
  
  try {
    setCompileUIState(true);
    progressStatusText.innerText = '🔍 Initializing PDF Session...';
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';
    
    // Start session
    await StartPDFSession();
    
    const { logLines } = await automateOneSlideViaIframe(
      currentSlide, state.currentSlideIndex, state.slides.length, settleMs
    );
    
    // Show confirm modal with details before finalizing PDF merge
    setCompileUIState(false);
    
    showConfirmModal(logLines, async () => {
      try {
        setCompileUIState(true);
        progressStatusText.innerText = `📄 Merging and finalizing PDF...`;
        progressPercentage.innerText = '90%';
        progressIndicator.style.width = '90%';
        
        const savePath = await GenerateNextSequentialPDFPath();
        const resultPath = await EndPDFSession(savePath);
        
        progressStatusText.innerHTML = `🎉 Slide compiled: <span style="color: var(--accent-green); font-family: monospace;">${resultPath}</span>`;
        progressPercentage.innerText = '100%';
        progressIndicator.style.width = '100%';
        progressIndicator.style.background = 'var(--accent-green)';
        progressIndicator.style.boxShadow = '0 0 10px var(--accent-green)';
        
        await refreshPDFList();
      } catch (err) {
        console.error('Iframe slide compilation failed:', err);
        progressStatusText.innerHTML = `❌ Failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
        progressIndicator.style.background = 'var(--accent-pink)';
        try { await EndPDFSession(""); } catch(_) {}
      } finally {
        setCompileUIState(false);
      }
    }, async () => {
      progressStatusText.innerText = 'Slide automation cancelled.';
      try { await EndPDFSession(""); } catch(_) {}
    });
    
    // Reload the iframe to restore clean state
    slideIframe.src = currentSlide.url;
    if (window.downloadCrawlerLogs) window.downloadCrawlerLogs();
    
  } catch (err) {
    console.error('Iframe automation failed:', err);
    progressStatusText.innerHTML = `❌ Failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
    setCompileUIState(false);
    try { await EndPDFSession(""); } catch(_) {}
    if (window.downloadCrawlerLogs) window.downloadCrawlerLogs();
  }
});

// ─── Automated Full Deck Crawl (via Live Iframe) ─────────────────────────────
// Loops through ALL slides, automating each one via the iframe, then compiles to deck PDF
btnAutomate.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;
  
  const settleMs = state.sleepMs || 800;
  
  try {
    setCompileUIState(true);
    progressStatusText.innerText = `🚀 Starting deck automation (${state.slides.length} slides)...`;
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';
    
    // Start session
    await StartPDFSession();
    
    const allLogLines = [];
    
    // Process each slide sequentially via the iframe
    for (let slideIdx = 0; slideIdx < state.slides.length; slideIdx++) {
      const slide = state.slides[slideIdx];
      
      progressStatusText.innerText = `[${slideIdx + 1}/${state.slides.length}] Processing ${slide.name}...`;
      const pct = Math.round((slideIdx / state.slides.length) * 90);
      progressPercentage.innerText = `${pct}%`;
      progressIndicator.style.width = `${pct}%`;
      
      try {
        const { logLines } = await automateOneSlideViaIframe(
          slide, slideIdx, state.slides.length, settleMs
        );
        allLogLines.push(...logLines);
      } catch (err) {
        console.warn(`Failed to automate slide ${slide.name}, skipping:`, err);
        allLogLines.push(`⚠️ [${slide.name}] Skipped (error: ${err.message || err})`);
      }
    }
    
    progressStatusText.innerText = `📄 Merging deck pages...`;
    progressPercentage.innerText = '95%';
    progressIndicator.style.width = '95%';
    
    const savePath = await GenerateDeckAutoSavePath();
    const resultPath = await EndPDFSession(savePath);
    
    progressStatusText.innerHTML = `🎉 Deck compiled: <span style="color: var(--accent-green); font-family: monospace;">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-green)';
    
    await refreshPDFList();
    
    // Restore to first slide
    if (state.slides.length > 0) {
      slideIframe.src = state.slides[0].url;
    }
    if (window.downloadCrawlerLogs) window.downloadCrawlerLogs();
    
  } catch (err) {
    console.error('Iframe deck automation failed:', err);
    progressStatusText.innerHTML = `❌ Failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
    setCompileUIState(false);
    try { await EndPDFSession(""); } catch(_) {}
    if (window.downloadCrawlerLogs) window.downloadCrawlerLogs();
  }
});

// ─── IDML Export (Kept as-is) ────────────────────────────────────────────────
btnIdml.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;

  let defaultName = 'Editable_Presentation.idml';

  try {
    const savePath = await SelectIDMLSavePath(defaultName);
    if (!savePath) return;

    setCompileUIState(true);
    progressStatusText.innerText = 'Extracting DOM vector coordinates...';
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';

    const jobs = state.slides.map((slide) => ({
      slideName: slide.name,
      folderName: slide.folderName,
      url: slide.url,
      customHtml: ''
    }));

    const resultPath = await CompileSlidesToIDML(jobs, savePath, state.sleepMs);

    progressStatusText.innerHTML = `🎉 IDML exported: <span style="color: var(--accent-green); font-family: monospace;">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
  } catch (err) {
    console.error('IDML export failed:', err);
    progressStatusText.innerHTML = `❌ IDML failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
  } finally {
    setCompileUIState(false);
  }
});

// ─── Compile UI State Helper ─────────────────────────────────────────────────
function setCompileUIState(compiling) {
  state.isCompiling = compiling;
  if (compiling) {
    btnCompile.setAttribute('disabled', 'true');
    btnScreenshot.setAttribute('disabled', 'true');
    btnIdml.setAttribute('disabled', 'true');
    btnAutomate.setAttribute('disabled', 'true');
    btnAutomateSlide.setAttribute('disabled', 'true');
    btnSelectDir.setAttribute('disabled', 'true');
    progressArea.style.display = 'flex';
    progressIndicator.style.background = '';
    progressIndicator.style.boxShadow = '';
  } else {
    btnCompile.removeAttribute('disabled');
    btnScreenshot.removeAttribute('disabled');
    btnIdml.removeAttribute('disabled');
    btnAutomate.removeAttribute('disabled');
    btnAutomateSlide.removeAttribute('disabled');
    btnSelectDir.removeAttribute('disabled');
  }
}

// ─── PDF List Management ─────────────────────────────────────────────────────
async function refreshPDFList() {
  try {
    // 1. Load single slide PDFs
    const pdfs = await ListCompiledPDFs();
    state.compiledPDFs = pdfs;
    pdfCount.innerText = pdfs.length;
    renderPDFList();

    // 2. Load combined decks
    const decks = await ListCombinedDecks();
    state.combinedDecks = decks;
    deckCount.innerText = decks.length;
    renderCombinedDeckList();

    // 3. Toggle Combine button availability
    if (pdfs.length > 1) {
      btnCombinePdf.removeAttribute('disabled');
    } else {
      btnCombinePdf.setAttribute('disabled', 'true');
    }
  } catch (err) {
    console.error('Failed to list PDFs:', err);
  }
}

// Self-healing fallback: aggressively ensure the Combine button is unlocked ONLY if 2 or more slide PDFs exist (>= 2)
setInterval(() => {
  const items = document.querySelectorAll('#pdf-list .pdf-item');
  const btn = document.querySelector('#btn-combine-pdf');
  if (btn) {
    if (items.length > 1 || (state.compiledPDFs && state.compiledPDFs.length > 1)) {
      btn.removeAttribute('disabled');
    } else {
      btn.setAttribute('disabled', 'true');
    }
  }
}, 500);

function renderCombinedDeckList() {
  if (state.combinedDecks.length === 0) {
    deckList.innerHTML = '<div class="pdf-empty">No combined decks created yet.</div>';
    return;
  }
  
  deckList.innerHTML = '';
  state.combinedDecks.forEach((pdf) => {
    const item = document.createElement('div');
    item.className = 'pdf-item';
    item.style.borderLeft = '3px solid #00f2fe';
    
    const sizeStr = formatFileSize(pdf.size);
    
    item.innerHTML = `
      <div class="pdf-item-icon">📚</div>
      <div class="pdf-item-info">
        <div class="pdf-item-name" style="font-weight: 600; color: #00f2fe; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${pdf.name}</div>
        <div class="pdf-item-meta">${sizeStr}</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; z-index: 10;">
        <button class="pdf-item-info-btn" title="View PDF Metadata" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); font-size: 0.95rem; cursor: pointer; padding: 6px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; color: var(--text-muted);">ℹ️</button>
        <button class="pdf-item-delete" title="Delete">🗑️</button>
      </div>
    `;
    
    // Hover effects for the info button
    const infoBtn = item.querySelector('.pdf-item-info-btn');
    infoBtn.addEventListener('mouseenter', () => {
      infoBtn.style.background = 'rgba(0, 242, 254, 0.15)';
      infoBtn.style.color = '#00f2fe';
    });
    infoBtn.addEventListener('mouseleave', () => {
      infoBtn.style.background = 'rgba(255,255,255,0.05)';
      infoBtn.style.color = 'var(--text-muted)';
    });

    // Click to view PDF
    item.addEventListener('click', (e) => {
      if (e.target.closest('.pdf-item-delete') || e.target.closest('.pdf-item-info-btn')) return;
      openPDFViewer(pdf);
    });

    // Info button click
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMetadataModal(pdf);
    });
    
    // Delete button (optimistic UI update!)
    item.querySelector('.pdf-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        state.combinedDecks = state.combinedDecks.filter(p => p.name !== pdf.name);
        deckCount.innerText = state.combinedDecks.length;
        renderCombinedDeckList();

        await DeleteCompiledPDF(pdf.name);
        
        setTimeout(async () => {
          await refreshPDFList();
        }, 150);
      } catch (err) {
        console.error('Failed to delete combined PDF:', err);
        await refreshPDFList();
      }
    });
    
    deckList.appendChild(item);
  });
}

// ─── PDF Combination Event Listener ─────────────────────────────────────────
btnCombinePdf.addEventListener('click', async () => {
  try {
    setCompileUIState(true);
    progressStatusText.innerHTML = '🔗 Combining all compiled slide PDFs into a single full deck...';
    progressIndicator.style.width = '45%';
    progressPercentage.innerText = '45%';

    await CombineCompiledPDFs();

    progressStatusText.innerHTML = '🎉 Full presentation deck combined successfully!';
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';

    setTimeout(async () => {
      setCompileUIState(false);
      await refreshPDFList();
    }, 1500);
  } catch (err) {
    console.error('Failed to combine PDFs:', err);
    progressStatusText.innerHTML = `❌ Combination failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
    setCompileUIState(false);
  }
});

function renderPDFList() {
  if (state.compiledPDFs.length === 0) {
    pdfList.innerHTML = '<div class="pdf-empty">No PDFs compiled yet.<br/>Compile slides to see them here.</div>';
    return;
  }
  
  pdfList.innerHTML = '';
  state.compiledPDFs.forEach((pdf) => {
    const item = document.createElement('div');
    item.className = 'pdf-item';
    
    const sizeStr = formatFileSize(pdf.size);
    
    item.innerHTML = `
      <div class="pdf-item-icon">📄</div>
      <div class="pdf-item-info">
        <div class="pdf-item-name">${pdf.name}</div>
        <div class="pdf-item-meta">${sizeStr}</div>
      </div>
      <div style="display: flex; gap: 8px; align-items: center; z-index: 10;">
        <button class="pdf-item-info-btn" title="View PDF Metadata" style="background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); font-size: 0.95rem; cursor: pointer; padding: 6px; border-radius: 8px; display: flex; align-items: center; justify-content: center; transition: all 0.2s; color: var(--text-muted);">ℹ️</button>
        <button class="pdf-item-delete" title="Delete">🗑️</button>
      </div>
    `;
    
    // Hover effects for the info button
    const infoBtn = item.querySelector('.pdf-item-info-btn');
    infoBtn.addEventListener('mouseenter', () => {
      infoBtn.style.background = 'rgba(0, 242, 254, 0.15)';
      infoBtn.style.color = '#00f2fe';
    });
    infoBtn.addEventListener('mouseleave', () => {
      infoBtn.style.background = 'rgba(255,255,255,0.05)';
      infoBtn.style.color = 'var(--text-muted)';
    });

    // Click to view PDF
    item.addEventListener('click', (e) => {
      if (e.target.closest('.pdf-item-delete') || e.target.closest('.pdf-item-info-btn')) return;
      openPDFViewer(pdf);
    });

    // Info button click
    infoBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openMetadataModal(pdf);
    });
    
    // Delete button
    item.querySelector('.pdf-item-delete').addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        // 1. Optimistic UI update: instantly hide from list
        state.compiledPDFs = state.compiledPDFs.filter(p => p.name !== pdf.name);
        pdfCount.innerText = state.compiledPDFs.length;
        renderPDFList();

        // 2. Perform file deletion in the backend
        await DeleteCompiledPDF(pdf.name);
        
        // 3. Settle delay: wait 150ms for Windows OS filesystem indexing to catch up
        setTimeout(async () => {
          await refreshPDFList();
        }, 150);
      } catch (err) {
        console.error('Failed to delete PDF:', err);
        // Rollback state if backend fails
        await refreshPDFList();
      }
    });
    
    pdfList.appendChild(item);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function openMetadataModal(pdf) {
  const metadataViewer = document.querySelector('#metadata-viewer');
  const metadataContent = document.querySelector('#metadata-content');
  const btnCloseMetadata = document.querySelector('#btn-close-metadata');

  let html = '';
  try {
    const meta = JSON.parse(pdf.metadata || '{}');
    if (Array.isArray(meta)) {
      // ─── RENDER COMBINED DECK SLIDES ACCORDION INDEX ────────────────────
      const totalPages = meta.length;
      const presentationId = meta[0]?.presentationId || 'Combined Deck';
      
      const getBadgeColor = (type) => {
        switch (type) {
          case 'slide': return 'linear-gradient(135deg, #4facfe, #00f2fe)';
          case 'popup': return 'linear-gradient(135deg, var(--accent-pink), var(--accent-purple))';
          case 'shared_on_slide': return 'linear-gradient(135deg, #a18cd1, #fbc2eb)';
          case 'shared_on_popup': return 'linear-gradient(135deg, #f6d365, #fda085)';
          default: return '#555';
        }
      };

      const getSharedBadgeColor = (sharedType) => {
        switch (sharedType) {
          case 'ref': return 'linear-gradient(135deg, #11998e, #38ef7d)';
          case 'pi': return 'linear-gradient(135deg, #f857a6, #ff5858)';
          case 'isi': return 'linear-gradient(135deg, #f12711, #f5af19)';
          case 'si': return 'linear-gradient(135deg, #e65c00, #F9D423)';
          case 'email': return 'linear-gradient(135deg, #ee9ca7, #ffdde1)';
          case 'menu': return 'linear-gradient(135deg, #2193b0, #6dd5ed)';
          case 'flow': return 'linear-gradient(135deg, #00c6ff, #0072ff)';
          case 'fragment': return 'linear-gradient(135deg, #e0c3fc, #8ec5fc)';
          default: return 'linear-gradient(135deg, #b19ffb, #7026ff)';
        }
      };

      html = `
        <div class="metadata-info-card" style="border-left: 4px solid #00f2fe; background: rgba(0, 242, 254, 0.02);">
          <div class="metadata-card-label" style="color: #00f2fe;">Combined Presentation Deck</div>
          <div class="metadata-card-value highlight-blue" style="font-size: 1.15rem; font-weight: 700;">${presentationId}</div>
          <div style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 4px; font-weight: 500;">Stitched Pages: <span style="color: #fff; font-weight: 700;">${totalPages} slices</span></div>
        </div>
        
        <div style="margin-top: 14px; margin-bottom: 6px; font-weight: 700; color: var(--text-light); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px;">Chronological Page Index</div>
        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${meta.map((page, idx) => `
            <div style="background: rgba(255,255,255,0.015); border: 1px solid rgba(255,255,255,0.04); border-radius: 12px; padding: 14px 18px; display: flex; flex-direction: column; gap: 8px;">
              <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03); padding-bottom: 6px;">
                <span style="font-size: 0.85rem; font-weight: 700; color: #fff;">
                  📄 ${page.startPage && page.endPage ? (page.startPage === page.endPage ? `Page ${page.startPage}` : `Pages ${page.startPage} - ${page.endPage}`) : `Page ${idx + 1}`}
                </span>
                <span style="background: ${getBadgeColor(page.type)}; padding: 3px 10px; border-radius: 20px; font-size: 0.65rem; font-weight: 700; color: #080c14; text-transform: uppercase; letter-spacing: 0.5px;">${page.type.replace(/_/g, ' ')}</span>
              </div>
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <div style="font-size: 0.82rem; color: var(--text-light); font-weight: 600;">Slide: <span style="font-family: monospace; color: var(--accent-cyan); font-weight: normal;">${page.slideName}</span></div>
                <div style="font-size: 0.78rem; color: var(--text-muted);">Folder: <span style="font-family: monospace;">${page.folderName}</span></div>
              </div>
              ${page.sharedType ? `
                <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(255,255,255,0.02); padding: 6px 12px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.02);">
                  <span style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600;">Active Overlay</span>
                  <span style="background: ${getSharedBadgeColor(page.sharedType)}; padding: 3px 8px; border-radius: 6px; font-size: 0.65rem; font-weight: 700; color: #080c14; text-transform: uppercase;">${page.sharedType}</span>
                </div>
              ` : ''}
              ${page.openPopups && page.openPopups.length > 0 ? `
                <div style="font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); font-weight: 600; margin-top: 2px;">Active Popups Stack (${page.openPopups.length})</div>
                <div style="display: flex; flex-direction: column; gap: 6px;">
                  ${page.openPopups.map(p => `
                    <div style="background: rgba(255,255,255,0.005); border-left: 2px solid ${p.type === 'slide_popup' ? 'var(--accent-pink)' : '#00f2fe'}; padding: 4px 10px; font-size: 0.75rem; font-family: monospace; color: var(--text-light); display: flex; justify-content: space-between;">
                      <span>#${p.id || 'dialog'}</span>
                      <span style="color: var(--text-muted); font-size: 0.68rem;">z: ${p.zIndex} (${p.type})</span>
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    } else if (!meta.presentationId) {
      html = `<div style="text-align: center; color: var(--text-muted); padding: 24px; font-family: 'Plus Jakarta Sans', sans-serif;">No structured compilation metadata found inside this PDF.</div>`;
    } else {
      const getBadgeColor = (type) => {
        switch (type) {
          case 'slide': return 'linear-gradient(135deg, #4facfe, #00f2fe)';
          case 'popup': return 'linear-gradient(135deg, var(--accent-pink), var(--accent-purple))';
          case 'shared_on_slide': return 'linear-gradient(135deg, #a18cd1, #fbc2eb)';
          case 'shared_on_popup': return 'linear-gradient(135deg, #f6d365, #fda085)';
          default: return '#555';
        }
      };

      const getSharedBadgeColor = (sharedType) => {
        switch (sharedType) {
          case 'ref': return 'linear-gradient(135deg, #11998e, #38ef7d)';
          case 'pi': return 'linear-gradient(135deg, #f857a6, #ff5858)';
          case 'isi': return 'linear-gradient(135deg, #f12711, #f5af19)';
          case 'si': return 'linear-gradient(135deg, #e65c00, #F9D423)';
          case 'email': return 'linear-gradient(135deg, #ee9ca7, #ffdde1)';
          case 'menu': return 'linear-gradient(135deg, #2193b0, #6dd5ed)';
          case 'flow': return 'linear-gradient(135deg, #00c6ff, #0072ff)';
          case 'fragment': return 'linear-gradient(135deg, #e0c3fc, #8ec5fc)';
          default: return 'linear-gradient(135deg, #b19ffb, #7026ff)';
        }
      };

      html = `
        <div class="metadata-info-card">
          <div class="metadata-card-label">Presentation ID</div>
          <div class="metadata-card-value highlight-blue">${meta.presentationId}</div>
        </div>
        <div class="metadata-info-card">
          <div class="metadata-card-label">Slide Number (Name)</div>
          <div class="metadata-card-value">${meta.slideName}</div>
        </div>
        <div class="metadata-info-card">
          <div class="metadata-card-label">Folder Name</div>
          <div class="metadata-card-value" style="font-family: monospace;">${meta.folderName}</div>
        </div>
        <div class="metadata-info-card">
          <div class="metadata-row">
            <span class="metadata-card-label" style="letter-spacing: 0.8px;">Compile Type</span>
            <span style="background: ${getBadgeColor(meta.type)}; padding: 5px 12px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; color: #080c14; text-transform: uppercase; letter-spacing: 0.8px;">${meta.type.replace(/_/g, ' ')}</span>
          </div>
        </div>
        ${meta.sharedType ? `
        <div class="metadata-info-card">
          <div class="metadata-row">
            <span class="metadata-card-label" style="letter-spacing: 0.8px;">Shared Popup Type</span>
            <span style="background: ${getSharedBadgeColor(meta.sharedType)}; padding: 5px 12px; border-radius: 20px; font-size: 0.72rem; font-weight: 700; color: #080c14; text-transform: uppercase; letter-spacing: 0.8px;">${meta.sharedType}</span>
          </div>
        </div>
        ` : ''}
        ${meta.parentPopup ? `
        <div class="metadata-info-card">
          <div class="metadata-card-label">Parent Slide Popup</div>
          <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 2px;">
            <div style="font-size: 0.85rem; color: var(--accent-pink); font-weight: 600;">ID: <span style="font-family: monospace; color: var(--text-light); font-weight: normal; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${meta.parentPopup.id || 'N/A'}</span></div>
            <div style="font-size: 0.8rem; color: var(--text-muted); word-break: break-all; font-family: monospace;">Class: ${meta.parentPopup.className || 'N/A'}</div>
          </div>
        </div>
        ` : ''}
        <div class="metadata-info-card">
          <div class="metadata-card-label">Compiled Time</div>
          <div class="metadata-card-value" style="font-size: 0.85rem; color: var(--text-muted); font-weight: normal;">${new Date(meta.timestamp).toLocaleString()}</div>
        </div>
      `;

      if (meta.openPopups && meta.openPopups.length > 0) {
        html += `
          <div style="margin-top: 8px; font-weight: 700; color: var(--text-light); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 6px; margin-bottom: 4px;">Active Popups Stack (${meta.openPopups.length})</div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${meta.openPopups.map((p, idx) => `
              <div style="background: rgba(255,255,255,0.01); border: 1px solid rgba(255,255,255,0.03); border-left: 4px solid ${p.type === 'slide_popup' ? 'var(--accent-pink)' : '#00f2fe'}; border-radius: 0 8px 8px 0; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px;">
                <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.85rem; font-weight: 600;">
                  <span style="color: var(--text-light); font-family: monospace;">#${p.id || 'Unnamed Element'}</span>
                  <span style="background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 6px; color: var(--text-muted); font-size: 0.7rem; font-family: monospace;">z: ${p.zIndex}</span>
                </div>
                ${p.className ? `<div style="font-size: 0.75rem; color: var(--text-muted); word-break: break-all; font-family: monospace; line-height: 1.3;">.${p.className.trim().replace(/\s+/g, '.')}</div>` : ''}
                <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 500; text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px;">Role: <span style="color: ${p.type === 'slide_popup' ? 'var(--accent-pink)' : '#00f2fe'}; font-weight: 700;">${p.type.replace(/_/g, ' ')}</span></div>
              </div>
            `).join('')}
          </div>
        `;
      }
    }
  } catch (err) {
    html = `<div style="text-align: center; color: var(--accent-pink); padding: 24px; font-family: 'Plus Jakarta Sans', sans-serif;">Failed to parse compiled metadata block: ${err.message}</div>`;
  }

  metadataContent.innerHTML = html;
  metadataViewer.style.display = 'flex';

  const closeHandler = () => {
    metadataViewer.style.display = 'none';
    btnCloseMetadata.removeEventListener('click', closeHandler);
  };
  btnCloseMetadata.addEventListener('click', closeHandler);
}

// ─── PDF Viewer ──────────────────────────────────────────────────────────────
function openPDFViewer(pdf) {
  const idx = state.compiledPDFs.findIndex(p => p.name === pdf.name);
  state.currentViewerPDFIndex = idx;

  pdfViewerTitleText.innerText = pdf.name;
  pdfViewerFrame.src = pdf.serveUrl;
  pdfViewer.style.display = 'flex';

  updatePDFViewerNavigation();
}

function updatePDFViewerNavigation() {
  const btnPdfPrev = document.querySelector('#btn-pdf-prev');
  const btnPdfNext = document.querySelector('#btn-pdf-next');
  const pdfViewerCounter = document.querySelector('#pdf-viewer-counter');

  if (state.currentViewerPDFIndex === -1 || state.compiledPDFs.length === 0) {
    btnPdfPrev.setAttribute('disabled', 'true');
    btnPdfNext.setAttribute('disabled', 'true');
    pdfViewerCounter.innerText = '0 / 0';
    return;
  }

  pdfViewerCounter.innerText = `${state.currentViewerPDFIndex + 1} / ${state.compiledPDFs.length}`;

  if (state.currentViewerPDFIndex <= 0) {
    btnPdfPrev.setAttribute('disabled', 'true');
  } else {
    btnPdfPrev.removeAttribute('disabled');
  }

  if (state.currentViewerPDFIndex >= state.compiledPDFs.length - 1) {
    btnPdfNext.setAttribute('disabled', 'true');
  } else {
    btnPdfNext.removeAttribute('disabled');
  }
}

document.querySelector('#btn-pdf-prev').addEventListener('click', () => {
  if (state.currentViewerPDFIndex > 0) {
    const prevPdf = state.compiledPDFs[state.currentViewerPDFIndex - 1];
    openPDFViewer(prevPdf);
  }
});

document.querySelector('#btn-pdf-next').addEventListener('click', () => {
  if (state.currentViewerPDFIndex < state.compiledPDFs.length - 1) {
    const nextPdf = state.compiledPDFs[state.currentViewerPDFIndex + 1];
    openPDFViewer(nextPdf);
  }
});

btnCloseViewer.addEventListener('click', () => {
  pdfViewer.style.display = 'none';
  pdfViewerFrame.src = '';
  state.currentViewerPDFIndex = -1;
});

// Close viewer on Escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pdfViewer.style.display !== 'none') {
    pdfViewer.style.display = 'none';
    pdfViewerFrame.src = '';
  }
});

// ─── Backend Progress Events ─────────────────────────────────────────────────
EventsOn('compilation_progress', (data) => {
  if (!state.isCompiling) return;
  
  const percentage = Math.round((data.current / data.total) * 100);
  
  if (data.phase === 'crawling') {
    progressStatusText.innerHTML = `Crawling Slide <span>${data.current}/${data.total}</span> (${data.slide}): <span style="color: var(--accent-cyan); font-weight: bold;">${data.detail}</span>`;
    const curProgress = percentage * 0.9;
    progressIndicator.style.width = `${curProgress}%`;
    progressPercentage.innerText = `${Math.round(curProgress)}%`;
  } else if (data.phase === 'rendering') {
    progressStatusText.innerHTML = `Rendering <span>${data.current}/${data.total}</span>: <span>${data.slide}</span>`;
    progressIndicator.style.width = `${percentage * 0.9}%`;
    progressPercentage.innerText = `${Math.round(percentage * 0.9)}%`;
  } else if (data.phase === 'merging') {
    progressStatusText.innerHTML = 'Merging slide pages...';
    progressIndicator.style.width = '95%';
    progressPercentage.innerText = '95%';
  }
});
