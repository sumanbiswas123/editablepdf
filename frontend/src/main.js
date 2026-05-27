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
  CombineCompiledPDFs
} from '../wailsjs/go/main/App';

import { EventsOn } from '../wailsjs/runtime/runtime';

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
    </div>
  </div>
`;

// ─── DOM Selectors ───────────────────────────────────────────────────────────
const btnSelectDir = document.querySelector('#btn-select-dir');
const btnCompile = document.querySelector('#btn-compile');
const btnScreenshot = document.querySelector('#btn-screenshot');
const btnIdml = document.querySelector('#btn-idml');
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
      loadSlide(0);
    } else {
      slideList.innerHTML = '<div class="slide-empty">No slide subfolders found.</div>';
      btnCompile.setAttribute('disabled', 'true');
      btnScreenshot.setAttribute('disabled', 'true');
      btnIdml.setAttribute('disabled', 'true');
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
  
  // Load slide URL
  slideIframe.src = slide.url;
}

// ─── Cross-Origin Navigation Listener ────────────────────────────────────────
// Captures secure postMessage slide navigation alerts sent by our bridge script inside the iframe.
// This completely bypasses CORS restrictions and eliminates layout/indexing race conditions!
window.addEventListener('message', (e) => {
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
    btnSelectDir.setAttribute('disabled', 'true');
    progressArea.style.display = 'flex';
    progressIndicator.style.background = '';
    progressIndicator.style.boxShadow = '';
  } else {
    btnCompile.removeAttribute('disabled');
    btnScreenshot.removeAttribute('disabled');
    btnIdml.removeAttribute('disabled');
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
  
  if (data.phase === 'rendering') {
    progressStatusText.innerHTML = `Rendering <span>${data.current}/${data.total}</span>: <span>${data.slide}</span>`;
    progressIndicator.style.width = `${percentage * 0.9}%`;
    progressPercentage.innerText = `${Math.round(percentage * 0.9)}%`;
  } else if (data.phase === 'merging') {
    progressStatusText.innerHTML = 'Merging slide pages...';
    progressIndicator.style.width = '95%';
    progressPercentage.innerText = '95%';
  }
});
