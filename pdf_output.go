package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
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
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
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

// CompileSlideFromCaptures takes multiple pre-captured HTML states (from iframe automation)
// and compiles each into a PDF page, merging them into a single slide PDF.
func (a *App) CompileSlideFromCaptures(jobs []ExportJob, sleepMs int) (string, error) {
	savePath, err := a.GenerateNextSequentialPDFPath()
	if err != nil {
		return "", err
	}
	return a.CompileSlidesToPDF(jobs, savePath, sleepMs)
}

// CompileDeckFromCaptures takes pre-captured HTML states for all slides (from iframe deck automation)
// and compiles them into a single combined deck PDF.
func (a *App) CompileDeckFromCaptures(jobs []ExportJob, sleepMs int) (string, error) {
	savePath, err := a.GenerateDeckAutoSavePath()
	if err != nil {
		return "", err
	}
	return a.CompileSlidesToPDF(jobs, savePath, sleepMs)
}

// StartPDFSession initializes a new chromedp session for compiling states on-the-fly
func (a *App) StartPDFSession() (string, error) {
	tempDir, err := os.MkdirTemp("", "wails_pdf_compile_")
	if err != nil {
		return "", fmt.Errorf("failed to create temp directory: %w", err)
	}
	a.pdfTempDir = tempDir
	a.pdfPaths = []string{}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	a.pdfAllocatorCancel = allocCancel

	ctx, cancel := chromedp.NewContext(allocCtx)
	a.pdfCtx = ctx
	a.pdfCancel = cancel

	if err := chromedp.Run(ctx); err != nil {
		return "", fmt.Errorf("failed to initialize headless browser: %w", err)
	}

	return tempDir, nil
}

// CompileSingleStateToPDF renders a single pre-captured state directly to a PDF page within the active session
func (a *App) CompileSingleStateToPDF(job ExportJob, sleepMs int) error {
	if a.pdfCtx == nil {
		return fmt.Errorf("no active PDF session")
	}

	renderUrl := job.URL
	var tempFile string
	if job.CustomHTML != "" {
		var err error
		renderUrl, err = a.CaptureCustomStateHTML(job.FolderName, job.CustomHTML)
		if err != nil {
			return err
		}
		tempFile = filepath.Base(renderUrl)
	}

	pdfPath := filepath.Join(a.pdfTempDir, fmt.Sprintf("slide_%05d.pdf", len(a.pdfPaths)))

	var buf []byte
	var screenshotBuf []byte

	// Determine dimensions based on folder name (landscape by default, portrait if it contains "vertical")
	width := int64(1024)
	height := int64(768)
	paperWidth := 10.66
	paperHeight := 8.00
	orientation := emulation.OrientationTypeLandscapePrimary
	angle := int64(90)

	if strings.Contains(strings.ToLower(job.FolderName), "vertical") {
		width = 768
		height = 1024
		paperWidth = 8.00
		paperHeight = 10.66
		orientation = emulation.OrientationTypePortraitPrimary
		angle = 0
	}

	actions := []chromedp.Action{
		emulation.SetEmulatedMedia().WithMedia("screen"),
		emulation.SetDeviceMetricsOverride(width, height, 1, false).
			WithScreenOrientation(&emulation.ScreenOrientation{
				Type:  orientation,
				Angle: angle,
			}),
		chromedp.Navigate(renderUrl),
		chromedp.WaitReady("body"),
		chromedp.Sleep(time.Duration(sleepMs) * time.Millisecond),
	}

	presentationId := filepath.Base(a.currentDir)
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
						
						var innerContent = d.querySelector('.ui-dialog-content');
						if (innerContent) {
							id = innerContent.id || "";
							cls = innerContent.className || "";
						}
						
						var lowerId = id.toLowerCase();
						var lowerCls = cls.toLowerCase();
						
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

					var topmost = openPopups[0];
					
					var isSharedTopmost = ["menu", "flow", "fragment", "ref", "pi", "isi", "si", "email"].includes(topmost.type) || 
					                      topmost.id === 'customMenuWrapper' || 
					                      topmost.id === 'flowSelector' || 
					                      topmost.id === 'fragmentSelector';

					if (isSharedTopmost) {
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

	if job.CustomHTML != "" {
		actions = append(actions,
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

				if (dialogs.length === 0) {
					window._pdfSkipFlatten = true;
					return 0;
				}
				window._pdfSkipFlatten = false;

				dialogs[0].setAttribute('data-pdf-topmost', 'true');
				dialogs[0].setAttribute('data-pdf-orig-visibility', dialogs[0].style.visibility || '');
				dialogs[0].style.setProperty('visibility', 'hidden', 'important');

				for (var i = 1; i < dialogs.length; i++) {
					dialogs[i].setAttribute('data-pdf-lower-popup', 'true');
					dialogs[i].setAttribute('data-pdf-orig-visibility', dialogs[i].style.visibility || '');
					dialogs[i].style.setProperty('visibility', 'hidden', 'important');
				}

				document.querySelectorAll('.ui-widget-overlay').forEach(function(o, idx) {
					o.setAttribute('data-pdf-overlay', 'true');
					o.setAttribute('data-pdf-orig-visibility', o.style.visibility || '');
					o.style.setProperty('visibility', 'hidden', 'important');
				});

				return dialogs.length;
			})()`, nil),

			chromedp.ActionFunc(func(ctx context.Context) error {
				var skip bool
				if err := chromedp.Evaluate(`window._pdfSkipFlatten === true`, &skip).Do(ctx); err != nil {
					return err
				}
				if skip {
					return nil
				}
				return chromedp.Screenshot("#contentFrame", &screenshotBuf, chromedp.ByID).Do(ctx)
			}),

			chromedp.ActionFunc(func(ctx context.Context) error {
				var skip bool
				if err := chromedp.Evaluate(`window._pdfSkipFlatten === true`, &skip).Do(ctx); err != nil {
					return err
				}
				if skip {
					return nil
				}

				base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(screenshotBuf)
				jsScript := fmt.Sprintf(`(function() {
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

					var topmost = document.querySelector('[data-pdf-topmost="true"]');
					if (topmost) {
						var origVis = topmost.getAttribute('data-pdf-orig-visibility') || '';
						topmost.style.visibility = origVis;
						topmost.removeAttribute('data-pdf-topmost');
						topmost.removeAttribute('data-pdf-orig-visibility');
					}

					var overlays = Array.from(document.querySelectorAll('[data-pdf-overlay="true"]'));
					if (overlays.length > 0) {
						var lastOverlay = overlays[overlays.length - 1];
						var origVis = lastOverlay.getAttribute('data-pdf-orig-visibility') || '';
						lastOverlay.style.visibility = origVis;
						lastOverlay.removeAttribute('data-pdf-overlay');
						lastOverlay.removeAttribute('data-pdf-orig-visibility');
					}

					return "restored";
				})()`, base64Str)
				return chromedp.Evaluate(jsScript, nil).Do(ctx)
			}),
		)
	}

	actions = append(actions,
		chromedp.ActionFunc(func(ctx context.Context) error {
			var err error
			buf, _, err = page.PrintToPDF().
				WithPaperWidth(paperWidth).
				WithPaperHeight(paperHeight).
				WithPrintBackground(true).
				WithMarginTop(0).
				WithMarginBottom(0).
				WithMarginLeft(0).
				WithMarginRight(0).
				Do(ctx)
			return err
		}),
	)

	if err := chromedp.Run(a.pdfCtx, actions...); err != nil {
		if tempFile != "" {
			a.CleanUpTempHTML(job.FolderName, tempFile)
		}
		return fmt.Errorf("failed to render slide: %w", err)
	}

	if err := os.WriteFile(pdfPath, buf, 0644); err != nil {
		if tempFile != "" {
			a.CleanUpTempHTML(job.FolderName, tempFile)
		}
		return fmt.Errorf("failed to write PDF file: %w", err)
	}

	if tempFile != "" {
		a.CleanUpTempHTML(job.FolderName, tempFile)
	}

	a.pdfPaths = append(a.pdfPaths, pdfPath)
	return nil
}

// EndPDFSession finishes the session, merges all compiled PDFs, and performs cleanup
func (a *App) EndPDFSession(outputPath string) (string, error) {
	if a.pdfCtx == nil {
		return "", fmt.Errorf("no active PDF session")
	}

	if a.pdfCancel != nil {
		a.pdfCancel()
	}
	if a.pdfAllocatorCancel != nil {
		a.pdfAllocatorCancel()
	}

	a.pdfCtx = nil
	a.pdfCancel = nil
	a.pdfAllocatorCancel = nil

	defer os.RemoveAll(a.pdfTempDir)

	if len(a.pdfPaths) == 0 {
		return "", fmt.Errorf("no slides compiled in this session")
	}

	// Merge all compiled PDFs
	err := api.MergeCreateFile(a.pdfPaths, outputPath, false, nil)
	if err != nil {
		return "", fmt.Errorf("failed to merge PDFs: %w", err)
	}

	return outputPath, nil
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

	// Extract and combine metadata from all slide pages
	var combinedMeta []map[string]interface{}
	currentPage := 1
	for _, path := range sortedPaths {
		// Get exact page count of this PDF using pdfcpu
		pageCount, err := api.PageCountFile(path)
		if err != nil {
			pageCount = 1 // default fallback
		}

		startPage := currentPage
		endPage := currentPage + pageCount - 1
		currentPage = currentPage + pageCount

		metaStr, err := a.ExtractPDFMetadata(path)
		if err == nil && metaStr != "" && metaStr != "{}" {
			var metaObj map[string]interface{}
			if err := json.Unmarshal([]byte(metaStr), &metaObj); err == nil {
				metaObj["startPage"] = startPage
				metaObj["endPage"] = endPage
				combinedMeta = append(combinedMeta, metaObj)
			}
		} else {
			// Fallback placeholder for slides without embedded metadata to maintain page indexing
			base := filepath.Base(path)
			metaObj := map[string]interface{}{
				"presentationId": presentationId,
				"slideName":      base,
				"folderName":     "",
				"type":           "slide",
				"startPage":      startPage,
				"endPage":        endPage,
			}
			combinedMeta = append(combinedMeta, metaObj)
		}
	}

	var combinedJSON string
	if len(combinedMeta) > 0 {
		metaBytes, err := json.Marshal(combinedMeta)
		if err == nil {
			combinedJSON = string(metaBytes)
		}
	}

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

	// Inject the consolidated JSON array and presentation ID as PDF Document Properties of the merged PDF using pdfcpu
	if combinedJSON != "" {
		tempOut := finalPath + ".tmp"
		err = api.AddPropertiesFile(finalPath, tempOut, map[string]string{
			"combinedMetadata": combinedJSON,
			"presentationId":   presentationId,
		}, nil)
		if err == nil {
			os.Remove(finalPath)
			os.Rename(tempOut, finalPath)
		} else {
			os.Remove(tempOut)
			return "", fmt.Errorf("failed to inject metadata properties into combined PDF: %w", err)
		}
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
	// 1. Hybrid: First try clean decoding using pdfcpu Properties API
	f, err := os.Open(filePath)
	if err == nil {
		props, err := api.Properties(f, nil)
		f.Close()
		if err == nil && props != nil {
			// Prioritize the full consolidated metadata array if available
			if combinedVal, ok := props["combinedMetadata"]; ok && combinedVal != "" {
				return combinedVal, nil
			}
			// Otherwise look for any custom property containing our marker
			for _, val := range props {
				if strings.Contains(val, "presentationId") {
					return val, nil
				}
			}
		}
	}

	// 2. Fallback: High-performance raw byte search
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

// AutomateDeck crawls through all presentation slides in numerical sequence, automatically triggers dynamic dialogs, captures all popup states recursively, and compiles them into a single indexed combined PDF.
func (a *App) AutomateDeck(sleepMs int) (string, error) {
	if a.currentDir == "" {
		return "", fmt.Errorf("no presentation directory loaded")
	}

	// 1. Scan slides like ScanAndStartServer
	files, err := os.ReadDir(a.currentDir)
	if err != nil {
		return "", err
	}

	var slides []Slide
	numReg := regexp.MustCompile(`\d+`)
	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		name := file.Name()
		if name == "shared" {
			continue
		}
		indexPath := filepath.Join(a.currentDir, name, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			slideUrl := fmt.Sprintf("http://127.0.0.1:%d/%s/index.html", a.serverPort, name)
			slides = append(slides, Slide{
				Name:       name,
				FolderName: name,
				IndexHTML:  indexPath,
				URL:        slideUrl,
			})
		}
	}

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

	if len(slides) == 0 {
		return "", fmt.Errorf("no slides found to compile")
	}

	// 2. Create a temp directory for compiling sequential page PDFs
	tempDir, err := os.MkdirTemp("", "wails_pdf_automate_")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	if err := chromedp.Run(ctx); err != nil {
		return "", fmt.Errorf("failed to start background browser: %w", err)
	}

	var generatedPDFs []string
	pdfCounter := 0

	for slideIdx, slide := range slides {
		// Emit progress update: Rendering base slide
		wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
			"current": slideIdx + 1,
			"total":   len(slides),
			"slide":   slide.Name,
			"phase":   "crawling",
			"detail":  "Base slide",
		})

		// A. BASE SLIDE COMPILING
		basePDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
		pdfCounter++

		// Navigate to slide URL and wait
		err = a.navigateAndSettle(ctx, slide.URL, sleepMs)
		if err != nil {
			return "", fmt.Errorf("failed to navigate to slide %s: %w", slide.Name, err)
		}

		// Capture the base PDF state
		err = a.captureCurrentStatePDF(ctx, slide.FolderName, slide.Name, basePDFPath, sleepMs)
		if err != nil {
			return "", err
		}
		generatedPDFs = append(generatedPDFs, basePDFPath)

		// B. FIRST SLIDE SPECIAL: SHARED OVERLAYS (MENU, FLOW, PI, REF, objection, quickres)
		if slideIdx == 0 {
			sharedIDs := []string{"pi", "references", "menu", "flowSelector", "email", "objection", "quickres"}
			for _, sid := range sharedIDs {
				var isVisible bool
				jsCheck := fmt.Sprintf(`(function() {
					var el = document.querySelector('#%s');
					if (!el) return false;
					if (el.classList.contains('inactive') || el.classList.contains('disabled')) return false;
					var style = window.getComputedStyle(el);
					if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false;
					if (parseFloat(style.opacity) < 0.6) return false;
					var rect = el.getBoundingClientRect();
					if (rect.width <= 5 || rect.height <= 5) return false;
					return true;
				})()`, sid)
				err = chromedp.Run(ctx, chromedp.Evaluate(jsCheck, &isVisible))
				if err == nil && isVisible {
					wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
						"current": slideIdx + 1,
						"total":   len(slides),
						"slide":   slide.Name,
						"phase":   "crawling",
						"detail":  fmt.Sprintf("Shared overlay: %s", sid),
					})

					sharedPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
					pdfCounter++

					err = chromedp.Run(ctx,
						chromedp.Evaluate(fmt.Sprintf(`(function() {
							var el = document.querySelector('#%s');
							if (!el) return;
							var opts = { bubbles: true, cancelable: true, view: window };
							el.dispatchEvent(new MouseEvent('mousedown', opts));
							el.dispatchEvent(new MouseEvent('mouseup', opts));
							el.dispatchEvent(new MouseEvent('click', opts));
							if (window.TouchEvent) {
								var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
								el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
								el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
							}
						})()`, sid), nil),
						chromedp.Sleep(450 * time.Millisecond), // settle transition
					)
					if err == nil {
						var popupOpened bool
						jsCheckOpened := `(function() {
							var selectors = ['.dialog', '.ui-dialog', '[role="dialog"]', '#flowSelector', '#fragmentSelector', '#customMenuWrapper', '.popup', '.overlay'];
							for (var i = 0; i < selectors.length; i++) {
								var els = document.querySelectorAll(selectors[i]);
								for (var j = 0; j < els.length; j++) {
									var el = els[j];
									var idLower = el.id.toLowerCase();
									if (idLower === 'flowselector' || idLower === 'fragmentselector') {
										var inner = el.querySelector('#flowSelectorInner, #fragmentSelectorInner, .flowSelectorInner, .fragmentSelectorInner');
										if (!inner) continue;
										var innerStyle = window.getComputedStyle(inner);
										if (innerStyle.display === 'none' || innerStyle.visibility === 'hidden') {
											continue;
										}
									}
									var style = window.getComputedStyle(el);
									if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
										var rect = el.getBoundingClientRect();
										if (rect.width > 20 && rect.height > 20) {
											return true;
										}
									}
								}
							}
							return false;
						})()`
						errCheck := chromedp.Run(ctx, chromedp.Evaluate(jsCheckOpened, &popupOpened))
						if errCheck == nil && popupOpened {
							err = a.captureCurrentStatePDF(ctx, slide.FolderName, slide.Name, sharedPDFPath, sleepMs)
							if err == nil {
								generatedPDFs = append(generatedPDFs, sharedPDFPath)
							}
						} else {
							pdfCounter--
						}
					}

					// Close the popup to restore active states for the next buttons
					jsCloseDialogs := `(function() {
						var closeSelectors = [
							'.ui-dialog-titlebar-close',
							'#closeFlowSelector',
							'#closeSelector',
							'.templateClose',
							'#closeCustomMenu',
							'.close-btn',
							'.close',
							'[data-close]',
							'.dialog-close'
						];
						for (var i = 0; i < closeSelectors.length; i++) {
							try {
								var btns = document.querySelectorAll(closeSelectors[i]);
								for (var j = 0; j < btns.length; j++) {
									var btn = btns[j];
									var style = window.getComputedStyle(btn);
									if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
										var opts = { bubbles: true, cancelable: true, view: window };
										btn.dispatchEvent(new MouseEvent('mousedown', opts));
										btn.dispatchEvent(new MouseEvent('mouseup', opts));
										btn.dispatchEvent(new MouseEvent('click', opts));
										if (window.TouchEvent) {
											var touch = new Touch({ identifier: Date.now(), target: btn, clientX: 0, clientY: 0 });
											btn.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
											btn.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
										}
									}
								}
							} catch (e) {}
						}
						if (window.jQuery) {
							try {
								jQuery('.ui-dialog-content').each(function() {
									try {
										if (jQuery(this).dialog('instance') && jQuery(this).dialog('isOpen') === true) {
											jQuery(this).dialog('close');
										}
									} catch (e) {}
								});
							} catch (e) {}
						}
					})()`
					_ = chromedp.Run(ctx,
						chromedp.Evaluate(jsCloseDialogs, nil),
						chromedp.Sleep(600 * time.Millisecond), // settle close transition
					)
				}
			}
		} else {
			// C. OTHER SLIDES: Check if there's a slide-level ref popup trigger (e.g. gotoRef outside of dialogs)
			var hasSlideRef bool
			jsCheckRef := `(function() {
				var ref = document.querySelector('#references');
				if (ref) {
					var isInactive = ref.classList.contains('inactive') || ref.classList.contains('disabled');
					var style = window.getComputedStyle(ref);
					var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
					if (!isInactive && !isHidden) return true;
				}
				var ref2 = document.querySelector('.gotoRef, [data-reftarget]');
				if (!ref2) return false;
				if (ref2.closest('.dialog') || ref2.closest('.ui-dialog')) return false;
				return true;
			})()`
			err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckRef, &hasSlideRef))
			if err == nil && hasSlideRef {
				wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
					"current": slideIdx + 1,
					"total":   len(slides),
					"slide":   slide.Name,
					"phase":   "crawling",
					"detail":  "Slide reference",
				})

				refPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
				pdfCounter++

				err = a.navigateAndSettle(ctx, slide.URL, sleepMs)
				if err == nil {
					err = chromedp.Run(ctx,
						chromedp.Evaluate(`(function() {
							var el = document.querySelector('#references');
							if (el) {
								var isInactive = el.classList.contains('inactive') || el.classList.contains('disabled');
								var style = window.getComputedStyle(el);
								var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
								if (isInactive || isHidden) el = null;
							}
							if (!el) {
								el = document.querySelector('.gotoRef, [data-reftarget]');
							}
							if (!el) return;
							var opts = { bubbles: true, cancelable: true, view: window };
							el.dispatchEvent(new MouseEvent('mousedown', opts));
							el.dispatchEvent(new MouseEvent('mouseup', opts));
							el.dispatchEvent(new MouseEvent('click', opts));
							if (window.TouchEvent) {
								var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
								el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
								el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
							}
						})()`, nil),
						chromedp.Sleep(450 * time.Millisecond),
					)
				}
				if err == nil {
					err = a.captureCurrentStatePDF(ctx, slide.FolderName, slide.Name, refPDFPath, sleepMs)
					if err == nil {
						generatedPDFs = append(generatedPDFs, refPDFPath)
					}
				}
			}
		}

		// D. DIALOG POPUPS (Triggered one by one)
		type DialogTrigger struct {
			Selector    string `json:"selector"`
			ID          string `json:"id"`
			ClassName   string `json:"className"`
			Description string `json:"description"`
		}
		var triggers []DialogTrigger

		jsDiscoverTriggers := `(function() {
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
						var classes = Array.from(curr.classList).filter(function(c) { return c.trim() !== ""; }).join('.');
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
				if (!target) target = "generic_" + (el.id || el.className || el.innerText || Math.random());
				if (!seenTargets[target]) {
					seenTargets[target] = true;
					var selector = getUniqueSelector(el);
					uniqueTriggers.push({
						selector: selector,
						id: el.id || "",
						targetDialog: target,
						className: el.className || "",
						description: el.getAttribute('data-description') || el.innerText || ""
					});
				}
			});
			return uniqueTriggers;
		})()`

		err = a.navigateAndSettle(ctx, slide.URL, sleepMs)
		if err == nil {
			err = chromedp.Run(ctx, chromedp.Evaluate(jsDiscoverTriggers, &triggers))
		}

		if err == nil && len(triggers) > 0 {
			for triggerIdx, t := range triggers {
				wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
					"current": slideIdx + 1,
					"total":   len(slides),
					"slide":   slide.Name,
					"phase":   "crawling",
					"detail":  fmt.Sprintf("Popup %d/%d: %s", triggerIdx+1, len(triggers), t.ID),
				})

				// D1. Open Dialog Base state
				dialogPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
				pdfCounter++

				if err == nil {
					err = chromedp.Run(ctx,
						chromedp.Evaluate(fmt.Sprintf(`(function() {
							var el = document.querySelector(%q);
							if (!el) return;
							var opts = { bubbles: true, cancelable: true, view: window };
							el.dispatchEvent(new MouseEvent('mousedown', opts));
							el.dispatchEvent(new MouseEvent('mouseup', opts));
							el.dispatchEvent(new MouseEvent('click', opts));
							if (window.TouchEvent) {
								var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
								el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
								el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
							}
						})()`, t.Selector), nil),
						chromedp.Sleep(450 * time.Millisecond), // settle dynamic dialogues
					)
				}
				if err == nil {
					err = a.captureCurrentStatePDF(ctx, slide.FolderName, slide.Name, dialogPDFPath, sleepMs)
					if err == nil {
						generatedPDFs = append(generatedPDFs, dialogPDFPath)

						// D2. Check if this open dialog has a nested reference trigger button inside it!
						var hasDialogRef bool
						jsCheckDialogRef := `(function() {
							var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
								return window.getComputedStyle(d).display !== 'none';
							})[0];
							if (!openDialog) return false;
							var refBtn = openDialog.querySelector('.gotoRef, [data-reftarget]');
							return refBtn !== null;
						})()`

						err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckDialogRef, &hasDialogRef))
						if err == nil && hasDialogRef {
							wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
								"current": slideIdx + 1,
								"total":   len(slides),
								"slide":   slide.Name,
								"phase":   "crawling",
								"detail":  fmt.Sprintf("Nested ref on Popup %s", t.ID),
							})

							dialogRefPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
							pdfCounter++

							nestedClickActions := []chromedp.Action{
								chromedp.Evaluate(`(function() {
									var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
										return window.getComputedStyle(d).display !== 'none';
									})[0];
									if (openDialog) {
										var el = openDialog.querySelector('.gotoRef, [data-reftarget]');
										if (!el) return;
										var opts = { bubbles: true, cancelable: true, view: window };
										el.dispatchEvent(new MouseEvent('mousedown', opts));
										el.dispatchEvent(new MouseEvent('mouseup', opts));
										el.dispatchEvent(new MouseEvent('click', opts));
										if (window.TouchEvent) {
											var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
											el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
											el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
										}
									}
								})()`, nil),
								chromedp.Sleep(450 * time.Millisecond),
							}
							err = chromedp.Run(ctx, nestedClickActions...)
							if err == nil {
								err = a.captureCurrentStatePDF(ctx, slide.FolderName, slide.Name, dialogRefPDFPath, sleepMs)
								if err == nil {
									generatedPDFs = append(generatedPDFs, dialogRefPDFPath)
								}
							}
						}
					}
				}
			}
		}
	}

	// E. MERGE ALL PDFs AND WRITE MASTER METADATA PROPERTIES
	wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
		"current": len(slides),
		"total":   len(slides),
		"slide":   "Stitching Decks",
		"phase":   "merging",
		"detail":  "Applying page indices...",
	})

	outDir, err := a.EnsureOutputDir()
	if err != nil {
		return "", err
	}

	presentationId := filepath.Base(a.currentDir)
	finalFilename := presentationId + ".pdf"
	finalPath := filepath.Join(outDir, finalFilename)

	// If the combined deck already exists, rename it to {presentationId}_oldX.pdf
	if _, err := os.Stat(finalPath); err == nil {
		x := 1
		for {
			oldFilename := fmt.Sprintf("%s_old%d.pdf", presentationId, x)
			oldPath := filepath.Join(outDir, oldFilename)
			if _, err := os.Stat(oldPath); os.IsNotExist(err) {
				if err := os.Rename(finalPath, oldPath); err != nil {
					return "", fmt.Errorf("failed to rename existing combined PDF: %w", err)
				}
				break
			}
			x++
		}
	}

	// Calculate startPage and endPage for each compiled PDF
	var combinedMeta []map[string]interface{}
	currentPage := 1
	for _, path := range generatedPDFs {
		pageCount, err := api.PageCountFile(path)
		if err != nil {
			pageCount = 1
		}

		startPage := currentPage
		endPage := currentPage + pageCount - 1
		currentPage = currentPage + pageCount

		metaStr, err := a.ExtractPDFMetadata(path)
		if err == nil && metaStr != "" && metaStr != "{}" {
			var metaObj map[string]interface{}
			if err := json.Unmarshal([]byte(metaStr), &metaObj); err == nil {
				metaObj["startPage"] = startPage
				metaObj["endPage"] = endPage
				combinedMeta = append(combinedMeta, metaObj)
			}
		} else {
			base := filepath.Base(path)
			metaObj := map[string]interface{}{
				"presentationId": presentationId,
				"slideName":      base,
				"folderName":     "",
				"type":           "slide",
				"startPage":      startPage,
				"endPage":        endPage,
			}
			combinedMeta = append(combinedMeta, metaObj)
		}
	}

	var combinedJSON string
	if len(combinedMeta) > 0 {
		metaBytes, err := json.Marshal(combinedMeta)
		if err == nil {
			combinedJSON = string(metaBytes)
		}
	}

	// Merge all generated page PDFs into the finalPath
	err = api.MergeCreateFile(generatedPDFs, finalPath, false, nil)
	if err != nil {
		return "", fmt.Errorf("failed to merge crawled slide PDFs: %w", err)
	}

	// Inject metadata properties
	if combinedJSON != "" {
		tempOut := finalPath + ".tmp"
		err = api.AddPropertiesFile(finalPath, tempOut, map[string]string{
			"combinedMetadata": combinedJSON,
			"presentationId":   presentationId,
		}, nil)
		if err == nil {
			os.Remove(finalPath)
			os.Rename(tempOut, finalPath)
		} else {
			os.Remove(tempOut)
			return "", fmt.Errorf("failed to inject metadata properties into combined PDF: %w", err)
		}
	}

	return finalPath, nil
}

// captureCurrentStatePDF captures the current dynamic state of the headless browser page to PDF
func (a *App) captureCurrentStatePDF(ctx context.Context, folderName string, slideName string, outputPath string, sleepMs int) error {
	presentationId := filepath.Base(a.currentDir)
	timestampStr := time.Now().Format(time.RFC3339)

	// A. Evaluate metadata script
	jsMetadata := fmt.Sprintf(`(function() {
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
				
				var innerContent = d.querySelector('.ui-dialog-content');
				if (innerContent) {
					id = innerContent.id || "";
					cls = innerContent.className || "";
				}
				
				var lowerId = id.toLowerCase();
				var lowerCls = cls.toLowerCase();
				
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

			var topmost = openPopups[0];
			
			var isSharedTopmost = ["menu", "flow", "fragment", "ref", "pi", "isi", "si", "email"].includes(topmost.type) || 
			                      topmost.id === 'customMenuWrapper' || 
			                      topmost.id === 'flowSelector' || 
			                      topmost.id === 'fragmentSelector';

			if (isSharedTopmost) {
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
	})()`, presentationId, strings.TrimPrefix(slideName, "_"), folderName, timestampStr)

	err := chromedp.Run(ctx, chromedp.Evaluate(jsMetadata, nil))
	if err != nil {
		return err
	}

	// B. Background Flattening (Only if popups are present)
	var activePopupsCount int
	jsCheckPopups := `(function() {
		function getActivePopups() {
			var selectors = ['.ui-dialog', '#customMenuWrapper', '#flowSelector', '#fragmentSelector', '#pi', '#references', '#ref', '#isi', '#si', '#email', '#mail', '#bi', '#mainpopup'];
			return Array.from(document.querySelectorAll(selectors.join(', '))).filter(function(d) {
				var cs = window.getComputedStyle(d);
				if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
				var rect = d.getBoundingClientRect();
				if (rect.width <= 150 || rect.height <= 150) return false;
				var isInViewport = rect.left < window.innerWidth && rect.right > 0 && rect.top < window.innerHeight && rect.bottom > 0;
				if (!isInViewport) return false;
				if (d.classList.contains('inactive') || d.classList.contains('hidden')) return false;
				return true;
			});
		}
		var dialogs = getActivePopups();
		if (dialogs.length === 0) {
			window._pdfSkipFlatten = true;
			return 0;
		}
		window._pdfSkipFlatten = false;

		dialogs[0].setAttribute('data-pdf-topmost', 'true');
		dialogs[0].setAttribute('data-pdf-orig-visibility', dialogs[0].style.visibility || '');
		dialogs[0].style.setProperty('visibility', 'hidden', 'important');

		for (var i = 1; i < dialogs.length; i++) {
			dialogs[i].setAttribute('data-pdf-lower-popup', 'true');
			dialogs[i].setAttribute('data-pdf-orig-visibility', dialogs[i].style.visibility || '');
			dialogs[i].style.setProperty('visibility', 'hidden', 'important');
		}

		document.querySelectorAll('.ui-widget-overlay').forEach(function(o) {
			o.setAttribute('data-pdf-overlay', 'true');
			o.setAttribute('data-pdf-orig-visibility', o.style.visibility || '');
			o.style.setProperty('visibility', 'hidden', 'important');
		});

		return dialogs.length;
	})()`

	err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckPopups, &activePopupsCount))
	if err != nil {
		return err
	}

	var buf []byte
	if activePopupsCount > 0 {
		var screenshotBuf []byte
		err = chromedp.Run(ctx, chromedp.Screenshot("#contentFrame", &screenshotBuf, chromedp.ByID))
		if err != nil {
			return err
		}

		base64Str := "data:image/png;base64," + base64.StdEncoding.EncodeToString(screenshotBuf)
		jsFlatten := fmt.Sprintf(`(function() {
			var cf = document.querySelector("#contentFrame");
			if (cf) {
				Array.from(cf.children).forEach(function(child) {
					var tagName = child.tagName.toLowerCase();
					if (tagName !== 'style' && tagName !== 'link' && !child.hasAttribute('data-pdf-flattened-bg')) {
						child.style.setProperty('display', 'none', 'important');
					}
				});
				
				var bgImg = document.createElement('img');
				bgImg.src = %q;
				bgImg.style.cssText = "width:100%%; height:100%%; object-fit:cover; margin:0; padding:0; border:none; display:block; position:absolute; top:0; left:0; z-index:-1;";
				bgImg.setAttribute('data-pdf-flattened-bg', 'true');
				cf.appendChild(bgImg);
			}

			var topmost = document.querySelector('[data-pdf-topmost="true"]');
			if (topmost) {
				var origVis = topmost.getAttribute('data-pdf-orig-visibility') || '';
				topmost.style.visibility = origVis;
				topmost.removeAttribute('data-pdf-topmost');
				topmost.removeAttribute('data-pdf-orig-visibility');
			}

			var overlays = Array.from(document.querySelectorAll('[data-pdf-overlay="true"]'));
			if (overlays.length > 0) {
				var lastOverlay = overlays[overlays.length - 1];
				var origVis = lastOverlay.getAttribute('data-pdf-orig-visibility') || '';
				lastOverlay.style.visibility = origVis;
				lastOverlay.removeAttribute('data-pdf-overlay');
				lastOverlay.removeAttribute('data-pdf-orig-visibility');
			}

			return "restored";
		})()`, base64Str)

		err = chromedp.Run(ctx, chromedp.Evaluate(jsFlatten, nil))
		if err != nil {
			return err
		}
	}

	// Wait for custom web fonts to be completely ready
	_ = chromedp.Run(ctx, chromedp.Evaluate(`(async function() { try { await document.fonts.ready; } catch(e){} })()`, nil))

	// Inject justification helper spans right before printing to make sure dynamic overlays get them
	jsJustifyBeforePrint := `(function() {
		try {
			var style = document.createElement('style');
			style.innerHTML = '.iScrollVerticalScrollbar, .iScrollIndicator { opacity: 1 !important; display: block !important; visibility: visible !important; }';
			document.head.appendChild(style);
		} catch(_) {}

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
					if (el.closest('.dialog') || el.closest('.ui-dialog') || el.closest('[role="dialog"]')) return;
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
	})()`
	_ = chromedp.Run(ctx, chromedp.Evaluate(jsJustifyBeforePrint, nil))

	// C. Print PDF
	err = chromedp.Run(ctx, chromedp.ActionFunc(func(ctx context.Context) error {
		var printErr error
		buf, _, printErr = page.PrintToPDF().
			WithPrintBackground(true).
			WithPaperWidth(10.66).
			WithPaperHeight(8.00).
			WithMarginTop(0).
			WithMarginBottom(0).
			WithMarginLeft(0).
			WithMarginRight(0).
			WithPreferCSSPageSize(false).
			Do(ctx)
		return printErr
	}))
	if err != nil {
		return err
	}

	return os.WriteFile(outputPath, buf, 0644)
}

// AutomateActiveSlide compiles the base slide, slide references, and all visible dialogue popups/nested references of a single slide folder, merging them into a multi-page sequential slide PDF.
func (a *App) AutomateActiveSlide(slideFolder string, sleepMs int) (string, error) {
	if a.currentDir == "" {
		return "", fmt.Errorf("no presentation directory loaded")
	}

	presentationId := filepath.Base(a.currentDir)

	// 1. Scan slides to find its position
	files, err := os.ReadDir(a.currentDir)
	if err != nil {
		return "", err
	}

	var slides []Slide
	numReg := regexp.MustCompile(`\d+`)
	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		name := file.Name()
		if name == "shared" {
			continue
		}
		indexPath := filepath.Join(a.currentDir, name, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			slideUrl := fmt.Sprintf("http://127.0.0.1:%d/%s/index.html", a.serverPort, name)
			slides = append(slides, Slide{
				Name:       name,
				FolderName: name,
				IndexHTML:  indexPath,
				URL:        slideUrl,
			})
		}
	}

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

	slideIdx := -1
	var targetSlide Slide
	for idx, s := range slides {
		if s.FolderName == slideFolder {
			slideIdx = idx
			targetSlide = s
			break
		}
	}

	if slideIdx == -1 {
		return "", fmt.Errorf("slide folder %s not found", slideFolder)
	}

	// 2. Create a temp directory for compiling sequential page PDFs
	tempDir, err := os.MkdirTemp("", "wails_pdf_automate_slide_")
	if err != nil {
		return "", err
	}
	defer os.RemoveAll(tempDir)

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	if err := chromedp.Run(ctx); err != nil {
		return "", fmt.Errorf("failed to start background browser: %w", err)
	}

	var generatedPDFs []string
	pdfCounter := 0

	// Emit progress update: Rendering base slide
	wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
		"current": 1,
		"total":   4,
		"slide":   targetSlide.Name,
		"phase":   "crawling",
		"detail":  "Base slide",
	})

	// A. BASE SLIDE COMPILING
	basePDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
	pdfCounter++

	// Navigate to slide URL and wait
	err = a.navigateAndSettle(ctx, targetSlide.URL, sleepMs)
	if err != nil {
		return "", fmt.Errorf("failed to navigate to slide %s: %w", targetSlide.Name, err)
	}

	// Capture the base PDF state
	err = a.captureCurrentStatePDF(ctx, targetSlide.FolderName, targetSlide.Name, basePDFPath, sleepMs)
	if err != nil {
		return "", err
	}
	generatedPDFs = append(generatedPDFs, basePDFPath)

	// B. SHARED OVERLAYS (Only if this is first slide, idx == 0)
	if slideIdx == 0 {
		sharedIDs := []string{"pi", "references", "menu", "flowSelector", "email", "objection", "quickres"}
		for _, sid := range sharedIDs {
			var isVisible bool
			jsCheck := fmt.Sprintf(`(function() {
				var el = document.querySelector('#%s');
				if (!el) return false;
				if (el.classList.contains('inactive') || el.classList.contains('disabled')) return false;
				var style = window.getComputedStyle(el);
				if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false;
				if (parseFloat(style.opacity) < 0.6) return false;
				var rect = el.getBoundingClientRect();
				if (rect.width <= 5 || rect.height <= 5) return false;
				return true;
			})()`, sid)
			err = chromedp.Run(ctx, chromedp.Evaluate(jsCheck, &isVisible))
			if err == nil && isVisible {
				wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
					"current": 2,
					"total":   4,
					"slide":   targetSlide.Name,
					"phase":   "crawling",
					"detail":  fmt.Sprintf("Shared overlay: %s", sid),
				})

				sharedPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
				pdfCounter++

				err = chromedp.Run(ctx,
					chromedp.Evaluate(fmt.Sprintf(`(function() {
						var el = document.querySelector('#%s');
						if (!el) return;
						var opts = { bubbles: true, cancelable: true, view: window };
						el.dispatchEvent(new MouseEvent('mousedown', opts));
						el.dispatchEvent(new MouseEvent('mouseup', opts));
						el.dispatchEvent(new MouseEvent('click', opts));
						if (window.TouchEvent) {
							var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
							el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
							el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
						}
					})()`, sid), nil),
					chromedp.Sleep(450 * time.Millisecond), // settle transition
				)
				if err == nil {
					var popupOpened bool
					var debugLog string
					jsCheckOpened := `(function() {
						var selectors = ['.dialog', '.ui-dialog', '[role="dialog"]', '#flowSelector', '#fragmentSelector', '#customMenuWrapper', '.popup', '.overlay'];
						var hasOpen = false;
						var details = [];
						for (var i = 0; i < selectors.length; i++) {
							var els = document.querySelectorAll(selectors[i]);
							for (var j = 0; j < els.length; j++) {
								var el = els[j];
								var idLower = el.id.toLowerCase();
								if (idLower === 'flowselector' || idLower === 'fragmentselector') {
									var inner = el.querySelector('#flowSelectorInner, #fragmentSelectorInner, .flowSelectorInner, .fragmentSelectorInner');
									if (!inner) continue;
									var innerStyle = window.getComputedStyle(inner);
									if (innerStyle.display === 'none' || innerStyle.visibility === 'hidden') {
										continue;
									}
								}
								var style = window.getComputedStyle(el);
								var rect = el.getBoundingClientRect();
								details.push(selectors[i] + '{id:"' + el.id + '",display:"' + style.display + '",vis:"' + style.visibility + '",op:"' + style.opacity + '",w:' + Math.round(rect.width) + ',h:' + Math.round(rect.height) + '}');
								if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
									if (rect.width > 20 && rect.height > 20) {
										hasOpen = true;
									}
								}
							}
						}
						return JSON.stringify({ hasOpen: hasOpen, details: details });
					})()`
					errCheck := chromedp.Run(ctx, chromedp.Evaluate(jsCheckOpened, &debugLog))
					if errCheck == nil {
						fmt.Printf("[DEBUG-CRAWL] Clicked %s | Result: %s\n", sid, debugLog)
						var logObj struct {
							HasOpen bool     `json:"hasOpen"`
							Details []string `json:"details"`
						}
						if json.Unmarshal([]byte(debugLog), &logObj) == nil {
							popupOpened = logObj.HasOpen
						}
					}
					if errCheck == nil && popupOpened {
						err = a.captureCurrentStatePDF(ctx, targetSlide.FolderName, targetSlide.Name, sharedPDFPath, sleepMs)
						if err == nil {
							generatedPDFs = append(generatedPDFs, sharedPDFPath)
						}
					} else {
						pdfCounter--
					}
				}

				// Close the popup to restore active states for the next buttons
				jsCloseDialogs := `(function() {
					var closeSelectors = [
						'.ui-dialog-titlebar-close',
						'#closeFlowSelector',
						'#closeSelector',
						'.templateClose',
						'#closeCustomMenu',
						'.close-btn',
						'.close',
						'[data-close]',
						'.dialog-close'
					];
					for (var i = 0; i < closeSelectors.length; i++) {
						try {
							var btns = document.querySelectorAll(closeSelectors[i]);
							for (var j = 0; j < btns.length; j++) {
								var btn = btns[j];
								var style = window.getComputedStyle(btn);
								if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
									var opts = { bubbles: true, cancelable: true, view: window };
									btn.dispatchEvent(new MouseEvent('mousedown', opts));
									btn.dispatchEvent(new MouseEvent('mouseup', opts));
									btn.dispatchEvent(new MouseEvent('click', opts));
									if (window.TouchEvent) {
										var touch = new Touch({ identifier: Date.now(), target: btn, clientX: 0, clientY: 0 });
										btn.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
										btn.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
									}
								}
							}
						} catch (e) {}
					}
					if (window.jQuery) {
						try {
							jQuery('.ui-dialog-content').each(function() {
								try {
									if (jQuery(this).dialog('instance') && jQuery(this).dialog('isOpen') === true) {
										jQuery(this).dialog('close');
									}
								} catch (e) {}
							});
						} catch (e) {}
					}
				})()`
				_ = chromedp.Run(ctx,
					chromedp.Evaluate(jsCloseDialogs, nil),
					chromedp.Sleep(600 * time.Millisecond), // settle close transition
				)
			}
		}
	} else {
		// C. OTHER SLIDES: Check if there's a slide-level ref popup trigger (e.g. gotoRef outside of dialogs)
		var hasSlideRef bool
		jsCheckRef := `(function() {
			var ref = document.querySelector('#references');
			if (ref) {
				var isInactive = ref.classList.contains('inactive') || ref.classList.contains('disabled');
				var style = window.getComputedStyle(ref);
				var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
				if (!isInactive && !isHidden) return true;
			}
			var ref2 = document.querySelector('.gotoRef, [data-reftarget]');
			if (!ref2) return false;
			if (ref2.closest('.dialog') || ref2.closest('.ui-dialog')) return false;
			return true;
		})()`
		err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckRef, &hasSlideRef))
		if err == nil && hasSlideRef {
			wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
				"current": 2,
				"total":   4,
				"slide":   targetSlide.Name,
				"phase":   "crawling",
				"detail":  "Slide reference",
			})

			refPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
			pdfCounter++

			err = a.navigateAndSettle(ctx, targetSlide.URL, sleepMs)
			if err == nil {
				err = chromedp.Run(ctx,
					chromedp.Evaluate(`(function() {
						var el = document.querySelector('#references');
						if (el) {
							var isInactive = el.classList.contains('inactive') || el.classList.contains('disabled');
							var style = window.getComputedStyle(el);
							var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
							if (isInactive || isHidden) el = null;
						}
						if (!el) {
							el = document.querySelector('.gotoRef, [data-reftarget]');
						}
						if (!el) return;
						var opts = { bubbles: true, cancelable: true, view: window };
						el.dispatchEvent(new MouseEvent('mousedown', opts));
						el.dispatchEvent(new MouseEvent('mouseup', opts));
						el.dispatchEvent(new MouseEvent('click', opts));
						if (window.TouchEvent) {
							var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
							el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
							el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
						}
					})()`, nil),
					chromedp.Sleep(450 * time.Millisecond),
				)
			}
			if err == nil {
				err = a.captureCurrentStatePDF(ctx, targetSlide.FolderName, targetSlide.Name, refPDFPath, sleepMs)
				if err == nil {
					generatedPDFs = append(generatedPDFs, refPDFPath)
				}
			}
		}
	}

	// D. DIALOG POPUPS (Triggered one by one)
	type DialogTrigger struct {
		Selector    string `json:"selector"`
		ID          string `json:"id"`
		ClassName   string `json:"className"`
		Description string `json:"description"`
	}
	var triggers []DialogTrigger

	jsDiscoverTriggers := `(function() {
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
					var classes = Array.from(curr.classList).filter(function(c) { return c.trim() !== ""; }).join('.');
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
			if (!target) target = "generic_" + (el.id || el.className || el.innerText || Math.random());
			if (!seenTargets[target]) {
				seenTargets[target] = true;
				var selector = getUniqueSelector(el);
				uniqueTriggers.push({
					selector: selector,
					id: el.id || "",
					targetDialog: target,
					className: el.className || "",
					description: el.getAttribute('data-description') || el.innerText || ""
				});
			}
		});
		return uniqueTriggers;
	})()`

	err = a.navigateAndSettle(ctx, targetSlide.URL, sleepMs)
	if err == nil {
		err = chromedp.Run(ctx, chromedp.Evaluate(jsDiscoverTriggers, &triggers))
	}

	if err == nil && len(triggers) > 0 {
		for triggerIdx, t := range triggers {
			wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
				"current": 3,
				"total":   4,
				"slide":   targetSlide.Name,
				"phase":   "crawling",
				"detail":  fmt.Sprintf("Popup %d/%d: %s", triggerIdx+1, len(triggers), t.ID),
			})

			// D1. Open Dialog Base state
			dialogPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
			pdfCounter++

			err = a.navigateAndSettle(ctx, targetSlide.URL, sleepMs)
			if err == nil {
				err = chromedp.Run(ctx,
					chromedp.Evaluate(fmt.Sprintf(`(function() {
						var el = document.querySelector(%q);
						if (!el) return;
						var opts = { bubbles: true, cancelable: true, view: window };
						el.dispatchEvent(new MouseEvent('mousedown', opts));
						el.dispatchEvent(new MouseEvent('mouseup', opts));
						el.dispatchEvent(new MouseEvent('click', opts));
						if (window.TouchEvent) {
							var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
							el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
							el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
						}
					})()`, t.Selector), nil),
					chromedp.Sleep(450 * time.Millisecond),
				)
			}
			if err == nil {
				err = a.captureCurrentStatePDF(ctx, targetSlide.FolderName, targetSlide.Name, dialogPDFPath, sleepMs)
				if err == nil {
					generatedPDFs = append(generatedPDFs, dialogPDFPath)

					// D2. Check if this open dialog has a nested reference trigger button inside it!
					var hasDialogRef bool
					jsCheckDialogRef := `(function() {
						var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
							return window.getComputedStyle(d).display !== 'none';
						})[0];
						if (!openDialog) return false;
						var refBtn = openDialog.querySelector('.gotoRef, [data-reftarget]');
						return refBtn !== null;
					})()`

					err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckDialogRef, &hasDialogRef))
					if err == nil && hasDialogRef {
						wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
							"current": 3,
							"total":   4,
							"slide":   targetSlide.Name,
							"phase":   "crawling",
							"detail":  fmt.Sprintf("Nested ref on Popup %s", t.ID),
						})

						dialogRefPDFPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d_%03d.pdf", slideIdx, pdfCounter))
						pdfCounter++

						nestedClickActions := []chromedp.Action{
							chromedp.Evaluate(`(function() {
								var openDialog = Array.from(document.querySelectorAll('.dialog, .ui-dialog')).filter(function(d) {
									return window.getComputedStyle(d).display !== 'none';
								})[0];
								if (openDialog) {
									var el = openDialog.querySelector('.gotoRef, [data-reftarget]');
									if (!el) return;
									var opts = { bubbles: true, cancelable: true, view: window };
									el.dispatchEvent(new MouseEvent('mousedown', opts));
									el.dispatchEvent(new MouseEvent('mouseup', opts));
									el.dispatchEvent(new MouseEvent('click', opts));
									if (window.TouchEvent) {
										var touch = new Touch({ identifier: Date.now(), target: el, clientX: 0, clientY: 0 });
										el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [touch] }));
										el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [touch] }));
									}
								}
							})()`, nil),
							chromedp.Sleep(450 * time.Millisecond),
						}
						err = chromedp.Run(ctx, nestedClickActions...)
						if err == nil {
							err = a.captureCurrentStatePDF(ctx, targetSlide.FolderName, targetSlide.Name, dialogRefPDFPath, sleepMs)
							if err == nil {
								generatedPDFs = append(generatedPDFs, dialogRefPDFPath)
							}
						}
					}
				}
			}
		}
	}

	// E. MERGE ALL PDFs AND WRITE MASTER METADATA PROPERTIES
	wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
		"current": 4,
		"total":   4,
		"slide":   "Saving Slide PDF",
		"phase":   "merging",
		"detail":  "Applying page indices...",
	})

	outDir, err := a.EnsureOutputDir()
	if err != nil {
		return "", err
	}
	outputPath := filepath.Join(outDir, fmt.Sprintf("%d.pdf", slideIdx+1))

	// Delete existing if any
	os.Remove(outputPath)

	// Calculate startPage and endPage for each compiled PDF
	var combinedMeta []map[string]interface{}
	currentPage := 1
	for _, path := range generatedPDFs {
		pageCount, err := api.PageCountFile(path)
		if err != nil {
			pageCount = 1
		}

		startPage := currentPage
		endPage := currentPage + pageCount - 1
		currentPage = currentPage + pageCount

		metaStr, err := a.ExtractPDFMetadata(path)
		if err == nil && metaStr != "" && metaStr != "{}" {
			var metaObj map[string]interface{}
			if err := json.Unmarshal([]byte(metaStr), &metaObj); err == nil {
				metaObj["startPage"] = startPage
				metaObj["endPage"] = endPage
				combinedMeta = append(combinedMeta, metaObj)
			}
		} else {
			base := filepath.Base(path)
			metaObj := map[string]interface{}{
				"presentationId": presentationId,
				"slideName":      base,
				"folderName":     "",
				"type":           "slide",
				"startPage":      startPage,
				"endPage":        endPage,
			}
			combinedMeta = append(combinedMeta, metaObj)
		}
	}

	var combinedJSON string
	if len(combinedMeta) > 0 {
		metaBytes, err := json.Marshal(combinedMeta)
		if err == nil {
			combinedJSON = string(metaBytes)
		}
	}

	// Merge all generated page PDFs into the final outputPath
	err = api.MergeCreateFile(generatedPDFs, outputPath, false, nil)
	if err != nil {
		return "", fmt.Errorf("failed to merge crawled slide PDFs: %w", err)
	}

	// Inject metadata properties
	if combinedJSON != "" {
		tempOut := outputPath + ".tmp"
		err = api.AddPropertiesFile(outputPath, tempOut, map[string]string{
			"combinedMetadata": combinedJSON,
			"presentationId":   presentationId,
		}, nil)
		if err == nil {
			os.Remove(outputPath)
			os.Rename(tempOut, outputPath)
		} else {
			os.Remove(tempOut)
			return "", fmt.Errorf("failed to inject metadata properties into combined PDF: %w", err)
		}
	}

	return outputPath, nil
}

// navigateAndSettle forces screen media emulation, locks to landscape 1024x768, navigates to the URL, and waits for settlement.
func (a *App) navigateAndSettle(ctx context.Context, url string, sleepMs int) error {
	return chromedp.Run(ctx,
		emulation.SetEmulatedMedia().WithMedia("screen"),
		emulation.SetDeviceMetricsOverride(1024, 768, 1, false).
			WithScreenOrientation(&emulation.ScreenOrientation{
				Type:  emulation.OrientationTypeLandscapePrimary,
				Angle: 90,
			}),
		chromedp.Navigate(url),
		chromedp.WaitReady("body"),
		chromedp.Evaluate(`(async function() { try { await document.fonts.ready; } catch(e){} })()`, nil),
		chromedp.Sleep(time.Duration(sleepMs)*time.Millisecond),
	)
}

// ScanActiveSlide returns a list of detected items (descriptions/selectors) that will be processed.
func (a *App) ScanActiveSlide(slideFolder string) ([]string, error) {
	if a.currentDir == "" {
		return nil, fmt.Errorf("no presentation directory loaded")
	}

	// 1. Scan slides to find its position
	files, err := os.ReadDir(a.currentDir)
	if err != nil {
		return nil, err
	}

	var slides []Slide
	numReg := regexp.MustCompile(`\d+`)
	for _, file := range files {
		if !file.IsDir() {
			continue
		}
		name := file.Name()
		if name == "shared" {
			continue
		}
		indexPath := filepath.Join(a.currentDir, name, "index.html")
		if _, err := os.Stat(indexPath); err == nil {
			slideUrl := fmt.Sprintf("http://127.0.0.1:%d/%s/index.html", a.serverPort, name)
			slides = append(slides, Slide{
				Name:       name,
				FolderName: name,
				IndexHTML:  indexPath,
				URL:        slideUrl,
			})
		}
	}

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

	slideIdx := -1
	var targetSlide Slide
	for idx, s := range slides {
		if s.FolderName == slideFolder {
			slideIdx = idx
			targetSlide = s
			break
		}
	}

	if slideIdx == -1 {
		return nil, fmt.Errorf("slide folder %s not found", slideFolder)
	}

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.DisableGPU,
		chromedp.NoSandbox,
	)
	allocCtx, allocCancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer allocCancel()

	ctx, cancel := chromedp.NewContext(allocCtx)
	defer cancel()

	if err := chromedp.Run(ctx); err != nil {
		return nil, fmt.Errorf("failed to start background browser: %w", err)
	}

	var detected []string
	detected = append(detected, "📄 Base Slide (always captured)")

	// Navigate to slide URL and wait
	err = a.navigateAndSettle(ctx, targetSlide.URL, 450)
	if err != nil {
		return nil, fmt.Errorf("failed to navigate to slide: %w", err)
	}

	// B. SHARED OVERLAYS (Only if this is first slide, idx == 0)
	if slideIdx == 0 {
		sharedIDs := []string{"pi", "references", "menu", "flowSelector", "email", "objection", "quickres"}
		for _, sid := range sharedIDs {
			var isVisible bool
			jsCheck := fmt.Sprintf(`(function() {
				var el = document.querySelector('#%s');
				if (!el) return false;
				if (el.classList.contains('inactive') || el.classList.contains('disabled')) return false;
				var style = window.getComputedStyle(el);
				if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || style.pointerEvents === 'none') return false;
				if (parseFloat(style.opacity) < 0.6) return false;
				var rect = el.getBoundingClientRect();
				if (rect.width <= 5 || rect.height <= 5) return false;
				return true;
			})()`, sid)
			err = chromedp.Run(ctx, chromedp.Evaluate(jsCheck, &isVisible))
			if err == nil && isVisible {
				detected = append(detected, fmt.Sprintf("🔗 Shared Overlay Button: #%s", sid))
			}
		}
	} else {
		// C. OTHER SLIDES: Slide references
		var hasSlideRef bool
		jsCheckRef := `(function() {
			var ref = document.querySelector('#references');
			if (ref) {
				var isInactive = ref.classList.contains('inactive') || ref.classList.contains('disabled');
				var style = window.getComputedStyle(ref);
				var isHidden = style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0' || parseFloat(style.opacity) < 0.5;
				if (!isInactive && !isHidden) return true;
			}
			var ref2 = document.querySelector('.gotoRef, [data-reftarget]');
			if (!ref2) return false;
			if (ref2.closest('.dialog') || ref2.closest('.ui-dialog')) return false;
			return true;
		})()`
		err = chromedp.Run(ctx, chromedp.Evaluate(jsCheckRef, &hasSlideRef))
		if err == nil && hasSlideRef {
			detected = append(detected, "📚 Slide-Level Reference Link (.gotoRef or [data-reftarget])")
		}
	}

	// D. DIALOG POPUPS
	type DialogTrigger struct {
		Selector    string `json:"selector"`
		ID          string `json:"id"`
		ClassName   string `json:"className"`
		Description string `json:"description"`
	}
	var triggers []DialogTrigger

	jsDiscoverTriggers := `(function() {
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
					var classes = Array.from(curr.classList).filter(function(c) { return c.trim() !== ""; }).join('.');
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
			if (!target) target = "generic_" + (el.id || el.className || el.innerText || Math.random());
			if (!seenTargets[target]) {
				seenTargets[target] = true;
				var selector = getUniqueSelector(el);
				uniqueTriggers.push({
					selector: selector,
					id: el.id || "",
					targetDialog: target,
					className: el.className || "",
					description: el.getAttribute('data-description') || el.innerText || ""
				});
			}
		});
		return uniqueTriggers;
	})()`

	err = chromedp.Run(ctx, chromedp.Evaluate(jsDiscoverTriggers, &triggers))
	if err == nil {
		for _, t := range triggers {
			desc := t.Description
			if desc == "" {
				desc = t.ClassName
			}
			detected = append(detected, fmt.Sprintf("💬 Dialog Trigger: Selector=%s | Target=%s", t.Selector, desc))
		}
	}

	return detected, nil
}


