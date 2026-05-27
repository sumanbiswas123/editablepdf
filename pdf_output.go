package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// CompiledPDF represents a generated PDF in the output directory
type CompiledPDF struct {
	Name     string `json:"name"`
	Path     string `json:"path"`
	Size     int64  `json:"size"`
	Modified string `json:"modified"`
	ServeURL string `json:"serveUrl"`
	Metadata string `json:"metadata"`
}

// GetOutputDir returns the output directory path for the current presentation
func (a *App) GetOutputDir() string {
	if a.currentDir == "" {
		return ""
	}
	return filepath.Join(a.currentDir, "output")
}

// EnsureOutputDir creates the output directory if it doesn't exist
func (a *App) EnsureOutputDir() (string, error) {
	outDir := a.GetOutputDir()
	if outDir == "" {
		return "", fmt.Errorf("no presentation directory loaded")
	}
	if err := os.MkdirAll(outDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create output directory: %w", err)
	}
	return outDir, nil
}

// GenerateNextSequentialPDFPath returns the next sequential PDF file path (e.g. 1.pdf, 2.pdf...) in the output directory
func (a *App) GenerateNextSequentialPDFPath() (string, error) {
	outDir, err := a.EnsureOutputDir()
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(outDir)
	if err != nil {
		return "", err
	}

	maxNum := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".pdf" {
			continue
		}
		base := entry.Name()
		base = base[:len(base)-4] // remove .pdf

		var num int
		if _, err := fmt.Sscanf(base, "%d", &num); err == nil {
			if num > maxNum {
				maxNum = num
			}
		}
	}

	nextNum := maxNum + 1
	filename := fmt.Sprintf("%d.pdf", nextNum)
	return filepath.Join(outDir, filename), nil
}

// GenerateDeckAutoSavePath generates an auto-save path for the full merged deck PDF
func (a *App) GenerateDeckAutoSavePath() (string, error) {
	outDir, err := a.EnsureOutputDir()
	if err != nil {
		return "", err
	}
	dirName := filepath.Base(a.currentDir)
	filename := dirName + "_Full_Deck.pdf"
	return filepath.Join(outDir, filename), nil
}

// AutoCompileSlidePDF compiles a single slide to PDF and auto-saves to the output directory
func (a *App) AutoCompileSlidePDF(job ExportJob, sleepMs int) (string, error) {
	savePath, err := a.GenerateNextSequentialPDFPath()
	if err != nil {
		return "", err
	}
	return a.CompileSlidesToPDF([]ExportJob{job}, savePath, sleepMs)
}

// AutoCompileDeckPDF compiles all slides to a merged deck PDF and auto-saves to the output directory
func (a *App) AutoCompileDeckPDF(jobs []ExportJob, sleepMs int) (string, error) {
	savePath, err := a.GenerateDeckAutoSavePath()
	if err != nil {
		return "", err
	}
	return a.CompileSlidesToPDF(jobs, savePath, sleepMs)
}

// ListCompiledPDFs returns all PDFs in the output directory, sorted newest first
func (a *App) ListCompiledPDFs() ([]CompiledPDF, error) {
	outDir := a.GetOutputDir()
	if outDir == "" {
		return []CompiledPDF{}, nil
	}

	entries, err := os.ReadDir(outDir)
	if err != nil {
		if os.IsNotExist(err) {
			return []CompiledPDF{}, nil
		}
		return nil, err
	}

	var pdfs []CompiledPDF
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".pdf" {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}

		serveURL := fmt.Sprintf("http://localhost:%d/output/%s", a.serverPort, entry.Name())

		pdfPath := filepath.Join(outDir, entry.Name())
		metadata, _ := a.ExtractPDFMetadata(pdfPath)

		pdfs = append(pdfs, CompiledPDF{
			Name:     entry.Name(),
			Path:     pdfPath,
			Size:     info.Size(),
			Modified: info.ModTime().Format(time.RFC3339),
			ServeURL: serveURL,
			Metadata: metadata,
		})
	}

	// Sort by name ascending for consistent ordering
	sort.Slice(pdfs, func(i, j int) bool {
		return pdfs[i].Name < pdfs[j].Name
	})

	return pdfs, nil
}

// DeleteCompiledPDF deletes a compiled PDF from the output directory
func (a *App) DeleteCompiledPDF(filename string) error {
	outDir := a.GetOutputDir()
	if outDir == "" {
		return fmt.Errorf("no output directory")
	}
	fullPath := filepath.Join(outDir, filepath.Base(filename))
	return os.Remove(fullPath)
}

// ExtractPDFMetadata parses a generated PDF file's Title field to retrieve the JSON metadata
func (a *App) ExtractPDFMetadata(filePath string) (string, error) {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return "{}", err
	}

	marker := `"presentationId"`
	idx := bytes.Index(data, []byte(marker))
	if idx == -1 {
		marker = `\"presentationId\"`
		idx = bytes.Index(data, []byte(marker))
	}
	if idx == -1 {
		return "{}", nil
	}

	startIdx := -1
	for i := idx; i >= 0; i-- {
		if data[i] == '{' {
			startIdx = i
			break
		}
	}

	if startIdx == -1 {
		return "{}", nil
	}

	bracketCount := 0
	endIdx := -1
	for i := startIdx; i < len(data); i++ {
		if data[i] == '{' {
			bracketCount++
		} else if data[i] == '}' {
			bracketCount--
			if bracketCount == 0 {
				endIdx = i
				break
			}
		}
	}

	if endIdx == -1 {
		return "{}", nil
	}

	jsonBytes := data[startIdx : endIdx+1]
	cleanedStr := string(jsonBytes)
	cleanedStr = strings.ReplaceAll(cleanedStr, "\\(", "(")
	cleanedStr = strings.ReplaceAll(cleanedStr, "\\)", ")")
	cleanedStr = strings.ReplaceAll(cleanedStr, "\\\\", "\\")

	return cleanedStr, nil
}
