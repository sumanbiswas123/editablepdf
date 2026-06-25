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
	// Create an instance of the app structure
	appService := NewApp()

	// Check if --server mode is requested
	isServer := false
	for _, arg := range os.Args {
		if arg == "--server" {
			isServer = true
			break
		}
	}

	if isServer {
		log.Println("[main] Starting in --server mode (headless)")
		RunServerMode(appService)
		return
	}

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

	// Create window
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:  "htmltoepdf",
		Width:  1024,
		Height: 768,
		BackgroundColour: application.RGBA{Red: 27, Green: 38, Blue: 54, Alpha: 255},
	})

	// Run the application
	err := app.Run()
	if err != nil {
		log.Fatal("Error:", err.Error())
	}
}

