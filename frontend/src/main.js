import './style.css';
import './app.css';

import {
  SelectDirectory,
  ScanAndStartServer,
  CompileSlidesToPDF,
  SelectSavePath,
  SelectScreenshotSavePath,
  CompileScreenshot,
  CompileSlidesToIDML,
  SelectIDMLSavePath
} from '../wailsjs/go/main/App';

import { EventsOn } from '../wailsjs/runtime/runtime';

// App State
let state = {
  rootDirectory: '',
  slides: [],
  currentSlideIndex: -1,
  customStates: {}, // slideFolderName -> outerHTML string
  isCompiling: false,
  sleepMs: 800
};

// Scaffold main HTML shell
document.querySelector('#app').innerHTML = `
  <!-- Sidebar -->
  <div class="sidebar">
    <div class="brand-section">
      <div class="brand-logo">P</div>
      <div class="brand-title">eDA PDF compiler</div>
    </div>
    
    <button class="action-btn" id="btn-select-dir">
      📁 Select Presentation Folder
    </button>
    
    <!-- Settings Panel -->
    <div class="settings-box">
      <div class="settings-title">Render Settings</div>
      
      <div class="setting-row">
        <label>Settle Delay: <span id="sleep-val">800ms</span></label>
        <input type="range" id="input-sleep" min="300" max="3000" step="100" value="800" />
      </div>
      
      <div class="setting-row">
        <label>Default Output Name</label>
        <input type="text" id="input-output-name" value="Editable_Presentation.pdf" placeholder="e.g. Campaign.pdf" />
      </div>
    </div>
    
    <div class="slide-list-header">Slides Deck</div>
    <div class="slide-list-container" id="slide-list">
      <div class="welcome-desc" style="font-size: 13px; text-align: center; margin-top: 20px;">
        No presentation directory loaded.
      </div>
    </div>
  </div>

  <!-- Workspace -->
  <div class="workspace">
    <!-- Top Header -->
    <div class="header">
      <div class="dir-path" id="dir-path-display">No directory selected</div>
      <div class="dir-path" id="slides-count-display">0 Slides Discovered</div>
    </div>
    
    <!-- Canvas area -->
    <div class="canvas-container">
      <!-- Welcome overlay -->
      <div class="welcome-overlay" id="welcome-view">
        <div class="welcome-icon">✨</div>
        <div class="welcome-title">Interactive HTML eDA PDF Compiler</div>
        <div class="welcome-desc">
          Select an eDA campaign folder containing slide subfolders (like _001, _002, etc.) and a sibling "shared" assets folder to begin.
        </div>
      </div>
      
      <!-- Floating Iframe Controls overlay -->
      <div class="floating-controls" id="floating-toolbar" style="display: none;">
        <button class="nav-btn" id="btn-prev">👈 Prev</button>
        <div class="nav-divider"></div>
        <button class="btn-pill btn-capture" id="btn-capture-state">✨ Capture Popup State</button>
        <button class="btn-pill btn-reset" id="btn-reset-state">🧹 Reset</button>
        <div class="nav-divider"></div>
        <button class="nav-btn" id="btn-next">Next 👉</button>
      </div>
      
      <!-- 1024x768px Locked Slide Frame -->
      <div class="canvas-frame" id="canvas-frame" style="display: none;">
        <iframe id="slide-iframe"></iframe>
      </div>
    </div>
    
    <!-- Bottom Compile Bar -->
    <div class="bottom-bar">
      <!-- Progress Bar -->
      <div class="progress-section" id="progress-area">
        <div class="progress-info">
          <div id="progress-status-text">Preparing renderer...</div>
          <div id="progress-percentage">0%</div>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="progress-indicator"></div>
        </div>
      </div>
      
      <div style="display: flex; gap: 12px; margin-left: auto;">
        <button class="compile-btn" id="btn-idml" style="background: linear-gradient(135deg, #00f2fe, #4facfe); box-shadow: 0 4px 20px rgba(79, 172, 254, 0.35);" disabled>
          📁 Export to IDML
        </button>
        <button class="compile-btn" id="btn-screenshot" style="background: linear-gradient(135deg, var(--accent-pink), var(--accent-purple)); box-shadow: 0 4px 20px rgba(255, 121, 198, 0.35);" disabled>
          📄 Compile Slide PDF
        </button>
        <button class="compile-btn" id="btn-compile" disabled>
          🚀 Compile Entire Deck
        </button>
      </div>
    </div>
  </div>
`;

// DOM Selectors
const btnSelectDir = document.querySelector('#btn-select-dir');
const btnCompile = document.querySelector('#btn-compile');
const btnScreenshot = document.querySelector('#btn-screenshot');
const btnIdml = document.querySelector('#btn-idml');
const inputSleep = document.querySelector('#input-sleep');
const sleepVal = document.querySelector('#sleep-val');
const inputOutputName = document.querySelector('#input-output-name');
const slideList = document.querySelector('#slide-list');
const dirPathDisplay = document.querySelector('#dir-path-display');
const slidesCountDisplay = document.querySelector('#slides-count-display');
const welcomeView = document.querySelector('#welcome-view');
const canvasFrame = document.querySelector('#canvas-frame');
const slideIframe = document.querySelector('#slide-iframe');
const floatingToolbar = document.querySelector('#floating-toolbar');
const btnPrev = document.querySelector('#btn-prev');
const btnNext = document.querySelector('#btn-next');
const btnCaptureState = document.querySelector('#btn-capture-state');
const btnResetState = document.querySelector('#btn-reset-state');
const progressArea = document.querySelector('#progress-area');
const progressStatusText = document.querySelector('#progress-status-text');
const progressPercentage = document.querySelector('#progress-percentage');
const progressIndicator = document.querySelector('#progress-indicator');

// Listen to slide load & settle delay slider
inputSleep.addEventListener('input', (e) => {
  state.sleepMs = parseInt(e.target.value, 10);
  sleepVal.innerText = `${state.sleepMs}ms`;
});

// Event: Select Directory
btnSelectDir.addEventListener('click', async () => {
  try {
    const dir = await SelectDirectory();
    if (dir) {
      loadDirectory(dir);
    }
  } catch (err) {
    console.error('Directory selection failed:', err);
  }
});

// Load and scan directory
async function loadDirectory(dirPath) {
  try {
    dirPathDisplay.innerHTML = `Loading: <span>${dirPath}</span>`;
    const result = await ScanAndStartServer(dirPath);
    
    state.rootDirectory = result.parentPath;
    state.slides = result.slides;
    state.customStates = {}; // Clear previous states
    state.currentSlideIndex = -1;
    
    dirPathDisplay.innerHTML = `Folder: <span>${state.rootDirectory}</span>`;
    slidesCountDisplay.innerText = `${state.slides.length} Slides Discovered`;
    
    if (state.slides.length > 0) {
      renderSlideList();
      btnCompile.removeAttribute('disabled');
      btnScreenshot.removeAttribute('disabled');
      btnIdml.removeAttribute('disabled');
      // Load first slide
      loadSlide(0);
    } else {
      slideList.innerHTML = `<div class="welcome-desc" style="font-size: 13px; text-align: center; margin-top: 20px;">No slide subfolders found.</div>`;
      btnCompile.setAttribute('disabled', 'true');
      btnScreenshot.setAttribute('disabled', 'true');
      btnIdml.setAttribute('disabled', 'true');
    }
  } catch (err) {
    console.error('Failed to load presentation directory:', err);
    dirPathDisplay.innerText = 'Failed to load directory';
  }
}

// Render the sidebar list of slides
function renderSlideList() {
  slideList.innerHTML = '';
  state.slides.forEach((slide, idx) => {
    const item = document.createElement('div');
    item.className = `slide-item ${idx === state.currentSlideIndex ? 'active' : ''}`;
    item.id = `slide-item-${idx}`;
    
    // Determine status badge
    let badgeHtml = '<span class="slide-badge badge-default">Ready</span>';
    if (state.customStates[slide.folderName]) {
      badgeHtml = '<span class="slide-badge badge-custom">Custom State</span>';
    }
    
    item.innerHTML = `
      <div class="slide-info">
        <div class="slide-name">${slide.name}</div>
        ${badgeHtml}
      </div>
    `;
    
    item.addEventListener('click', () => {
      loadSlide(idx);
    });
    
    slideList.appendChild(item);
  });
}

// Load a slide into our locked 1024x768px frame
function loadSlide(idx) {
  if (idx < 0 || idx >= state.slides.length) return;
  state.currentSlideIndex = idx;
  
  // Highlight active sidebar item
  document.querySelectorAll('.slide-item').forEach((item) => item.classList.remove('active'));
  const activeItem = document.querySelector(`#slide-item-${idx}`);
  if (activeItem) activeItem.classList.add('active');
  
  const slide = state.slides[idx];
  
  // Switch view from welcome to canvas
  welcomeView.style.display = 'none';
  canvasFrame.style.display = 'block';
  floatingToolbar.style.display = 'flex';
  
  // Load standard URL
  slideIframe.src = slide.url;
}

// ─── Iframe Auto-Sync ────────────────────────────────────────────────────────
// When the eDA's internal navigation arrows change the iframe URL, we need to
// keep state.currentSlideIndex in sync, otherwise btnScreenshot uses stale data.
slideIframe.addEventListener('load', () => {
  if (!slideIframe.src || slideIframe.src === 'about:blank') return;

  // Normalise the loaded URL so we can compare it to our slide list
  let loadedUrl;
  try {
    loadedUrl = new URL(slideIframe.src).href;
  } catch (_) {
    return;
  }

  // Try exact match first, then basename match (handles ?cache-bust suffixes etc.)
  let matchIdx = state.slides.findIndex((s) => {
    try { return new URL(s.url).href === loadedUrl; } catch (_) { return false; }
  });

  if (matchIdx === -1) {
    // Fallback: compare by path segments — match the folder name inside the URL
    const loadedParts = new URL(loadedUrl).pathname.split('/').filter(Boolean);
    matchIdx = state.slides.findIndex((s) => {
      try {
        const slideParts = new URL(s.url).pathname.split('/').filter(Boolean);
        // The slide folder is the first path segment on our local server
        return slideParts[0] && loadedParts[0] && slideParts[0] === loadedParts[0];
      } catch (_) { return false; }
    });
  }

  if (matchIdx !== -1 && matchIdx !== state.currentSlideIndex) {
    state.currentSlideIndex = matchIdx;

    // Sync sidebar highlight without reloading the iframe
    document.querySelectorAll('.slide-item').forEach((item) => item.classList.remove('active'));
    const activeItem = document.querySelector(`#slide-item-${matchIdx}`);
    if (activeItem) {
      activeItem.classList.add('active');
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
});

// eDA navigation events
btnPrev.addEventListener('click', () => {
  if (state.currentSlideIndex > 0) {
    loadSlide(state.currentSlideIndex - 1);
  }
});

btnNext.addEventListener('click', () => {
  if (state.currentSlideIndex < state.slides.length - 1) {
    loadSlide(state.currentSlideIndex + 1);
  }
});

// Interactive state bridge event listener
window.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'captured_html') {
    const activeSlide = state.slides[state.currentSlideIndex];
    state.customStates[activeSlide.folderName] = e.data.html;
    
    // Update sidebar UI with status badge
    renderSlideList();
    
    // Flash message
    btnCaptureState.innerText = '✅ Saved State!';
    btnCaptureState.style.background = 'linear-gradient(135deg, var(--accent-green), var(--accent-blue))';
    setTimeout(() => {
      btnCaptureState.innerText = '✨ Capture Popup State';
      btnCaptureState.style.background = '';
    }, 1500);
  }
});

// Send postMessage DOM capture command to iframe
btnCaptureState.addEventListener('click', () => {
  if (state.currentSlideIndex === -1) return;
  slideIframe.contentWindow.postMessage('request_html', '*');
});

// Reset slide custom captured state to default URL
btnResetState.addEventListener('click', () => {
  if (state.currentSlideIndex === -1) return;
  const activeSlide = state.slides[state.currentSlideIndex];
  
  if (state.customStates[activeSlide.folderName]) {
    delete state.customStates[activeSlide.folderName];
    renderSlideList();
    // Reload iframe to clear active popup visual state
    slideIframe.src = activeSlide.url;
  }
});

// Compile eDA slides to multi-page vector PDF
btnCompile.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;
  
  // 1. Select output file save path using Wails native SaveFileDialog
  let defaultName = inputOutputName.value.trim() || 'Editable_Presentation.pdf';
  if (!defaultName.endsWith('.pdf')) defaultName += '.pdf';
  
  try {
    const savePath = await SelectSavePath(defaultName);
    if (!savePath) return; // Dialog cancelled
    
    // Start compile UI state
    state.isCompiling = true;
    btnCompile.setAttribute('disabled', 'true');
    btnScreenshot.setAttribute('disabled', 'true');
    btnSelectDir.setAttribute('disabled', 'true');
    progressArea.style.display = 'flex';
    
    // 2. Prepare rendering jobs
    const jobs = state.slides.map((slide) => {
      const customHtml = state.customStates[slide.folderName] || '';
      return {
        slideName: slide.name,
        folderName: slide.folderName,
        url: slide.url,
        customHtml: customHtml
      };
    });
    
    // 3. Trigger Wails backend compilation
    progressStatusText.innerText = 'Opening background engine...';
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';
    
    const resultPath = await CompileSlidesToPDF(jobs, savePath, state.sleepMs);
    
    // Compilation successful!
    progressStatusText.innerHTML = `🎉 Merged Successfully to <span style="font-family: monospace; color: var(--accent-green);">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-green)';
    
  } catch (err) {
    console.error('Compilation failed:', err);
    progressStatusText.innerHTML = `❌ Error: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-pink)';
  } finally {
    state.isCompiling = false;
    btnCompile.removeAttribute('disabled');
    btnScreenshot.removeAttribute('disabled');
    btnSelectDir.removeAttribute('disabled');
  }
});

// Compile single active slide to a vector editable PDF
btnScreenshot.addEventListener('click', async () => {
  if (state.currentSlideIndex === -1 || state.isCompiling) return;
  
  const activeSlide = state.slides[state.currentSlideIndex];
  let defaultName = `${activeSlide.name}_Editable.pdf`;
  
  try {
    const savePath = await SelectSavePath(defaultName);
    if (!savePath) return; // Dialog cancelled
    
    // Start UI state
    state.isCompiling = true;
    btnCompile.setAttribute('disabled', 'true');
    btnScreenshot.setAttribute('disabled', 'true');
    btnSelectDir.setAttribute('disabled', 'true');
    progressArea.style.display = 'flex';
    progressStatusText.innerText = 'Compiling single slide PDF...';
    
    const customHtml = state.customStates[activeSlide.folderName] || '';
    const jobs = [{
      slideName: activeSlide.name,
      folderName: activeSlide.folderName,
      url: activeSlide.url,
      customHtml: customHtml
    }];
    
    const resultPath = await CompileSlidesToPDF(jobs, savePath, state.sleepMs);
    
    progressStatusText.innerHTML = `📄 Single slide PDF compiled to <span style="font-family: monospace; color: var(--accent-green);">${resultPath}</span>`;
  } catch (err) {
    console.error('Slide compilation failed:', err);
    progressStatusText.innerHTML = `❌ Compilation failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
  } finally {
    state.isCompiling = false;
    btnCompile.removeAttribute('disabled');
    btnScreenshot.removeAttribute('disabled');
    btnIdml.removeAttribute('disabled');
    btnSelectDir.removeAttribute('disabled');
  }
});

// Compile eDA slides to fully editable InDesign (IDML) package
btnIdml.addEventListener('click', async () => {
  if (state.slides.length === 0 || state.isCompiling) return;

  // Pre-fill default IDML save name based on text box or default
  let defaultName = inputOutputName.value.trim() || 'Editable_Presentation.pdf';
  // Replace .pdf with .idml
  defaultName = defaultName.replace(/\.pdf$/i, '') + '.idml';
  if (!defaultName.endsWith('.idml')) defaultName += '.idml';

  try {
    const savePath = await SelectIDMLSavePath(defaultName);
    if (!savePath) return; // Dialog cancelled

    // Start IDML compile UI state
    state.isCompiling = true;
    btnCompile.setAttribute('disabled', 'true');
    btnScreenshot.setAttribute('disabled', 'true');
    btnIdml.setAttribute('disabled', 'true');
    btnSelectDir.setAttribute('disabled', 'true');
    progressArea.style.display = 'flex';

    // 2. Prepare rendering/layout scraping jobs
    const jobs = state.slides.map((slide) => {
      const customHtml = state.customStates[slide.folderName] || '';
      return {
        slideName: slide.name,
        folderName: slide.folderName,
        url: slide.url,
        customHtml: customHtml
      };
    });

    // 3. Trigger Wails backend IDML compilation
    progressStatusText.innerText = 'Extracting DOM vector coordinates...';
    progressPercentage.innerText = '0%';
    progressIndicator.style.width = '0%';

    const resultPath = await CompileSlidesToIDML(jobs, savePath, state.sleepMs);

    // Compilation successful!
    progressStatusText.innerHTML = `🎉 IDML exported successfully to <span style="font-family: monospace; color: var(--accent-green);">${resultPath}</span>`;
    progressPercentage.innerText = '100%';
    progressIndicator.style.width = '100%';
    progressIndicator.style.background = 'var(--accent-green)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-green)';

  } catch (err) {
    console.error('IDML compilation failed:', err);
    progressStatusText.innerHTML = `❌ IDML Export failed: <span style="color: var(--accent-pink);">${err.message || err}</span>`;
    progressIndicator.style.background = 'var(--accent-pink)';
    progressIndicator.style.boxShadow = '0 0 10px var(--accent-pink)';
  } finally {
    state.isCompiling = false;
    btnCompile.removeAttribute('disabled');
    btnScreenshot.removeAttribute('disabled');
    btnIdml.removeAttribute('disabled');
    btnSelectDir.removeAttribute('disabled');
  }
});

// Listen to Go backend EventsOn "compilation_progress"
EventsOn('compilation_progress', (data) => {
  // data contains {current, total, slide, phase}
  if (!state.isCompiling) return;
  
  const percentage = Math.round((data.current / data.total) * 100);
  
  if (data.phase === 'rendering') {
    progressStatusText.innerHTML = `Rendering page <span>${data.current}/${data.total}</span>: <span>${data.slide}</span>`;
    progressIndicator.style.width = `${percentage * 0.9}%`; // Leave 10% for merge phase
    progressPercentage.innerText = `${Math.round(percentage * 0.9)}%`;
  } else if (data.phase === 'merging') {
    progressStatusText.innerHTML = `Merging all slide vector pages...`;
    progressIndicator.style.width = '95%';
    progressPercentage.innerText = '95%';
  }
});
