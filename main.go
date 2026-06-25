package main

import (
	"embed"
	"flag"
	"log"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	appService := NewApp()

	serverFlag := flag.Bool("server", false, "run headless asset and WS server for Nocodex integration")
	flag.Parse()

	if *serverFlag {
		runHeadlessServer(appService, 8082)
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
