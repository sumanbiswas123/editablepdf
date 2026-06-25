package main
 
import (
	"embed"
	"log"
	"os"
 
	"github.com/wailsapp/wails/v3/pkg/application"
)
 
//go:embed all:frontend/dist
var assets embed.FS
 
func main() {
	// Register embedded frontend assets so the HTTP server on :8082 can serve the UI
	// (used when the app is loaded as an iframe inside Nocodex)
	SetAppAssets(assets)

	// Create an instance of the app structure
	appService := NewApp()
 
	app := application.New(application.Options{
		Name: "htmltoepdf",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(appService),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// Check if --server flag is passed (launched by Nocodex as a background extension)
	hasServerFlag := false
	for _, arg := range os.Args {
		if arg == "--server" {
			hasServerFlag = true
			break
		}
	}

	// When launched by Nocodex with --server, start the embedded HTTP server immediately.
	// In normal Wails mode, the frontend JS calls StartEmbeddedWSServer() via Wails binding.
	// In --server mode the Wails webview is hidden, so we must start it here from Go directly.
	if hasServerFlag {
		result := appService.StartEmbeddedWSServer()
		log.Println("Embedded server started from main (--server mode):", result)
	}
 
	// Create window (hidden in --server mode so the app runs silently as a background service)
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "htmltoepdf",
		Width:  1024,
		Height: 768,
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
		Hidden: hasServerFlag,
	})
 
	// Run the application
	err := app.Run()
	if err != nil {
		log.Fatal("Error:", err.Error())
	}
}
