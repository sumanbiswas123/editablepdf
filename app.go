package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
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
	server     *http.Server
	serverPort int
	currentDir string
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// SelectDirectory triggers the folder selector dialog
func (a *App) SelectDirectory() (string, error) {
	dir, err := wailsRuntime.OpenDirectoryDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title: "Select eDA Presentation Root Directory",
	})
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

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	port := listener.Addr().(*net.TCPAddr).Port
	a.serverPort = port
	a.currentDir = dirPath

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		// Prevent traversal attacks
		cleanedPath := filepath.Clean(r.URL.Path)
		fullPath := filepath.Join(dirPath, cleanedPath)

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
window.addEventListener('message', function(e) {
  if (e.data !== 'request_html') return;

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
        // Exclude dark backdrop overlays so we detect the actual text container popup
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
  try {
    findActivePopups(document.documentElement);
  } catch (_) {}

  // 2. Clone document natively (since slides use standard DOM and jQuery UI)
  var docClone = document.documentElement.cloneNode(true);

  // 3. Tag active popup surgically so the backend screenshot engine can identify and isolate it in the clone
  if (topActivePopup) {
    topActivePopup.setAttribute('data-pdf-active-popup', 'true');
    var freshClone = document.documentElement.cloneNode(true);
    topActivePopup.removeAttribute('data-pdf-active-popup');
    docClone = freshClone;
  }

  // 4. Inject helper span ONLY into cloned document (preserving justification spacing fix!)
  // We scan standard styleSheets dynamically inside the live page to locate rules targeted by the spacing hack.
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

  // Return the cloned outerHTML to Wails parent frame
  window.parent.postMessage({
    type: 'captured_html',
    html: docClone.outerHTML
  }, '*');
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
				htmlStr = htmlStr[:importIdx] + injection + htmlStr[importIdx:]

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
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save Slide Screenshot",
		DefaultFilename: defaultFilename,
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "PNG Image (*.png)",
				Pattern:     "*.png",
			},
		},
	})
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

	// Capture visual screenshot using chromedp
	var buf []byte
	err := chromedp.Run(ctx,
		// Lock viewport to 1024x768
		emulation.SetDeviceMetricsOverride(1024, 768, 1, false).
			WithScreenOrientation(&emulation.ScreenOrientation{
				Type:  emulation.OrientationTypeLandscapePrimary,
				Angle: 90,
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
}

func (a *App) CompileSlidesToPDF(jobs []ExportJob, outputPath string, sleepMs int) (string, error) {
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
		wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
			"current": idx + 1,
			"total":   len(jobs),
			"slide":   job.SlideName,
			"phase":   "rendering",
		})

		renderUrl := job.URL

		// If custom interactive state HTML is provided, write it temporarily
		var tempFile string
		if job.CustomHTML != "" {
			var err error
			renderUrl, err = a.CaptureCustomStateHTML(job.FolderName, job.CustomHTML)
			if err != nil {
				return "", err
			}
			tempFile = filepath.Base(renderUrl)
		}

		// Filepath to save individual page PDF
		pdfPath := filepath.Join(tempDir, fmt.Sprintf("slide_%03d.pdf", idx))

		// Execute page loading, locking 1024x768 viewport, and printing to PDF
		var buf []byte
		var screenshotBuf []byte

		actions := []chromedp.Action{
			// Force screen media emulation to render screen-specific layouts, fonts, backgrounds, and pseudo-elements
			emulation.SetEmulatedMedia().WithMedia("screen"),
			// Lock viewport to 1024x768 to prevent layout shifts
			emulation.SetDeviceMetricsOverride(1024, 768, 1, false).
				WithScreenOrientation(&emulation.ScreenOrientation{
					Type:  emulation.OrientationTypeLandscapePrimary,
					Angle: 90,
				}),
			chromedp.Navigate(renderUrl),
			// Wait for body to be loaded
			chromedp.WaitReady("body"),
			// Settle time for custom transitions or web fonts
			chromedp.Sleep(time.Duration(sleepMs) * time.Millisecond),
		}

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
					var dialogs = Array.from(document.querySelectorAll('.ui-dialog')).filter(function(d) {
						var cs = window.getComputedStyle(d);
						return cs.display !== 'none' && cs.visibility !== 'hidden';
					});

					// NO visible popups → skip flattening, render as fully editable vector PDF
					if (dialogs.length === 0) {
						window._pdfSkipFlatten = true;
						return 0;
					}
					window._pdfSkipFlatten = false;

					// Sort by z-index descending so [0] = topmost
					dialogs.sort(function(a, b) {
						return (parseInt(window.getComputedStyle(b).zIndex) || 0) -
						       (parseInt(window.getComputedStyle(a).zIndex) || 0);
					});

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
						// Flatten #contentFrame to screenshot image
						var cf = document.querySelector("#contentFrame");
						if (cf) {
							cf.innerHTML = '<img src="%s" style="width:100%%; height:100%%; object-fit:cover; margin:0; padding:0; border:none; display:block;" />';
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
					var res string
					return chromedp.Evaluate(jsScript, &res).Do(ctx)
				}),
			)
		}

		// Finally, add the PrintToPDF printing action to the pipeline
		actions = append(actions,
			chromedp.ActionFunc(func(ctx context.Context) error {
				var err error
				// Print to 10.66 x 8.00 in (perfect 1024x768px at 96 DPI aspect ratio) with zero margins
				buf, _, err = page.PrintToPDF().
					WithPrintBackground(true).
					WithPaperWidth(10.66).
					WithPaperHeight(8.00).
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
	wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
		"current": len(jobs),
		"total":   len(jobs),
		"slide":   "All Slides",
		"phase":   "merging",
	})

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
		wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
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
	wailsRuntime.EventsEmit(a.ctx, "compilation_progress", map[string]interface{}{
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
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save InDesign Interchange Package",
		DefaultFilename: defaultFilename,
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "InDesign Markup Language (*.idml)",
				Pattern:     "*.idml",
			},
		},
	})
}

// SelectSavePath triggers a native save file dialog
func (a *App) SelectSavePath(defaultFilename string) (string, error) {
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		Title:           "Save Editable PDF",
		DefaultFilename: defaultFilename,
		Filters: []wailsRuntime.FileFilter{
			{
				DisplayName: "PDF Files (*.pdf)",
				Pattern:     "*.pdf",
			},
		},
	})
}

// CleanUpServer shuts down the local server when app closes
func (a *App) CleanUpServer() {
	if a.server != nil {
		a.server.Shutdown(context.Background())
	}
}

