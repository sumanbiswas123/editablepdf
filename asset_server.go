package main

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
)

// ──────────────────────────────────────────────
// SSE Event Bus (replaces Wails Events for server mode)
// ──────────────────────────────────────────────

type sseClient struct {
	ch     chan string
	closed atomic.Bool
}

var (
	sseMu      sync.Mutex
	sseClients []*sseClient
)

func broadcastSSE(eventName, dataJSON string) {
	sseMu.Lock()
	alive := sseClients[:0]
	for _, c := range sseClients {
		if c.closed.Load() {
			continue
		}
		select {
		case c.ch <- fmt.Sprintf("event: %s\ndata: %s\n\n", eventName, dataJSON):
		default:
		}
		alive = append(alive, c)
	}
	sseClients = alive
	sseMu.Unlock()
}

// emitServerEvent is wired into App so Go code can emit events
// even when no Wails app runtime is present.
func (a *App) emitServerEvent(name string, payload interface{}) {
	b, _ := json.Marshal(payload)
	broadcastSSE(name, string(b))
}

// ──────────────────────────────────────────────
// Wails-compatible shim injected into index.html
// ──────────────────────────────────────────────

const wailsShim = `
<script>
// Wails Server-Mode Shim – injected at runtime
// Overrides @wailsio/runtime's Call.ByID / Call.ByName
// so that function calls go to /rpc instead of the WebView2 IPC bridge.
(function() {
  'use strict';

  var _callId = 0;
  var _pending = {};

  // Shared fetch-based dispatcher
  function rpcCall(method, args) {
    var id = ++_callId;
    return {
      id: id,
      cancel: function() {},
      then: function(onFulfilled, onRejected) {
        return fetch('/rpc', {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({method: method, args: args})
        })
        .then(function(r) { return r.json(); })
        .then(function(body) {
          if (body.error) { throw new Error(body.error); }
          return body.result;
        })
        .then(onFulfilled, onRejected);
      },
      catch: function(fn) {
        return this.then(undefined, fn);
      },
      finally: function(fn) {
        return this.then(function(v){fn();return v;}, function(e){fn();throw e;});
      }
    };
  }

  // Build the global wails object that @wailsio/runtime reads
  window.__wails = window.__wails || {};
  window.__wails_server_mode__ = true;

  // Patch $Call so that generated bindings work unchanged
  window.__wails_call_by_id__   = function(id)   { var a=Array.prototype.slice.call(arguments,1); return rpcCall('id:'+id, a); };
  window.__wails_call_by_name__ = function(name) { var a=Array.prototype.slice.call(arguments,1); return rpcCall('name:'+name, a); };

  // Listen for SSE server-push events (replaces Wails Events)
  var evtSrc = new EventSource('/events');
  evtSrc.addEventListener('message', function(e) {});
  // Re-dispatch all server events to the wails event bus
  evtSrc.onmessage = function(e) {
    try {
      var ev = JSON.parse(e.data);
      if (window.__wails_emit_event__) {
        window.__wails_emit_event__(ev.name, ev.data);
      }
    } catch(_) {}
  };
  // Named event forwarding
  var sseNames = [
    'viewership_event','devices_list_updated','compilation_progress',
    'room_timeout_recreate','room_closed_by_timeout','pdf_saved_remote'
  ];
  sseNames.forEach(function(n) {
    evtSrc.addEventListener(n, function(e) {
      try {
        var data = JSON.parse(e.data);
        if (window.__wails_emit_event__) { window.__wails_emit_event__(n, data); }
      } catch(_) {}
    });
  });

  console.log('[WailsShim] Server-mode shim active. All Go calls routed via /rpc.');
})();
</script>
`

// ──────────────────────────────────────────────
// HTTP handlers
// ──────────────────────────────────────────────

func serveIndexWithShim(w http.ResponseWriter, _ *http.Request, subFS fs.FS) {
	f, err := subFS.Open("index.html")
	if err != nil {
		http.Error(w, "index.html not found", 500)
		return
	}
	defer f.Close()
	raw, err := io.ReadAll(f)
	if err != nil {
		http.Error(w, "read error", 500)
		return
	}
	html := string(raw)
	// Inject shim just before </head>
	html = strings.Replace(html, "</head>", wailsShim+"</head>", 1)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	io.WriteString(w, html)
}

// handleSSE streams server-sent events to the browser
func handleSSE(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Connection", "keep-alive")

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming not supported", 500)
		return
	}

	c := &sseClient{ch: make(chan string, 32)}
	sseMu.Lock()
	sseClients = append(sseClients, c)
	sseMu.Unlock()

	defer c.closed.Store(true)

	// Send keep-alive comment every 15 s
	done := r.Context().Done()
	for {
		select {
		case <-done:
			return
		case msg := <-c.ch:
			fmt.Fprint(w, msg)
			flusher.Flush()
		}
	}
}

// handleRPC dispatches JSON-RPC calls from the browser shim to Go functions
func handleRPC(w http.ResponseWriter, r *http.Request, a *App) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return
	}
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req struct {
		Method string        `json:"method"`
		Args   []interface{} `json:"args"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeRPCError(w, "invalid request: "+err.Error())
		return
	}

	result, err := dispatchRPC(a, req.Method, req.Args)
	if err != nil {
		writeRPCError(w, err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]interface{}{"result": result})
}

func writeRPCError(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK) // keep 200 so JS can parse body
	json.NewEncoder(w).Encode(map[string]interface{}{"error": msg})
}

func argStr(args []interface{}, i int) string {
	if i >= len(args) {
		return ""
	}
	if s, ok := args[i].(string); ok {
		return s
	}
	return fmt.Sprintf("%v", args[i])
}
func argInt(args []interface{}, i int) int {
	if i >= len(args) {
		return 0
	}
	switch v := args[i].(type) {
	case float64:
		return int(v)
	case int:
		return v
	}
	return 0
}

// dispatchRPC maps "id:<N>" or "name:<funcName>" to actual Go method calls.
func dispatchRPC(a *App, method string, args []interface{}) (interface{}, error) {
	// Normalize the method key
	key := method // e.g. "id:4010810328" or "name:main.App.GetSystemUsername"

	switch key {

	// ── ScanAndStartServer ──────────────────────────────────────────────────
	case "id:4010810328":
		dirPath := argStr(args, 0)
		return a.ScanAndStartServer(dirPath)

	// ── ListCompiledPDFs ────────────────────────────────────────────────────
	case "id:4021739937":
		return a.ListCompiledPDFs()

	// ── ListCombinedDecks ───────────────────────────────────────────────────
	case "id:4020234804":
		return a.ListCombinedDecks()

	// ── AutoCompileSlidePDF ─────────────────────────────────────────────────
	case "id:3682724958":
		job, err := unmarshalExportJob(args, 0)
		if err != nil {
			return nil, err
		}
		sleepMs := argInt(args, 1)
		return a.AutoCompileSlidePDF(job, sleepMs)

	// ── AutoCompileDeckPDF ──────────────────────────────────────────────────
	case "id:560229824":
		jobs, err := unmarshalExportJobs(args, 0)
		if err != nil {
			return nil, err
		}
		sleepMs := argInt(args, 1)
		return a.AutoCompileDeckPDF(jobs, sleepMs)

	// ── CompileSlidesToPDF ──────────────────────────────────────────────────
	case "id:2932220729":
		jobs, err := unmarshalExportJobs(args, 0)
		if err != nil {
			return nil, err
		}
		outputPath := argStr(args, 1)
		sleepMs := argInt(args, 2)
		return a.CompileSlidesToPDF(jobs, outputPath, sleepMs)

	// ── CompileSlidesToPDFForRoom ───────────────────────────────────────────
	case "id:2668857607":
		roomCode := argStr(args, 0)
		jobs, err := unmarshalExportJobs(args, 1)
		if err != nil {
			return nil, err
		}
		outputPath := argStr(args, 2)
		sleepMs := argInt(args, 3)
		return a.CompileSlidesToPDFForRoom(roomCode, jobs, outputPath, sleepMs)

	// ── DeleteCompiledPDF ───────────────────────────────────────────────────
	case "id:3987530237":
		return nil, a.DeleteCompiledPDF(argStr(args, 0))

	// ── CombineCompiledPDFs ─────────────────────────────────────────────────
	case "id:2109371114":
		return a.CombineCompiledPDFs()

	// ── CombineCustomPDFs ───────────────────────────────────────────────────
	case "id:2640124358":
		filenames, _ := toStringSlice(args, 0)
		metaJSON := argStr(args, 1)
		return a.CombineCustomPDFs(filenames, metaJSON)

	// ── MergePDFsToPath ─────────────────────────────────────────────────────
	case "name:main.App.MergePDFsToPath":
		filenames, _ := toStringSlice(args, 0)
		outputPath := argStr(args, 1)
		return nil, a.MergePDFsToPath(filenames, outputPath)

	// ── SplitCombinedPDFToPages ─────────────────────────────────────────────
	case "id:2028511321":
		return a.SplitCombinedPDFToPages(argStr(args, 0))

	// ── RebuildCombinedPDF ──────────────────────────────────────────────────
	case "id:1849374071":
		originalFilename := argStr(args, 0)
		pagePaths, _ := toStringSlice(args, 1)
		pageMetadatas, _ := toStringSlice(args, 2)
		return a.RebuildCombinedPDF(originalFilename, pagePaths, pageMetadatas)

	// ── RenameCombinedPDF ───────────────────────────────────────────────────
	case "id:797740134":
		return nil, a.RenameCombinedPDF(argStr(args, 0), argStr(args, 1))

	// ── ClearSingleSlidePDFs ────────────────────────────────────────────────
	case "name:main.App.ClearSingleSlidePDFs":
		return nil, a.ClearSingleSlidePDFs()

	// ── GenerateDeckAutoSavePath ────────────────────────────────────────────
	case "id:2882721702":
		return a.GenerateDeckAutoSavePath()

	// ── GenerateNextSequentialPDFPath ───────────────────────────────────────
	case "id:113716333":
		return a.GenerateNextSequentialPDFPath()

	// ── GenerateNextAutoSlidePDFPath ────────────────────────────────────────
	case "id:1221673002":
		return a.GenerateNextAutoSlidePDFPath(argInt(args, 0))

	// ── EnsureOutputDir ─────────────────────────────────────────────────────
	case "id:2437797033":
		return a.EnsureOutputDir()

	// ── GetOutputDir ────────────────────────────────────────────────────────
	case "id:2496053065":
		return a.GetOutputDir(), nil

	// ── ExtractPDFMetadata ──────────────────────────────────────────────────
	case "id:3423517369":
		return a.ExtractPDFMetadata(argStr(args, 0))

	// ── IsSingleSlidePDF ────────────────────────────────────────────────────
	case "id:3146291056":
		return a.IsSingleSlidePDF(argStr(args, 0)), nil

	// ── SelectDirectory ─────────────────────────────────────────────────────
	case "id:1735672136":
		return nil, fmt.Errorf("SelectDirectory not available in server mode")

	// ── SelectSavePath ──────────────────────────────────────────────────────
	case "id:1300572447":
		return nil, fmt.Errorf("SelectSavePath not available in server mode")

	// ── SelectIDMLSavePath ──────────────────────────────────────────────────
	case "id:3277550051":
		return nil, fmt.Errorf("SelectIDMLSavePath not available in server mode")

	// ── SelectPDFFile ───────────────────────────────────────────────────────
	case "id:119417331":
		return nil, fmt.Errorf("SelectPDFFile not available in server mode")

	// ── SelectScreenshotSavePath ────────────────────────────────────────────
	case "id:941428723":
		return nil, fmt.Errorf("SelectScreenshotSavePath not available in server mode")

	// ── OpenDirectory ───────────────────────────────────────────────────────
	case "id:4113378380":
		return nil, a.OpenDirectory()

	// ── OpenBuilderWindow ───────────────────────────────────────────────────
	case "id:2586631480":
		return nil, fmt.Errorf("OpenBuilderWindow not available in server mode")

	// ── ShareFile ───────────────────────────────────────────────────────────
	case "id:3239681846":
		return a.ShareFile(argStr(args, 0))

	// ── GetPlatform ─────────────────────────────────────────────────────────
	case "id:3709063056":
		return a.GetPlatform(), nil

	// ── GetLocalIPAddresses ─────────────────────────────────────────────────
	case "id:3325779953":
		return a.GetLocalIPAddresses(), nil

	// ── GetSystemUsername ───────────────────────────────────────────────────
	case "name:main.App.GetSystemUsername":
		return a.GetSystemUsername(), nil

	// ── SaveRemotePDF ───────────────────────────────────────────────────────
	case "id:1013709212":
		return a.SaveRemotePDF(argStr(args, 0), argStr(args, 1))

	// ── SyncWorkspaceToMac ──────────────────────────────────────────────────
	case "id:330759889":
		return a.SyncWorkspaceToMac()

	// ── ReadLocalFile ───────────────────────────────────────────────────────
	case "id:4016121990":
		return a.ReadLocalFile(argStr(args, 0))

	// ── CaptureCustomStateHTML ──────────────────────────────────────────────
	case "id:348162122":
		return a.CaptureCustomStateHTML(argStr(args, 0), argStr(args, 1))

	// ── CleanUpTempHTML ─────────────────────────────────────────────────────
	case "id:3291743464":
		a.CleanUpTempHTML(argStr(args, 0), argStr(args, 1))
		return nil, nil

	// ── StartEmbeddedWSServer ───────────────────────────────────────────────
	case "id:909006332":
		return a.StartEmbeddedWSServer(), nil

	// ── CleanUpEmbeddedWSServer / CleanUpServer ─────────────────────────────
	case "id:3584425128":
		a.CleanUpServer()
		return nil, nil

	// ── StartWSClient ───────────────────────────────────────────────────────
	case "id:1776640770":
		serverURL := argStr(args, 0)
		room := argStr(args, 1)
		mode := argStr(args, 2)
		return nil, a.StartWSClient(serverURL, room, mode)

	// ── StopWSClient ────────────────────────────────────────────────────────
	case "id:927361720":
		return nil, a.StopWSClient()

	// ── StopWSClientForRoom ─────────────────────────────────────────────────
	case "id:745844272":
		return nil, a.StopWSClientForRoom(argStr(args, 0))

	// ── StartPDFSession ─────────────────────────────────────────────────────
	case "id:642174649":
		return a.StartPDFSession()

	// ── EndPDFSession ───────────────────────────────────────────────────────
	case "id:760299660":
		return a.EndPDFSession(argStr(args, 0))

	// ── CompileSingleStateToPDF ─────────────────────────────────────────────
	case "id:1697637524":
		job, err := unmarshalExportJob(args, 0)
		if err != nil {
			return nil, err
		}
		sleepMs := argInt(args, 1)
		return nil, a.CompileSingleStateToPDF(job, sleepMs)

	// ── CompileSlideFromCaptures ────────────────────────────────────────────
	case "id:655608788":
		jobs, err := unmarshalExportJobs(args, 0)
		if err != nil {
			return nil, err
		}
		sleepMs := argInt(args, 1)
		return a.CompileSlideFromCaptures(jobs, sleepMs)

	// ── CompileDeckFromCaptures ─────────────────────────────────────────────
	case "id:3413885816":
		jobs, err := unmarshalExportJobs(args, 0)
		if err != nil {
			return nil, err
		}
		sleepMs := argInt(args, 1)
		return a.CompileDeckFromCaptures(jobs, sleepMs)

	// ── AutomateActiveSlide ─────────────────────────────────────────────────
	case "id:1618109438":
		return a.AutomateActiveSlide(argStr(args, 0), argInt(args, 1))

	// ── AutomateDeck ────────────────────────────────────────────────────────
	case "id:3355232630":
		return a.AutomateDeck(argInt(args, 0))

	// ── ScanActiveSlide ─────────────────────────────────────────────────────
	case "id:2744249679":
		return a.ScanActiveSlide(argStr(args, 0))

	// ── CompileScreenshot ───────────────────────────────────────────────────
	case "id:4192616226":
		job, err := unmarshalExportJob(args, 0)
		if err != nil {
			return nil, err
		}
		outputPath := argStr(args, 1)
		sleepMs := argInt(args, 2)
		return a.CompileScreenshot(job, outputPath, sleepMs)

	// ── CompileSlidesToIDML ─────────────────────────────────────────────────
	case "id:1565557109":
		jobs, err := unmarshalExportJobs(args, 0)
		if err != nil {
			return nil, err
		}
		outputPath := argStr(args, 1)
		sleepMs := argInt(args, 2)
		return a.CompileSlidesToIDML(jobs, outputPath, sleepMs)

	// ── GetAssetBase64 ──────────────────────────────────────────────────────
	case "id:59194422":
		return a.GetAssetBase64(argStr(args, 0)), nil

	// ── RestartRoomTimer ────────────────────────────────────────────────────
	case "name:main.App.RestartRoomTimer":
		return a.RestartRoomTimer(argStr(args, 0)), nil

	default:
		return nil, fmt.Errorf("unknown RPC method: %s", method)
	}
}

// ──────────────────────────────────────────────
// Arg helpers
// ──────────────────────────────────────────────

func unmarshalExportJob(args []interface{}, i int) (ExportJob, error) {
	if i >= len(args) {
		return ExportJob{}, fmt.Errorf("missing ExportJob arg at index %d", i)
	}
	b, err := json.Marshal(args[i])
	if err != nil {
		return ExportJob{}, err
	}
	var job ExportJob
	err = json.Unmarshal(b, &job)
	return job, err
}

func unmarshalExportJobs(args []interface{}, i int) ([]ExportJob, error) {
	if i >= len(args) {
		return nil, fmt.Errorf("missing []ExportJob arg at index %d", i)
	}
	b, err := json.Marshal(args[i])
	if err != nil {
		return nil, err
	}
	var jobs []ExportJob
	err = json.Unmarshal(b, &jobs)
	return jobs, err
}

func toStringSlice(args []interface{}, i int) ([]string, error) {
	if i >= len(args) {
		return nil, nil
	}
	raw, ok := args[i].([]interface{})
	if !ok {
		return nil, fmt.Errorf("expected array at arg %d", i)
	}
	out := make([]string, len(raw))
	for j, v := range raw {
		out[j] = fmt.Sprintf("%v", v)
	}
	return out, nil
}

// ──────────────────────────────────────────────
// Entry point called from main.go --server
// ──────────────────────────────────────────────

func RunServerMode(appService *App) {
	// Find the frontend/dist directory
	// First try embedded FS
	subFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal("asset_server: cannot find embedded frontend/dist: ", err)
	}

	// Override the app's event emitter to use SSE
	// (app.go's emitViewershipEvent calls app.app.Event.Emit which panics without Wails)
	// We patch it via the server event method.

	// Wire a startup hook: StartEmbeddedWSServer (port 8081) first
	result := appService.StartEmbeddedWSServer()
	log.Printf("[server] WS server: %s", result)

	mux := http.NewServeMux()

	// Static file server
	fileServer := http.FileServer(http.FS(subFS))

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		// Specifically catch requests to wails-specific resources that do not exist in the client
		if strings.HasPrefix(p, "/wails/") {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			if strings.HasSuffix(p, ".js") {
				w.Header().Set("Content-Type", "application/javascript")
				w.Write([]byte("// Wails server-mode stub"))
			} else {
				http.NotFound(w, r)
			}
			return
		}
		if p == "/" || p == "/index.html" || (!strings.Contains(filepath.Base(p), ".") && !strings.HasPrefix(p, "/assets/")) {
			serveIndexWithShim(w, r, subFS)
			return
		}
		w.Header().Set("Access-Control-Allow-Origin", "*")
		fileServer.ServeHTTP(w, r)
	})

	// RPC dispatcher
	mux.HandleFunc("/rpc", func(w http.ResponseWriter, r *http.Request) {
		handleRPC(w, r, appService)
	})

	// SSE event stream
	mux.HandleFunc("/events", handleSSE)

	// Health check
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok","mode":"server"}`))
	})

	// Also forward the WS and create-room endpoints from port 8081
	// (proxy them at 8082 as well so the frontend only needs one base URL)
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		if embeddedServer != nil {
			embeddedServer.handleWS(w, r)
		} else {
			http.Error(w, "ws server not ready", 503)
		}
	})
	mux.HandleFunc("/create-room", func(w http.ResponseWriter, r *http.Request) {
		if embeddedServer != nil {
			embeddedServer.handleCreateRoom(w, r)
		} else {
			http.Error(w, "ws server not ready", 503)
		}
	})
	mux.HandleFunc("/proxy/", func(w http.ResponseWriter, r *http.Request) {
		if embeddedServer != nil {
			embeddedServer.handleProxyRequest(w, r)
		} else {
			http.Error(w, "ws server not ready", 503)
		}
	})

	port := "8082"
	if p := os.Getenv("WAILS_SERVER_PORT"); p != "" {
		port = p
	}

	log.Printf("[server] Serving frontend on http://localhost:%s", port)
	srv := &http.Server{
		Addr:    ":" + port,
		Handler: mux,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal("[server] ListenAndServe:", err)
	}
}
