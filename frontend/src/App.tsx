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
  StopWSClientForRoom,
  CaptureCustomStateHTML,
  CleanUpTempHTML,
  SyncWorkspaceToMac,
  ReadLocalFile,
  OpenBuilderWindow,
  RestartRoomTimer
} from '../bindings/htmltoepdf/app';

import { Events } from '@wailsio/runtime';
import { StudioPage } from './components/StudioPage';

// Helper to safely bind Wails events (guards against undefined runtime in standard web browsers)
const safeEventsOn = (eventName: string, callback: (data: any) => void): (() => void) => {
  try {
    return Events.On(eventName, (event) => {
      callback(event.data);
    });
  } catch (e) {
    console.warn(`Events.On failed for ${eventName}:`, e);
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

let globalDeviceRooms: any[] = [];
let initialRoomPromise: Promise<any> | null = null;

export const App: React.FC = () => {
  // Theme state
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const saved = localStorage.getItem('app-theme');
    if (saved === 'light') return 'light';
    return 'dark';
  });

  // ─── Builder vs Capture Mode states ───
  const [appMode, setAppMode] = useState<'select' | 'builder' | 'capture'>(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'builder') {
      return 'builder';
    }
    return 'capture';
  });
  const [osPlatform, setOsPlatform] = useState<'darwin' | 'windows' | ''>('');
  
  // Mac Performer details
  const [macPairingCode, setMacPairingCode] = useState('');
  const [macIPAddresses, setMacIPAddresses] = useState<string[]>([]);
  const [macConnectionStatus, setMacConnectionStatus] = useState('Idle');
  
  interface DeviceRoom {
    code: string;
    status: string;
    logs: string[];
    clients: string[];
    createdAt?: string;
  }
  const [deviceRooms, setDeviceRooms] = useState<DeviceRoom[]>(() => globalDeviceRooms);

  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  const [genericModal, setGenericModal] = useState<{
    title: string;
    message: string;
    type?: 'success' | 'error' | 'info';
    onClose?: () => void;
  } | null>(null);

  const showModal = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info', onClose?: () => void) => {
    setGenericModal({ title, message, type, onClose });
  };

  useEffect(() => {
    window.alert = (message: string) => {
      let title = "Notification";
      let type: 'success' | 'error' | 'info' = 'info';
      
      const lower = message.toLowerCase();
      if (lower.includes("failed") || lower.includes("error") || lower.includes("invalid") || lower.includes("timed out") || lower.includes("timed_out")) {
        title = "Error Encountered";
        type = "error";
      } else if (lower.includes("success") || lower.includes("saved") || lower.includes("completed") || lower.includes("finished")) {
        title = "Success";
        type = "success";
      }
      
      showModal(title, message, type);
    };
  }, []);

  // Windows Controller details
  const [targetMacIP, setTargetMacIP] = useState(() => localStorage.getItem('capture-mac-ip') || '');
  const [targetMacCode, setTargetMacCode] = useState(() => localStorage.getItem('capture-mac-code') || '');
  const [controllerWS, setControllerWS] = useState<WebSocket | null>(null);
  const [wsConnectionState, setWsConnectionState] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [controllerRoomCreatedAt, setControllerRoomCreatedAt] = useState<string | null>(null);
  const [windowsIP, setWindowsIP] = useState('');
  const pendingCleanupsRef = useRef<{ folder: string; file: string }[]>([]);
  const initializedRef = useRef(false);

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
            const matching = ips.find((ip: string) => ip.startsWith(macPrefix));
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

  const MAX_ROOMS = 10;

  const addDeviceRoom = async () => {
    if (deviceRooms.length >= MAX_ROOMS) {
      showModal("Limit Reached", `Maximum room limit of ${MAX_ROOMS} rooms reached.`, "error");
      return;
    }
    try {
      const res = await fetch('http://127.0.0.1:8081/create-room');
      const data = await res.json();
      const code = data.room;
      const createdAt = data.createdAt || new Date().toISOString();

      setDeviceRooms(prev => [
        ...prev,
        {
          code,
          status: 'Listening',
          logs: [`[${new Date().toLocaleTimeString()}] Room ${code} created. Listening for controllers...`],
          clients: [],
          createdAt
        }
      ]);

      await StartWSClient("ws://127.0.0.1:8081/ws", code, "capture");
    } catch (err: any) {
      console.error(err);
      showModal("Error", `Failed to add device room: ${err.message || err}`, "error");
    }
  };

  const removeDeviceRoom = async (code: string) => {
    try {
      await StopWSClientForRoom(code);
      setDeviceRooms(prev => prev.filter(r => r.code !== code));
    } catch (err: any) {
      console.error(err);
      showModal("Error", `Failed to remove device room: ${err.message || err}`, "error");
    }
  };

  // Sync global device rooms
  useEffect(() => {
    globalDeviceRooms = deviceRooms;
  }, [deviceRooms]);

  // Initialize Mac Performer Mode
  useEffect(() => {
    let isStopped = false;
    if (appMode === 'capture' && osPlatform === 'darwin') {
      const initMacPerformer = async () => {
        try {
          await StartEmbeddedWSServer();
          const ips = await GetLocalIPAddresses();
          if (isStopped) return;
          setMacIPAddresses(ips);
          
          // Spawn the first device room automatically if none exist yet
          if (globalDeviceRooms.length === 0) {
            if (!initialRoomPromise) {
              initialRoomPromise = (async () => {
                const res = await fetch('http://127.0.0.1:8081/create-room');
                const data = await res.json();
                const code = data.room;
                const createdAt = data.createdAt || new Date().toISOString();
                const newRoom = {
                  code,
                  status: 'Listening',
                  logs: [`[${new Date().toLocaleTimeString()}] Room ${code} created. Listening for controllers...`],
                  clients: [],
                  createdAt
                };
                globalDeviceRooms = [newRoom];
                await StartWSClient("ws://127.0.0.1:8081/ws", code, "capture");
                return newRoom;
              })();
            }
            const room = await initialRoomPromise;
            if (!isStopped) {
              setDeviceRooms([room]);
            }
          }
        } catch (err: any) {
          console.error(err);
        }
      };

      initMacPerformer();

      // Listen for Go wails events
      const destroyWSEvent = safeEventsOn('viewership_event', (eventData: any) => {
        let room = "";
        let message = "";
        if (eventData && typeof eventData === 'object' && eventData.room) {
          room = eventData.room;
          message = eventData.message;
        } else if (typeof eventData === 'string') {
          message = eventData;
        }

        if (room) {
          setDeviceRooms(prev => prev.map(r => r.code === room ? {
            ...r,
            logs: [...r.logs, `[${new Date().toLocaleTimeString()}] ${message}`]
          } : r));
        } else {
          setDeviceRooms(prev => prev.map((r, i) => i === 0 ? {
            ...r,
            logs: [...r.logs, `[${new Date().toLocaleTimeString()}] ${message}`]
          } : r));
        }

        if (message.includes("Finished rendering!")) {
          showModal("Render Success", `Successfully rendered and sent PDF for device Room ${room || 'Default'}!`, "success");
        }
      });

      const destroyDevicesEvent = safeEventsOn('devices_list_updated', (eventData: any) => {
        let room = "";
        let dataStr = "";
        if (eventData && typeof eventData === 'object' && eventData.room) {
          room = eventData.room;
          dataStr = eventData.data;
        } else if (typeof eventData === 'string') {
          dataStr = eventData;
        }

        try {
          const list = JSON.parse(dataStr);
          if (room) {
            setDeviceRooms(prev => prev.map(r => r.code === room ? {
              ...r,
              clients: list || []
            } : r));
          } else {
            setDeviceRooms(prev => prev.map((r, i) => i === 0 ? {
              ...r,
              clients: list || []
            } : r));
          }
        } catch (_) {}
      });

      const destroyRoomTimeoutEvent = safeEventsOn('room_timeout_recreate', (eventData: any) => {
        const oldRoom = eventData?.oldRoom || "";
        const newRoom = eventData?.newRoom || "";
        if (oldRoom && newRoom) {
          StopWSClientForRoom(oldRoom).catch(console.error);
          setDeviceRooms(prev => prev.map(r => r.code === oldRoom ? {
            ...r,
            code: newRoom,
            status: 'Listening',
            logs: [`[${new Date().toLocaleTimeString()}] Room ${newRoom} created (Auto-recreated from ${oldRoom}). Listening for controllers...`],
            clients: [],
            createdAt: new Date().toISOString()
          } : r));
          StartWSClient("ws://127.0.0.1:8081/ws", newRoom, "capture").catch(console.error);
        }
      });

      const destroyRoomClosedEvent = safeEventsOn('room_closed_by_timeout', (eventData: any) => {
        const room = eventData?.room || "";
        if (room) {
          StopWSClientForRoom(room).catch(console.error);
          setDeviceRooms(prev => prev.filter(r => r.code !== room));
        }
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
        if (typeof destroyRoomTimeoutEvent === 'function') {
          destroyRoomTimeoutEvent();
        }
        if (typeof destroyRoomClosedEvent === 'function') {
          destroyRoomClosedEvent();
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
        customHtml: appMode === 'capture' ? '' : html,
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
      const sharedIds = ['pi', 'menu', 'flowSelector', 'email', 'objection', 'quickres'];
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
            await loadSlideInIframe();
            await new Promise((r) => setTimeout(r, settleMs));

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

      // E. References popup (All Slides) - captured at the very end
      try {
        // Reload the main slide first to reset any active tabs/dialogs
        await loadSlideInIframe();
        await new Promise((r) => setTimeout(r, settleMs));

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
      // Explicitly request room info upon connection open
      ws.send(JSON.stringify({ type: 'request_room_info' }));
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'room_info') {
          setControllerRoomCreatedAt(msg.data);
          return;
        }

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
          
          showModal("Compilation Success", `ePDF file saved successfully inside your output directory: ${filename}`, "success");

          setTimeout(async () => {
            setIsCompiling(false);
            setCompilationProgress(null);
            setIsSingleSave(false);
            await refreshPDFList();
          }, 3000);
        } else if (msg.type === 'error') {
          setIsCompiling(false);
          setIsSingleSave(false);
          setCompilationProgress(null);
          if (msg.message && msg.message.includes("already in use")) {
            showModal("Connection Rejected", "This pairing code is already in use by another device. Please generate a new pairing code on the Mac Performer.", "error");
            ws.close();
          } else {
            showModal("Mac Compilation Failed", msg.message, "error");
          }
        } else if (msg.type === 'devices_list') {
          try {
            const list = JSON.parse(msg.data);
            setConnectedClients(list || []);
          } catch (_) {}
        } else if (msg.type === 'proxy_request') {
          try {
            const res = await ReadLocalFile(msg.filename);
            ws.send(JSON.stringify({
              type: 'proxy_response',
              target: msg.senderId,
              cmd: msg.cmd,
              data: res.data,
              mimetype: res.mime,
              statusCode: 200
            }));
          } catch (readErr) {
            console.error("Failed to read proxy file:", readErr);
            ws.send(JSON.stringify({
              type: 'proxy_response',
              target: msg.senderId,
              cmd: msg.cmd,
              statusCode: 404
            }));
          }
        }
      } catch (err: any) {
        console.error("Error processing WS message:", err);
        setIsCompiling(false);
        setIsSingleSave(false);
        setCompilationProgress(null);
        showModal("Error", `Error processing WS message: ${err.message || err}`, "error");
      }
    };

    ws.onclose = () => {
      setWsConnectionState('disconnected');
      setControllerWS(null);
      setControllerRoomCreatedAt(null);
    };

    ws.onerror = (err) => {
      console.error("WS error:", err);
      setWsConnectionState('disconnected');
      setControllerWS(null);
      setControllerRoomCreatedAt(null);
      showModal("Connection Failed", "Failed to connect to Mac Viewership. Please verify the IP Address, pairing code, and network connection.", "error");
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

        const nextPath = await GenerateNextSequentialPDFPath();
        const filename = nextPath.substring(Math.max(nextPath.lastIndexOf('/'), nextPath.lastIndexOf('\\')) + 1);
        remoteFilenameRef.current = filename;

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
              const nextPath = await GenerateNextAutoSlidePDFPath(currentSlideIndex);
              const filename = nextPath.substring(Math.max(nextPath.lastIndexOf('/'), nextPath.lastIndexOf('\\')) + 1);
              remoteFilenameRef.current = filename;
              
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

    if (appMode === 'capture') {
      if (wsConnectionState !== 'connected' || !controllerWS) {
        showModal("Connection Required", "Please connect to Mac Viewership first.", "info");
        return;
      }
      try {
        setIsCompiling(true);
        setCompilationProgress({
          phase: 'rendering',
          current: 1,
          total: slides.length,
          slide: 'All presentation decks',
          detail: 'Preparing slide state resources for Mac Performer...'
        });

        const jobs = slides.map((s) => ({
          slideName: s.name,
          folderName: s.folderName,
          url: s.url,
          customHtml: '',
          tempFilename: ''
        }));

        const nextPath = await GenerateDeckAutoSavePath();
        const filename = nextPath.substring(Math.max(nextPath.lastIndexOf('/'), nextPath.lastIndexOf('\\')) + 1);
        remoteFilenameRef.current = filename;

        controllerWS?.send(JSON.stringify({
          type: 'render_request',
          jobs: jobs
        }));
      } catch (err: any) {
        console.error('Deck compilation failed:', err);
        showModal("Compile Deck Failed", err.message || err, "error");
        setIsCompiling(false);
        setCompilationProgress(null);
      }
      return;
    }

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
      showModal("Compile Deck Failed", err.message || err, "error");
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
        className="app-container animate-fade-in" 
        style={{ 
          height: '100vh', 
          display: 'flex', 
          flexDirection: 'column', 
          background: 'radial-gradient(circle at 50% 50%, #0c0e17 0%, #05060a 100%)',
          padding: '24px',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        {/* Apple Liquid Glass Background Mesh */}
        <div className="liquid-glass-mesh">
          <div className="liquid-glass-orb liquid-glass-orb-cyan" />
          <div className="liquid-glass-orb liquid-glass-orb-purple" />
          <div className="liquid-glass-orb liquid-glass-orb-pink" />
        </div>

        <style dangerouslySetInnerHTML={{__html: `
          @keyframes glowPulse {
            0% { box-shadow: 0 0 10px rgba(0, 242, 254, 0.15), inset 0 1px 0 0 rgba(255, 255, 255, 0.1); }
            50% { box-shadow: 0 0 20px rgba(0, 242, 254, 0.35), inset 0 1px 0 0 rgba(255, 255, 255, 0.25); }
            100% { box-shadow: 0 0 10px rgba(0, 242, 254, 0.15), inset 0 1px 0 0 rgba(255, 255, 255, 0.1); }
          }
          .liquid-header {
            background: rgba(255, 255, 255, 0.02) !important;
            backdrop-filter: blur(30px) saturate(210%) !important;
            -webkit-backdrop-filter: blur(30px) saturate(210%) !important;
            border: 1px solid rgba(255, 255, 255, 0.08) !important;
            border-top: 1px solid rgba(255, 255, 255, 0.15) !important;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25) !important;
            border-radius: 20px;
            padding: 20px 24px;
            margin-bottom: 24px;
            position: relative;
            z-index: 10;
            display: flex;
            justify-content: space-between;
            align-items: center;
          }
        `}} />

        {/* Dashboard Glass Header */}
        <div className="liquid-header">
          <div>
            <h1 style={{ fontSize: '24px', fontWeight: 900, background: 'linear-gradient(135deg, #ffffff 40%, rgba(255,255,255,0.7) 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', letterSpacing: '-0.7px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ textShadow: '0 0 20px rgba(255,255,255,0.3)' }}>🖥️</span> Mac Performer Dashboard
            </h1>
            <p style={{ fontSize: '13px', color: 'var(--text-3)', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>Local Network IPs:</span>
              {macIPAddresses.length > 0 ? (
                macIPAddresses.map((ip, i) => (
                  <span key={ip} style={{ 
                    fontFamily: 'var(--font-mono)', 
                    color: 'var(--accent)', 
                    fontWeight: 700, 
                    backgroundColor: 'rgba(0, 242, 254, 0.05)',
                    border: '1px solid rgba(0, 242, 254, 0.15)',
                    padding: '3px 10px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    boxShadow: '0 0 10px rgba(0, 242, 254, 0.05)',
                    letterSpacing: '0.2px'
                  }}>
                    {ip}
                  </span>
                ))
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Detecting local IPs...</span>
              )}
            </p>
          </div>
          <button 
            onClick={() => OpenBuilderWindow()}
            style={{
              background: 'rgba(255, 255, 255, 0.04)',
              backdropFilter: 'blur(16px)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderTop: '1px solid rgba(255, 255, 255, 0.18)',
              color: '#ffffff',
              padding: '10px 20px',
              borderRadius: '12px',
              fontSize: '12px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.05)',
              transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.borderColor = 'rgba(0, 242, 254, 0.3)';
              e.currentTarget.style.transform = 'scale(1.02)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.04)';
              e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.1)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            ⚙️ Open Builder
          </button>
        </div>

        {/* Dashboard Grid Container */}
        <div style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))',
          gap: '28px',
          overflowY: 'auto',
          paddingBottom: '24px',
          position: 'relative',
          zIndex: 5
        }}>
          {deviceRooms.map((room) => (
            <div 
              key={room.code}
              className="liquid-glass-card"
              style={{
                borderRadius: '24px',
                display: 'flex',
                flexDirection: 'column',
                height: '440px',
                overflow: 'hidden',
                position: 'relative'
              }}
            >
              {/* Card Header */}
              <div style={{
                padding: '18px 24px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                backgroundColor: 'rgba(255, 255, 255, 0.008)'
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    backgroundColor: room.clients.length > 0 ? 'var(--success)' : 'rgba(255,255,255,0.2)',
                    boxShadow: room.clients.length > 0 ? '0 0 12px var(--success), 0 0 4px var(--success)' : 'none',
                    transition: 'all 0.3s ease'
                  }} />
                  <span style={{ fontSize: '11px', fontWeight: 800, color: room.clients.length > 0 ? '#ffffff' : 'var(--text-3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                    {room.clients.length > 0 ? `${room.clients.length} Active Connection` : 'Awaiting Pair'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={async () => {
                      try {
                        const res = await RestartRoomTimer(room.code);
                        if (res === "Success") {
                          setDeviceRooms(prev => prev.map(r => r.code === room.code ? {
                            ...r,
                            createdAt: new Date().toISOString(),
                            logs: [...r.logs, `[${new Date().toLocaleTimeString()}] Room timer manual restart. Resetting 3-hour limit.`]
                          } : r));
                        } else {
                          showModal("Error", `Failed to restart room timer: ${res}`, "error");
                        }
                      } catch (err: any) {
                        showModal("Error", `Failed to restart room: ${err.message || err}`, "error");
                      }
                    }}
                    style={{
                      background: 'rgba(56, 189, 248, 0.04)',
                      border: '1px solid rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '6px 14px',
                      borderRadius: '10px',
                      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.12)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                      e.currentTarget.style.color = '#0ea5e9';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(56, 189, 248, 0.04)';
                      e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.15)';
                      e.currentTarget.style.color = '#38bdf8';
                    }}
                  >
                    Restart
                  </button>
                  <button
                    onClick={() => removeDeviceRoom(room.code)}
                    style={{
                      background: 'rgba(244, 63, 94, 0.04)',
                      border: '1px solid rgba(244, 63, 94, 0.15)',
                      color: '#fb7185',
                      fontSize: '11px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '6px 14px',
                      borderRadius: '10px',
                      transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.05)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'rgba(244, 63, 94, 0.12)';
                      e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.35)';
                      e.currentTarget.style.color = '#ef4444';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'rgba(244, 63, 94, 0.04)';
                      e.currentTarget.style.borderColor = 'rgba(244, 63, 94, 0.15)';
                      e.currentTarget.style.color = '#fb7185';
                    }}
                  >
                    Close Room
                  </button>
                </div>
              </div>

              {/* Card Body - Pairing Code */}
              <div style={{
                padding: '24px 24px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '4px',
                borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.25))'
              }}>
                <span style={{ fontSize: '10px', color: 'var(--text-3)', fontWeight: 800, letterSpacing: '2px', textTransform: 'uppercase' }}>
                  Pairing Passcode
                </span>
                <span style={{
                  fontSize: '40px',
                  fontWeight: 900,
                  color: '#ffffff',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '6px',
                  lineHeight: '1.1',
                  textShadow: '0 0 30px rgba(0, 242, 254, 0.35), 0 0 10px rgba(0, 242, 254, 0.15)'
                }}>
                  {room.code}
                </span>
                {room.createdAt && (
                  <span style={{
                    fontSize: '10.5px',
                    color: '#38bdf8',
                    fontWeight: 700,
                    fontFamily: 'var(--font-mono)',
                    marginTop: '6px',
                    letterSpacing: '0.5px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}>
                    ⏳ {(() => {
                      const created = new Date(room.createdAt).getTime();
                      const expires = created + 3 * 60 * 60 * 1000;
                      const diff = expires - Date.now();
                      if (diff <= 0) return "EXPIRED";
                      const totalSecs = Math.floor(diff / 1000);
                      if (totalSecs < 60) {
                        return `${totalSecs}s`;
                      }
                      const h = Math.floor(totalSecs / 3600);
                      const m = Math.floor((totalSecs % 3600) / 60);
                      if (h > 0) {
                        return `${h}h ${m.toString().padStart(2, '0')}m`;
                      }
                      return `${m}m`;
                    })()}
                  </span>
                )}
              </div>

              {/* Card Console Logs */}
              <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
              }}>
                <div style={{
                  padding: '10px 20px',
                  fontSize: '10px',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  color: 'var(--text-3)',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  backgroundColor: 'rgba(255,255,255,0.005)',
                  letterSpacing: '0.5px'
                }}>
                  Live Output Feed
                </div>
                <div style={{
                  flex: 1,
                  padding: '16px 20px',
                  overflowY: 'auto',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '12px',
                  backgroundColor: 'rgba(0, 0, 0, 0.25)',
                  boxShadow: 'inset 0 10px 20px rgba(0,0,0,0.15)'
                }}>
                  {(() => {
                    const parseLogsToSteps = (logs: string[]) => {
                      return logs.map(log => {
                        let time = "";
                        let message = log;
                        const match = log.match(/^\[(.*?)\]\s*(.*)$/);
                        if (match) {
                          time = match[1];
                          message = match[2];
                        }
                        
                        let title = "Status Update";
                        let description = message;
                        let type: 'info' | 'success' | 'error' | 'sync' | 'render' | 'ready' = 'info';

                        if (message.includes("created") || message.includes("Listening")) {
                          title = "Room Started";
                          description = "Room passcode generated. Waiting for device pairing.";
                          type = "ready";
                        } else if (message.includes("Syncing presentation workspace") || message.includes("Syncing workspace")) {
                          title = "Syncing Files";
                          description = "Transferring presentation slides and resources from Windows.";
                          type = "sync";
                        } else if (message.includes("Workspace synced")) {
                          title = "Workspace Loaded";
                          description = "Files successfully synchronized and saved.";
                          type = "success";
                        } else if (message.includes("Performer HTTP server active") || message.includes("HTTP server active")) {
                          title = "Preview Ready";
                          description = "Local server initialized to stream presentation.";
                          type = "success";
                        } else if (message.includes("Navigating to URL")) {
                          title = "Slide Changed";
                          const urlMatch = message.match(/Navigating to URL:\s*(.*)/);
                          description = urlMatch ? `Navigated to slide preview at ${urlMatch[1].split('/').pop() || urlMatch[1]}` : "Syncing slide view.";
                          type = "info";
                        } else if (message.includes("Received render request")) {
                          title = "Render Initiated";
                          description = "Controller requested a high-quality PDF compile.";
                          type = "info";
                        } else if (message.includes("Rendering") && message.includes("slides locally")) {
                          title = "Generating PDF Pages";
                          description = message;
                          type = "render";
                        } else if (message.includes("Finished rendering")) {
                          title = "PDF Compiled";
                          description = "PDF compilation completed successfully. Output sent.";
                          type = "success";
                        } else if (message.includes("error") || message.includes("failed") || message.includes("Error") || message.includes("tip:")) {
                          title = "Connection Status / Error";
                          description = message;
                          type = "error";
                        } else if (message.includes("recreated") || message.includes("limit") || message.includes("timeout")) {
                          title = "Room Timeout Policies";
                          description = message;
                          type = "error";
                        }
                        
                        return { time, title, description, type };
                      });
                    };

                    const steps = parseLogsToSteps(room.logs);
                    if (steps.length === 0) {
                      return <div style={{ color: 'var(--text-muted)', fontStyle: 'italic', fontSize: '11px', textAlign: 'center', marginTop: '20px' }}>Waiting for room activity...</div>;
                    }
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {steps.map((step, i) => {
                          let icon = "🔔";
                          let color = "var(--blue)";
                          let bg = "rgba(59, 130, 246, 0.06)";
                          let border = "rgba(59, 130, 246, 0.12)";
                          
                          if (step.type === 'success') {
                            icon = "⚙️";
                            color = "var(--success)";
                            bg = "rgba(16, 185, 129, 0.06)";
                            border = "rgba(16, 185, 129, 0.12)";
                          } else if (step.type === 'error') {
                            icon = "⚠️";
                            color = "#fb7185";
                            bg = "rgba(244, 63, 94, 0.06)";
                            border = "rgba(244, 63, 94, 0.12)";
                          } else if (step.type === 'sync') {
                            icon = "🔄";
                            color = "var(--accent)";
                            bg = "rgba(168, 85, 247, 0.06)";
                            border = "rgba(168, 85, 247, 0.12)";
                          } else if (step.type === 'render') {
                            icon = "📄";
                            color = "#00f2fe";
                            bg = "rgba(0, 242, 254, 0.06)";
                            border = "rgba(0, 242, 254, 0.12)";
                          } else if (step.type === 'ready') {
                            icon = "🌐";
                            color = "#38bdf8";
                            bg = "rgba(56, 189, 248, 0.06)";
                            border = "rgba(56, 189, 248, 0.12)";
                          }

                          return (
                            <div key={i} style={{
                              display: 'flex',
                              gap: '10px',
                              alignItems: 'flex-start',
                              backgroundColor: bg,
                              border: `1px solid ${border}`,
                              borderRadius: '12px',
                              padding: '8px 12px',
                              transition: 'all 0.2s ease',
                            }}>
                              <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                width: '24px',
                                height: '24px',
                                borderRadius: '50%',
                                backgroundColor: 'rgba(255,255,255,0.03)',
                                fontSize: '12px'
                              }}>
                                {icon}
                              </div>
                              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                  <span style={{ fontWeight: 700, color: '#ffffff', fontSize: '11px' }}>{step.title}</span>
                                  <span style={{ fontSize: '9px', color: 'var(--text-3)', fontWeight: 600 }}>{step.time}</span>
                                </div>
                                <span style={{ fontSize: '10.5px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.4' }}>{step.description}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          ))}

          {/* Add Device Button Card */}
          <div 
            onClick={addDeviceRoom}
            className="liquid-add-card"
            style={{
              borderRadius: '24px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              height: '440px',
              cursor: 'pointer',
              gap: '16px',
              textAlign: 'center',
              padding: '24px'
            }}
          >
            <div style={{
              fontSize: '56px',
              background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              fontWeight: 300,
              textShadow: '0 0 25px rgba(0, 242, 254, 0.3)'
            }}>
              +
            </div>
            <div>
              <h3 style={{ fontSize: '17px', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.3px' }}>Create Pairing Room</h3>
              <p style={{ fontSize: '12px', color: 'rgba(255, 255, 255, 0.45)', marginTop: '10px', maxWidth: '240px', lineHeight: '1.5' }}>
                Spawns a new pairing room code to connect another Windows Controller concurrently.
              </p>
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
            onClick={() => OpenBuilderWindow()}
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
            ⚙️ Open Builder Mode (New Window)
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
        appMode={appMode}
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
          appMode={appMode}
          osPlatform={osPlatform}
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
              {wsConnectionState === 'connected' && controllerRoomCreatedAt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '12px', borderLeft: '1px solid var(--border-1)', paddingLeft: '12px' }}>
                  <span style={{ color: '#38bdf8', fontWeight: 'bold', fontFamily: 'var(--font-mono)' }}>
                    ⏳ {(() => {
                      const created = new Date(controllerRoomCreatedAt).getTime();
                      const expires = created + 3 * 60 * 60 * 1000;
                      const diff = expires - Date.now();
                      if (diff <= 0) return "EXPIRED";
                      const totalSecs = Math.floor(diff / 1000);
                      if (totalSecs < 60) {
                        return `${totalSecs}s`;
                      }
                      const h = Math.floor(totalSecs / 3600);
                      const m = Math.floor((totalSecs % 3600) / 60);
                      if (h > 0) {
                        return `${h}h ${m.toString().padStart(2, '0')}m`;
                      }
                      return `${m}m`;
                    })()}
                  </span>
                  <button
                    onClick={() => {
                      if (controllerWS && controllerWS.readyState === 1) {
                        controllerWS.send(JSON.stringify({ type: 'extend_session' }));
                      }
                    }}
                    style={{
                      background: 'rgba(56, 189, 248, 0.1)',
                      border: '1px solid rgba(56, 189, 248, 0.3)',
                      color: '#38bdf8',
                      fontSize: '9px',
                      fontWeight: 800,
                      cursor: 'pointer',
                      padding: '2px 8px',
                      borderRadius: '6px',
                      textTransform: 'uppercase'
                    }}
                  >
                    Extend Session
                  </button>
                </div>
              )}
              <button 
                onClick={() => setWsConnectionState('disconnected')}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--rose)',
                  fontSize: '10px',
                  cursor: 'pointer',
                  marginLeft: '8px',
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

      {/* 8. Beautiful Custom Glassmorphism Alert Modal */}
      {genericModal && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(7, 8, 20, 0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          animation: 'fadeIn 0.2s ease-out',
          zIndex: 99999,
          alignItems: 'center',
          justifyContent: 'center'
        }}>
          <div style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-accent)',
            borderRadius: 'var(--radius-xl)',
            padding: '32px',
            width: '420px',
            maxWidth: '90%',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.4)',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '16px'
          }}>
            <div style={{
              fontSize: '48px'
            }}>
              {genericModal.type === 'success' ? '🎉' : genericModal.type === 'error' ? '❌' : 'ℹ️'}
            </div>
            <h3 style={{
              fontSize: '18px',
              fontWeight: 800,
              color: 'var(--text-1)',
              margin: 0
            }}>
              {genericModal.title}
            </h3>
            <p style={{
              fontSize: '13px',
              color: 'var(--text-2)',
              lineHeight: '1.6',
              margin: 0
            }}>
              {genericModal.message}
            </p>
            <button
              onClick={() => {
                if (genericModal.onClose) {
                  genericModal.onClose();
                }
                setGenericModal(null);
              }}
              style={{
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--blue) 100%)',
                border: 'none',
                color: '#07080a',
                padding: '10px 24px',
                borderRadius: '8px',
                fontWeight: 800,
                fontSize: '13px',
                cursor: 'pointer',
                transition: 'transform 0.1s ease, box-shadow 0.2s',
                marginTop: '12px'
              }}
            >
              Okay
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
export default App;
