import React, { useState, useEffect, useRef } from 'react';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { Canvas } from './components/Canvas';
import { OutputPanel } from './components/OutputPanel';
import { PDFViewer } from './components/PDFViewer';
import { MetadataModal } from './components/MetadataModal';
import { ConfirmModal } from './components/ConfirmModal';

import {
  ScanAndStartServer,
  AutoCompileSlidePDF,
  AutoCompileDeckPDF,
  ListCompiledPDFs,
  DeleteCompiledPDF,
  CompileSlidesToIDML,
  SelectIDMLSavePath,
  ListCombinedDecks,
  CombineCompiledPDFs,
  StartPDFSession,
  CompileSingleStateToPDF,
  EndPDFSession,
  GenerateDeckAutoSavePath,
  GenerateNextSequentialPDFPath,
  GenerateNextAutoSlidePDFPath,
  CombineCustomPDFs,
  SelectPDFFile,
  SplitCombinedPDFToPages,
  RebuildCombinedPDF,
  StartEmbeddedWSServer,
  GetPlatform,
  GetLocalIPAddresses,
  SaveRemotePDF,
  StartWSClient,
  StopWSClient,
  CaptureCustomStateHTML,
  CleanUpTempHTML,
  SyncWorkspaceToMac
} from '../wailsjs/go/main/App';

import { EventsOn } from '../wailsjs/runtime/runtime';
import { StudioPage } from './components/StudioPage';

// Helper to safely bind Wails events (guards against undefined runtime in standard web browsers)
const safeEventsOn = (eventName: string, callback: (...args: any[]) => void): (() => void) => {
  if (typeof window !== 'undefined' && (window as any).runtime) {
    try {
      return EventsOn(eventName, callback);
    } catch (e) {
      console.warn(`EventsOn failed for ${eventName}:`, e);
    }
  }
  return () => {};
};


interface Slide {
  name: string;
  folderName: string;
  url: string;
}

interface CompiledPDF {
  name: string;
  size: number;
  serveUrl: string;
  metadata: string;
}

interface CompilationProgress {
  phase: string;
  current: number;
  total: number;
  slide: string;
  detail: string;
}

export const App: React.FC = () => {
  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('app-theme');
    if (saved === 'light') return 'light';
    return 'dark';
  });

  // ─── Builder vs Capture Mode states ───
  const [appMode, setAppMode] = useState<'select' | 'builder' | 'capture'>('select');
  const [osPlatform, setOsPlatform] = useState<'darwin' | 'windows' | ''>('');
  
  // Mac Performer details
  const [macPairingCode, setMacPairingCode] = useState('');
  const [macIPAddresses, setMacIPAddresses] = useState<string[]>([]);
  const [macConnectionStatus, setMacConnectionStatus] = useState('Idle');
  
  // Windows Controller details
  const [targetMacIP, setTargetMacIP] = useState(() => localStorage.getItem('capture-mac-ip') || '');
  const [targetMacCode, setTargetMacCode] = useState(() => localStorage.getItem('capture-mac-code') || '');
  const [controllerWS, setControllerWS] = useState<WebSocket | null>(null);
  const [wsConnectionState, setWsConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [windowsIP, setWindowsIP] = useState('');
  const pendingCleanupsRef = useRef<{ folder: string; file: string }[]>([]);

  // Logs for Mac Viewership Console
  const [viewershipLogs, setViewershipLogs] = useState<string[]>([]);

  // Accumulated Remote jobs for multipage crawl compilation
  const remoteJobsRef = useRef<any[]>([]);

  // Fetch Windows Controller IP for routing (with subnet prefix matching to target Mac IP)
  useEffect(() => {
    const fetchWindowsIP = async () => {
      try {
        const ips = await GetLocalIPAddresses();
        if (ips && ips.length > 0) {
          let matched = ips[0];
          if (targetMacIP) {
            const macPrefix = targetMacIP.split('.').slice(0, 3).join('.'); // e.g., "192.168.1"
            const matching = ips.find(ip => ip.startsWith(macPrefix));
            if (matching) {
              matched = matching;
            }
          }
          setWindowsIP(matched);
        }
      } catch (err) {
        console.error("Failed to fetch Windows local IP:", err);
      }
    };
    if (osPlatform === 'windows') {
      fetchWindowsIP();
    }
  }, [osPlatform, targetMacIP]);

  // Detect OS platform
  useEffect(() => {
    const detect = async () => {
      try {
        const plat = await GetPlatform();
        setOsPlatform(plat.toLowerCase() as 'darwin' | 'windows');
      } catch (_) {
        setOsPlatform(navigator.userAgent.indexOf('Mac') !== -1 ? 'darwin' : 'windows');
      }
    };
    detect();
  }, []);

  // Initialize Mac Performer Mode
  useEffect(() => {
    if (appMode === 'capture' && osPlatform === 'darwin') {
      let isStopped = false;
      const initMacPerformer = async () => {
        try {
          setViewershipLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Starting Embedded WS Server on port 8081...`]);
          await StartEmbeddedWSServer();
          
          const ips = await GetLocalIPAddresses();
          setMacIPAddresses(ips);

          setViewershipLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Requesting unique 6-digit pairing code...`]);
          
          const res = await fetch('http://127.0.0.1:8081/create-room');
          const data = await res.json();
          if (isStopped) return;
          const code = data.room;
          setMacPairingCode(code);

          setViewershipLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Connecting Wails backend to room ${code}...`]);
          await StartWSClient("ws://127.0.0.1:8081/ws", code, "capture");
          setMacConnectionStatus('Listening');
          setViewershipLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] Viewership active. Ready to render safari-matched ePDFs.`]);
        } catch (err: any) {
          console.error(err);
          setViewershipLogs(prev => [...prev, `[ERROR] Failed to start Performer: ${err.message || err}`]);
        }
      };

      initMacPerformer();

      // Listen for Go wails events
      const destroyWSEvent = safeEventsOn('viewership_event', (msg: string) => {
        setViewershipLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
      });

      const destroyDevicesEvent = safeEventsOn('devices_list_updated', (data: string) => {
        try {
          const list = JSON.parse(data);
          setConnectedClients(list || []);
        } catch (_) {}
      });

      return () => {
        isStopped = true;
        StopWSClient();
        if (typeof destroyWSEvent === 'function') {
          destroyWSEvent();
        }
        if (typeof destroyDevicesEvent === 'function') {
          destroyDevicesEvent();
        }
      };
    }
  }, [appMode, osPlatform]);

  // Root States
  const [rootDirectory, setRootDirectory] = useState('');
  const [slides, setSlides] = useState<Slide[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = useState(-1);
  const [compiledPDFs, setCompiledPDFs] = useState<CompiledPDF[]>([]);
  const [combinedDecks, setCombinedDecks] = useState<CompiledPDF[]>([]);
  const [sleepMs, setSleepMs] = useState(800);
  const [isCompiling, setIsCompiling] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Overlays / Modals States
  const [activeViewerPDF, setActiveViewerPDF] = useState<CompiledPDF | null>(null);
  const [activeMetadataPDF, setActiveMetadataPDF] = useState<CompiledPDF | null>(null);
  const [pdfToDelete, setPdfToDelete] = useState<{ name: string; type: 'single' | 'deck' } | null>(null);
  const [confirmModalData, setConfirmModalData] = useState<{
    items: string[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  // Compilation Progress State
  const [compilationProgress, setCompilationProgress] = useState<CompilationProgress | null>(null);
  const [isSingleSave, setIsSingleSave] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Sync theme class to document element
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light') {
      root.classList.add('light');
    } else {
      root.classList.remove('light');
    }
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  // Bind legacy global logging functions and window message listener
  useEffect(() => {
    // Bind global crawlerLogs and logToTextFile
    (window as any).crawlerLogs = [];

    (window as any).logToTextFile = (msg: string) => {
      const timestamp = new Date().toLocaleTimeString();
      const logMsg = `[${timestamp}] ${msg}`;
      (window as any).crawlerLogs.push(logMsg);
      console.log(logMsg);
    };

    (window as any).downloadCrawlerLogs = () => {
      const globalLogs = (window as any).crawlerLogs;
      if (!globalLogs || globalLogs.length === 0) return;
      const blob = new Blob([globalLogs.join('\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'crawler_log.txt';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };

    // Listen to iframe postMessage events (navigation alert, bridge logs)
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'iframe_log') {
        const msg = "[IFRAME] " + e.data.message;
        (window as any).logToTextFile(msg);
        try {
          (window as any).go.main.App.LogCrawlerStatus(msg);
        } catch (_) {}
        return;
      }

      if (e.data && e.data.type === 'iframe_navigation') {
        const loadedUrl = e.data.url;
        if (!loadedUrl || loadedUrl === 'about:blank') return;

        // Try exact URL match
        let matchIdx = slides.findIndex((s) => {
          try {
            return new URL(s.url).href === loadedUrl;
          } catch (_) {
            return false;
          }
        });

        // Try boundary-safe case-insensitive folder name regex match (handles queries/slashes)
        if (matchIdx === -1) {
          matchIdx = slides.findIndex((s) => {
            if (!s.folderName) return false;
            const cleanFolder = s.folderName.replace(/^_+|_+$/g, '').toLowerCase();
            const lowerUrl = loadedUrl.toLowerCase();
            const regex = new RegExp('[\\/_]' + cleanFolder + '([\\/_\\?\\.#]|$)');
            return regex.test(lowerUrl);
          });
        }

        if (matchIdx !== -1 && matchIdx !== currentSlideIndex) {
          setCurrentSlideIndex(matchIdx);
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Bind Wails progress events
    const destroyProgressEvent = safeEventsOn('compilation_progress', (data: any) => {
      setCompilationProgress({
        phase: data.phase,
        current: data.current,
        total: data.total,
        slide: data.slide,
        detail: data.detail,
      });
    });

    return () => {
      window.removeEventListener('message', handleMessage);
      // Clean up event listener if supported by Wails destroy
      if (typeof destroyProgressEvent === 'function') {
        destroyProgressEvent();
      }
    };
  }, [slides, currentSlideIndex]);



  const [workspaceSynced, setWorkspaceSynced] = useState(false);

  const ensureWorkspaceSynced = async (forced = false) => {
    if (!rootDirectory) {
      return;
    }
    if (appMode !== 'capture' || wsConnectionState !== 'connected' || !controllerWS) {
      return;
    }
    if (workspaceSynced && !forced) {
      return;
    }
    
    setCompilationProgress({
      phase: 'merging',
      current: 5,
      total: 100,
      slide: 'Syncing...',
      detail: 'Synchronizing presentation assets to Mac Performer over WebSocket...'
    });

    try {
      const base64Zip = await SyncWorkspaceToMac();
      controllerWS.send(JSON.stringify({
        type: 'sync_workspace',
        data: base64Zip
      }));
      setWorkspaceSynced(true);
      // Wait a moment for unzip and local HTTP server initialization on Mac
      await new Promise(r => setTimeout(r, 1500));
    } catch (err: any) {
      console.error("Workspace sync failed:", err);
      alert(`Workspace sync failed: ${err.message || err}`);
    }
  };

  // Load Single presentation Workspace
  const onDirectoryLoaded = async (dirPath: string) => {
    try {
      const result = await ScanAndStartServer(dirPath);
      // Guard: wrong folder or server error may return null/empty result
      if (!result || !result.slides) {
        console.warn('Invalid or empty workspace — no slides found.');
        setSlides([]);
        setCurrentSlideIndex(-1);
        setRootDirectory('');
        setConfirmModalData({
          items: ['The selected folder does not contain a valid presentation. Please choose a correct folder.'],
          onConfirm: () => setConfirmModalData(null),
          onCancel: () => setConfirmModalData(null),
        });
        return;
      }
      setRootDirectory(result.parentPath ?? '');
      setSlides(result.slides);
      setCurrentSlideIndex(-1);

      if (result.slides.length > 0) {
        // Load first slide
        setCurrentSlideIndex(0);
      }

      await refreshPDFList();
    } catch (err: any) {
      console.error('Failed to load workspace directory:', err);
      // Reset to safe state so the app doesn't crash
      setSlides([]);
      setCurrentSlideIndex(-1);
      setRootDirectory('');
    }
  };

  // Select a slide index
  const onSelectSlide = (idx: number) => {
    if (idx >= 0 && idx < slides.length) {
      setCurrentSlideIndex(idx);
    }
  };

  // Navigations
  const handlePrevSlide = () => {
    if (currentSlideIndex > 0) {
      setCurrentSlideIndex(currentSlideIndex - 1);
    }
  };

  const handleNextSlide = () => {
    if (currentSlideIndex < slides.length - 1) {
      setCurrentSlideIndex(currentSlideIndex + 1);
    }
  };

  const handleReloadSlide = () => {
    if (iframeRef.current && currentSlideIndex !== -1) {
      const activeSlide = slides[currentSlideIndex];
      iframeRef.current.src = activeSlide.url;
    }
  };

  // Trigger file outputs refresh
  const refreshPDFList = async () => {
    try {
      const pdfs = await ListCompiledPDFs();
      setCompiledPDFs(pdfs || []);

      const decks = await ListCombinedDecks();
      setCombinedDecks(decks || []);
    } catch (err) {
      console.error('Failed to list workspace PDFs:', err);
    }
  };

  // File Deletions
  const onDeletePDF = async (name: string, type: 'single' | 'deck') => {
    try {
      // Optimistic UI updates
      if (type === 'single') {
        setCompiledPDFs((prev) => prev.filter((p) => p.name !== name));
      } else {
        setCombinedDecks((prev) => prev.filter((p) => p.name !== name));
      }

      await DeleteCompiledPDF(name);

      // Timeout for Windows filesystem indexing delay
      setTimeout(async () => {
        await refreshPDFList();
      }, 150);
    } catch (err) {
      console.error('Failed to delete compiled file:', err);
      await refreshPDFList();
    }
  };

  // Merge All Single Output PDFs
  const onCombineDecks = async () => {
    try {
      setIsCompiling(true);
      setCompilationProgress({
        phase: 'merging',
        current: 50,
        total: 100,
        slide: 'Merging PDFs...',
        detail: 'Executing PDF stitcher engine...'
      });

      await CombineCompiledPDFs();

      setCompilationProgress({
        phase: 'complete',
        current: 100,
        total: 100,
        slide: 'Merge Completed',
        detail: 'PDF presentation output combined successfully.'
      });

      setTimeout(async () => {
        setIsCompiling(false);
        setCompilationProgress(null);
        await refreshPDFList();
      }, 1500);
    } catch (err: any) {
      console.error('PDF stitching fail:', err);
      setIsCompiling(false);
      setCompilationProgress(null);
      alert(`Stitching failed: ${err.message || err}`);
    }
  };

  // PDF Viewer Navigation Controls
  const handleViewerPrev = () => {
    if (!activeViewerPDF) return;
    const allPDFs = [...compiledPDFs, ...combinedDecks];
    const idx = allPDFs.findIndex((p) => p.name === activeViewerPDF.name);
    if (idx > 0) {
      setActiveViewerPDF(allPDFs[idx - 1]);
    }
  };

  const handleViewerNext = () => {
    if (!activeViewerPDF) return;
    const allPDFs = [...compiledPDFs, ...combinedDecks];
    const idx = allPDFs.findIndex((p) => p.name === activeViewerPDF.name);
    if (idx !== -1 && idx < allPDFs.length - 1) {
      setActiveViewerPDF(allPDFs[idx + 1]);
    }
  };

  const getViewerIndexAndCount = () => {
    if (!activeViewerPDF) return { index: -1, count: 0 };
    const allPDFs = [...compiledPDFs, ...combinedDecks];
    const idx = allPDFs.findIndex((p) => p.name === activeViewerPDF.name);
    return { index: idx, count: allPDFs.length };
  };

  // ─── IFRAME AUTOMATION CORE ────────────────────────────────────────────────

  // Capture Live DOM State inside iframe
  const captureCurrentSlideState = (): Promise<string> => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve('');
      }, 3000);

      const handler = (e: MessageEvent) => {
        if (e.data && e.data.type === 'captured_html') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(e.data.html);
        }
      };

      window.addEventListener('message', handler);

      try {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ type: 'request_html' }), '*');
        } else {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve('');
        }
      } catch (_) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve('');
      }
    });
  };

  // Execute custom JavaScript code inside the iframe context
  const executeInIframe = (code: string): Promise<any> => {
    return new Promise((resolve, reject) => {
      const id = Date.now() + '_' + Math.random().toString(36).slice(2);
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        reject(new Error('Iframe script execution timed out'));
      }, 8000);

      const handler = (e: MessageEvent) => {
        if (e.data && e.data.type === 'iframe_execute_result' && e.data.id === id) {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          if (e.data.error) reject(new Error(e.data.error));
          else resolve(e.data.result);
        }
      };

      window.addEventListener('message', handler);

      try {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ type: 'iframe_execute', id, code }), '*');
        } else {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          reject(new Error('Iframe content window unavailable'));
        }
      } catch (err) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        reject(err);
      }
    });
  };

  // Dispatch mouse/touch actions to click an element inside iframe
  const clickInIframe = (selector: string): Promise<boolean> => {
    return executeInIframe(`(function() {
      var el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      
      var dispatchTouch = function(element, type) {
        try {
          var touch = {
            identifier: Date.now(),
            target: element,
            clientX: 0, clientY: 0, screenX: 0, screenY: 0, pageX: 0, pageY: 0
          };
          var touchList = [touch];
          var evt;
          try {
            evt = new TouchEvent(type, {
              bubbles: true, cancelable: true,
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
  };

  // Close active modals/references open inside VEVA presentation iframe
  const closeIframeDialogs = (): Promise<boolean> => {
    return new Promise(async (resolve) => {
      const timeout = setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve(false);
      }, 4000);

      const handler = async (e: MessageEvent) => {
        if (e.data && e.data.type === 'iframe_close_result') {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);

          // Loop wait for close transitions to resolve
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
            await new Promise((r) => setTimeout(r, 50));
            attempts++;
          }
          resolve(e.data.success);
        }
      };

      window.addEventListener('message', handler);

      try {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          iframeRef.current.contentWindow.postMessage(JSON.stringify({ type: 'iframe_close_dialogs' }), '*');
        } else {
          clearTimeout(timeout);
          window.removeEventListener('message', handler);
          resolve(false);
        }
      } catch (_) {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(false);
      }
    });
  };

  // Automate Slide state transitions (crawls tabs, dots, dialogue triggers) and captures PDFs
  const automateOneSlideViaIframe = async (
    slide: Slide,
    slideIndex: number,
    totalSlides: number,
    settleMs: number
  ) => {
    const logHelper = (window as any).logToTextFile;
    if (logHelper) {
      logHelper(`======================================================================`);
      logHelper(`🚀 STARTING AUTOMATION RUN FOR SLIDE: ${slide.name} (Index ${slideIndex})`);
      logHelper(`======================================================================`);
    }

    const isFirstSlide = slideIndex === 0;
    const logLines: string[] = [];

    const updateProgress = (detail: string) => {
      setCompilationProgress({
        phase: 'crawling',
        current: slideIndex,
        total: totalSlides,
        slide: slide.name,
        detail
      });
    };

    // Load slide in iframe and wait
    const loadSlideInIframe = () => new Promise<void>((resolve) => {
      if (iframeRef.current) {
        iframeRef.current.onload = () => {
          if (iframeRef.current) iframeRef.current.onload = null;
          resolve();
        };
        iframeRef.current.src = slide.url;
      } else {
        resolve();
      }
    });

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
        await new Promise((r) => setTimeout(r, 300));
        attempts++;
      }
      return false;
    };

    const captureAndCompileState = async (desc: string) => {
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
      try {
        await (window as any).go.main.App.LogCrawlerStatus(statusStr);
      } catch (_) {}

      const html = await captureCurrentSlideState();
      if (!html) return;

      let renderUrl = slide.url;
      if (html && appMode === 'capture') {
        try {
          const tempUrl = await CaptureCustomStateHTML(slide.folderName, html);
          const localIP = windowsIP || '127.0.0.1';
          renderUrl = tempUrl.replace('127.0.0.1', localIP).replace('localhost', localIP);
          
          const filename = tempUrl.substring(tempUrl.lastIndexOf('/') + 1);
          pendingCleanupsRef.current.push({
            folder: slide.folderName,
            file: filename
          });
        } catch (writeErr) {
          console.warn("Failed to write state HTML locally on Windows, falling back to direct URL:", writeErr);
        }
      }

      const job = {
        slideName: slide.name,
        folderName: slide.folderName,
        url: renderUrl,
        customHtml: '', // empty so Mac Performer handles it as direct URL
        tempFilename: ''
      };

      updateProgress(`📸 Rendering PDF: ${desc}...`);
      if (appMode === 'capture') {
        remoteJobsRef.current.push(job);
      } else {
        await CompileSingleStateToPDF(job, settleMs);
      }
    };

    // Load slide once
    updateProgress('Loading slide...');
    await loadSlideInIframe();
    await new Promise((r) => setTimeout(r, settleMs));

    // A. Base State Capture
    updateProgress('📄 Capturing base state...');
    await captureAndCompileState('Base Slide');
    logLines.push(`📄 [${slide.name}] Base Slide`);

    // B. First Slide: Shared Overlays
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
            if (sid === 'pi' || sid === 'references') {
              await loadSlideInIframe();
              await new Promise((r) => setTimeout(r, settleMs));
            } else {
              await ensureAllClosed();
            }

            await clickInIframe('#' + sid);
            await new Promise((r) => setTimeout(r, settleMs));

            updateProgress(`📸 Capturing #${sid}...`);
            await captureAndCompileState(`Shared #${sid}`);
            logLines.push(`🔗 [${slide.name}] Shared: #${sid}`);

            await closeIframeDialogs();
            await new Promise((r) => setTimeout(r, 400));
          }
        } catch (_) {}
      }
    } else {
      // C. Non-First Slides: References popup
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
          await loadSlideInIframe();
          await new Promise((r) => setTimeout(r, settleMs));

          const refSelector = hasRef === 'nav' ? '#references' : '.gotoRef, [data-reftarget]';
          await clickInIframe(refSelector);
          await new Promise((r) => setTimeout(r, settleMs));

          updateProgress('📸 Capturing references...');
          await captureAndCompileState('References');
          logLines.push(`📚 [${slide.name}] References`);

          await closeIframeDialogs();
          await new Promise((r) => setTimeout(r, 400));
        }
      } catch (_) {}
    }

    // D. Tabs and Internal switches crawling
    let currentTabInfo: any = null;
    const activateTabIfNeeded = async (tabSelector: string | null) => {
      if (!tabSelector) return;
      await executeInIframe(`(function() {
        var info = ${JSON.stringify(currentTabInfo || {})};
        var el = null;
        if (info.dataTab) el = document.querySelector('[data-tab="' + info.dataTab + '"]');
        if (!el && info.dataNum) el = document.querySelector('[data-num="' + info.dataNum + '"]');
        if (!el) {
          try { el = document.querySelector(info.selector || ''); } catch(_) {}
        }
        if (!el) return false;
        
        var isAlreadyActive = el.classList.contains('active') || 
                              el.classList.contains('active_tab') || 
                              el.classList.contains('tabActive') || 
                              el.classList.contains('selected') || 
                              el.className.indexOf('active') !== -1;
        if (isAlreadyActive) return true;

        var opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        try { el.click(); } catch(_) {}
        return true;
      })()`);

      await new Promise((r) => setTimeout(r, Math.max(settleMs, 600)));
    };

    const scanAndProcessDialogs = async (contextLabel: string, tabSelector: string | null) => {
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

          // Restore clean slide state, then click dialog
          await loadSlideInIframe();
          await new Promise((r) => setTimeout(r, settleMs));
          await activateTabIfNeeded(tabSelector);

          await clickInIframe(t.selector);
          await new Promise((r) => setTimeout(r, settleMs));

          const clickDialogTab = async (tabInfo: any) => {
            if (!tabInfo) return false;
            try {
              await (window as any).go.main.App.LogCrawlerStatus("[CRAWLER] clickDialogTab: " + tabInfo.label);
            } catch (_) {}

            return await executeInIframe(`(function() {
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
              if (!el) return false;

              var isAlreadyActive = el.classList.contains('active') || 
                                    el.classList.contains('active_tab') || 
                                    el.classList.contains('tabActive') || 
                                    el.classList.contains('selected') || 
                                    el.className.indexOf('active') !== -1;
              if (isAlreadyActive) return true;

              var dispatchTouch = function(element, type) {
                try {
                  var touch = {
                    identifier: Date.now(), target: element, clientX: 0, clientY: 0, screenX: 0, screenY: 0, pageX: 0, pageY: 0
                  };
                  var touchList = [touch];
                  var evt;
                  try {
                    evt = new TouchEvent(type, {
                      bubbles: true, cancelable: true,
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
          };

          const restoreDialogAndOpenDot = async (
            dotSelector: string | null = null,
            subTabInfo: any = null,
            tabsAreInner = false,
            targetDotIdx: number | null = null
          ) => {
            updateProgress(`🔄 Restoring clean dialog state...`);
            await loadSlideInIframe();
            await new Promise((r) => setTimeout(r, settleMs));
            await activateTabIfNeeded(tabSelector);
            await clickInIframe(t.selector);
            await new Promise((r) => setTimeout(r, settleMs));

            const waitForDotTransition = async (targetIdx: number | null) => {
              if (targetIdx === null) return;
              await executeInIframe(`(function() {
                return new Promise(function(resolve) {
                  var targetIdx = ${targetIdx};
                  var deadline = Date.now() + 1500;
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
              if (dotSelector) {
                await clickInIframe(dotSelector);
                await waitForDotTransition(targetDotIdx);
                await new Promise((r) => setTimeout(r, settleMs));
              }
              if (subTabInfo) {
                if (typeof subTabInfo === 'string') {
                  await clickInIframe(subTabInfo);
                } else {
                  await clickDialogTab(subTabInfo);
                }
                await new Promise((r) => setTimeout(r, settleMs));
              }
            } else {
              if (subTabInfo) {
                if (typeof subTabInfo === 'string') {
                  await clickInIframe(subTabInfo);
                } else {
                  await clickDialogTab(subTabInfo);
                }
                await new Promise((r) => setTimeout(r, settleMs));
              }
              if (dotSelector) {
                await clickInIframe(dotSelector);
                await waitForDotTransition(targetDotIdx);
                await new Promise((r) => setTimeout(r, settleMs));
              }
            }
          };

          const checkAndCaptureNestedRef = async (stateLabel: string) => {
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
                await clickInIframe('#references');
                await new Promise((r) => setTimeout(r, settleMs));

                await captureAndCompileState(`Nested Ref in ${stateLabel}`);
                logLines.push(`📚 [${slide.name}] Nested Ref in ${stateLabel} (${contextLabel})`);

                updateProgress(`📚 Closing nested reference...`);
                await executeInIframe(`(function() {
                  var refDlg = document.querySelector('#references, #ref');
                  if (refDlg) {
                    var closeBtn = refDlg.closest('.ui-dialog') ? refDlg.closest('.ui-dialog').querySelector('.ui-dialog-titlebar-close') : null;
                    if (closeBtn) {
                      closeBtn.click();
                    } else {
                      var btn = refDlg.querySelector('.close, .closeBtn, [class*="close"], .dialog-close');
                      if (btn) btn.click();
                      else {
                        refDlg.style.display = 'none';
                        var overlay = document.querySelector('.ui-widget-overlay');
                        if (overlay) overlay.style.display = 'none';
                      }
                    }
                  }
                })()`);
                await new Promise((r) => setTimeout(r, 500));
              }
            } catch (_) {}
          };

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
                  
                  var text = el.innerText.trim();
                  if (text === '•' || text === '·' || text === 'o' || text === '*' || text === '-' || text === '▪') return;
                  if (text.length > 3) return;
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
                if (slideContainer) tabsAreInner = true;
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
              if (navInfo.hasTabs && navInfo.hasDots && navInfo.tabsAreInner) {
                hasInternalCrawl = true;
                for (let dIdx = 0; dIdx < navInfo.dots.length; dIdx++) {
                  const dot = navInfo.dots[dIdx];
                  updateProgress(`🔄 Dialog Slider Page ${dIdx + 1}/${navInfo.dots.length} inside ${label}...`);
                  if (dIdx > 0) {
                    await restoreDialogAndOpenDot(dot.selector, null, true, dIdx);
                  } else {
                    await clickInIframe(dot.selector);
                    await new Promise((r) => setTimeout(r, settleMs));
                  }

                  // Wait for Swiper slides transition to settle
                  await executeInIframe(`(function() {
                    return new Promise(function(resolve) {
                      var targetIdx = ${dIdx};
                      var deadline = Date.now() + 1500;
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

                  // Fetch subtabs on active Swiper slide specifically
                  const activeTabs = await executeInIframe(`(function() {
                    var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
                      return window.getComputedStyle(d).display !== 'none';
                    })[0];
                    if (!openDialog) return [];

                    var activeSlide = openDialog.querySelector('.swiper-slide-active, .slick-active, .owl-item.active, [class*="swiper-slide-active"], [class*="slick-active"]');
                    if (!activeSlide) {
                      var allSlides = openDialog.querySelectorAll('.swiper-slide, .slick-slide, .owl-item');
                      if (allSlides[${dIdx}]) activeSlide = allSlides[${dIdx}];
                    }
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
                        await new Promise((r) => setTimeout(r, settleMs));
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
              } else if (navInfo.hasTabs && navInfo.hasDots && !navInfo.tabsAreInner) {
                hasInternalCrawl = true;
                for (let tIdx = 0; tIdx < navInfo.tabs.length; tIdx++) {
                  const subTab = navInfo.tabs[tIdx];
                  updateProgress(`🔄 Dialog SubTab ${tIdx + 1}/${navInfo.tabs.length}: ${subTab.label}...`);
                  if (tIdx > 0) {
                    await restoreDialogAndOpenDot(null, subTab);
                  } else {
                    await clickDialogTab(subTab);
                    await new Promise((r) => setTimeout(r, settleMs));
                  }

                  // Fetch dots inside active Tab panel
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
                        await new Promise((r) => setTimeout(r, settleMs));
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
              } else if (navInfo.hasDots) {
                hasInternalCrawl = true;
                for (let dIdx = 0; dIdx < navInfo.dots.length; dIdx++) {
                  const dot = navInfo.dots[dIdx];
                  updateProgress(`🔄 Dialog Slider Page ${dIdx + 1}/${navInfo.dots.length} inside ${label}...`);
                  if (dIdx > 0) {
                    await restoreDialogAndOpenDot(dot.selector, null, false, dIdx);
                  } else {
                    await clickInIframe(dot.selector);
                    await new Promise((r) => setTimeout(r, settleMs));
                  }
                  await captureAndCompileState(`Popup: ${label} - Page: ${dIdx + 1}`);
                  logLines.push(`💬 [${slide.name}] Dialog: ${label} -> Page ${dIdx + 1}`);
                  await checkAndCaptureNestedRef(`Popup: ${label} - Page: ${dIdx + 1}`);
                }
              } else if (navInfo.hasTabs) {
                hasInternalCrawl = true;
                for (let tIdx = 0; tIdx < navInfo.tabs.length; tIdx++) {
                  const subTab = navInfo.tabs[tIdx];
                  updateProgress(`🔄 Dialog SubTab ${tIdx + 1}/${navInfo.tabs.length} inside ${label}: ${subTab.label}...`);
                  if (tIdx > 0) {
                    await restoreDialogAndOpenDot(null, subTab);
                  } else {
                    await clickDialogTab(subTab);
                    await new Promise((r) => setTimeout(r, settleMs));
                  }
                  await captureAndCompileState(`Popup: ${label} - SubTab: ${subTab.label}`);
                  logLines.push(`💬 [${slide.name}] Dialog: ${label} -> SubTab: ${subTab.label}`);
                  await checkAndCaptureNestedRef(`Popup: ${label} - SubTab: ${subTab.label}`);
                }
              }
            }
          } catch (err) {
            console.warn("Advanced nested dialog crawler failed:", err);
          }

          if (!hasInternalCrawl) {
            updateProgress(`📸 Capturing popup: ${label}...`);
            await captureAndCompileState(`Popup: ${label}`);
            logLines.push(`💬 [${slide.name}] Dialog: ${label} (${contextLabel})`);
            await checkAndCaptureNestedRef(`Popup: ${label}`);
          }

          await closeIframeDialogs();
          await new Promise((r) => setTimeout(r, 400));
        }
      }
    };

    try {
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
          if (el.classList.contains('gotoSlide') || el.hasAttribute('data-slide')) return false;
          
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
          currentTabInfo = tab;

          await loadSlideInIframe();
          await new Promise((r) => setTimeout(r, settleMs));
          await activateTabIfNeeded(tab.selector);

          updateProgress(`📸 Capturing tab base: ${label}...`);
          await captureAndCompileState(`Tab: ${label}`);
          logLines.push(`🔄 [${slide.name}] Internal Switch: ${label}`);

          // Shared reference popup verification
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
              await new Promise((r) => setTimeout(r, settleMs));

              updateProgress(`📸 Capturing tab references: ${label}...`);
              await captureAndCompileState(`Nested Ref in Tab: ${label}`);
              logLines.push(`📚 [${slide.name}] Nested Ref in Tab: ${label}`);

              updateProgress(`📚 Closing tab references...`);
              await closeIframeDialogs();
              await new Promise((r) => setTimeout(r, 400));

              // Restore tab state
              updateProgress(`🔄 Restoring tab state: ${label}...`);
              await loadSlideInIframe();
              await new Promise((r) => setTimeout(r, settleMs));
              await activateTabIfNeeded(tab.selector);
            }
          } catch (refErr) {
            console.warn(`Failed to capture references for tab ${label}:`, refErr);
          }

          // Scan tab dialogues
          await scanAndProcessDialogs(`Tab: ${label}`, tab.selector);
        }
      } else {
        await scanAndProcessDialogs('Base Slide', null);
      }
    } catch (err) {
      console.warn(`Internal switch scanning failed for ${slide.name}:`, err);
    }

    return { logLines };
  };

  // WebSocket controller connection function for Windows
  const connectToMac = (ip: string, code: string) => {
    if (!ip || !code) {
      alert("Please enter the Mac's IP address and the 6-digit pairing code.");
      return;
    }
    setWsConnectionState('connecting');
    const wsUrl = `ws://${ip}:8081/ws?room=${code}&role=windows`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setWsConnectionState('connected');
      setControllerWS(ws);
      localStorage.setItem('capture-mac-ip', ip);
      localStorage.setItem('capture-mac-code', code);
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        setCompilationProgress(prev => prev ? {
          ...prev,
          detail: `Received WS packet of type: ${msg.type || 'unknown'}`
        } : null);

        if (msg.type === 'pdf') {
          setCompilationProgress({
            phase: 'merging',
            current: 90,
            total: 100,
            slide: msg.filename,
            detail: 'Saving compiled ePDF output to local disk...'
          });

          const filename = remoteFilenameRef.current || msg.filename;
          await SaveRemotePDF(filename, msg.data);

          if (pendingCleanupsRef.current.length > 0) {
            for (const cleanup of pendingCleanupsRef.current) {
              try {
                if (cleanup.file.startsWith('temp_state_')) {
                  await CleanUpTempHTML(cleanup.folder, cleanup.file);
                }
              } catch (_) {}
            }
            pendingCleanupsRef.current = [];
          }
          
          setCompilationProgress({
            phase: 'complete',
            current: 100,
            total: 100,
            slide: filename,
            detail: `Saved successfully: ${filename}`
          });
          
          setTimeout(async () => {
            setIsCompiling(false);
            setCompilationProgress(null);
            await refreshPDFList();
          }, 1500);
        } else if (msg.type === 'error') {
          setIsCompiling(false);
          setCompilationProgress(null);
          alert(`Mac Compilation failed: ${msg.message}`);
        } else if (msg.type === 'devices_list') {
          try {
            const list = JSON.parse(msg.data);
            setConnectedClients(list || []);
          } catch (_) {}
        }
      } catch (err: any) {
        console.error("Error processing WS message:", err);
        setIsCompiling(false);
        setCompilationProgress(null);
        alert(`Error processing WS message: ${err.message || err}`);
      }
    };

    ws.onclose = () => {
      setWsConnectionState('disconnected');
      setControllerWS(null);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      setWsConnectionState('disconnected');
      setControllerWS(null);
      alert("Failed to connect to Mac Viewership. Please verify the IP Address, pairing code, and network connection.");
    };
  };

  const remoteFilenameRef = useRef<string>('');
  const [connectedClients, setConnectedClients] = useState<string[]>([]);

  // Compile Single Slide DOM Screenshot PDF
  const onSaveSlide = async () => {
    if (currentSlideIndex === -1 || isCompiling) return;
    const activeSlide = slides[currentSlideIndex];

    if (appMode === 'capture') {
      if (wsConnectionState !== 'connected' || !controllerWS) {
        alert("Please connect to Mac Viewership first.");
        return;
      }
      try {
        setIsSingleSave(true);
        setIsCompiling(true);
        setCompilationProgress({
          phase: 'rendering',
          current: 1,
          total: 1,
          slide: activeSlide.name,
          detail: 'Auto-capturing slide HTML DOM...'
        });

        const capturedHtml = await captureCurrentSlideState();
        
        setCompilationProgress({
          phase: 'rendering',
          current: 1,
          total: 1,
          slide: activeSlide.name,
          detail: 'Preparing slide state resources for Mac Performer...'
        });

        let renderUrl = activeSlide.url;
        pendingCleanupsRef.current = [];

        if (capturedHtml) {
          try {
            const tempUrl = await CaptureCustomStateHTML(activeSlide.folderName, capturedHtml);
            const localIP = windowsIP || '127.0.0.1';
            renderUrl = tempUrl.replace('127.0.0.1', localIP).replace('localhost', localIP);
            
            const filename = tempUrl.substring(tempUrl.lastIndexOf('/') + 1);
            pendingCleanupsRef.current.push({
              folder: activeSlide.folderName,
              file: filename
            });
          } catch (writeErr) {
            console.warn("Failed to write state HTML locally on Windows, falling back to direct URL:", writeErr);
          }
        }

        const job = {
          slideName: activeSlide.name,
          folderName: activeSlide.folderName,
          url: renderUrl,
          customHtml: '', // empty so Mac Performer handles it as direct URL
          tempFilename: ''
        };

        remoteFilenameRef.current = `${activeSlide.name}.pdf`;
        controllerWS?.send(JSON.stringify({
          type: 'render_request',
          jobs: [job]
        }));
      } catch (err: any) {
        console.error('Save Slide failed:', err);
        alert(`Save Slide failed: ${err.message || err}`);
        setIsCompiling(false);
        setIsSingleSave(false);
        setCompilationProgress(null);
      }
      return;
    }

    try {
      setIsSingleSave(true);
      setIsCompiling(true);
      setCompilationProgress({
        phase: 'rendering',
        current: 1,
        total: 1,
        slide: activeSlide.name,
        detail: 'Auto-capturing slide HTML DOM...'
      });

      const capturedHtml = await captureCurrentSlideState();
      
      setCompilationProgress({
        phase: 'rendering',
        current: 1,
        total: 1,
        slide: activeSlide.name,
        detail: 'Invoking PDF generator engine...'
      });

      const job = {
        slideName: activeSlide.name,
        folderName: activeSlide.folderName,
        url: activeSlide.url,
        customHtml: capturedHtml,
        tempFilename: ''
      };

      await AutoCompileSlidePDF(job, sleepMs);

      setCompilationProgress({
        phase: 'complete',
        current: 1,
        total: 1,
        slide: activeSlide.name,
        detail: 'Slide PDF saved successfully.'
      });

      await refreshPDFList();
    } catch (err: any) {
      console.error('Save Slide failed:', err);
      alert(`Save Slide failed: ${err.message || err}`);
    } finally {
      setIsCompiling(false);
      setIsSingleSave(false);
      setCompilationProgress(null);
    }
  };

  // Auto Slide PDF Crawling (Active Slide only)
  const onAutoSlide = async () => {
    if (slides.length === 0 || isCompiling || currentSlideIndex === -1) return;
    const activeSlide = slides[currentSlideIndex];

    if (appMode === 'capture') {
      if (wsConnectionState !== 'connected' || !controllerWS) {
        alert("Please connect to Mac Viewership first.");
        return;
      }
    }

    try {
      setIsCompiling(true);
      setCompilationProgress({
        phase: 'crawling',
        current: 0,
        total: 1,
        slide: activeSlide.name,
        detail: 'Initializing crawler session...'
      });

      remoteJobsRef.current = [];
      pendingCleanupsRef.current = [];
      if (appMode !== 'capture') {
        await StartPDFSession();
      }

      const { logLines } = await automateOneSlideViaIframe(
        activeSlide, currentSlideIndex, slides.length, sleepMs
      );

      setIsCompiling(false);

      // Trigger custom confirm modal
      setConfirmModalData({
        items: logLines,
        onConfirm: async () => {
          setConfirmModalData(null);
          try {
            setIsCompiling(true);
            setCompilationProgress({
              phase: 'merging',
              current: 90,
              total: 100,
              slide: activeSlide.name,
              detail: appMode === 'capture' ? 'Requesting Safari rendering on Mac...' : 'Saving output PDF file...'
            });

            if (appMode === 'capture') {
              remoteFilenameRef.current = `auto_${activeSlide.name}.pdf`;
              
              setCompilationProgress({
                phase: 'rendering',
                current: 1,
                total: remoteJobsRef.current.length,
                slide: activeSlide.name,
                detail: 'Preparing slide state resources for Mac Performer...'
              });

              const resolvedJobs = [];
              for (let i = 0; i < remoteJobsRef.current.length; i++) {
                const j = remoteJobsRef.current[i];
                resolvedJobs.push({
                  ...j,
                  url: j.url,
                  customHtml: j.customHtml,
                  tempFilename: ''
                });
              }

              setCompilationProgress({
                phase: 'rendering',
                current: 1,
                total: resolvedJobs.length,
                slide: activeSlide.name,
                detail: 'Requesting Safari rendering on Mac...'
              });

              controllerWS?.send(JSON.stringify({
                type: 'render_request',
                jobs: resolvedJobs
              }));
              remoteJobsRef.current = [];
            } else {
              const savePath = await GenerateNextAutoSlidePDFPath(currentSlideIndex);
              await EndPDFSession(savePath);

              setCompilationProgress({
                phase: 'complete',
                current: 100,
                total: 100,
                slide: activeSlide.name,
                detail: 'Compilation finished.'
              });

              await refreshPDFList();
              setIsCompiling(false);
              setCompilationProgress(null);
            }
          } catch (err: any) {
            console.error('Finalize auto-slide fail:', err);
            alert(`Compilation failed: ${err.message || err}`);
            if (appMode !== 'capture') {
              try { await EndPDFSession(""); } catch (_) {}
            }
            setIsCompiling(false);
            setCompilationProgress(null);
          } finally {
            handleReloadSlide();
          }
        },
        onCancel: async () => {
          setConfirmModalData(null);
          remoteJobsRef.current = [];
          if (appMode !== 'capture') {
            try {
              await EndPDFSession("");
            } catch (_) {}
          }
          handleReloadSlide();
        }
      });

      const downloadHelper = (window as any).downloadCrawlerLogs;
      if (downloadHelper) downloadHelper();
    } catch (err: any) {
      console.error('Auto Slide crawling failed:', err);
      alert(`Auto Slide failed: ${err.message || err}`);
      setIsCompiling(false);
      setCompilationProgress(null);
      if (appMode !== 'capture') {
        try {
          await EndPDFSession("");
        } catch (_) {}
      }
      handleReloadSlide();
    }
  };

  // Full Auto Crawl (Loop over all slides in workspace)
  const onFullAuto = async () => {
    if (slides.length === 0 || isCompiling) return;

    if (appMode === 'capture') {
      if (wsConnectionState !== 'connected' || !controllerWS) {
        alert("Please connect to Mac Viewership first.");
        return;
      }
    }

    try {
      setIsCompiling(true);
      remoteJobsRef.current = [];
      pendingCleanupsRef.current = [];
      
      setCompilationProgress({
        phase: 'crawling',
        current: 0,
        total: slides.length,
        slide: 'Pre-flight',
        detail: 'Starting presentation crawler engine...'
      });

      for (let idx = 0; idx < slides.length; idx++) {
        const slide = slides[idx];
        setCompilationProgress({
          phase: 'crawling',
          current: idx,
          total: slides.length,
          slide: slide.name,
          detail: 'Loading workspace URL...'
        });

        try {
          setCurrentSlideIndex(idx);
          
          if (appMode !== 'capture') {
            await StartPDFSession();
          }

          await automateOneSlideViaIframe(
            slide, idx, slides.length, sleepMs
          );
          
          if (appMode !== 'capture') {
            const savePath = await GenerateNextAutoSlidePDFPath(idx);
            await EndPDFSession(savePath);
          }
        } catch (err: any) {
          console.error(`Skipping slide ${slide.name} due to automation error:`, err);
          if (appMode !== 'capture') {
            try {
              await EndPDFSession("");
            } catch (_) {}
          }
        }
      }

      if (appMode === 'capture') {
        setCompilationProgress({
          phase: 'merging',
          current: 95,
          total: 100,
          slide: 'Preparing slide batch...',
          detail: 'Mapping state resources to LAN IP...'
        });

        const resolvedJobs = [];
        for (let i = 0; i < remoteJobsRef.current.length; i++) {
          const j = remoteJobsRef.current[i];
          resolvedJobs.push({
            ...j,
            url: j.url,
            customHtml: j.customHtml,
            tempFilename: ''
          });
        }

        setCompilationProgress({
          phase: 'merging',
          current: 95,
          total: 100,
          slide: 'Sending batch to Mac Performer...',
          detail: 'Requesting Safari rendering on Mac...'
        });

        const presentationId = rootDirectory.split(/[/\\]/).filter(Boolean).pop() || 'deck';
        remoteFilenameRef.current = `${presentationId}_deck.pdf`;

        controllerWS?.send(JSON.stringify({
          type: 'render_request',
          jobs: resolvedJobs
        }));
        remoteJobsRef.current = [];
      } else {
        setCompilationProgress({
          phase: 'merging',
          current: 95,
          total: 100,
          slide: 'Stitching presentation pages...',
          detail: 'Combining compiled PDF slices...'
        });

        await CombineCompiledPDFs();

        setCompilationProgress({
          phase: 'complete',
          current: 100,
          total: 100,
          slide: 'Presentation Compiled',
          detail: 'Entire campaign deck compiled successfully.'
        });

        await refreshPDFList();
        setIsCompiling(false);
        setCompilationProgress(null);
      }

      if (slides.length > 0) {
        setCurrentSlideIndex(0);
      }

      const downloadHelper = (window as any).downloadCrawlerLogs;
      if (downloadHelper) downloadHelper();
    } catch (err: any) {
      console.error('Full Auto compilation failed:', err);
      alert(`Full Auto failed: ${err.message || err}`);
      setIsCompiling(false);
      setCompilationProgress(null);
    }
  };

  // Compile Raw Deck URLs
  const onCompileDeck = async () => {
    if (slides.length === 0 || isCompiling) return;

    try {
      setIsCompiling(true);
      setCompilationProgress({
        phase: 'rendering',
        current: 1,
        total: slides.length,
        slide: 'All presentation decks',
        detail: 'Spinning up background renderers...'
      });

      const jobs = slides.map((s) => ({
        slideName: s.name,
        folderName: s.folderName,
        url: s.url,
        customHtml: '',
        tempFilename: ''
      }));

      await AutoCompileDeckPDF(jobs, sleepMs);
      await refreshPDFList();
    } catch (err: any) {
      console.error('Deck compilation failed:', err);
      alert(`Compile Deck failed: ${err.message || err}`);
    } finally {
      setIsCompiling(false);
      setCompilationProgress(null);
    }
  };

  // Export Adobe IDML vector files
  const onExportIDML = async () => {
    if (slides.length === 0 || isCompiling) return;
    const defaultName = 'Editable_Presentation.idml';

    try {
      const savePath = await SelectIDMLSavePath(defaultName);
      if (!savePath) return;

      setIsCompiling(true);
      setCompilationProgress({
        phase: 'rendering',
        current: 0,
        total: slides.length,
        slide: 'Adobe IDML export',
        detail: 'Extracting DOM node coordinate streams...'
      });

      const jobs = slides.map((s) => ({
        slideName: s.name,
        folderName: s.folderName,
        url: s.url,
        customHtml: '',
        tempFilename: ''
      }));

      await CompileSlidesToIDML(jobs, savePath, sleepMs);
    } catch (err: any) {
      console.error('Adobe IDML vector export failed:', err);
      alert(`Export IDML failed: ${err.message || err}`);
    } finally {
      setIsCompiling(false);
      setCompilationProgress(null);
    }
  };

  // Load Initial Lists on mount
  useEffect(() => {
    refreshPDFList();
  }, []);

  if (appMode === 'select') {
    return (
      <div 
        className="app-container" 
        style={{ 
          height: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '40px',
          background: 'radial-gradient(circle at center, var(--bg-raised) 0%, var(--bg-deep) 100%)',
          padding: '24px'
        }}
      >
        <div style={{ textAlign: 'center', animation: 'fadeIn 0.5s ease-out' }}>
          <h1 style={{ 
            fontSize: '38px', 
            fontWeight: 800, 
            background: 'linear-gradient(135deg, var(--text-1) 30%, var(--accent) 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            letterSpacing: '-1px',
            marginBottom: '10px'
          }}>
            NoCodex ePDF Studio
          </h1>
          <p style={{ color: 'var(--text-3)', fontSize: '14px', fontWeight: 500 }}>
            Select your workspace orchestration layout
          </p>
        </div>

        <div 
          style={{ 
            display: 'flex', 
            gap: '24px', 
            maxWidth: '860px', 
            width: '100%',
            justifyContent: 'center',
            animation: 'slideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          {/* Builder Mode Option Card */}
          <div 
            onClick={() => setAppMode('builder')}
            style={{
              flex: 1,
              padding: '32px',
              borderRadius: 'var(--radius-xl)',
              background: 'rgba(255, 255, 255, 0.015)',
              border: '1px solid var(--border-1)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              overflow: 'hidden'
            }}
            className="mode-card"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-6px)';
              e.currentTarget.style.borderColor = 'var(--purple)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(167, 139, 250, 0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.borderColor = 'var(--border-1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--purple-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--purple)',
              fontSize: '20px',
              fontWeight: 'bold'
            }}>
              ⚙️
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-1)', marginBottom: '8px' }}>
                Builder Mode
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' }}>
                Standalone execution engine. Run page captures, crawls, and compile presentation decks locally on this machine using standard headless Chromium engine.
              </p>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--purple)', fontWeight: 600 }}>
              Launch standalone builder ➔
            </div>
          </div>

          {/* Capture Mode Option Card */}
          <div 
            onClick={() => setAppMode('capture')}
            style={{
              flex: 1,
              padding: '32px',
              borderRadius: 'var(--radius-xl)',
              background: 'rgba(255, 255, 255, 0.015)',
              border: '1px solid var(--border-1)',
              cursor: 'pointer',
              transition: 'all 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)',
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
              position: 'relative',
              overflow: 'hidden'
            }}
            className="mode-card"
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-6px)';
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.boxShadow = '0 12px 30px rgba(0, 242, 254, 0.06)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.borderColor = 'var(--border-1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-lg)',
              backgroundColor: 'var(--accent-dim)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              fontSize: '20px',
              fontWeight: 'bold'
            }}>
              🔗
            </div>
            <div>
              <h2 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-1)', marginBottom: '8px' }}>
                Capture Mode
              </h2>
              <p style={{ fontSize: '13px', color: 'var(--text-2)', lineHeight: '1.6' }}>
                Cross-platform orchestrator link. Pair Windows controllers with a macOS Performer to generate high-accuracy Safari-rendered ePDFs seamlessly.
              </p>
            </div>
            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--accent)', fontWeight: 600 }}>
              Launch collaborative workspace ➔
            </div>
          </div>
        </div>
      </div>
    );
  }

  // MAC PERFORMER / VIEWERSHIP VIEW
  if (appMode === 'capture' && osPlatform === 'darwin') {
    return (
      <div 
        className="app-container" 
        style={{ 
          height: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          backgroundColor: 'var(--bg-deep)',
          padding: '24px'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexShrink: 0 }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 800, color: 'var(--text-1)' }}>
              Mac Viewership Performer
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', fontWeight: 500 }}>
              WebSocket Engine Status: <span style={{ color: 'var(--success)', fontWeight: 700 }}>{macConnectionStatus}</span>
            </p>
          </div>
          <button 
            onClick={() => setAppMode('select')}
            style={{
              backgroundColor: 'var(--bg-raised)',
              border: '1px solid var(--border-1)',
              color: 'var(--text-2)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ← Reset Mode
          </button>
        </div>

        {/* Viewership Empty Space Screen Layout */}
        <div style={{ display: 'flex', gap: '20px', flex: 1, overflow: 'hidden' }}>
          {/* Main Info Board */}
          <div 
            className="glass-panel" 
            style={{ 
              flex: 1, 
              borderRadius: 'var(--radius-lg)', 
              padding: '40px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              gap: '24px',
              border: '1px solid var(--border-accent)',
              boxShadow: '0 8px 32px rgba(0, 242, 254, 0.03)'
            }}
          >
            <div style={{ fontSize: '48px' }}>🖥️</div>
            <div>
              <h2 style={{ fontSize: '24px', fontWeight: 800, color: 'var(--text-1)' }}>
                Safari Rendering Viewership Active
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: '13px', marginTop: '6px', maxWidth: '440px', margin: '6px auto 0' }}>
                This Mac is now serving as the Performer node. Connect from any Windows Controller on your network to render pixel-perfect Safari-styled PDFs.
              </p>
            </div>

            {/* Glowing 6-digit code */}
            <div style={{
              padding: '24px 40px',
              borderRadius: 'var(--radius-xl)',
              background: 'rgba(0, 242, 254, 0.03)',
              border: '2px dashed var(--accent)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span style={{ fontSize: '11px', fontWeight: 800, color: 'var(--accent)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                Pairing Room Code
              </span>
              <span style={{ 
                fontSize: '42px', 
                fontWeight: 900, 
                color: 'var(--text-1)', 
                fontFamily: 'var(--font-mono)', 
                letterSpacing: '6px',
                textShadow: '0 0 20px rgba(0, 242, 254, 0.4)'
              }}>
                {macPairingCode || '------'}
              </span>
            </div>

            {/* local network IPs */}
            <div style={{ fontSize: '12px', color: 'var(--text-3)' }}>
              <strong style={{ color: 'var(--text-2)' }}>Target Mac Network IPs:</strong>{' '}
              {macIPAddresses.length > 0 ? (
                macIPAddresses.map((ip, i) => (
                  <span key={ip} style={{ 
                    fontFamily: 'var(--font-mono)', 
                    color: 'var(--accent)', 
                    fontWeight: 700,
                    marginRight: '8px'
                  }}>
                    {ip}{i < macIPAddresses.length - 1 ? ',' : ''}
                  </span>
                ))
              ) : (
                <span>Detecting local IPs...</span>
              )}
            </div>

            {/* Paired devices counter */}
            <div style={{ fontSize: '12px', color: 'var(--text-2)', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                backgroundColor: (connectedClients || []).length > 0 ? 'var(--success)' : 'var(--text-3)'
              }} />
              <span>{(connectedClients || []).length} Connected Controller(s)</span>
            </div>
          </div>

          {/* Activity Console Logs Log */}
          <div 
            className="glass-panel" 
            style={{ 
              width: '380px', 
              borderRadius: 'var(--radius-lg)', 
              display: 'flex', 
              flexDirection: 'column',
              overflow: 'hidden'
            }}
          >
            <div style={{ 
              padding: '12px 16px', 
              borderBottom: '1px solid var(--border-1)', 
              fontSize: '12px', 
              fontWeight: 700, 
              color: 'var(--text-2)',
              backgroundColor: 'var(--bg-raised)'
            }}>
              Activity Console Logs
            </div>
            <div style={{ 
              flex: 1, 
              padding: '16px', 
              fontFamily: 'var(--font-mono)', 
              fontSize: '11px', 
              color: 'var(--text-3)', 
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              {viewershipLogs.map((log, i) => (
                <div key={i} style={{ 
                  lineHeight: '1.5',
                  color: log.includes('[ERROR]') ? 'var(--rose)' : log.includes('Success') || log.includes('Finished') ? 'var(--success)' : 'var(--text-2)'
                }}>
                  {log}
                </div>
              ))}
              {viewershipLogs.length === 0 && (
                <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Console logs will print here...</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // WINDOWS PAIRING PANEL
  if (appMode === 'capture' && osPlatform === 'windows' && wsConnectionState !== 'connected') {
    return (
      <div 
        className="app-container" 
        style={{ 
          height: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: 'radial-gradient(circle at center, var(--bg-raised) 0%, var(--bg-deep) 100%)',
          padding: '24px'
        }}
      >
        <div 
          className="glass-panel"
          style={{
            width: '440px',
            borderRadius: 'var(--radius-xl)',
            padding: '32px',
            border: '1px solid var(--border-accent)',
            boxShadow: 'var(--shadow-main)',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
            animation: 'slideUp 0.4s ease-out'
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontSize: '32px' }}>🔗</span>
            <h2 style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text-1)', marginTop: '10px' }}>
              Safari Performer Link
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--text-3)', marginTop: '4px' }}>
              Enter Mac IP Address and pairing code to route compiles to Mac
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-2)' }}>Mac IP Address</label>
              <input 
                type="text" 
                value={targetMacIP}
                onChange={(e) => setTargetMacIP(e.target.value)}
                placeholder="e.g. 192.168.1.50 or localhost"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-deep)',
                  border: '1px solid var(--border-1)',
                  color: 'var(--text-1)',
                  fontSize: '13px',
                  fontFamily: 'var(--font-mono)'
                }}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-2)' }}>6-Digit Pairing Code</label>
              <input 
                type="text" 
                value={targetMacCode}
                onChange={(e) => setTargetMacCode(e.target.value)}
                placeholder="e.g. 839210"
                maxLength={6}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  backgroundColor: 'var(--bg-deep)',
                  border: '1px solid var(--border-1)',
                  color: 'var(--text-1)',
                  fontSize: '16px',
                  fontWeight: 'bold',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '2px',
                  textAlign: 'center'
                }}
              />
            </div>
          </div>

          <button
            onClick={() => connectToMac(targetMacIP, targetMacCode)}
            disabled={wsConnectionState === 'connecting'}
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--blue))',
              border: 'none',
              color: 'var(--bg-deep)',
              padding: '12px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '13px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(var(--accent-rgb), 0.2)'
            }}
          >
            {wsConnectionState === 'connecting' ? 'Connecting to Mac...' : 'Pair Controller ➔'}
          </button>

          <button
            onClick={() => setAppMode('select')}
            style={{
              backgroundColor: 'transparent',
              border: 'none',
              color: 'var(--text-3)',
              fontSize: '12px',
              fontWeight: 600,
              cursor: 'pointer',
              textAlign: 'center'
            }}
          >
            ← Cancel and select mode
          </button>
        </div>
      </div>
    );
  }

  if (studioOpen) {
    return (
      <div className="app-container" style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <StudioPage
          onClose={() => setStudioOpen(false)}
          combinedDecks={combinedDecks}
          refreshPDFList={refreshPDFList}
          slides={slides}
          theme={theme}
        />
      </div>
    );
  }

  return (
    <div className="app-container">
      {/* 1. Header Navigation */}
      <Header
        rootDirectory={rootDirectory}
        onDirectoryLoaded={onDirectoryLoaded}
        sleepMs={sleepMs}
        onSleepMsChange={setSleepMs}
        theme={theme}
        toggleTheme={() => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))}
        onOpenStudio={() => setStudioOpen(true)}
      />

      {/* 2. Main content panels wrapper */}
      <div className="main" style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        {/* Left: Collapsible Slide List Sidebar */}
        <Sidebar
          slides={slides}
          currentSlideIndex={currentSlideIndex}
          onSelectSlide={onSelectSlide}
          isCollapsed={sidebarCollapsed}
          setIsCollapsed={setSidebarCollapsed}
        />

        {/* Center: Live Viewer canvas and spinner */}
        <Canvas
          activeSlide={currentSlideIndex !== -1 ? slides[currentSlideIndex] : null}
          currentSlideIndex={currentSlideIndex}
          totalSlides={slides.length}
          iframeRef={iframeRef}
          onPrev={handlePrevSlide}
          onNext={handleNextSlide}
          onReload={handleReloadSlide}
          isCompiling={isCompiling}
          compilationProgress={compilationProgress}
          isSingleSave={isSingleSave}
          pdfToDelete={pdfToDelete}
          onCancelDelete={() => setPdfToDelete(null)}
          onConfirmDelete={async () => {
            if (pdfToDelete) {
              await onDeletePDF(pdfToDelete.name, pdfToDelete.type);
              setPdfToDelete(null);
            }
          }}
          theme={theme}
          slides={slides}
          onSelectSlide={onSelectSlide}
          presentationId={rootDirectory.split(/[/\\]/).filter(Boolean).pop() || ''}
        />

        {/* Right: Compiled outputs list & merged decks */}
        <OutputPanel
          slides={slides}
          compiledPDFs={compiledPDFs}
          combinedDecks={combinedDecks}
          onDeletePDF={async (name, type) => setPdfToDelete({ name, type })}
          onCombineDecks={onCombineDecks}
          onOpenPDFViewer={(pdf) => setActiveViewerPDF(pdf)}
          onOpenMetadata={(pdf) => setActiveMetadataPDF(pdf)}
          isCompiling={isCompiling}
        />
      </div>

      {/* 3. Bottom controls and compile triggers */}
      <div
        className="glass-panel"
        style={{
          height: '46px',
          padding: '0 16px',
          borderTop: '1px solid var(--border-1)',
          backgroundColor: 'var(--bg-base)',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: isCompiling ? 'var(--amber)' : slides.length > 0 ? 'var(--success)' : 'var(--text-3)',
                boxShadow: isCompiling
                  ? '0 0 10px var(--amber)'
                  : slides.length > 0
                  ? '0 0 10px var(--success)'
                  : 'none',
                animation: isCompiling ? 'pulse 1.4s ease-in-out infinite' : 'none'
              }}
            />
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-2)' }}>
              {isCompiling
                ? 'Compiling slices...'
                : slides.length > 0
                ? `Workspace Loaded: ${slides.length} slides`
                : 'Idle'}
            </span>
          </div>

          {appMode === 'capture' && (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: '6px', 
              borderLeft: '1px solid var(--border-1)',
              paddingLeft: '12px',
              fontSize: '11px'
            }}>
              <div style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: wsConnectionState === 'connected' ? 'var(--success)' : 'var(--rose)'
              }} />
              <span style={{ color: 'var(--text-3)', fontWeight: 600 }}>
                Safari Link: {wsConnectionState === 'connected' ? `Connected to Mac (${targetMacIP})` : 'Disconnected'}
              </span>
              <button 
                onClick={() => setWsConnectionState('disconnected')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  marginLeft: '4px',
                  fontWeight: 700
                }}
              >
                Disconnect
              </button>
            </div>
          )}
        </div>

        {isCompiling && compilationProgress && (
          <div style={{
            margin: '0 auto',
            fontSize: '11px',
            color: 'var(--accent)',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            userSelect: 'none'
          }}>
            {compilationProgress.phase === 'crawling' && 'Crawling Slide States: '}
            {compilationProgress.phase === 'rendering' && 'Rendering slide PDF: '}
            {compilationProgress.phase === 'merging' && 'Stitching presentation PDF: '}
            <span style={{ color: 'var(--text-1)' }}>
              {compilationProgress.slide} ({compilationProgress.current}/{compilationProgress.total})
            </span>
            {compilationProgress.detail && (
              <span style={{ color: 'var(--text-3)', fontWeight: 500 }}>
                - {compilationProgress.detail}
              </span>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto' }}>

          <button
            onClick={onSaveSlide}
            disabled={currentSlideIndex === -1 || isCompiling}
            style={{
              backgroundColor: 'var(--accent-dim)',
              border: '1px solid var(--border-accent)',
              color: 'var(--accent)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all var(--transition)',
              boxShadow: '0 2px 8px rgba(var(--accent-rgb), 0.05)'
            }}
            className="action-btn"
          >
            Save Slide
          </button>

          <button
            onClick={onAutoSlide}
            disabled={currentSlideIndex === -1 || isCompiling}
            style={{
              backgroundColor: 'var(--purple-dim)',
              border: '1px solid var(--purple-mid)',
              color: 'var(--purple)',
              padding: '6px 14px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all var(--transition)',
              boxShadow: '0 2px 8px rgba(139, 92, 246, 0.05)'
            }}
            className="action-btn"
          >
            Auto Slide
          </button>

          <button
            onClick={onFullAuto}
            disabled={slides.length === 0 || isCompiling}
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--blue))',
              border: 'none',
              color: 'var(--bg-deep)',
              padding: '6px 16px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
              boxShadow: '0 3px 10px rgba(var(--accent-rgb), 0.25)',
              transition: 'all var(--transition)'
            }}
            className="action-btn"
          >
            Full Auto
          </button>
        </div>
      </div>

      {/* 5. Fullscreen PDF Viewer Overlay */}
      {activeViewerPDF && (
        <PDFViewer
          pdf={activeViewerPDF}
          currentIndex={getViewerIndexAndCount().index}
          totalPDFs={getViewerIndexAndCount().count}
          onClose={() => setActiveViewerPDF(null)}
          onPrev={handleViewerPrev}
          onNext={handleViewerNext}
        />
      )}

      {/* 6. Properties Inspector Drawer Modal */}
      {activeMetadataPDF && (
        <MetadataModal
          pdf={activeMetadataPDF}
          onClose={() => setActiveMetadataPDF(null)}
        />
      )}

      {/* 7. Slide Crawl Confirmation Modal */}
      {confirmModalData && (
        <ConfirmModal
          items={confirmModalData.items}
          onConfirm={confirmModalData.onConfirm}
          onCancel={confirmModalData.onCancel}
        />
      )}
    </div>
  );
};
export default App;
