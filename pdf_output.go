package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/pdfcpu/pdfcpu/pkg/api"
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

// IsSingleSlidePDF checks if a filename represents a single sequential slide PDF (e.g. 1.pdf, 2.pdf)
func (a *App) IsSingleSlidePDF(name string) bool {
	// If it contains the presentation root folder name, it is a combined deck!
	if a.currentDir != "" {
		presentationId := filepath.Base(a.currentDir)
		if presentationId != "" && (strings.Contains(name, presentationId) || strings.Contains(name, "Full_Deck")) {
			return false
		}
	}

	base := name
	if filepath.Ext(name) == ".pdf" {
		base = name[:len(name)-4]
	}
	base = strings.TrimPrefix(base, "slide")
	base = strings.Trim(base, "_- ")
	if len(base) == 0 {
		return false
	}
	for _, c := range base {
		if c < '0' || c > '9' {
			return false
		}
	}
	return true
}

// ListCompiledPDFs returns all single slide compiled PDFs in the output directory
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
		// Filter ONLY single slide numeric PDFs
		if !a.IsSingleSlidePDF(entry.Name()) {
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

	// Sort numerically to ensure correct slide counter deck index mapping
	sort.Slice(pdfs, func(i, j int) bool {
		var n1, n2 int
		b1 := pdfs[i].Name[:len(pdfs[i].Name)-4]
		b2 := pdfs[j].Name[:len(pdfs[j].Name)-4]
		b1 = strings.TrimPrefix(b1, "slide")
		b1 = strings.Trim(b1, "_- ")
		b2 = strings.TrimPrefix(b2, "slide")
		b2 = strings.Trim(b2, "_- ")
		fmt.Sscanf(b1, "%d", &n1)
		fmt.Sscanf(b2, "%d", &n2)
		return n1 < n2
	})

	return pdfs, nil
}

// ListCombinedDecks returns all merged presentation deck PDFs in the output directory
func (a *App) ListCombinedDecks() ([]CompiledPDF, error) {
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
		// Skip single slide PDFs, return only combined decks
		if a.IsSingleSlidePDF(entry.Name()) {
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

	// Sort combined decks newest first so the latest compile sits at the top of the list
	sort.Slice(pdfs, func(i, j int) bool {
		return pdfs[i].Modified > pdfs[j].Modified
	})

	return pdfs, nil
}

// CombineCompiledPDFs merges all single-slide compiled PDFs in numerical order into a single full presentation deck
func (a *App) CombineCompiledPDFs() (string, error) {
	outDir, err := a.EnsureOutputDir()
	if err != nil {
		return "", err
	}

	entries, err := os.ReadDir(outDir)
	if err != nil {
		return "", err
	}

	// Find all single slide PDFs
	type FileWithNum struct {
		Path string
		Num  int
	}
	var files []FileWithNum
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".pdf" {
			continue
		}
		if !a.IsSingleSlidePDF(entry.Name()) {
			continue
		}
		base := entry.Name()
		base = base[:len(base)-4]
		base = strings.TrimPrefix(base, "slide")
		base = strings.Trim(base, "_- ")
		var num int
		if _, err := fmt.Sscanf(base, "%d", &num); err == nil {
			files = append(files, FileWithNum{
				Path: filepath.Join(outDir, entry.Name()),
				Num:  num,
			})
		}
	}

	if len(files) == 0 {
		return "", fmt.Errorf("no compiled single-slide PDFs found to combine")
	}

	// Sort numerically to ensure correct deck order (1 -> 2 -> 10)
	sort.Slice(files, func(i, j int) bool {
		return files[i].Num < files[j].Num
	})

	var sortedPaths []string
	for _, f := range files {
		sortedPaths = append(sortedPaths, f.Path)
	}

	presentationId := filepath.Base(a.currentDir)
	finalFilename := presentationId + ".pdf"
	finalPath := filepath.Join(outDir, finalFilename)

	// If the combined deck already exists, rename it to {presentationId}_oldX.pdf
	if _, err := os.Stat(finalPath); err == nil {
		// Find first available _oldX index
		x := 1
		for {
			oldFilename := fmt.Sprintf("%s_old%d.pdf", presentationId, x)
			oldPath := filepath.Join(outDir, oldFilename)
			if _, err := os.Stat(oldPath); os.IsNotExist(err) {
				// Rename existing file
				if err := os.Rename(finalPath, oldPath); err != nil {
					return "", fmt.Errorf("failed to rename existing combined PDF: %w", err)
				}
				break
			}
			x++
		}
	}

	// Merge all single slide PDFs into the finalPath using pdfcpu
	err = api.MergeCreateFile(sortedPaths, finalPath, false, nil)
	if err != nil {
		return "", fmt.Errorf("failed to merge PDFs: %w", err)
	}

	return finalPath, nil
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
