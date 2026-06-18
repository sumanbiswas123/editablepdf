import React from 'react';
import { ArrowLeft, ArrowRight, RotateCw, Monitor, Smartphone, Sparkles } from 'lucide-react';

interface Slide {
  name: string;
  folderName: string;
  url: string;
}

interface CompilationProgress {
  phase: string;
  current: number;
  total: number;
  slide: string;
  detail: string;
}

interface CanvasProps {
  activeSlide: Slide | null;
  currentSlideIndex: number;
  totalSlides: number;
  iframeRef: React.RefObject<HTMLIFrameElement>;
  onPrev: () => void;
  onNext: () => void;
  onReload: () => void;
  isCompiling: boolean;
  compilationProgress: CompilationProgress | null;
  isSingleSave: boolean;
  pdfToDelete: { name: string; type: 'single' | 'deck' } | null;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  theme?: 'dark' | 'light';
  slides: Slide[];
  onSelectSlide: (index: number) => void;
  presentationId: string;
  onSaveSlide?: () => void;
  onAutoSlide?: () => void;
  onFullAuto?: () => void;
  onCaptureSwimlane?: () => void;
  showBottomBar: boolean;
  setShowBottomBar: React.Dispatch<React.SetStateAction<boolean>>;
  showVeevaMenu: boolean;
  setShowVeevaMenu: React.Dispatch<React.SetStateAction<boolean>>;
  currentPage: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
}

export const Canvas: React.FC<CanvasProps> = ({
  activeSlide,
  currentSlideIndex,
  totalSlides,
  iframeRef,
  onPrev,
  onNext,
  onReload,
  isCompiling,
  compilationProgress,
  isSingleSave,
  pdfToDelete,
  onCancelDelete,
  onConfirmDelete,
  theme = 'dark',
  slides,
  onSelectSlide,
  presentationId,
  onSaveSlide,
  onAutoSlide,
  onFullAuto,
  onCaptureSwimlane,
  showBottomBar,
  setShowBottomBar,
  showVeevaMenu,
  setShowVeevaMenu,
  currentPage,
  setCurrentPage,
}) => {
  if (!activeSlide) {
    return (
      <div style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '40px',
        backgroundColor: 'var(--bg-deep)'
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          background: 'linear-gradient(135deg, var(--accent-dim), var(--blue-dim))',
          border: '1px solid var(--border-accent)',
          borderRadius: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '28px',
          marginBottom: '24px',
          color: 'var(--accent)',
          boxShadow: '0 8px 24px rgba(0, 242, 254, 0.15)'
        }}>
          ◈
        </div>
        <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '10px', color: 'var(--text-1)', letterSpacing: '-0.3px' }}>
          NoCodeX ePDF Studio
        </h2>
        <p style={{ fontSize: '12px', color: 'var(--text-2)', maxWidth: '380px', lineHeight: '1.7' }}>
          Open a campaign project folder containing slide subfolders and a sibling "shared" assets folder to inspect and compile PDFs.
        </p>
      </div>
    );
  }

  const isVertical = !!(activeSlide.folderName && activeSlide.folderName.toLowerCase().includes('vertical'));
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = React.useState({ width: 1024, height: 768 });

  const thumbsContainerRef = React.useRef<HTMLDivElement>(null);
  const currentPageRef = React.useRef(0);      // always up-to-date, safe inside event listeners
  const [isDragging, setIsDragging] = React.useState(false);
  const [isApproved, setIsApproved] = React.useState(false);
  // Track which slide indices have portrait-oriented thumbnails (detected on image load)
  const [portraitThumbs, setPortraitThumbs] = React.useState<Set<number>>(new Set());
  const dragStartX = React.useRef(0);
  const dragStartScroll = React.useRef(0);
  const didDrag = React.useRef(false);
  const lastWheelTime = React.useRef(0);        // debounce trackpad wheel bursts

  // Toggle bottom bar on iframe message and bind top-left click detection in iframe
  React.useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data) {
        if (e.data.type === 'epdf_toggle_bottom_bar') {
          setShowBottomBar(prev => !prev);
        } else if (e.data.type === 'epdf_toggle_veeva_menu') {
          setShowVeevaMenu(prev => !prev);
        }
      }
    };
    window.addEventListener('message', handleMessage);

    const handleIframeClick = (e: MouseEvent) => {
      // Check if user clicked the actual three-dots button/image/element inside the iframe.
      // We check if the element clicked has an img with "three" in src, or class, or if it's within the top-left area.
      const target = e.target as HTMLElement;
      const isThreeDots = !!(
        target.closest('[class*="three-dot"]') ||
        target.closest('[id*="three-dot"]') ||
        target.closest('[class*="menu"]') ||
        (target.tagName === 'IMG' && ((target as HTMLImageElement).src.includes('three') || (target as HTMLImageElement).src.includes('dot') || (target as HTMLImageElement).src.includes('menu'))) ||
        e.clientX < 80 && e.clientY < 50
      );

      if (isThreeDots) {
        setShowVeevaMenu(prev => !prev);
      }
    };

    const attachIFrameListener = () => {
      try {
        const iframe = iframeRef.current;
        if (!iframe) return;
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;
        
        doc.removeEventListener('click', handleIframeClick);
        doc.addEventListener('click', handleIframeClick);
      } catch (err) {
        // Safe catch for load states
      }
    };

    const interval = setInterval(attachIFrameListener, 1000);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
      try {
        const iframe = iframeRef.current;
        const doc = iframe?.contentDocument || iframe?.contentWindow?.document;
        doc?.removeEventListener('click', handleIframeClick);
      } catch (err) {}
    };
  }, [currentSlideIndex, activeSlide]);

  const targetWidth = isVertical ? 768 : 1024;

  // thumbWidth: paddingLeft(3) + 8×gap(20.625) + 8×tw = targetWidth
  // 3 + 165 + 8×tw = targetWidth → 168 + 8×tw = targetWidth → tw = (targetWidth−168)/8
  // Works exactly: 1024→tw=107, 768→tw=75 (both integers, zero gap/cut on right)
  const thumbWidth = Math.round((targetWidth - 168) / 8);
  const thumbHeight = Math.round(thumbWidth * 0.745);

  // Page layout: page 0 shows slides 1-8 (slide 8 slightly cut).
  // Page N (N>=1) starts at the middle of slide (7N), ends at middle of slide (7N+8).
  // Each page advances by 7 slides. First thumb offset = paddingLeft(10) + gap(20) = 30px.
  // Scroll target for page N: middle of slide at index (7N - 1) in 0-based.
  const getScrollForPage = (pageIndex: number, tw: number) => {
    if (pageIndex === 0) return 0;
    // thumbStart(idx) = 23.625 + idx × (tw + 20.625)  [paddingLeft(3) + gap(20.625) = 23.625]
    // Scroll to middle of card at index (7*pageIndex - 1)
    const cardIndex = 7 * pageIndex - 1;
    return 21.625 + cardIndex * (tw + 20.625) + tw / 2;
  };

  // Total pages: page 0 covers 8 slides, each extra page covers 7 more.
  const totalPages = slides.length <= 8
    ? 1
    : 1 + Math.ceil((slides.length - 8) / 7);

  // Update current page when active slide changes
  React.useEffect(() => {
    if (currentSlideIndex !== -1) {
      const pageIndex = Math.min(Math.floor(currentSlideIndex / 7), totalPages - 1);
      setCurrentPage(pageIndex);
      if (thumbsContainerRef.current) {
        thumbsContainerRef.current.scrollTo({
          left: getScrollForPage(pageIndex, thumbWidth),
          behavior: 'smooth'
        });
      }
    }
  }, [currentSlideIndex, totalPages, thumbWidth]);

  // Scroll to current page when currentPage changes (lifted state)
  React.useEffect(() => {
    if (thumbsContainerRef.current) {
      const scrollTarget = getScrollForPage(currentPage, thumbWidth);
      if (Math.abs(thumbsContainerRef.current.scrollLeft - scrollTarget) > 5) {
        thumbsContainerRef.current.scrollTo({
          left: scrollTarget,
          behavior: 'smooth'
        });
      }
    }
  }, [currentPage, thumbWidth]);

  const handleScroll = () => {
    if (!thumbsContainerRef.current) return;
    const scrollLeft = thumbsContainerRef.current.scrollLeft;
    // Reverse-calculate page: page 0 ends before midpoint of page 1 scroll target
    let best = 0;
    let bestDist = Math.abs(scrollLeft - 0);
    for (let p = 1; p < totalPages; p++) {
      const target = getScrollForPage(p, thumbWidth);
      const dist = Math.abs(scrollLeft - target);
      if (dist < bestDist) { bestDist = dist; best = p; }
    }
    setCurrentPage(best);
  };

  const scrollToPage = (pageIndex: number) => {
    if (thumbsContainerRef.current) {
      thumbsContainerRef.current.scrollTo({
        left: getScrollForPage(pageIndex, thumbWidth),
        behavior: 'smooth'
      });
      setCurrentPage(pageIndex);
      currentPageRef.current = pageIndex;
    }
  };

  // Keep currentPageRef in sync so wheel handler always sees latest value
  currentPageRef.current = currentPage;

  // Non-passive wheel listener: intercepts trackpad swipe and snaps to next/prev page.
  // Must be attached via addEventListener with { passive: false } so preventDefault works.
  React.useEffect(() => {
    const container = thumbsContainerRef.current;
    if (!container) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - lastWheelTime.current < 500) return; // debounce: one page jump per 500ms
      // Use whichever axis has more movement (horizontal swipe vs vertical scroll)
      const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(delta) < 5) return; // ignore tiny jitter
      lastWheelTime.current = now;
      const cp = currentPageRef.current;
      const tw = thumbWidth;
      const tp = totalPages;
      if (delta > 0) {
        const next = Math.min(cp + 1, tp - 1);
        container.scrollTo({ left: getScrollForPage(next, tw), behavior: 'smooth' });
        setCurrentPage(next);
        currentPageRef.current = next;
      } else {
        const prev = Math.max(cp - 1, 0);
        container.scrollTo({ left: getScrollForPage(prev, tw), behavior: 'smooth' });
        setCurrentPage(prev);
        currentPageRef.current = prev;
      }
    };
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [totalPages, thumbWidth]); // re-attach only when slide count or thumb size changes

  React.useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setDimensions({ width, height });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  const targetHeight = isVertical ? 1024 : 768;

  // Sleek thin bezel width is 8px on each side (16px total)
  const bezelSize = 16;

  // Fit within available dimensions with a 10px breathing room buffer
  const paddingBuffer = 10;
  const scale = Math.min(
    1,
    Math.min(
      (dimensions.width - paddingBuffer) / (targetWidth + bezelSize),
      (dimensions.height - paddingBuffer) / (targetHeight + bezelSize)
    )
  );

  // Compute live progress percentage
  let pct = 0;
  if (compilationProgress) {
    const rawPct = Math.round((compilationProgress.current / compilationProgress.total) * 100);
    if (compilationProgress.phase === 'crawling' || compilationProgress.phase === 'rendering') {
      pct = Math.round(rawPct * 0.9);
    } else if (compilationProgress.phase === 'merging') {
      pct = 95;
    } else {
      pct = rawPct;
    }
  }

  return (
    <div 
      ref={containerRef}
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--bg-deep)',
        position: 'relative',
        overflow: 'hidden',
        padding: '20px 20px 60px 20px'
      }}
    >


      {/* Floating Canvas Navbar */}
      <div
        className="glass-panel"
        style={{
          position: 'absolute',
          bottom: '20px',
          left: '46%', // Shifted slightly to the left to balance the added control buttons
          transform: 'translateX(-50%)',
          borderRadius: '24px',
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          zIndex: 100,
          border: '1px solid rgba(255, 255, 255, 0.25)',
          background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.02) 50.1%, rgba(255, 255, 255, 0.12) 100%)',
          backgroundColor: 'var(--bg-glass)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -1px 2px rgba(0,0,0,0.1)'
        }}
      >
        <button
          onClick={onPrev}
          disabled={currentSlideIndex <= 0 || isCompiling}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-2)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color var(--transition)',
            position: 'relative'
          }}
          className="nav-btn custom-tooltip"
          data-tooltip="Shift + P"
          data-action="prev-slide"
        >
          <ArrowLeft size={14} />
        </button>

        <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />

        <span style={{
          fontSize: '11px',
          color: 'var(--text-2)',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.5px'
         }}>
          {currentSlideIndex + 1} / {totalSlides}
        </span>
        <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />

        <button
          onClick={onReload}
          disabled={isCompiling}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-2)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color var(--transition)',
            position: 'relative'
          }}
          className="nav-btn custom-tooltip"
          data-tooltip="Shift + T"
          data-action="reload-slide"
        >
          <RotateCw size={12} />
        </button>

        <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />

        <button
          onClick={onNext}
          disabled={currentSlideIndex >= totalSlides - 1 || isCompiling}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-2)',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'color var(--transition)',
            position: 'relative'
          }}
          className="nav-btn custom-tooltip"
          data-tooltip="Shift + N"
          data-action="next-slide"
        >
          <ArrowRight size={14} />
        </button>
 
         <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />
 
         {/* Integrated Action Buttons */}
         <button
           onClick={onSaveSlide}
           disabled={currentSlideIndex === -1 || isCompiling}
           style={{
             background: 'transparent',
             border: 'none',
             color: 'var(--accent)',
             fontSize: '10.5px',
             fontWeight: 700,
             cursor: 'pointer',
             padding: '4px 8px',
             borderRadius: '12px',
             transition: 'all var(--transition)',
             position: 'relative'
           }}
           className="nav-btn custom-tooltip"
           data-tooltip="Shift + S"
           data-action="save-slide"
         >
           Save Slide
         </button>
 
         <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />
 
         <button
           onClick={onAutoSlide}
           disabled={currentSlideIndex === -1 || isCompiling}
           style={{
             background: 'transparent',
             border: 'none',
             color: 'var(--purple)',
             fontSize: '10.5px',
             fontWeight: 700,
             cursor: 'pointer',
             padding: '4px 8px',
             borderRadius: '12px',
             transition: 'all var(--transition)',
             position: 'relative'
           }}
           className="nav-btn custom-tooltip"
           data-tooltip="Shift + A"
           data-action="auto-slide"
         >
           Auto Slide
         </button>
 
         <div style={{ width: '1px', height: '14px', backgroundColor: 'var(--border-2)' }} />
 
         <button
           onClick={onFullAuto}
           disabled={totalSlides === 0 || isCompiling}
           style={{
             background: 'transparent',
             border: 'none',
             color: 'var(--blue)',
             fontSize: '10.5px',
             fontWeight: 800,
             cursor: 'pointer',
             padding: '4px 8px',
             borderRadius: '12px',
             transition: 'all var(--transition)',
             position: 'relative'
           }}
           className="nav-btn custom-tooltip"
           data-tooltip="Shift + F"
           data-action="full-auto"
         >
           Full Auto
         </button>
       </div>
 
       {currentSlideIndex === 0 && (
         <button
           onClick={onCaptureSwimlane}
           className="glass-panel nav-btn custom-tooltip"
           data-tooltip="Shift + H"
           data-action="capture-swimlane"
           style={{
             position: 'absolute',
             bottom: '20px',
             left: 'calc(46% + 350px)',
             transform: 'translateX(-50%)',
             borderRadius: '24px',
             padding: '10px 22px',
             display: 'flex',
             alignItems: 'center',
             justifyContent: 'center',
             zIndex: 100,
             border: '1px solid rgba(255, 255, 255, 0.25)',
             background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.28) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.02) 50.1%, rgba(255, 255, 255, 0.12) 100%)',
             backgroundColor: 'var(--bg-glass)',
             backdropFilter: 'blur(20px) saturate(180%)',
             WebkitBackdropFilter: 'blur(20px) saturate(180%)',
             boxShadow: '0 8px 32px rgba(0,0,0,0.25), inset 0 1px 1px rgba(255,255,255,0.45), inset 0 -1px 2px rgba(0,0,0,0.1)',
             cursor: 'pointer',
             transition: 'all 0.2s ease',
             color: 'var(--accent)',
             fontSize: '10.5px',
             fontWeight: 800,
             whiteSpace: 'nowrap',
             textShadow: '0 1px 1px rgba(255,255,255,0.2)'
           }}
         >
           Capture Swimlane
         </button>
       )}

      {/* Sized-constrained container to match visual scaled dimensions */}
      <div
        style={{
          width: `${(targetWidth + 16) * scale}px`,
          height: `${(targetHeight + 16) * scale}px`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible', // Keep shadow unclipped
          transition: 'width 0.2s ease, height 0.2s ease'
        }}
      >
        {/* iPad Pro Device Frame */}
        <div
          style={{
            width: `${targetWidth + 16}px`,
            height: `${targetHeight + 16}px`,
            background: theme === 'dark' 
              ? 'linear-gradient(135deg, #8e95a5 0%, #cfd5e2 25%, #7c8290 50%, #b0b7c6 75%, #696f7c 100%)' 
              : '#0d0e11', // Anodized aluminium gradient in dark mode, black in light mode
            border: theme === 'dark' ? '1.5px solid #575e6a' : '1.5px solid #2e3035', // Metal edge rim
            borderRadius: '36px', // Rounded outer corners
            position: 'relative',
            boxShadow: theme === 'dark' 
              ? '0 24px 64px rgba(0, 0, 0, 0.55), 0 0 0 1px #4b525d' 
              : '0 24px 64px rgba(0, 0, 0, 0.45), 0 0 1px rgba(0,0,0,0.15)',
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            flexShrink: 0,
            padding: '8px', // Bezel size (ultra thin)
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'transform 0.2s ease'
          }}
        >
          {/* Screen Content Wrapper */}
          <div style={{
            width: `${targetWidth}px`,
            height: `${targetHeight}px`,
            backgroundColor: '#ffffff',
            borderRadius: '28px', // Concentric inner rounding (36px outer - 8px bezel = 28px inner)
            overflow: 'hidden',
            position: 'relative',
            boxShadow: 'inset 0 0 4px rgba(0,0,0,0.2)'
          }}>
            {/* iPad Pro Camera Module (Android punch-hole style, overlapping screen content) */}
            <div style={{
              position: 'absolute',
              top: '10px', // Positioned slightly below the top edge of the screen content area
              left: '50%',
              transform: 'translateX(-50%)',
              width: '12px',
              height: '12px',
              backgroundColor: '#07080a', // Deep punch-hole black
              border: '0.7px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 100,
              boxShadow: '0 1px 2px rgba(0,0,0,0.3)'
            }}>
              {/* Camera Lens Highlight */}
              <div style={{
                width: '5px',
                height: '5px',
                borderRadius: '50%',
                backgroundColor: '#111424',
                border: '0.5px solid #2e3035',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                {/* Specular Reflection */}
                <div style={{
                  position: 'absolute',
                  top: '0.5px',
                  left: '0.5px',
                  width: '1.5px',
                  height: '1.5px',
                  borderRadius: '50%',
                  backgroundColor: '#38bdf8',
                  opacity: 0.8
                }} />
              </div>
            </div>
            {/* Dropdown Menu (connected to slide's built-in header click) */}
            {showVeevaMenu && (
              <div
                id="veeva-menu-panel"
                style={{
                position: 'absolute',
                top: '45px',
                left: '17px',
                zIndex: 200,
                userSelect: 'none'
              }}>
                {/* Invisible backdrop to close menu on outside click */}
                <div 
                  onClick={() => setShowVeevaMenu(false)}
                  style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    zIndex: 199,
                    cursor: 'default'
                  }}
                />
                
                {/* Menu Card */}
                <div 
                  style={{
                    position: 'relative',
                    width: '240px',
                    backgroundColor: 'rgb(215, 222, 235)',
                    backdropFilter: 'blur(25px) saturate(190%)',
                    borderRadius: '0px 16px 16px 16px',
                    boxShadow: '0 10px 30px rgba(0, 0, 0, 0.15)',
                    zIndex: 200,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'visible', // Ensure caret/arrow stays visible
                    animation: 'veevaMenuFadeIn 0.2s ease-out'
                  }}
                >
                  {/* Caret pointing to the three dots */}
                  <div style={{
                    position: 'absolute',
                    top: '-8.5px',
                    left: '2px',
                    width: '18px',
                    height: '18px',
                    backgroundColor: 'rgb(215, 222, 235)',
                    transform: 'rotate(45deg)',
                    zIndex: 201,
                    borderRadius: '4px 0px 5px 5px',
                    clipPath: 'polygon(0% 0%, 100% 0%, 0% 100%)'
                  }} />

                  {/* Menu Items */}
                  {[
                    { label: 'Done', action: () => { console.log('Done clicked'); } },
                    { label: 'Slides', action: () => { setShowBottomBar(true); } },
                    { label: 'Select Account', action: () => { console.log('Select Account clicked'); } },
                    { label: 'Show Information', action: () => { console.log('Show Information clicked'); } },
                    { label: 'Save For Later', action: () => { console.log('Save For Later clicked'); } }
                  ].map((item, index, arr) => (
                    <div 
                      key={item.label}
                      onClick={() => {
                        item.action();
                        setShowVeevaMenu(false);
                      }}
                      style={{
                        padding: '13px 16px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        borderBottom: index < arr.length - 1 ? '1px solid rgba(0, 0, 0, 0.08)' : 'none',
                        color: '#007aff',
                        fontSize: '15px',
                        fontWeight: 500,
                        transition: 'background-color 0.15s',
                        userSelect: 'none',
                        textAlign: 'center'
                      }}
                      className="veeva-menu-item"
                    >
                      {item.label}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <iframe
              ref={iframeRef}
              src={activeSlide.url}
              style={{
                width: `${targetWidth}px`,
                height: `${targetHeight}px`,
                border: 'none',
                backgroundColor: '#ffffff'
              }}
              title={activeSlide.name}
            />

        {isSingleSave && (
          <div className="material-spinner-overlay">
            <div className="spinner-card">
              <div className="material-spinner">
                <svg viewBox="25 25 50 50">
                  <circle cx="50" cy="50" r="20" fill="none" strokeWidth="4" strokeMiterlimit="10" />
                </svg>
                {pct > 0 && <span className="spinner-percentage">{pct}%</span>}
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span className="spinner-status-title">
                  {compilationProgress?.phase === 'rendering' ? 'Rendering to PDF' : 'Executing Auto Capture...'}
                </span>
                
                <span className="spinner-status-detail">
                  {compilationProgress?.slide && (
                    <span style={{ fontWeight: 600, color: 'var(--accent)' }}>
                      {compilationProgress.slide}
                    </span>
                  )}
                  {compilationProgress?.detail && ` - ${compilationProgress.detail}`}
                </span>
              </div>
            </div>
          </div>
        )}
            {/* Bottom Presentation Slider Panel */}
            <div
              id="bottom-slides-panel"
              style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '185px',
              backgroundColor: 'rgba(255, 255, 255, 0.85)',
              backdropFilter: 'blur(30px) saturate(180%)',
              borderTop: 'none',
              boxShadow: '0 -4px 30px rgba(0, 0, 0, 0.05)',
              display: 'flex',
              flexDirection: 'column',
              zIndex: 150,
              transition: 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              transform: showBottomBar ? 'translateY(0)' : 'translateY(100%)',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
              boxSizing: 'border-box',
              padding: '12px 0px 5px 0px',
              overflow: 'hidden'
            }}>
              {/* Header inside slider */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                marginBottom: '10px',
                padding: '0 15px 0 15px'
               }}>
                <span 
                  onClick={() => setShowBottomBar(false)}
                  style={{
                    fontSize: '13px',
                    fontWeight: 400,
                    color: '#007aff',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                >
                  Close
                </span>
                
                <span style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  color: '#1d1d1f',
                  letterSpacing: '-0.1px'
                }}>
                  {(presentationId.replace(/_/g, ' ').replace(/\bMain\b/gi, '').replace(/\s+/g, ' ').trim()) || '—'}{' '}
                  <span
                    onClick={() => setIsApproved(prev => !prev)}
                    style={{
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                  >
                    ({isApproved ? 'Approved' : 'Staged'})
                  </span>
                </span>

                <span style={{
                  fontSize: '13px',
                  fontWeight: 400,
                  color: '#007aff',
                  cursor: 'pointer',
                  userSelect: 'none'
                }}>
                  Find Presentation
                </span>
              </div>

              {/* Slider list of slide thumbnails */}
              <div 
                ref={thumbsContainerRef}
                onScroll={handleScroll}
                onMouseDown={(e) => {
                  setIsDragging(true);
                  didDrag.current = false;
                  dragStartX.current = e.clientX;
                  dragStartScroll.current = thumbsContainerRef.current?.scrollLeft || 0;
                  e.preventDefault();
                }}
                onMouseMove={(e) => {
                  if (!isDragging || !thumbsContainerRef.current) return;
                  const delta = dragStartX.current - e.clientX;
                  if (Math.abs(delta) > 3) didDrag.current = true;
                  thumbsContainerRef.current.scrollLeft = dragStartScroll.current + delta;
                }}
                onMouseUp={() => {
                  if (!isDragging) return;
                  setIsDragging(false);
                  // Snap to nearest page on release
                  if (thumbsContainerRef.current) {
                    const scrollLeft = thumbsContainerRef.current.scrollLeft;
                    let best = 0;
                    let bestDist = Math.abs(scrollLeft);
                    for (let p = 1; p < totalPages; p++) {
                      const target = getScrollForPage(p, thumbWidth);
                      const dist = Math.abs(scrollLeft - target);
                      if (dist < bestDist) { bestDist = dist; best = p; }
                    }
                    scrollToPage(best);
                  }
                }}
                onMouseLeave={() => {
                  if (!isDragging) return;
                  setIsDragging(false);
                  if (thumbsContainerRef.current) {
                    const scrollLeft = thumbsContainerRef.current.scrollLeft;
                    let best = 0;
                    let bestDist = Math.abs(scrollLeft);
                    for (let p = 1; p < totalPages; p++) {
                      const target = getScrollForPage(p, thumbWidth);
                      const dist = Math.abs(scrollLeft - target);
                      if (dist < bestDist) { bestDist = dist; best = p; }
                    }
                    scrollToPage(best);
                  }
                }}
                style={{
                  display: 'flex',
                  gap: '20.625px',
                  overflowX: 'auto',
                  flex: 1,
                  alignItems: 'center',
                  paddingBottom: '0px',
                  paddingLeft: '1px',
                  WebkitOverflowScrolling: 'touch',
                  scrollbarWidth: 'none',
                  msOverflowStyle: 'none',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  userSelect: 'none',
                }}
                className="hide-scrollbar"
              >
                {/* 0px spacer so flex gap pushes first thumb 20px from paddingLeft edge */}
                <div style={{ width: '0px', flexShrink: 0 }} />
                {slides.map((slide, idx) => {
                  const isActive = idx === currentSlideIndex;
                  const thumbUrl = slide.url.replace('index.html', 'thumb.png');
                  return (
                    <div 
                      key={slide.name + idx}
                      onClick={() => {
                        if (didDrag.current) return; // suppress accidental click after drag
                        onSelectSlide(idx);
                      }}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        width: `${thumbWidth}px`,
                        flexShrink: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {/* Thumbnail frame */}
                      <div style={{
                        width: `${thumbWidth}px`,
                        height: `${thumbHeight}px`,
                        borderRadius: '0px',
                        border: isActive ? '3.5px solid #007aff' : 'none',
                        boxShadow: isActive ? 'none' : '0 2px 4px rgba(0, 0, 0, 0.3)',
                        backgroundColor: portraitThumbs.has(idx) ? '#000000' : '#f5f5f7',
                        overflow: 'hidden',
                        marginBottom: '8px',
                        boxSizing: 'border-box',
                        transition: 'border-color 0.2s',
                        // For portrait slides: flex-center so img fills full height with side bars only
                        display: portraitThumbs.has(idx) ? 'flex' : 'block',
                        alignItems: portraitThumbs.has(idx) ? 'center' : undefined,
                        justifyContent: portraitThumbs.has(idx) ? 'center' : undefined,
                      }}>
                        <img 
                          src={thumbUrl} 
                          alt={slide.name}
                          draggable={false}
                          onDragStart={(e) => e.preventDefault()}
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="${thumbWidth}" height="${thumbHeight}" viewBox="0 0 ${thumbWidth} ${thumbHeight}"><rect width="${thumbWidth}" height="${thumbHeight}" fill="%23f5f5f7"/><text x="50%" y="50%" font-family="sans-serif" font-size="8" fill="%2386868b" text-anchor="middle" dominant-baseline="middle">No Thumbnail</text></svg>`;
                          }}
                          style={portraitThumbs.has(idx) ? {
                            // Portrait: height fills frame exactly, width auto → bars left/right only
                            height: '100%',
                            width: 'auto',
                            display: 'block',
                            pointerEvents: 'none',
                          } : {
                            // Landscape: cover fills frame fully, no bars
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            borderRadius: '0px',
                            pointerEvents: 'none',
                          }}
                          onLoad={(e) => {
                            const img = e.target as HTMLImageElement;
                            if (img.naturalHeight > img.naturalWidth) {
                              setPortraitThumbs(prev => {
                                const next = new Set(prev);
                                next.add(idx);
                                return next;
                              });
                            }
                          }}
                        />
                      </div>
                      
                      {/* Name label */}
                      <span style={{
                        fontSize: '9px',
                        fontWeight: 500,
                        color: '#515154',
                        maxWidth: `${thumbWidth - 4}px`,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textAlign: 'center'
                      }}>
                        {slide.name}
                      </span>
                    </div>
                  );
                })}
                {/* Trailing spacer: extends scroll area so last page target is always reachable.
                    lastPageScroll = 30 + (7*(totalPages-1)-1)*(tw+20) + tw/2
                    currentMaxScroll = 10 + slides.length*(tw+20) - targetWidth
                    trailingWidth = max(0, lastPageScroll - currentMaxScroll) */}
                {(() => {
                  if (totalPages <= 1) return null;
                  const tw = thumbWidth;
                  const lastPageScroll = getScrollForPage(totalPages - 1, tw);
                  const currentMaxScroll = 1 + slides.length * (tw + 20.625) - targetWidth;
                  const trailingWidth = Math.max(0, lastPageScroll - currentMaxScroll);
                  return trailingWidth > 0
                    ? <div style={{ width: `${trailingWidth}px`, flexShrink: 0 }} />
                    : null;
                })()}
              </div>

              {/* Pagination Dots Indicator */}
              {totalPages >= 1 && (
                <div style={{
                  display: 'flex',
                  justifyContent: 'center',
                  gap: '6px',
                  marginTop: '6px',
                  flexShrink: 0
                }}>
                  {Array.from({ length: totalPages }).map((_, pIdx) => (
                    <div 
                      key={pIdx}
                      onClick={() => scrollToPage(pIdx)}
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: pIdx === currentPage ? '#007aff' : 'rgba(0, 0, 0, 0.15)',
                        cursor: 'pointer',
                        transition: 'background-color 0.25s ease'
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Inline CSS style block to hide scrollbar cleanly */}
            <style dangerouslySetInnerHTML={{__html: `
              .hide-scrollbar::-webkit-scrollbar {
                display: none !important;
              }
              .hide-scrollbar {
                -ms-overflow-style: none !important;
                scrollbar-width: none !important;
              }
              .veeva-menu-item:hover {
                background-color: rgba(255, 255, 255, 0.25) !important;
              }
              .veeva-menu-item:active {
                background-color: rgba(0, 0, 0, 0.05) !important;
              }
              .veeva-header-btn:hover {
                opacity: 0.7;
              }
              .veeva-header-btn:active {
                opacity: 0.5;
              }
              @keyframes veevaMenuFadeIn {
                from { opacity: 0; transform: translateY(-5px); }
                to { opacity: 1; transform: translateY(0); }
              }
              /* Instant Custom CSS Tooltips */
              .custom-tooltip {
                position: relative;
              }
              .custom-tooltip::after {
                content: attr(data-tooltip);
                position: absolute;
                bottom: 125%;
                left: 50%;
                transform: translateX(-50%) scale(0.8);
                background-color: rgba(15, 23, 42, 0.9);
                color: #ffffff;
                font-size: 9px;
                font-weight: 700;
                padding: 4px 8px;
                border-radius: 6px;
                white-space: nowrap;
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.05s ease, transform 0.05s ease;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
                border: 1px solid rgba(255, 255, 255, 0.08);
                z-index: 999999;
              }
              .custom-tooltip:hover::after {
                opacity: 1;
                transform: translateX(-50%) scale(1);
              }
            `}} />
          </div>
    </div>
  </div>

      {/* Deletion confirmation overlay rendered directly over the Canvas area */}
      {pdfToDelete && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(5, 7, 12, 0.65)',
          backdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 500,
          animation: 'fadeIn 0.2s ease'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-base)',
            border: '1px solid var(--border-accent)',
            borderRadius: '16px',
            padding: '24px',
            width: '340px',
            boxShadow: 'var(--shadow-main), 0 0 30px rgba(var(--accent-rgb), 0.1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            animation: 'slideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          }}>
            <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--rose)' }}>
              Confirm Deletion
            </h3>
            <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-2)', lineHeight: '1.5', textAlign: 'left' }}>
              Are you sure you want to delete <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>{pdfToDelete.name}</span>? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={onCancelDelete}
                style={{
                  backgroundColor: 'transparent',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-2)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
                className="action-btn"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                style={{
                  background: 'linear-gradient(135deg, var(--rose), #e11d48)',
                  border: 'none',
                  color: '#ffffff',
                  padding: '6px 14px',
                  borderRadius: '6px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(244, 63, 94, 0.2)',
                  transition: 'all 0.2s'
                }}
                className="action-btn"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
