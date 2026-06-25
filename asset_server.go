package main

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
)

type CallRequest struct {
	ID   int64             `json:"id,omitempty"`
	Name string            `json:"name,omitempty"`
	Args []json.RawMessage `json:"args"`
}

type CallResponse struct {
	Result interface{} `json:"result,omitempty"`
	Error  string      `json:"error,omitempty"`
}

func handleCall(appService *App, w http.ResponseWriter, r *http.Request) {
	// Enable CORS for localhost access
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")

	if r.Method == "OPTIONS" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if r.Method != "POST" {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var req CallRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	var result interface{}
	var err error

	if req.Name != "" {
		switch req.Name {
		case "main.App.GetSystemUsername":
			result = appService.GetSystemUsername()
		case "main.App.RestartRoomTimer":
			var room string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &room) }
			result = appService.RestartRoomTimer(room)
		case "main.App.ClearSingleSlidePDFs":
			err = appService.ClearSingleSlidePDFs()
		case "main.App.MergePDFsToPath":
			var filenames []string
			var outputPath string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &filenames) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &outputPath) }
			err = appService.MergePDFsToPath(filenames, outputPath)
		default:
			err = fmt.Errorf("method %s not supported in headless mode", req.Name)
		}
	} else {
		switch req.ID {
		case 4010810328: // ScanAndStartServer(dirPath string)
			var dirPath string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &dirPath) }
			result, err = appService.ScanAndStartServer(dirPath)

		case 3682724958: // AutoCompileSlidePDF(job ExportJob, sleepMs int)
			var job ExportJob
			var sleepMs int
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &job) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &sleepMs) }
			result, err = appService.AutoCompileSlidePDF(job, sleepMs)

		case 560229824: // AutoCompileDeckPDF(jobs []ExportJob, sleepMs int)
			var jobs []ExportJob
			var sleepMs int
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &jobs) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &sleepMs) }
			result, err = appService.AutoCompileDeckPDF(jobs, sleepMs)

		case 4021739937: // ListCompiledPDFs()
			result, err = appService.ListCompiledPDFs()

		case 4020234804: // ListCombinedDecks()
			result, err = appService.ListCombinedDecks()

		case 3987530237: // DeleteCompiledPDF(filename string)
			var filename string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &filename) }
			err = appService.DeleteCompiledPDF(filename)

		case 2640124358: // CombineCustomPDFs(filenames []string, combinedMetadataJSON string)
			var filenames []string
			var meta string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &filenames) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &meta) }
			result, err = appService.CombineCustomPDFs(filenames, meta)

		case 1013709212: // SaveRemotePDF(filename string, base64Data string)
			var filename, base64Data string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &filename) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &base64Data) }
			result, err = appService.SaveRemotePDF(filename, base64Data)

		case 909006332: // StartEmbeddedWSServer()
			result = appService.StartEmbeddedWSServer()

		case 3709063056: // GetPlatform()
			result = appService.GetPlatform()

		case 3325779953: // GetLocalIPAddresses()
			result = appService.GetLocalIPAddresses()

		case 1776640770: // StartWSClient(serverURL string, room string, mode string)
			var serverURL, room, mode string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &serverURL) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &room) }
			if len(req.Args) > 2 { json.Unmarshal(req.Args[2], &mode) }
			err = appService.StartWSClient(serverURL, room, mode)

		case 927361720: // StopWSClient()
			err = appService.StopWSClient()

		case 348162122: // CaptureCustomStateHTML(folderName string, htmlContent string)
			var folderName, htmlContent string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &folderName) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &htmlContent) }
			result, err = appService.CaptureCustomStateHTML(folderName, htmlContent)

		case 3291743464: // CleanUpTempHTML(folderName string, tempFilename string)
			var folderName, tempFilename string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &folderName) }
			if len(req.Args) > 1 { json.Unmarshal(req.Args[1], &tempFilename) }
			appService.CleanUpTempHTML(folderName, tempFilename)

		case 330759889: // SyncWorkspaceToMac()
			result, err = appService.SyncWorkspaceToMac()

		case 4016121990: // ReadLocalFile(path string)
			var path string
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &path) }
			result, err = appService.ReadLocalFile(path)

		case 1735672136: // SelectDirectory()
			// Mock SelectDirectory to return the currently loaded directory from config or empty
			result = appService.GetOutputDir()

		case 4113378380: // OpenDirectory()
			err = appService.OpenDirectory()

		case 2496053065: // GetOutputDir()
			result = appService.GetOutputDir()

		case 2437797033: // EnsureOutputDir()
			result, err = appService.EnsureOutputDir()

		case 113716333: // GenerateNextSequentialPDFPath()
			result, err = appService.GenerateNextSequentialPDFPath()

		case 1221673002: // GenerateNextAutoSlidePDFPath(slideIndex int)
			var slideIndex int
			if len(req.Args) > 0 { json.Unmarshal(req.Args[0], &slideIndex) }
			result, err = appService.GenerateNextAutoSlidePDFPath(slideIndex)

		case 2882721702: // GenerateDeckAutoSavePath()
			result, err = appService.GenerateDeckAutoSavePath()

		default:
			err = fmt.Errorf("method with ID %d not supported in headless mode", req.ID)
		}
	}

	var resp CallResponse
	if err != nil {
		resp.Error = err.Error()
	} else {
		resp.Result = result
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(resp)
}

func runHeadlessServer(appService *App, port int) {
	// 1. Start the embedded WebSocket server
	res := appService.StartEmbeddedWSServer()
	log.Printf("Embedded WS Server: %s", res)

	// 2. Start the HTTP asset server
	subFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("failed to create sub filesystem: %v", err)
	}

	mux := http.NewServeMux()
	mux.Handle("/", http.FileServer(http.FS(subFS)))
	mux.HandleFunc("/call", func(w http.ResponseWriter, r *http.Request) {
		handleCall(appService, w, r)
	})

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Running headless asset server on %s", addr)
	
	err = http.ListenAndServe(addr, mux)
	if err != nil {
		log.Fatalf("Headless asset server error: %v", err)
	}
}
