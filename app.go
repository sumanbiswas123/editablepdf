package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/user"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/gorilla/websocket"
	"sync"
)

const shareHTMLPage = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Download PDF - NoCodeX ePDF Studio</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #0b0f19;
            --accent: #a855f7;
            --blue: #3b82f6;
            --text: #f3f4f6;
            --text-dim: #9ca3af;
        }
        body {
            margin: 0;
            padding: 0;
            background-color: var(--bg);
            color: var(--text);
            font-family: 'Outfit', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            overflow: hidden;
            position: relative;
        }
        .bg-glow {
            position: absolute;
            width: 300px;
            height: 300px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(168,85,247,0.15) 0%, transparent 70%);
            top: 10%;
            left: 10%;
            filter: blur(50px);
            z-index: 1;
        }
        .bg-glow-2 {
            position: absolute;
            width: 300px;
            height: 300px;
            border-radius: 50%;
            background: radial-gradient(circle, rgba(59,130,246,0.15) 0%, transparent 70%);
            bottom: 10%;
            right: 10%;
            filter: blur(50px);
            z-index: 1;
        }
        .container {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(255, 255, 255, 0.08);
            backdrop-filter: blur(20px);
            border-radius: 24px;
            padding: 40px;
            width: 90%;
            max-width: 380px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
            z-index: 10;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
        }
        .title {
            font-size: 18px;
            font-weight: 800;
            margin: 0;
            letter-spacing: 0.5px;
            background: linear-gradient(135deg, #fff, var(--text-dim));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        .filename {
            font-size: 12px;
            color: var(--text-dim);
            word-break: break-all;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            padding: 8px 12px;
            border-radius: 10px;
            max-width: 100%;
            box-sizing: border-box;
        }
        .download-btn {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--accent), var(--blue));
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 8px 24px rgba(168, 85, 247, 0.4);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.3s;
            position: relative;
            outline: none;
            margin: 10px 0;
        }
        .download-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 12px 30px rgba(168, 85, 247, 0.6);
        }
        .download-btn:active {
            transform: scale(0.95);
        }
        .download-icon {
            color: white;
            width: 32px;
            height: 32px;
            fill: none;
            stroke: currentColor;
            stroke-width: 2.5;
            stroke-linecap: round;
            stroke-linejoin: round;
            animation: bounce 2s infinite;
        }
        @keyframes bounce {
            0%, 100% {
                transform: translateY(0);
            }
            50% {
                transform: translateY(4px);
            }
        }
        .footer {
            font-size: 10px;
            color: rgba(255, 255, 255, 0.3);
            margin: 0;
        }
    </style>
</head>
<body>
    <div class="bg-glow"></div>
    <div class="bg-glow-2"></div>
    <div class="container">
        <h2 class="title">NoCodeX ePDF Studio</h2>
        <div class="filename">%s</div>
        <a href="/output/%s?download=true" download class="download-btn" title="Download PDF">
            <svg class="download-icon" viewBox="0 0 24 24">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
        </a>
        <p class="footer">Stitched Presentation File Share</p>
    </div>
</body>
</html>`

// Slide represents a discovered slide
type Slide struct {
	Name       string `json:"name"`
	FolderName string `json:"folderName"`
	IndexHTML  string `json:"indexHtml"`
	URL        string `json:"url"`
}

// ScanResult represents the scan details
type ScanResult struct {
	ParentPath string  `json:"parentPath"`
	Slides     []Slide `json:"slides"`
	HasShared  bool    `json:"hasShared"`
	ServerPort int     `json:"serverPort"`
}

// App struct
type App struct {
	ctx        context.Context
	app        *application.App
	server     *http.Server
	serverPort int
	currentDir string

	// PDF session state (used by StartPDFSession / CompileSingleStateToPDF / EndPDFSession)
	pdfCtx              context.Context
	pdfCancel           context.CancelFunc
	pdfAllocatorCancel  context.CancelFunc
	pdfTempDir          string
	pdfPaths            []string
	// WebSocket client for Mac control
	wsConns    map[string]*WSConnection
	wsConnsMu  sync.RWMutex
}

type WSConnection struct {
	conn     *websocket.Conn
	sendMu   sync.Mutex
	stopCh   chan struct{}
	roomCode string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// ServiceName returns the name of the service
func (a *App) ServiceName() string {
	return "App"
}

// ServiceStartup is called when the service starts
func (a *App) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	a.ctx = ctx
	a.app = application.Get()
	go func() {
		<-ctx.Done()
		a.CleanUpServer()
	}()
	return nil
}

// StartWSClient starts a WebSocket client that connects to the given server and room as a Mac role.
// mode is either "builder" or "capture" and affects behavior.
func (a *App) StartWSClient(serverURL, room, mode string) error {
	a.wsConnsMu.Lock()
	if a.wsConns == nil {
		a.wsConns = make(map[string]*WSConnection)
	}
	if _, exists := a.wsConns[room]; exists {
		a.wsConnsMu.Unlock()
		return fmt.Errorf("ws client already running for room %s", room)
	}
	a.wsConnsMu.Unlock()

	if serverURL == "" {
		serverURL = "ws://127.0.0.1:8081/ws"
	}
	u := fmt.Sprintf("%s?room=%s&role=mac", serverURL, room)
	conn, _, err := websocket.DefaultDialer.Dial(u, nil)
	if err != nil {
		return err
	}

	wsc := &WSConnection{
		conn:     conn,
		stopCh:   make(chan struct{}),
		roomCode: room,
	}

	a.wsConnsMu.Lock()
	a.wsConns[room] = wsc
	a.wsConnsMu.Unlock()

	go a.wsReadLoopForRoom(wsc, mode)
	return nil
}

// StopWSClientForRoom stops the running WebSocket client for a specific room.
func (a *App) StopWSClientForRoom(room string) error {
	a.wsConnsMu.Lock()
	wsc, ok := a.wsConns[room]
	if ok {
		delete(a.wsConns, room)
	}
	a.wsConnsMu.Unlock()

	if !ok {
		return nil
	}

	close(wsc.stopCh)
	wsc.sendMu.Lock()
	_ = wsc.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
	wsc.sendMu.Unlock()
	_ = wsc.conn.Close()
	return nil
}

// StopWSClient stops all active running WebSocket clients.
func (a *App) StopWSClient() error {
	a.wsConnsMu.Lock()
	var rooms []string
	for r := range a.wsConns {
		rooms = append(rooms, r)
	}
	a.wsConnsMu.Unlock()

	for _, r := range rooms {
		_ = a.StopWSClientForRoom(r)
	}
	return nil
}

func (a *App) wsReadLoopForRoom(wsc *WSConnection, mode string) {
	roomCode := wsc.roomCode
	for {
		select {
		case <-wsc.stopCh:
			return
		default:
		}
		var msg map[string]interface{}
		if err := wsc.conn.ReadJSON(&msg); err != nil {
			// connection closed or error
			_ = a.StopWSClientForRoom(roomCode)
			return
		}
		t, _ := msg["type"].(string)
		switch t {
		case "room_command":
			cmd, _ := msg["cmd"].(string)
			target, _ := msg["target"].(string)
			if cmd == "capture" {
				go a.handleCaptureCommandForRoom(roomCode, target)
			}
		case "render_request":
			jobsRaw, ok := msg["jobs"]
			requester, _ := msg["senderId"].(string)
			if ok && requester != "" {
				go a.handleRenderRequestForRoom(wsc, jobsRaw, requester)
			}
		case "sync_workspace":
			dataStr, _ := msg["data"].(string)
			go a.handleSyncWorkspace(dataStr)

		case "proxy_response":
			reqID, _ := msg["cmd"].(string)
			dataStr, _ := msg["data"].(string)
			mime, _ := msg["mimetype"].(string)
			statusVal, _ := msg["statusCode"].(float64)
			if reqID != "" {
				proxyRequestsMu.Lock()
				ch, ok := proxyRequests[reqID]
				proxyRequestsMu.Unlock()
				if ok {
					ch <- ProxyResponse{
						Data:       dataStr,
						Mimetype:   mime,
						StatusCode: int(statusVal),
					}
				}
			}
		case "devices_list":
			data, _ := msg["data"].(string)
			a.app.Event.Emit( "devices_list_updated", map[string]interface{}{
				"room": roomCode,
				"data": data,
			})
		case "room_info":
			data, _ := msg["data"].(string)
			a.app.Event.Emit("room_timer_updated", map[string]interface{}{
				"room": roomCode,
				"data": data,
			})
		}
	}
}

func (a *App) sendWS(msg interface{}) error {
	a.wsConnsMu.RLock()
	var wsc *WSConnection
	for _, conn := range a.wsConns {
		wsc = conn
		break
	}
	a.wsConnsMu.RUnlock()

	if wsc == nil {
		return fmt.Errorf("ws not connected")
	}

	wsc.sendMu.Lock()
	defer wsc.sendMu.Unlock()
	return wsc.conn.WriteJSON(msg)
}

func (a *App) sendWSForRoom(room string, msg interface{}) error {
	a.wsConnsMu.RLock()
	wsc, ok := a.wsConns[room]
	a.wsConnsMu.RUnlock()

	if !ok {
		return a.sendWS(msg)
	}

	wsc.sendMu.Lock()
	defer wsc.sendMu.Unlock()
	return wsc.conn.WriteJSON(msg)
}

func (a *App) emitViewershipEvent(roomCode string, msg string) {
	a.app.Event.Emit( "viewership_event", map[string]string{
		"room":    roomCode,
		"message": msg,
	})
}

// handleCaptureCommand performs a single-capture action for the first active room (fallback)
func (a *App) handleCaptureCommand(targetRoom string) {
	a.wsConnsMu.RLock()
	var roomCode string
	for r := range a.wsConns {
		roomCode = r
		break
	}
	a.wsConnsMu.RUnlock()
	a.handleCaptureCommandForRoom(roomCode, targetRoom)
}

func (a *App) handleCaptureCommandForRoom(room string, targetRoom string) {
	job := ExportJob{SlideName: "capture", FolderName: "", URL: "http://127.0.0.1:0/"}
	out, err := a.AutoCompileSlidePDF(job, 200)
	if err != nil {
		_ = a.sendWSForRoom(room, map[string]interface{}{"type": "error", "message": err.Error(), "target": targetRoom})
		return
	}
	b, err := os.ReadFile(out)
	if err != nil {
		_ = a.sendWSForRoom(room, map[string]interface{}{"type": "error", "message": err.Error(), "target": targetRoom})
		return
	}
	payload := base64.StdEncoding.EncodeToString(b)
	_ = a.sendWSForRoom(room, map[string]interface{}{"type": "file", "data": payload, "filename": filepath.Base(out), "mimetype": "application/pdf", "target": targetRoom})
}

func (a *App) handleRenderRequest(jobsRaw interface{}, requester string) {
	a.wsConnsMu.RLock()
	var wsc *WSConnection
	for _, conn := range a.wsConns {
		wsc = conn
		break
	}
	a.wsConnsMu.RUnlock()
	if wsc != nil {
		a.handleRenderRequestForRoom(wsc, jobsRaw, requester)
	}
}

func (a *App) handleRenderRequestForRoom(wsc *WSConnection, jobsRaw interface{}, requester string) {
	roomCode := wsc.roomCode
	a.emitViewershipEvent(roomCode, fmt.Sprintf("Received render request from client %s", requester))
	
	rawSlice, ok := jobsRaw.([]interface{})
	if !ok {
		if s, ok2 := jobsRaw.(string); ok2 {
			var parsed []ExportJob
			if err := json.Unmarshal([]byte(s), &parsed); err == nil {
				jobs := parsed
				a.emitViewershipEvent(roomCode, fmt.Sprintf("Rendering %d slides locally...", len(jobs)))
				outPath, err := a.CompileSlidesToPDFForRoom(roomCode, jobs, filepath.Join(os.TempDir(), fmt.Sprintf("render_%d.pdf", time.Now().Unix())), 200)
				if err != nil {
					a.emitViewershipEvent(roomCode, fmt.Sprintf("Render error: %s", err.Error()))
					if strings.Contains(err.Error(), "net::ERR_CONNECTION_TIMED_OUT") || strings.Contains(err.Error(), "net::ERR_ADDRESS_UNREACHABLE") {
						a.emitViewershipEvent(roomCode, "💡 Troubleshooting tip: Ensure both devices are on the exact same Wi-Fi network, client isolation is disabled on the router, and Windows Firewall permits incoming connections on the dynamic port.")
					}
					_ = a.sendWSForRoom(roomCode, map[string]interface{}{"type": "error", "message": err.Error(), "target": requester})
					return
				}
				b, _ := os.ReadFile(outPath)
				a.emitViewershipEvent(roomCode, fmt.Sprintf("Finished rendering! Sending PDF %s (%d bytes)", filepath.Base(outPath), len(b)))
				_ = a.sendWSForRoom(roomCode, map[string]interface{}{"type": "pdf", "data": base64.StdEncoding.EncodeToString(b), "filename": filepath.Base(outPath), "mimetype": "application/pdf", "target": requester})
				return
			}
		}
		a.emitViewershipEvent(roomCode, "Render error: invalid jobs payload")
		_ = a.sendWSForRoom(roomCode, map[string]interface{}{"type": "error", "message": "invalid jobs", "target": requester})
		return
	}
	
	var jobs []ExportJob
	for _, item := range rawSlice {
		if m, ok := item.(map[string]interface{}); ok {
			job := ExportJob{}
			if v, ok := m["slideName"].(string); ok { job.SlideName = v }
			if v, ok := m["folderName"].(string); ok { job.FolderName = v }
			if v, ok := m["url"].(string); ok { job.URL = v }
			if v, ok := m["customHtml"].(string); ok { job.CustomHTML = v }
			if v, ok := m["isSwimlane"].(bool); ok { job.IsSwimlane = v }
			jobs = append(jobs, job)
		}
	}
	a.emitViewershipEvent(roomCode, fmt.Sprintf("Rendering %d slides locally...", len(jobs)))
	outPath, err := a.CompileSlidesToPDFForRoom(roomCode, jobs, filepath.Join(os.TempDir(), fmt.Sprintf("render_%d.pdf", time.Now().Unix())), 200)
	if err != nil {
		a.emitViewershipEvent(roomCode, fmt.Sprintf("Render error: %s", err.Error()))
		if strings.Contains(err.Error(), "net::ERR_CONNECTION_TIMED_OUT") || strings.Contains(err.Error(), "net::ERR_ADDRESS_UNREACHABLE") {
			a.emitViewershipEvent(roomCode, "💡 Troubleshooting tip: Ensure both devices are on the exact same Wi-Fi network, client isolation is disabled on the router, and Windows Firewall permits incoming connections on the dynamic port.")
		}
		_ = a.sendWSForRoom(roomCode, map[string]interface{}{"type": "error", "message": err.Error(), "target": requester})
		return
	}
	b, _ := os.ReadFile(outPath)
	a.emitViewershipEvent(roomCode, fmt.Sprintf("Finished rendering! Sending PDF %s (%d bytes)", filepath.Base(outPath), len(b)))
	_ = a.sendWSForRoom(roomCode, map[string]interface{}{
		"type":     "pdf",
		"data":     base64.StdEncoding.EncodeToString(b),
		"filename": filepath.Base(outPath),
		"mimetype": "application/pdf",
		"target":   requester,
	})
}

// SelectDirectory triggers the folder selector dialog
func (a *App) SelectDirectory() (string, error) {
	dir, err := a.app.Dialog.OpenFile().
		SetTitle("Select eDA Presentation Root Directory").
		CanChooseDirectories(true).
		CanChooseFiles(false).
		PromptForSingleSelection()
	if err != nil {
		return "", err
	}
	return dir, nil
}

// ScanAndStartServer scans directory for slides and starts the local server
func (a *App) ScanAndStartServer(dirPath string) (*ScanResult, error) {
	if dirPath == "" {
		return nil, fmt.Errorf("directory path is empty")
	}

	// 1. Start local server
	port, err := a.startLocalServer(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to start local server: %w", err)
	}

	// 2. Scan directory
	files, err := os.ReadDir(dirPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %w", err)
	}

	var slides []Slide
	hasShared := false

	// Regex to extract numbers for sorting (e.g. "_001", "_002", "003")
	numReg := regexp.MustCompile(`\d+`)

	for _, file := range files {
		if !file.IsDir() {
			continue
		}

		name := file.Name()
		if name == "shared" {
			hasShared = true
			continue
		}

		// Check if it contains index.html
		indexPath := filepath.Join(dirPath, name, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			slideUrl := fmt.Sprintf("http://127.0.0.1:%d/%s/index.html", port, name)
			slides = append(slides, Slide{
				Name:       name,
				FolderName: name,
				IndexHTML:  indexPath,
				URL:        slideUrl,
			})
		}
	}

	// Sort slides based on numerical suffix or alphabetical name
	sort.Slice(slides, func(i, j int) bool {
		numStrI := numReg.FindString(slides[i].Name)
		numStrJ := numReg.FindString(slides[j].Name)

		if numStrI != "" && numStrJ != "" {
			numI, errI := strconv.Atoi(numStrI)
			numJ, errJ := strconv.Atoi(numStrJ)
			if errI == nil && errJ == nil {
				return numI < numJ
			}
		}
		return slides[i].Name < slides[j].Name
	})

	// Load description.json if it exists and apply descriptions to sorted slides
	descPath := filepath.Join(dirPath, "description.json")
	if descData, err := os.ReadFile(descPath); err == nil {
		var descriptions []string
		if err := json.Unmarshal(descData, &descriptions); err == nil && len(descriptions) > 0 {
			for i := 0; i < len(slides); i++ {
				if i < len(descriptions) {
					slides[i].Name = descriptions[i]
				}
			}
		}
	}

	return &ScanResult{
		ParentPath: dirPath,
		Slides:     slides,
		HasShared:  hasShared,
		ServerPort: port,
	}, nil
}

// startLocalServer starts a background HTTP server to resolve relative paths
func (a *App) startLocalServer(dirPath string) (int, error) {
	if a.server != nil {
		a.server.Shutdown(context.Background())
	}

	listener, err := net.Listen("tcp", "0.0.0.0:0")
	if err != nil {
		return 0, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	a.serverPort = port
	a.currentDir = dirPath

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Serve custom download landing page for shared links
		if strings.HasPrefix(r.URL.Path, "/share/") {
			filename := strings.TrimPrefix(r.URL.Path, "/share/")
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Header().Set("Access-Control-Allow-Origin", "*")
			fmt.Fprintf(w, shareHTMLPage, filename, filename)
			return
		}

		// Inject attachment header for download parameter
		if strings.HasPrefix(r.URL.Path, "/output/") && r.URL.Query().Get("download") == "true" {
			filename := filepath.Base(r.URL.Path)
			w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
		}

		// Prevent traversal attacks
		cleanedPath := filepath.Clean(r.URL.Path)
		fullPath := filepath.Join(dirPath, cleanedPath)

		// If the requested file doesn't exist, check if stripping the first folder segment works
		if _, err := os.Stat(fullPath); os.IsNotExist(err) {
			parts := strings.Split(strings.TrimPrefix(cleanedPath, "/"), "/")
			if len(parts) > 1 {
				altPath := filepath.Join(dirPath, filepath.Join(parts[1:]...))
				if _, errAlt := os.Stat(altPath); errAlt == nil {
					r.URL.Path = "/" + strings.Join(parts[1:], "/")
					cleanedPath = filepath.Clean(r.URL.Path)
					fullPath = altPath
				}
			}
		}

		// Check if it's a directory
		stat, err := os.Stat(fullPath)
		if err == nil && stat.IsDir() {
			fullPath = filepath.Join(fullPath, "index.html")
		}

		// Inject bridge script into index.html on-the-fly for cross-origin postMessage DOM capture with background text pruning
		if filepath.Base(fullPath) == "index.html" {
			content, err := os.ReadFile(fullPath)
			if err == nil {
				injection := `
<script>
(function() {

  // Inject visual presentation overlays
  try {
    var injectOverlays = function() {
      try {
        var target = document.body || document.documentElement;
        if (target && !document.getElementById('epdf-overlay-container')) {
          var container = document.createElement('div');
          container.id = 'epdf-overlay-container';
          container.style.cssText = 'position: fixed; inset: 0px; pointer-events: none; z-index: 999998;';
          container.innerHTML = ' \
            <div style="position: absolute; top: 6px; left: 7px; display: flex; align-items: center; gap: 8px; pointer-events: auto;"> \
              <img id="epdf-three-dots-btn" class="epdf-three-dot" src="BASE64_WHITE_DOTS" style="height: 14px; width: auto; object-fit: contain; cursor: pointer;" /> \
              <img src="BASE64_PENCIL" style="height: 27px; width: auto; object-fit: contain;" /> \
              <img src="BASE64_ARROWS" style="height: 15px; width: auto; object-fit: contain;" /> \
            </div> \
            <div style="position: absolute; top: 51px; left: 12px; pointer-events: auto;"> \
              <img src="BASE64_COLORS_DOTS" style="width: 12px; height: auto; object-fit: contain;" /> \
            </div> \
            <div id="epdf-stack-btn" style="position: absolute; bottom: 8px; left: 8px; pointer-events: auto; cursor: pointer;"> \
              <img src="BASE64_STACK" style="width: 30px; height: auto; object-fit: contain;" /> \
            </div> \
          ';
          target.appendChild(container);

          var threeDotsBtn = container.querySelector('#epdf-three-dots-btn');
          if (threeDotsBtn) {
            threeDotsBtn.onclick = function() {
              try {
                window.parent.postMessage({ type: 'epdf_toggle_veeva_menu' }, '*');
              } catch (_) {}
            };
          }

          var stackBtn = container.querySelector('#epdf-stack-btn');
          if (stackBtn) {
            stackBtn.onclick = function() {
              try {
                window.parent.postMessage({ type: 'epdf_toggle_bottom_bar' }, '*');
              } catch (_) {}
            };
          }
        }
      } catch(_) {}
    };
    injectOverlays();
    window.addEventListener('DOMContentLoaded', injectOverlays);
    window.addEventListener('load', injectOverlays);
    setInterval(injectOverlays, 100);
  } catch(_) {}

  // Force quicklinks stylesheet injection
  try {
    var injectStyles = function() {
      try {
        var target = document.head || document.documentElement;
        if (target && !document.getElementById('pdf-override-styles')) {
          var style = document.createElement('style');
          style.id = 'pdf-override-styles';
          style.innerHTML = ' .navBottom, .bottomnav { display: flex !important; visibility: visible !important; opacity: 1 !important; z-index: 9999999 !important; pointer-events: auto !important; } ';
          target.appendChild(style);
        }
      } catch(_) {}
    };
    injectStyles();
    window.addEventListener('DOMContentLoaded', injectStyles);
    window.addEventListener('load', injectStyles);
    setInterval(injectStyles, 100);
  } catch(_) {}

  var lastUrl = window.location.href;
  function checkUrl() {
    if (window.location.href !== lastUrl) {
      lastUrl = window.location.href;
      try {
        window.parent.postMessage({
          type: 'iframe_navigation',
          url: lastUrl
        }, '*');
      } catch(_) {}
    }
  }
  setInterval(checkUrl, 200);
  try {
    window.parent.postMessage({
      type: 'iframe_navigation',
      url: lastUrl
    }, '*');
  } catch(_) {}
})();

window.addEventListener('message', function(e) {
  var data = e.data;
  if (typeof data === 'string') {
    try {
      var parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        data = parsed;
      }
    } catch(_) {}
  }

  // ─── Handle: request_html (DOM capture for PDF compilation) ───
  var isRequestHtml = data === 'request_html' || (data && data.type === 'request_html');
  if (isRequestHtml) {
    // 1. Locate the topmost active popup in standard DOM (excluding backdrop overlays)
    var topActivePopup = null;
    var maxZ = -1;
    function findActivePopups(node) {
      if (!node) return;
      if (node.nodeType === 1) {
        var cs = window.getComputedStyle(node);
        var isVisible = cs.display !== 'none' && cs.visibility !== 'hidden' &&
                        node.offsetWidth > 0 && node.offsetHeight > 0;
        if (isVisible) {
          var nameStr = (node.className || '') + ' ' + (node.id || '');
          var isPopupName = /popup|modal|dialog|ref|window|pi|si|layer|pop/i.test(nameStr);
          var isOverlay = /overlay|backdrop|bg-dim|blocker/i.test(nameStr);
          if (isPopupName && !isOverlay) {
            var z = parseInt(cs.zIndex) || 0;
            if (z > maxZ) {
              maxZ = z;
              topActivePopup = node;
            }
          }
        }
      }
      Array.from(node.childNodes || []).forEach(findActivePopups);
    }
    try { findActivePopups(document.documentElement); } catch (_) {}

    var docClone = document.documentElement.cloneNode(true);
    if (topActivePopup) {
      topActivePopup.setAttribute('data-pdf-active-popup', 'true');
      var freshClone = document.documentElement.cloneNode(true);
      topActivePopup.removeAttribute('data-pdf-active-popup');
      docClone = freshClone;
    }

    var targetSelectors = new Set();
    try {
      Array.from(document.styleSheets).forEach(function(sheet) {
        try {
          var rules = sheet.cssRules || sheet.rules || [];
          Array.from(rules).forEach(function(rule) {
            if (!rule.selectorText) return;
            if (rule.selectorText.indexOf(':after') !== -1 || rule.selectorText.indexOf('::after') !== -1) {
              var display = rule.style.display || '';
              var width = rule.style.width || '';
              var cssText = rule.style.cssText || '';
              var isInlineBlock = display === 'inline-block' || cssText.indexOf('display: inline-block') !== -1;
              var isWidth100 = width === '100%' || cssText.indexOf('width: 100%') !== -1;
              if (isInlineBlock && isWidth100) {
                var baseSelector = rule.selectorText.replace(/::?after/g, '').trim();
                if (baseSelector) targetSelectors.add(baseSelector);
              }
            }
          });
        } catch (_) {}
      });
    } catch (_) {}

    targetSelectors.forEach(function(selector) {
      try {
        docClone.querySelectorAll(selector).forEach(function(el) {
          var hasText = Array.from(el.childNodes).some(function(n) {
            return n.nodeType === 3 && n.nodeValue.trim().length > 0;
          });
          if (hasText && !el.querySelector('.pdf-justify-helper')) {
            var helper = document.createElement('span');
            helper.className = 'pdf-justify-helper';
            helper.style.cssText = 'display: inline-block !important; width: 100% !important; font-size: inherit !important; line-height: inherit !important; margin: 0 !important; padding: 0 !important;';
            helper.innerHTML = '&nbsp;';
            el.appendChild(helper);
          }
        });
      } catch (_) {}
    });

    window.parent.postMessage({ type: 'captured_html', html: docClone.outerHTML }, '*');
    return;
  }

  // ─── Handle: iframe_execute (run arbitrary JS and return result) ───
  if (data && data.type === 'iframe_execute') {
    var id = data.id;
    var code = data.code;
    try {
      var result = (new Function('return (' + code + ')'))();
      // If result is a Promise (async code), wait for it
      if (result && typeof result === 'object' && typeof result.then === 'function') {
        result.then(function(val) {
          window.parent.postMessage({ type: 'iframe_execute_result', id: id, result: val }, '*');
        }).catch(function(err) {
          window.parent.postMessage({ type: 'iframe_execute_result', id: id, error: err.message || String(err) }, '*');
        });
      } else {
        window.parent.postMessage({ type: 'iframe_execute_result', id: id, result: result }, '*');
      }
    } catch (err) {
      window.parent.postMessage({ type: 'iframe_execute_result', id: id, error: err.message || String(err) }, '*');
    }
    return;
  }

  // ─── Handle: iframe_click (click element by CSS selector) ───
  if (data && data.type === 'iframe_click') {
    var selector = data.selector;
    try {
      var el = document.querySelector(selector);
      if (el) {
        var opts = { bubbles: true, cancelable: true, view: window };
        el.dispatchEvent(new MouseEvent('mousedown', opts));
        el.dispatchEvent(new MouseEvent('mouseup', opts));
        el.dispatchEvent(new MouseEvent('click', opts));
        // Also try .click() for jQuery-bound handlers
        try { el.click(); } catch(_) {}
        window.parent.postMessage({ type: 'iframe_click_result', success: true }, '*');
      } else {
        window.parent.postMessage({ type: 'iframe_click_result', success: false }, '*');
      }
    } catch (err) {
      window.parent.postMessage({ type: 'iframe_click_result', success: false }, '*');
    }
    return;
  }

  // ─── Handle: iframe_close_dialogs (close all visible popups/dialogs) ───
  if (data && data.type === 'iframe_close_dialogs') {
    try {
      var closed = false;
      // 1. Try jQuery UI dialog close buttons
      document.querySelectorAll('.ui-dialog-titlebar-close').forEach(function(btn) {
        try {
          var dlg = btn.closest('.ui-dialog');
          if (dlg && window.getComputedStyle(dlg).display !== 'none') {
            btn.click();
            closed = true;
          }
        } catch(_) {}
      });
      // 2. Try generic close buttons inside visible dialogs
      document.querySelectorAll('.dialog .close, .dialog .closeBtn, [class*="close"], .dialog-close').forEach(function(btn) {
        try {
          var dlg = btn.closest('.dialog, [role="dialog"]');
          if (dlg && window.getComputedStyle(dlg).display !== 'none') {
            btn.click();
            closed = true;
          }
        } catch(_) {}
      });
      // 3. Try jQuery .dialog('close') if available
      if (typeof jQuery !== 'undefined' || typeof $ !== 'undefined') {
        var jq = typeof jQuery !== 'undefined' ? jQuery : $;
        try {
          jq('.ui-dialog-content:visible').each(function() {
            try { jq(this).dialog('close'); closed = true; } catch(_) {}
          });
        } catch(_) {}
      }
      // 4. Force-hide known overlay IDs (references, pi, isi, etc.)
      ['#references', '#ref', '#pi', '#isi', '#si', '#bi', '#email', '#mail', '#mainpopup'].forEach(function(sel) {
        try {
          var el = document.querySelector(sel);
          if (el && window.getComputedStyle(el).display !== 'none') {
            el.style.display = 'none';
            closed = true;
          }
        } catch(_) {}
      });
      // 5. Hide jQuery UI backdrop overlays
      document.querySelectorAll('.ui-widget-overlay').forEach(function(o) {
        try { o.style.display = 'none'; closed = true; } catch(_) {}
      });
      window.parent.postMessage({ type: 'iframe_close_result', success: closed }, '*');
    } catch (err) {
      window.parent.postMessage({ type: 'iframe_close_result', success: false }, '*');
    }
    return;
  }
});

// 5. Headless Chrome Auto-Fix (runs ONLY inside the background PDF compiler browser instance)
if (navigator.userAgent.indexOf('HeadlessChrome') !== -1) {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      var targetSelectors = new Set();
      try {
        Array.from(document.styleSheets).forEach(function(sheet) {
          try {
            var rules = sheet.cssRules || sheet.rules || [];
            Array.from(rules).forEach(function(rule) {
              if (!rule.selectorText) return;
              if (rule.selectorText.indexOf(':after') !== -1 || rule.selectorText.indexOf('::after') !== -1) {
                var display = rule.style.display || '';
                var width = rule.style.width || '';
                var cssText = rule.style.cssText || '';
                var isInlineBlock = display === 'inline-block' || cssText.indexOf('display: inline-block') !== -1;
                var isWidth100 = width === '100%' || cssText.indexOf('width: 100%') !== -1;
                if (isInlineBlock && isWidth100) {
                  var baseSelector = rule.selectorText.replace(/::?after/g, '').trim();
                  if (baseSelector) targetSelectors.add(baseSelector);
                }
              }
            });
          } catch (_) {}
        });
      } catch (_) {}

      targetSelectors.forEach(function(selector) {
        try {
          document.querySelectorAll(selector).forEach(function(el) {
            var hasText = Array.from(el.childNodes).some(function(n) {
              return n.nodeType === 3 && n.nodeValue.trim().length > 0;
            });
            if (hasText && !el.querySelector('.pdf-justify-helper')) {
              var helper = document.createElement('span');
              helper.className = 'pdf-justify-helper';
              helper.style.cssText = 'display: inline-block !important; width: 100% !important; font-size: inherit !important; line-height: inherit !important; margin: 0 !important; padding: 0 !important;';
              helper.innerHTML = '&nbsp;';
              el.appendChild(helper);
            }
          });
        } catch (_) {}
      });
    }, 100);
  });
}
</script>
`
				htmlStr := string(content)
				// Insert before </body> if present, otherwise append
				importIdx := len(htmlStr)
				for i := len(htmlStr) - 7; i >= 0; i-- {
					if i+7 <= len(htmlStr) && htmlStr[i:i+7] == "</body>" {
						importIdx = i
						break
					}
				}
				resolvedInj := injection
				resolvedInj = strings.Replace(resolvedInj, "BASE64_WHITE_DOTS", a.GetAssetBase64("white-dots.png"), 1)
				resolvedInj = strings.Replace(resolvedInj, "BASE64_PENCIL", a.GetAssetBase64("pencil.png"), 1)
				resolvedInj = strings.Replace(resolvedInj, "BASE64_ARROWS", a.GetAssetBase64("arrows.png"), 1)
				resolvedInj = strings.Replace(resolvedInj, "BASE64_COLORS_DOTS", a.GetAssetBase64("colors-dots.png"), 1)
				resolvedInj = strings.Replace(resolvedInj, "BASE64_STACK", a.GetAssetBase64("stack.png"), 1)

				htmlStr = htmlStr[:importIdx] + resolvedInj + htmlStr[importIdx:]

				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				w.Header().Set("Access-Control-Allow-Origin", "*")
				w.Write([]byte(htmlStr))
				return
			}
		}

		w.Header().Set("Access-Control-Allow-Origin", "*")
		http.FileServer(http.Dir(dirPath)).ServeHTTP(w, r)
	})

	a.server = &http.Server{
		Handler: mux,
	}

	go func() {
		if err := a.server.Serve(listener); err != http.ErrServerClosed {
			fmt.Printf("HTTP server error: %v\n", err)
		}
	}()

	return port, nil
}

// CaptureCustomStateHTML saves interactive outerHTML to a temp file, stripping scripts to freeze dynamic content
func (a *App) CaptureCustomStateHTML(folderName string, htmlContent string) (string, error) {
	if a.currentDir == "" {
		return "", fmt.Errorf("no root directory selected")
	}

	// Strip all script tags to freeze dynamically injected elements (like ref, pi, si)
	reScript := regexp.MustCompile(`(?s)<script.*?>.*?</script>`)
	frozenHTML := reScript.ReplaceAllString(htmlContent, "")

	// Also strip inline onload/onerror script attributes to prevent any execution
	reOnload := regexp.MustCompile(`(?i)\s(onload|onerror|onclick)\s*=\s*"[^"]*"`)
	frozenHTML = reOnload.ReplaceAllString(frozenHTML, "")

	// Create temp file inside slide folder so relative resources resolve cleanly
	filename := fmt.Sprintf("temp_state_%d.html", time.Now().UnixNano())
	fullPath := filepath.Join(a.currentDir, folderName, filename)

	err := os.WriteFile(fullPath, []byte(frozenHTML), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to save temporary state HTML: %w", err)
	}

	tempUrl := fmt.Sprintf("http://127.0.0.1:%d/%s/%s", a.serverPort, folderName, filename)
	return tempUrl, nil
}

// SelectScreenshotSavePath triggers a native save file dialog for screenshots
func (a *App) SelectScreenshotSavePath(defaultFilename string) (string, error) {
	return a.app.Dialog.SaveFile().
		SetMessage("Save Slide Screenshot").
		SetFilename(defaultFilename).
		AddFilter("PNG Image (*.png)", "*.png").
		PromptForSingleSelection()
}

// CompileScreenshot exports a single slide visual screenshot to a PNG file
func (a *App) CompileScreenshot(job ExportJob, outputPath string, sleepMs int) (string, error) {
	// Create a single chromedp headless instance in context
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	renderUrl := job.URL
	var tempFile string

	// If custom interactive state HTML is provided, write it temporarily (with scripts stripped)
	if job.CustomHTML != "" {
		var err error
		renderUrl, err = a.CaptureCustomStateHTML(job.FolderName, job.CustomHTML)
		if err != nil {
			return "", err
		}
		tempFile = filepath.Base(renderUrl)
	}

	// Determine dimensions based on folder, slide name, or URL containing "vertical"
	width := int64(1024)
	height := int64(768)
	orientation := emulation.OrientationTypeLandscapePrimary
	angle := int64(90)

	if strings.Contains(strings.ToLower(job.FolderName), "vertical") ||
		strings.Contains(strings.ToLower(job.SlideName), "vertical") ||
		strings.Contains(strings.ToLower(renderUrl), "vertical") {
		width = 768
		height = 1024
		orientation = emulation.OrientationTypePortraitPrimary
		angle = 0
	}

	// Capture visual screenshot using chromedp
	var buf []byte
	err := chromedp.Run(ctx,
		// Lock viewport to dimensions
		emulation.SetDeviceMetricsOverride(width, height, 1, false).
			WithScreenOrientation(&emulation.ScreenOrientation{
				Type:  orientation,
				Angle: angle,
			}),
		chromedp.Navigate(renderUrl),
		chromedp.WaitReady("body"),
		chromedp.Sleep(time.Duration(sleepMs)*time.Millisecond),
		chromedp.Screenshot("body", &buf, chromedp.ByID),
	)

	// Clean up temporary HTML file immediately after screenshot
	if tempFile != "" {
		a.CleanUpTempHTML(job.FolderName, tempFile)
	}

	if err != nil {
		return "", fmt.Errorf("failed to capture screenshot for '%s': %w", job.SlideName, err)
	}

	// Write screenshot bytes to file
	err = os.WriteFile(outputPath, buf, 0644)
	if err != nil {
		return "", fmt.Errorf("failed to save screenshot image: %w", err)
	}

	return outputPath, nil
}

// CleanUpTempHTML deletes the generated temporary HTML state file
func (a *App) CleanUpTempHTML(folderName string, tempFilename string) {
	if a.currentDir == "" {
		return
	}
	fullPath := filepath.Join(a.currentDir, folderName, tempFilename)
	os.Remove(fullPath)
}

// ExportPDFJobs exports selected slide URLs into a single merged editable PDF
type ExportJob struct {
	SlideName    string `json:"slideName"`
	FolderName   string `json:"folderName"`
	URL          string `json:"url"`
	CustomHTML   string `json:"customHtml"`   // Optional custom interactive DOM state
	TempFilename string `json:"tempFilename"` // Kept for cleanup
	IsSwimlane   bool   `json:"isSwimlane"`   // Flag indicating if this is a swimlane capture
}

func (a *App) CompileSlidesToPDF(jobs []ExportJob, outputPath string, sleepMs int) (string, error) {
	return a.CompileSlidesToPDFForRoom("", jobs, outputPath, sleepMs)
}

func (a *App) CompileSlidesToPDFForRoom(roomCode string, jobs []ExportJob, outputPath string, sleepMs int) (string, error) {
	if len(jobs) == 0 {
		return "", fmt.Errorf("no slides specified for compilation")
	}

	// 1. Create a temp directory for individual slide PDFs
	tempDir, err := os.MkdirTemp("", "wails_pdf_compile_")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}
	defer os.RemoveAll(tempDir)

	// Create a single chromedp headless instance in context
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	// Ensure browser starts
	if err := chromedp.Run(ctx); err != nil {
		return "", fmt.Errorf("failed to initialize headless browser: %w", err)
	}

	var pdfPaths []string

	for idx, job := range jobs {
		progress := map[string]interface{}{
			"current": idx + 1,
			"total":   len(jobs),
			"slide":   job.SlideName,
			"phase":   "rendering",
		}
		if roomCode != "" {
			progress["room"] = roomCode
		}
		a.app.Event.Emit( "compilation_progress", progress)

		renderUrl := job.URL
		if a.currentDir != "" && a.serverPort != 0 {
			if parsed, err := url.Parse(renderUrl); err == nil {
				renderUrl = fmt.Sprintf("http://127.0.0.1:%d%s", a.serverPort, parsed.Path)
			}
		} else if a.currentDir == "" {
			if parsed, err := url.Parse(renderUrl); err == nil {
				if roomCode != "" {
					renderUrl = fmt.Sprintf("http://127.0.0.1:8081/proxy/%s%s", roomCode, parsed.Path)
				} else {
					renderUrl = fmt.Sprintf("http://127.0.0.1:8081/proxy%s", parsed.Path)
				}
			}
		}
		
		if roomCode != "" {
			a.emitViewershipEvent(roomCode, fmt.Sprintf("Navigating to URL: %s", renderUrl))
		} else {
			a.app.Event.Emit( "viewership_event", fmt.Sprintf("Navigating to URL: %s", renderUrl))
		}

		// If custom interactive state HTML is provided, write it temporarily (only if workspace path is set locally)
		var tempFile string
		if job.CustomHTML != "" && a.currentDir != "" {
			var err error
			renderUrl, err = a.CaptureCustomStateHTML(job.FolderName, job.CustomHTML)
			if err != nil {
				return "", err
			}
			tempFile = filepath.Base(renderUrl)
		}

		// Filepath to save individual page PDF
		pdfPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d.pdf", idx))

		// Determine dimensions based on folder, slide name, or URL containing "vertical"
		width := int64(1024)
		height := int64(768)
		paperWidth := 10.66
		paperHeight := 8.00
		orientation := emulation.OrientationTypeLandscapePrimary
		angle := int64(90)

		if strings.Contains(strings.ToLower(job.FolderName), "vertical") ||
			strings.Contains(strings.ToLower(job.SlideName), "vertical") ||
			strings.Contains(strings.ToLower(renderUrl), "vertical") {
			width = 768
			height = 1024
			paperWidth = 8.00
			paperHeight = 10.66
			orientation = emulation.OrientationTypePortraitPrimary
			angle = 0
		}

		// Execute page loading, locking viewport, and printing to PDF
		var buf []byte
		var screenshotBuf []byte

		deviceScaleFactor := float64(1)
		if job.IsSwimlane {
			deviceScaleFactor = 3 // 3x Retina scale for crisp screenshots
		}

		actions := []chromedp.Action{
			// Force screen media emulation to render screen-specific layouts, fonts, backgrounds, and pseudo-elements
			emulation.SetEmulatedMedia().WithMedia("screen"),
			// Lock viewport to dimensions to prevent layout shifts
			emulation.SetDeviceMetricsOverride(width, height, deviceScaleFactor, false).
				WithScreenOrientation(&emulation.ScreenOrientation{
					Type:  orientation,
					Angle: angle,
				}),
			chromedp.Navigate(renderUrl),
			// Wait for body to be loaded
			chromedp.WaitReady("body"),
			// Settle time for custom transitions or web fonts
			chromedp.Sleep(time.Duration(sleepMs) * time.Millisecond),
		}

		if job.CustomHTML != "" && a.currentDir == "" {
			// Strip/freeze the HTML in Go
			reScript := regexp.MustCompile(`(?s)<script.*?>.*?</script>`)
			frozen := reScript.ReplaceAllString(job.CustomHTML, "")
			reOnload := regexp.MustCompile(`(?i)\s(onload|onerror|onclick)\s*=\s*"[^"]*"`)
			frozen = reOnload.ReplaceAllString(frozen, "")

			actions = append(actions,
				chromedp.ActionFunc(func(ctx context.Context) error {
					jsScript := fmt.Sprintf(`(function() {
						document.open();
						document.write(%q);
						document.close();
					})()`, frozen)
					return chromedp.Evaluate(jsScript, nil).Do(ctx)
				}),
				chromedp.Sleep(200 * time.Millisecond), // Settle down after document.write
			)
		}

		// Set document title with JSON metadata of slide/popup details so Chrome embeds it into PDF metadata
		presentationId := "presentation_deck"
		if a.currentDir != "" {
			presentationId = filepath.Base(a.currentDir)
		}
		timestampStr := time.Now().Format(time.RFC3339)
		actions = append(actions,
			chromedp.ActionFunc(func(ctx context.Context) error {
				jsScript := fmt.Sprintf(`(function() {
					function getActivePopups() {
						var selectors = ['.ui-dialog', '#customMenuWrapper', '#flowSelector', '#fragmentSelector', '#pi', '#references', '#ref', '#isi', '#si', '#email', '#mail', '#bi', '#mainpopup'];
						var dialogs = Array.from(document.querySelectorAll(selectors.join(', '))).filter(function(d) {
							var cs = window.getComputedStyle(d);
							if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
							var rect = d.getBoundingClientRect();
							if (rect.width <= 150 || rect.height <= 150) return false;
							var isInViewport = rect.left < window.innerWidth && rect.right > 0 && rect.top < window.innerHeight && rect.bottom > 0;
							if (!isInViewport) return false;
							if (d.classList.contains('inactive') || d.classList.contains('hidden')) return false;
							return true;
						});
						function getActiveScore(el) {
							var score = 0;
							var cls = el.className.toLowerCase();
							var id = el.id.toLowerCase();
							if (cls.includes('activenav') || cls.includes('active-nav') || id.includes('activenav')) {
								score += 5000000;
							}
							if (cls.includes('active') || id.includes('active')) {
								score += 2000000;
							}
							if (cls.includes('open') || cls.includes('show') || cls.includes('visible') || id.includes('open') || id.includes('show') || id.includes('visible')) {
								score += 1000000;
							}
							if (cls.includes('inactive') || cls.includes('hidden') || cls.includes('close') || id.includes('inactive') || id.includes('hidden') || id.includes('close')) {
								score -= 10000000;
							}
							return score;
						}
						dialogs.sort(function(a, b) {
							var scoreA = getActiveScore(a);
							var scoreB = getActiveScore(b);
							if (scoreA !== scoreB) return scoreB - scoreA;
							var zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
							var zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
							if (zA !== zB) return zB - zA;
							var allElements = Array.from(document.querySelectorAll('*'));
							return allElements.indexOf(b) - allElements.indexOf(a);
						});
						return dialogs;
					}

					var dialogs = getActivePopups();

					var metadata = {
						presentationId: %q,
						slideName: %q,
						folderName: %q,
						type: "slide",
						timestamp: %q
					};

					if (dialogs.length > 0) {
						var openPopups = dialogs.map(function(d) {
							var type = "slide_popup";
							var id = d.id || "";
							var cls = d.className || "";
							
							// Target ONLY the immediate jQuery UI dialog content element to extract the exact container ID/class
							var innerContent = d.querySelector('.ui-dialog-content');
							if (innerContent) {
								id = innerContent.id || "";
								cls = innerContent.className || "";
							}
							
							var lowerId = id.toLowerCase();
							var lowerCls = cls.toLowerCase();
							
							// Check if it is a shared popup
							if (lowerId === 'custommenuwrapper' || lowerCls.includes('menu')) {
								type = "menu";
							} else if (lowerId === 'flowselector' || lowerCls.includes('flow')) {
								type = "flow";
							} else if (lowerId === 'fragmentselector' || lowerCls.includes('fragment')) {
								type = "fragment";
							} else if (lowerId.includes('ref') || lowerCls.includes('ref') || lowerId.includes('reference') || lowerCls.includes('reference') || d.querySelector('.refTitle, [class*="reftitle"], [class*="refTitle"]')) {
								type = "ref";
							} else if (lowerId.includes('pi') || lowerCls.includes('pi') || lowerId.includes('prescrib') || lowerCls.includes('prescrib') || d.querySelector('.piTitle, [class*="pititle"], [class*="piTitle"]')) {
								type = "pi";
							} else if (lowerId.includes('isi') || lowerCls.includes('isi') || lowerId.includes('safety') || lowerCls.includes('safety') || d.querySelector('.isiTitle, [class*="isititle"], [class*="isiTitle"]')) {
								type = "isi";
							} else if (lowerId.includes('si') || lowerCls.includes('si')) {
								type = "si";
							} else if (lowerId.includes('email') || lowerCls.includes('email') || lowerId.includes('mail') || lowerCls.includes('mail')) {
								type = "email";
							}

							return {
								id: id,
								className: cls,
								type: type,
								zIndex: parseInt(window.getComputedStyle(d).zIndex) || 0
							};
						});

						metadata.openPopups = openPopups;

						// Topmost popup
						var topmost = openPopups[0];
						
						// Determine type of compilation unit
						var isSharedTopmost = ["menu", "flow", "fragment", "ref", "pi", "isi", "si", "email"].includes(topmost.type) || 
						                      topmost.id === 'customMenuWrapper' || 
						                      topmost.id === 'flowSelector' || 
						                      topmost.id === 'fragmentSelector';

						if (isSharedTopmost) {
							// Find if there is a slide popup behind it (e.g., standard .ui-dialog or other non-shared popups)
							var parentPopup = null;
							for (var i = 1; i < openPopups.length; i++) {
								if (openPopups[i].type === "slide_popup") {
									parentPopup = openPopups[i];
									break;
								}
							}

							if (parentPopup) {
								metadata.type = "shared_on_popup";
								metadata.parentPopup = {
									id: parentPopup.id,
									className: parentPopup.className
								};
								metadata.sharedType = topmost.type;
							} else {
								metadata.type = "shared_on_slide";
								metadata.sharedType = topmost.type;
							}
						} else {
							metadata.type = "popup";
							metadata.popupInfo = {
								id: topmost.id,
								className: topmost.className
							};
						}
					}

					document.title = JSON.stringify(metadata);
				})()`, presentationId, strings.TrimPrefix(job.FolderName, "_"), job.FolderName, timestampStr)
				return chromedp.Evaluate(jsScript, nil).Do(ctx)
			}),
		)

		// If a dynamic popup state is captured, we surgically flatten `#contentFrame` to a high-res screenshot
		// Handles 3 scenarios:
		//   1. No popup (CustomHTML == "") → fully editable vector PDF (this block is skipped entirely)
		//   2. CustomHTML set but no visible popups (user closed popup before saving) → also fully editable
		//   3. One popup open → screenshot #contentFrame as flat background, popup stays editable
		//   4. Layered popups (shared over slide popup) → screenshot #contentFrame, hide ALL lower popups,
		//      only the TOPMOST popup remains editable
		if job.CustomHTML != "" {
			actions = append(actions,
				// 1. Detect visible popups. If NONE are visible, mark flag to skip flattening.
				//    If popups ARE visible: save original display values, hide them all for clean screenshot.
				chromedp.Evaluate(`(function() {
					function getActivePopups() {
						var selectors = ['.ui-dialog', '#customMenuWrapper', '#flowSelector', '#fragmentSelector', '#pi', '#references', '#ref', '#isi', '#si', '#email', '#mail', '#bi', '#mainpopup'];
						var dialogs = Array.from(document.querySelectorAll(selectors.join(', '))).filter(function(d) {
							var cs = window.getComputedStyle(d);
							if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
							var rect = d.getBoundingClientRect();
							if (rect.width <= 150 || rect.height <= 150) return false;
							var isInViewport = rect.left < window.innerWidth && rect.right > 0 && rect.top < window.innerHeight && rect.bottom > 0;
							if (!isInViewport) return false;
							if (d.classList.contains('inactive') || d.classList.contains('hidden')) return false;
							return true;
						});
						function getActiveScore(el) {
							var score = 0;
							var cls = el.className.toLowerCase();
							var id = el.id.toLowerCase();
							if (cls.includes('activenav') || cls.includes('active-nav') || id.includes('activenav')) {
								score += 5000000;
							}
							if (cls.includes('active') || id.includes('active')) {
								score += 2000000;
							}
							if (cls.includes('open') || cls.includes('show') || cls.includes('visible') || id.includes('open') || id.includes('show') || id.includes('visible')) {
								score += 1000000;
							}
							if (cls.includes('inactive') || cls.includes('hidden') || cls.includes('close') || id.includes('inactive') || id.includes('hidden') || id.includes('close')) {
								score -= 10000000;
							}
							return score;
						}
						dialogs.sort(function(a, b) {
							var scoreA = getActiveScore(a);
							var scoreB = getActiveScore(b);
							if (scoreA !== scoreB) return scoreB - scoreA;
							var zA = parseInt(window.getComputedStyle(a).zIndex) || 0;
							var zB = parseInt(window.getComputedStyle(b).zIndex) || 0;
							if (zA !== zB) return zB - zA;
							var allElements = Array.from(document.querySelectorAll('*'));
							return allElements.indexOf(b) - allElements.indexOf(a);
						});
						return dialogs;
					}

					var dialogs = getActivePopups();

					// NO visible popups → skip flattening, render as fully editable vector PDF
					if (dialogs.length === 0) {
						window._pdfSkipFlatten = true;
						return 0;
					}
					window._pdfSkipFlatten = false;

					// Save original display and hide the TOPMOST popup (will be restored as editable)
					dialogs[0].setAttribute('data-pdf-topmost', 'true');
					dialogs[0].setAttribute('data-pdf-orig-display', dialogs[0].style.display || '');
					dialogs[0].style.setProperty('display', 'none', 'important');

					// Save and hide ALL lower popups (stay hidden permanently - no text bleed)
					for (var i = 1; i < dialogs.length; i++) {
						dialogs[i].setAttribute('data-pdf-lower-popup', 'true');
						dialogs[i].setAttribute('data-pdf-orig-display', dialogs[i].style.display || '');
						dialogs[i].style.setProperty('display', 'none', 'important');
					}

					// Save and hide ALL jQuery UI backdrop overlays for clean screenshot
					document.querySelectorAll('.ui-widget-overlay').forEach(function(o, idx) {
						o.setAttribute('data-pdf-overlay', 'true');
						o.setAttribute('data-pdf-orig-display', o.style.display || '');
						o.style.setProperty('display', 'none', 'important');
					});

					return dialogs.length;
				})()`, nil),

				// 2. Screenshot #contentFrame (only if popups were found)
				chromedp.ActionFunc(func(ctx context.Context) error {
					// Check if we should skip flattening
					var skip bool
					if err := chromedp.Evaluate(`window._pdfSkipFlatten === true`, &skip).Do(ctx); err != nil {
						return err
					}
					if skip {
						return nil // No visible popups → skip screenshot, keep fully editable
					}
					// Take screenshot of clean #contentFrame
					return chromedp.Screenshot("#contentFrame", &screenshotBuf, chromedp.ByID).Do(ctx)
				}),

				// 3. If popups exist: flatten #contentFrame → screenshot image, restore ONLY topmost popup
				chromedp.ActionFunc(func(ctx context.Context) error {
					// Check skip flag again
					var skip bool
					if err := chromedp.Evaluate(`window._pdfSkipFlatten === true`, &skip).Do(ctx); err != nil {
						return err
					}
					if skip {
						return nil // Fully editable → do nothing
					}

					base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(screenshotBuf)
					jsScript := fmt.Sprintf(`(function() {
						// Flatten #contentFrame by hiding direct content containers and keeping stylesheets active
						var cf = document.querySelector("#contentFrame");
						if (cf) {
							Array.from(cf.children).forEach(function(child) {
								var tagName = child.tagName.toLowerCase();
								if (tagName !== 'style' && tagName !== 'link' && !child.hasAttribute('data-pdf-flattened-bg')) {
									child.style.setProperty('display', 'none', 'important');
								}
							});
							
							var bgImg = document.createElement('img');
							bgImg.src = "%s";
							bgImg.style.cssText = "width:100%%; height:100%%; object-fit:cover; margin:0; padding:0; border:none; display:block; position:absolute; top:0; left:0; z-index:-1;";
							bgImg.setAttribute('data-pdf-flattened-bg', 'true');
							cf.appendChild(bgImg);
						}

						// Restore ONLY the topmost popup with its ORIGINAL display value
						var topmost = document.querySelector('[data-pdf-topmost="true"]');
						if (topmost) {
							var origDisplay = topmost.getAttribute('data-pdf-orig-display') || 'block';
							topmost.style.display = origDisplay || 'block';
							topmost.removeAttribute('data-pdf-topmost');
							topmost.removeAttribute('data-pdf-orig-display');
						}

						// Restore the LAST overlay backdrop (for topmost popup's visual dimming)
						var overlays = Array.from(document.querySelectorAll('[data-pdf-overlay="true"]'));
						if (overlays.length > 0) {
							var lastOverlay = overlays[overlays.length - 1];
							var origDisplay = lastOverlay.getAttribute('data-pdf-orig-display') || 'block';
							lastOverlay.style.display = origDisplay || 'block';
							lastOverlay.removeAttribute('data-pdf-overlay');
							lastOverlay.removeAttribute('data-pdf-orig-display');
						}

						// Lower popups stay display:none — text fully suppressed
						// Lower overlays stay display:none — no stacking artifacts
						return "restored";
					})()`, base64Str)
					return chromedp.Evaluate(jsScript, nil).Do(ctx)
				}),
			)
		}

		if job.IsSwimlane {
			actions = append(actions,
				chromedp.ActionFunc(func(ctx context.Context) error {
					var screenshotBuf []byte
					if err := chromedp.CaptureScreenshot(&screenshotBuf).Do(ctx); err != nil {
						return fmt.Errorf("failed to take swimlane screenshot: %w", err)
					}

					base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(screenshotBuf)

					jsScript := fmt.Sprintf(`(function() {
						document.documentElement.style.cssText = "margin:0; padding:0; width:100%%; height:100%%; overflow:hidden;";
						document.body.style.cssText = "margin:0; padding:0; width:100%%; height:100%%; overflow:hidden;";
						document.body.innerHTML = '<img src="%s" style="width:100%%; height:100%%; object-fit:fill; display:block; margin:0; padding:0;" />';
					})()`, base64Str)

					if err := chromedp.Evaluate(jsScript, nil).Do(ctx); err != nil {
						return fmt.Errorf("failed to replace document with screenshot: %w", err)
					}

					// Wait a tiny bit for Chrome to process the base64 image injection
					time.Sleep(150 * time.Millisecond)
					return nil
				}),
			)
		}

		// Finally, add the PrintToPDF printing action to the pipeline
		actions = append(actions,
			chromedp.ActionFunc(func(ctx context.Context) error {
				var err error
				// Print to perfect aspect ratio with zero margins
				buf, _, err = page.PrintToPDF().
					WithPrintBackground(true).
					WithPaperWidth(paperWidth).
					WithPaperHeight(paperHeight).
					WithMarginTop(0).
					WithMarginBottom(0).
					WithMarginLeft(0).
					WithMarginRight(0).
					WithPreferCSSPageSize(false).
					Do(ctx)
				return err
			}),
		)

		err = chromedp.Run(ctx, actions...)

		// Clean up temporary HTML file immediately after render
		if tempFile != "" {
			a.CleanUpTempHTML(job.FolderName, tempFile)
		}

		if err != nil {
			return "", fmt.Errorf("failed to print slide '%s' to PDF: %w", job.SlideName, err)
		}

		// Write page PDF bytes to disk
		err = os.WriteFile(pdfPath, buf, 0644)
		if err != nil {
			return "", fmt.Errorf("failed to save temp page PDF: %w", err)
		}

		pdfPaths = append(pdfPaths, pdfPath)
	}

	// 2. Merge all page PDFs into a single file using pdfcpu
	progressMerge := map[string]interface{}{
		"current": len(jobs),
		"total":   len(jobs),
		"slide":   "All Slides",
		"phase":   "merging",
	}
	if roomCode != "" {
		progressMerge["room"] = roomCode
	}
	a.app.Event.Emit( "compilation_progress", progressMerge)

	err = api.MergeCreateFile(pdfPaths, outputPath, false, nil)
	if err != nil {
		return "", fmt.Errorf("failed to merge slide PDFs: %w", err)
	}

	return outputPath, nil
}

// CompileSlidesToIDML extracts exact DOM absolute coordinate elements via chromedp and generates an IDML spread deck
func (a *App) CompileSlidesToIDML(jobs []ExportJob, outputPath string, sleepMs int) (string, error) {
	if len(jobs) == 0 {
		return "", fmt.Errorf("no slides specified for IDML compilation")
	}

	// Create a single chromedp headless instance
	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	// Ensure browser starts
	if err := chromedp.Run(ctx); err != nil {
		return "", fmt.Errorf("failed to initialize headless browser: %w", err)
	}

	var idmlSlides []IDMLSlide

	for idx, job := range jobs {
		a.app.Event.Emit( "compilation_progress", map[string]interface{}{
			"current": idx + 1,
			"total":   len(jobs),
			"slide":   job.SlideName,
			"phase":   "rendering",
		})

		renderUrl := job.URL
		var tempFile string

		// Use captured dynamic interactive state if provided
		if job.CustomHTML != "" {
			var err error
			renderUrl, err = a.CaptureCustomStateHTML(job.FolderName, job.CustomHTML)
			if err != nil {
				return "", err
			}
			tempFile = filepath.Base(renderUrl)
		}

		// Navigate, wait, settle, and run layout extraction script
		var extractedJSON string
		err := chromedp.Run(ctx,
			emulation.SetDeviceMetricsOverride(1024, 768, 1, false).
				WithScreenOrientation(&emulation.ScreenOrientation{
					Type:  emulation.OrientationTypeLandscapePrimary,
					Angle: 90,
				}),
			chromedp.Navigate(renderUrl),
			chromedp.WaitReady("body"),
			chromedp.Sleep(time.Duration(sleepMs)*time.Millisecond),
			chromedp.Evaluate(`(function() {
				var elements = [];
				// Query all elements
				document.querySelectorAll('*').forEach(function(el) {
					// Exclude structural containers, scripts, and non-visual wrappers
					var tag = el.tagName.toUpperCase();
					if (['SCRIPT', 'STYLE', 'BODY', 'HTML', 'HEAD', 'IFRAME', 'NOSCRIPT'].indexOf(tag) !== -1) return;

					var cs = window.getComputedStyle(el);
					if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;

					// Bounding box
					var rect = el.getBoundingClientRect();
					if (rect.width <= 0 || rect.height <= 0) return;

					// 1. Extract Images
					if (tag === 'IMG') {
						elements.push({
							type: 'image',
							x: rect.left,
							y: rect.top,
							w: rect.width,
							h: rect.height,
							src: el.src || el.getAttribute('src') || ''
						});
					} else {
						// 2. Extract visible direct text-containing leaves (prevents parent-child duplicate capture)
						var text = '';
						var hasDirectText = false;
						
						// Check children: only scrape if direct text node child exists and is non-empty
						for (var i = 0; i < el.childNodes.length; i++) {
							var node = el.childNodes[i];
							if (node.nodeType === 3) { // TEXT_NODE
								var val = node.nodeValue.trim();
								if (val.length > 0) {
									text += val + ' ';
									hasDirectText = true;
								}
							}
						}

						if (hasDirectText) {
							elements.push({
								type: 'text',
								x: rect.left,
								y: rect.top,
								w: rect.width,
								h: rect.height,
								text: text.trim(),
								color: cs.color,
								fontSize: cs.fontSize,
								fontFamily: cs.fontFamily,
								textAlign: cs.textAlign
							});
						}
					}
				});
				return JSON.stringify(elements);
			})()`, &extractedJSON),
		)

		// Clean up temp file
		if tempFile != "" {
			a.CleanUpTempHTML(job.FolderName, tempFile)
		}

		if err != nil {
			return "", fmt.Errorf("failed to scrape layout for '%s': %w", job.SlideName, err)
		}

		// Unmarshal elements
		var elements []IDMLElement
		var json = regexp.MustCompile(`\\u[0-9a-fA-F]{4}`) // fallback json parser safety
		_ = json // keep standard unmarshalling
		
		// Standard JSON decode
		dec := strings.NewReader(extractedJSON)
		var tempElements []IDMLElement
		if err := decodeJSON(dec, &tempElements); err == nil {
			elements = tempElements
		}

		// Image source local resolution helper
		for i, el := range elements {
			if el.Type == "image" && strings.HasPrefix(el.Src, "http://") {
				// Convert local HTTP URL back to absolute file system reference so InDesign links successfully
				parsedPath := strings.TrimPrefix(el.Src, fmt.Sprintf("http://127.0.0.1:%d/", a.serverPort))
				elements[i].Src = filepath.Join(a.currentDir, filepath.FromSlash(parsedPath))
			}
		}

		idmlSlides = append(idmlSlides, IDMLSlide{
			Name:     job.SlideName,
			Elements: elements,
		})
	}

	// Emit status
	a.app.Event.Emit( "compilation_progress", map[string]interface{}{
		"current": len(jobs),
		"total":   len(jobs),
		"slide":   "Packaging IDML file...",
		"phase":   "merging",
	})

	// Packaging IDML spread deck
	err := GenerateIDMLPackage(idmlSlides, outputPath)
	if err != nil {
		return "", fmt.Errorf("failed to generate IDML package: %w", err)
	}

	return outputPath, nil
}

// decodeJSON acts as helper to decode element arrays
func decodeJSON(r io.Reader, v interface{}) error {
	var buf bytes.Buffer
	_, err := buf.ReadFrom(r)
	if err != nil {
		return err
	}
	return json.Unmarshal(buf.Bytes(), v)
}

// SelectIDMLSavePath triggers a native save file dialog for IDMLs
func (a *App) SelectIDMLSavePath(defaultFilename string) (string, error) {
	return a.app.Dialog.SaveFile().
		SetMessage("Save InDesign Interchange Package").
		SetFilename(defaultFilename).
		AddFilter("InDesign Markup Language (*.idml)", "*.idml").
		PromptForSingleSelection()
}

// SelectSavePath triggers a native save file dialog
func (a *App) SelectSavePath(defaultFilename string) (string, error) {
	return a.app.Dialog.SaveFile().
		SetMessage("Save Editable PDF").
		SetFilename(defaultFilename).
		AddFilter("PDF Files (*.pdf)", "*.pdf").
		PromptForSingleSelection()
}

// CleanUpServer shuts down the local server when app closes
func (a *App) CleanUpServer() {
	if a.server != nil {
		a.server.Shutdown(context.Background())
	}
	a.CleanUpEmbeddedWSServer()
}

// GetAssetBase64 reads an asset image and returns it as a Base64 data URI
func (a *App) GetAssetBase64(name string) string {
	// Try multiple candidate locations to be robust across environments
	candidates := []string{}
	if a.currentDir != "" {
		candidates = append(candidates, filepath.Join(a.currentDir, "frontend", "src", "assets", "images", name))
	}

	if exe, err := os.Executable(); err == nil {
		exeDir := filepath.Dir(exe)
		candidates = append(candidates, filepath.Join(exeDir, "frontend", "src", "assets", "images", name))
		// macOS app bundle Resources
		candidates = append(candidates, filepath.Join(exeDir, "..", "Resources", "frontend", "src", "assets", "images", name))
	}

	// Project-relative and common paths
	candidates = append(candidates,
		filepath.Join("frontend", "src", "assets", "images", name),
		filepath.Join("assets", "images", name),
	)

	for _, p := range candidates {
		data, err := os.ReadFile(p)
		if err == nil {
			var mime string
			if strings.HasSuffix(strings.ToLower(name), ".png") {
				mime = "image/png"
			} else if strings.HasSuffix(strings.ToLower(name), ".jpg") || strings.HasSuffix(strings.ToLower(name), ".jpeg") {
				mime = "image/jpeg"
			} else if strings.HasSuffix(strings.ToLower(name), ".svg") {
				mime = "image/svg+xml"
			} else {
				mime = "application/octet-stream"
			}
			return fmt.Sprintf("data:%s;base64,%s", mime, base64.StdEncoding.EncodeToString(data))
		}
	}

	return ""
}

// SyncWorkspaceToMac zip-compresses the current project workspace directory and returns it as a Base64 string.
func (a *App) SyncWorkspaceToMac() (string, error) {
	if a.currentDir == "" {
		return "", fmt.Errorf("no workspace directory selected")
	}

	tmpFile, err := os.CreateTemp("", "workspace_sync_*.zip")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	archive := zip.NewWriter(tmpFile)
	err = filepath.Walk(a.currentDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Skip output, node_modules, and git directories to keep payload minimal
		if info.IsDir() {
			name := info.Name()
			if name == "output" || name == ".git" || name == "node_modules" || name == ".wails" {
				return filepath.SkipDir
			}
		}
		
		// Skip temporary or PDF outputs
		lowerPath := strings.ToLower(path)
		if strings.HasSuffix(lowerPath, ".zip") || strings.HasSuffix(lowerPath, ".pdf") {
			return nil
		}

		header, err := zip.FileInfoHeader(info)
		if err != nil {
			return err
		}

		relPath, err := filepath.Rel(a.currentDir, path)
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(relPath)

		if info.IsDir() {
			header.Name += "/"
		} else {
			header.Method = zip.Deflate
		}

		writer, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		file, err := os.Open(path)
		if err != nil {
			return err
		}
		defer file.Close()
		_, err = io.Copy(writer, file)
		return err
	})

	if err != nil {
		archive.Close()
		return "", err
	}
	archive.Close()

	zipBytes, err := os.ReadFile(tmpFile.Name())
	if err != nil {
		return "", err
	}

	return base64.StdEncoding.EncodeToString(zipBytes), nil
}

// UnzipBytes decodes base64 zip payload and extracts it to the destination directory.
func UnzipBytes(zipBase64 string, destDir string) error {
	zipBytes, err := base64.StdEncoding.DecodeString(zipBase64)
	if err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp("", "mac_received_*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(tmpFile.Name())
	defer tmpFile.Close()

	if _, err := tmpFile.Write(zipBytes); err != nil {
		return err
	}

	r, err := zip.OpenReader(tmpFile.Name())
	if err != nil {
		return err
	}
	defer r.Close()

	for _, f := range r.File {
		fpath := filepath.Join(destDir, f.Name)
		// Protect against Zip Slip vulnerabilities
		if !strings.HasPrefix(fpath, filepath.Clean(destDir)+string(os.PathSeparator)) {
			continue
		}

		if f.FileInfo().IsDir() {
			os.MkdirAll(fpath, os.ModePerm)
			continue
		}

		if err := os.MkdirAll(filepath.Dir(fpath), os.ModePerm); err != nil {
			return err
		}

		outFile, err := os.OpenFile(fpath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, f.Mode())
		if err != nil {
			return err
		}

		rc, err := f.Open()
		if err != nil {
			outFile.Close()
			return err
		}

		_, err = io.Copy(outFile, rc)
		outFile.Close()
		rc.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

// handleSyncWorkspace processes the synced directory payload on macOS Performer.
func (a *App) handleSyncWorkspace(zipBase64 string) {
	a.app.Event.Emit( "viewership_event", "Syncing presentation workspace from Windows...")
	tempDir, err := os.MkdirTemp("", "wails_mac_workspace_")
	if err != nil {
		a.app.Event.Emit( "viewership_event", fmt.Sprintf("Workspace sync error: failed to create temp directory: %s", err.Error()))
		return
	}

	err = UnzipBytes(zipBase64, tempDir)
	if err != nil {
		a.app.Event.Emit( "viewership_event", fmt.Sprintf("Workspace sync error: failed to extract files: %s", err.Error()))
		return
	}

	a.app.Event.Emit( "viewership_event", "Workspace synced. Starting local Performer HTTP server...")
	port, err := a.startLocalServer(tempDir)
	if err != nil {
		a.app.Event.Emit( "viewership_event", fmt.Sprintf("Workspace sync error: failed to start local HTTP server: %s", err.Error()))
		return
	}

	a.app.Event.Emit( "viewership_event", fmt.Sprintf("Performer HTTP server active locally on port %d", port))
}

// ReadLocalFile reads a file from the local workspace directory and returns its base64 data and mime type.
func (a *App) ReadLocalFile(path string) (map[string]string, error) {
	if a.currentDir == "" {
		return nil, fmt.Errorf("no workspace directory loaded")
	}

	fullPath := filepath.Join(a.currentDir, path)
	cleanedPath := filepath.Clean(fullPath)

	// If the file doesn't exist, check if stripping the first folder segment works
	if _, err := os.Stat(cleanedPath); os.IsNotExist(err) {
		parts := strings.Split(strings.TrimPrefix(filepath.ToSlash(path), "/"), "/")
		if len(parts) > 1 {
			altPath := filepath.Join(a.currentDir, filepath.Join(parts[1:]...))
			if _, errAlt := os.Stat(altPath); errAlt == nil {
				cleanedPath = altPath
			}
		}
	}

	if !strings.HasPrefix(cleanedPath, filepath.Clean(a.currentDir)) {
		return nil, fmt.Errorf("forbidden path traversal detected")
	}

	data, err := os.ReadFile(cleanedPath)
	if err != nil {
		return nil, err
	}

	var mime string
	ext := strings.ToLower(filepath.Ext(cleanedPath))
	switch ext {
	case ".html", ".htm":
		mime = "text/html"
	case ".css":
		mime = "text/css"
	case ".js":
		mime = "application/javascript"
	case ".png":
		mime = "image/png"
	case ".jpg", ".jpeg":
		mime = "image/jpeg"
	case ".gif":
		mime = "image/gif"
	case ".svg":
		mime = "image/svg+xml"
	case ".json":
		mime = "application/json"
	case ".woff":
		mime = "font/woff"
	case ".woff2":
		mime = "font/woff2"
	case ".ttf":
		mime = "font/ttf"
	default:
		mime = "application/octet-stream"
	}

	return map[string]string{
		"data": base64.StdEncoding.EncodeToString(data),
		"mime": mime,
	}, nil
}

// OpenBuilderWindow opens a new window specifically for Builder Mode
func (a *App) OpenBuilderWindow() {
	a.app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "NoCodeX ePDF Studio - Builder Mode",
		Width:  1024,
		Height: 768,
		URL:    "/?mode=builder",
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
	})
}

// GetSystemUsername returns the current system user's name or username
func (a *App) GetSystemUsername() string {
	u, err := user.Current()
	if err != nil {
		name := os.Getenv("USERNAME")
		if name == "" {
			name = os.Getenv("USER")
		}
		if name == "" {
			name = "Unknown User"
		}
		return name
	}
	if u.Name != "" {
		return u.Name
	}
	// On Windows, u.Username might include the domain (e.g. DOMAIN\username).
	// Let's strip the domain prefix for a cleaner display name.
	parts := strings.Split(u.Username, "\\")
	return parts[len(parts)-1]
}
