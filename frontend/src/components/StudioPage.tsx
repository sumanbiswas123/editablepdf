import React, { useState, useEffect } from 'react';
import { ArrowLeft, Plus, Sparkles, BookOpen, Settings2, Trash2, Save, Play, GripVertical, FileText, Eye, FolderOpen, Edit3 } from 'lucide-react';
import { SelectPDFFile, SplitCombinedPDFToPages, RebuildCombinedPDF, GetOutputDir, DeleteCompiledPDF, RenameCombinedPDF, OpenDirectory } from '../../bindings/htmltoepdf/app';

interface CompiledPDF {
  name: string;
  size: number;
  serveUrl: string;
  metadata: string;
}

interface Slide {
  name: string;
  folderName: string;
  url: string;
}

interface StudioPageProps {
  onClose: () => void; // Go back to main dashboard
  combinedDecks: CompiledPDF[];
  refreshPDFList: () => Promise<void>;
  slides: Slide[];
  theme: 'dark' | 'light';
}

interface StudioPageItem {
  id: string;
  path: string;
  originalIndex: number;
  metadata: string; // JSON metadata string
  slideName: string;
  isExternal: boolean;
  serveUrl: string;
}

const formatFileSize = (bytes: number) => {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
};

export const StudioPage: React.FC<StudioPageProps> = ({
  onClose,
  combinedDecks,
  refreshPDFList,
  slides,
  theme
}) => {
  const [selectedDeck, setSelectedDeck] = useState<CompiledPDF | null>(null);
  const [pages, setPages] = useState<StudioPageItem[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [editingMetadata, setEditingMetadata] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Drag selection states
  const [isSelecting, setIsSelecting] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // Custom Context Menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; isOpen: boolean } | null>(null);

  // Custom Deck Context Menu state
  const [deckContextMenu, setDeckContextMenu] = useState<{ x: number; y: number; isOpen: boolean; deck: CompiledPDF } | null>(null);

  // Delete confirmation modal state
  const [deleteConfirmModal, setDeleteConfirmModal] = useState<{
    isOpen: boolean;
    indices: number[];
    deckToDelete: CompiledPDF | null;
  } | null>(null);

  // Custom PDF conversion naming modal state
  const [convertModal, setConvertModal] = useState<{
    isOpen: boolean;
    filename: string;
  } | null>(null);

  // Custom rename modal state
  const [renameModal, setRenameModal] = useState<{
    isOpen: boolean;
    deck: CompiledPDF | null;
    filename: string;
  } | null>(null);

  // Reset view when entering
  useEffect(() => {
    setSelectedDeck(null);
    setPages([]);
    setActivePageId(null);
    setSelectedPageIds(new Set());
    setErrorMessage('');
    setDeleteConfirmModal(null);
    setContextMenu(null);
    setConvertModal(null);
    setRenameModal(null);
    setDeckContextMenu(null);
  }, []);

  // Update metadata editor textarea when active page changes
  useEffect(() => {
    if (activePageId) {
      const activePage = pages.find(p => p.id === activePageId);
      if (activePage) {
        try {
          const parsed = JSON.parse(activePage.metadata);
          setEditingMetadata(JSON.stringify(parsed, null, 2));
        } catch (_) {
          setEditingMetadata(activePage.metadata || '{}');
        }
      }
    } else {
      setEditingMetadata('');
    }
  }, [activePageId, pages]);

  // Open a combined PDF in Studio Editor
  const handleOpenDeck = async (deck: CompiledPDF) => {
    try {
      setIsProcessing(true);
      setErrorMessage('');
      setSelectedDeck(deck);

      const splitPagesStr = await SplitCombinedPDFToPages(deck.name);
      const splitPages = JSON.parse(splitPagesStr);
      
      const formattedPages: StudioPageItem[] = splitPages.map((p: any, idx: number) => {
        let slideName = `Page ${p.index}`;
        try {
          const meta = JSON.parse(p.metadata);
          if (meta.slideName) {
            slideName = meta.slideName;
            if (meta.openPopups && meta.openPopups.length > 0) {
              slideName += ` (${meta.openPopups[0].type || 'popup'})`;
            }
          }
        } catch (_) {}

        return {
          id: `page-${idx}-${Date.now()}`,
          path: p.path,
          originalIndex: p.index,
          metadata: p.metadata,
          slideName: slideName,
          isExternal: false,
          serveUrl: p.serveUrl || ''
        };
      });

      setPages(formattedPages);
      if (formattedPages.length > 0) {
        setActivePageId(formattedPages[0].id);
        setSelectedPageIds(new Set([formattedPages[0].id]));
      }
    } catch (err: any) {
      console.error('Failed to open PDF in studio:', err);
      setErrorMessage(`Failed to open presentation: ${err.message || err}`);
      setSelectedDeck(null);
    } finally {
      setIsProcessing(false);
    }
  };

  // Selection Card Click Handler (Ctrl & Shift support)
  const handleCardClick = (e: React.MouseEvent, page: StudioPageItem, index: number) => {
    e.stopPropagation();
    setActivePageId(page.id);

    if (e.ctrlKey || e.metaKey) {
      const newSelected = new Set(selectedPageIds);
      if (newSelected.has(page.id)) {
        newSelected.delete(page.id);
      } else {
        newSelected.add(page.id);
      }
      setSelectedPageIds(newSelected);
    } else if (e.shiftKey && activePageId) {
      const activeIdx = pages.findIndex(p => p.id === activePageId);
      if (activeIdx !== -1) {
        const start = Math.min(activeIdx, index);
        const end = Math.max(activeIdx, index);
        const rangeIds = pages.slice(start, end + 1).map(p => p.id);
        setSelectedPageIds(new Set([...selectedPageIds, ...rangeIds]));
      }
    } else {
      setSelectedPageIds(new Set([page.id]));
    }
  };

  // Drag selection mouse event handlers (drag selection box)
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isProcessing) return;
    
    // Only trigger if we clicked directly on the canvas scrollable container background
    const container = e.currentTarget;
    const isBg = e.target === container || (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true';
    if (!isBg) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left + container.scrollLeft;
    const y = e.clientY - rect.top + container.scrollTop;

    setIsSelecting(true);
    setDragStart({ x, y });
    setDragRect({ left: x, top: y, width: 0, height: 0 });

    if (!e.ctrlKey && !e.metaKey) {
      setSelectedPageIds(new Set());
    }
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isSelecting || !dragStart) return;

    const container = e.currentTarget;
    const rect = container.getBoundingClientRect();
    const curX = e.clientX - rect.left + container.scrollLeft;
    const curY = e.clientY - rect.top + container.scrollTop;

    const left = Math.min(dragStart.x, curX);
    const top = Math.min(dragStart.y, curY);
    const width = Math.abs(dragStart.x - curX);
    const height = Math.abs(dragStart.y - curY);

    setDragRect({ left, top, width, height });

    // Calculate intersections with page card boundary rectangles
    const cardElements = container.querySelectorAll('.studio-page-card');
    const newSelected = new Set<string>(e.ctrlKey || e.metaKey ? selectedPageIds : []);

    cardElements.forEach((cardEl: any) => {
      const pageId = cardEl.getAttribute('data-page-id');
      if (!pageId) return;

      const cardLeft = cardEl.offsetLeft;
      const cardTop = cardEl.offsetTop;
      const cardWidth = cardEl.offsetWidth;
      const cardHeight = cardEl.offsetHeight;

      const intersects =
        left < cardLeft + cardWidth &&
        left + width > cardLeft &&
        top < cardTop + cardHeight &&
        top + height > cardTop;

      if (intersects) {
        newSelected.add(pageId);
      }
    });

    setSelectedPageIds(newSelected);
  };

  const handleCanvasMouseUp = () => {
    setIsSelecting(false);
    setDragStart(null);
    setDragRect(null);
  };

  // Drag & Drop Handlers (Group Selection shifting)
  const handleDragStart = (e: React.DragEvent, index: number) => {
    const page = pages[index];
    let draggedIds = Array.from(selectedPageIds);

    // If dragged card is not in current group selection, select it exclusively
    if (!selectedPageIds.has(page.id)) {
      draggedIds = [page.id];
      setSelectedPageIds(new Set([page.id]));
      setActivePageId(page.id);
    }

    e.dataTransfer.setData('application/json', JSON.stringify(draggedIds));
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    try {
      const dataJson = e.dataTransfer.getData('application/json');
      if (!dataJson) return;

      const draggedIds: string[] = JSON.parse(dataJson);
      if (!draggedIds || draggedIds.length === 0) return;

      // Group selection indices
      const draggedItems = pages.filter((p) => draggedIds.includes(p.id));
      const remainingItems = pages.filter((p) => !draggedIds.includes(p.id));

      // Calculate where to drop relative to remaining cards
      const targetPage = pages[dropIndex];
      let newDropIndex = remainingItems.findIndex((p) => p.id === targetPage.id);
      if (newDropIndex === -1) {
        newDropIndex = dropIndex;
      }

      // Re-insert dragging list together
      const updatedPages = [...remainingItems];
      updatedPages.splice(newDropIndex, 0, ...draggedItems);

      setPages(updatedPages);
      setDraggedIndex(null);

      // Re-align selection state
      if (activePageId && draggedIds.includes(activePageId)) {
        setActivePageId(activePageId);
      } else if (draggedItems.length > 0) {
        setActivePageId(draggedItems[0].id);
      }
    } catch (err) {
      console.error('Multi-drag shift failed:', err);
    }
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  // Trigger Delete Confirmation Modal
  const triggerDeleteConfirm = (indices: number[], deckToDelete: CompiledPDF | null = null) => {
    setDeleteConfirmModal({
      isOpen: true,
      indices,
      deckToDelete
    });
  };

  const handleConfirmDelete = async () => {
    if (!deleteConfirmModal) return;

    if (deleteConfirmModal.deckToDelete) {
      try {
        setIsProcessing(true);
        setErrorMessage('');
        await DeleteCompiledPDF(deleteConfirmModal.deckToDelete.name);
        await refreshPDFList();
      } catch (err: any) {
        console.error('Failed to delete deck:', err);
        setErrorMessage(`Failed to delete deck: ${err.message || err}`);
      } finally {
        setIsProcessing(false);
      }
    } else {
      const indicesToDelete = deleteConfirmModal.indices;
      const remainingPages = pages.filter((_, idx) => !indicesToDelete.includes(idx));
      setPages(remainingPages);

      setSelectedPageIds(new Set());
      if (activePageId) {
        const stillExists = remainingPages.some((p) => p.id === activePageId);
        if (!stillExists) {
          if (remainingPages.length > 0) {
            setActivePageId(remainingPages[0].id);
          } else {
            setActivePageId(null);
          }
        }
      }
    }

    setDeleteConfirmModal(null);
  };

  // Close context menus on outside click
  useEffect(() => {
    const handleOutsideClick = () => {
      if (contextMenu?.isOpen) {
        setContextMenu(null);
      }
      if (deckContextMenu?.isOpen) {
        setDeckContextMenu(null);
      }
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, [contextMenu, deckContextMenu]);

  // Context Menu Event Trigger
  const handleContextMenu = (e: React.MouseEvent, page: StudioPageItem, index: number) => {
    e.preventDefault();
    e.stopPropagation();

    // If card is not already selected, select it exclusively first
    if (!selectedPageIds.has(page.id)) {
      setSelectedPageIds(new Set([page.id]));
      setActivePageId(page.id);
    }

    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      isOpen: true
    });
  };

  // Deck Context Menu Event Trigger
  const handleDeckContextMenu = (e: React.MouseEvent, deck: CompiledPDF) => {
    e.preventDefault();
    e.stopPropagation();

    setDeckContextMenu({
      x: e.clientX,
      y: e.clientY,
      isOpen: true,
      deck
    });
  };

  // Rename a compiled presentation deck
  const handleRenameDeck = (deck: CompiledPDF) => {
    setDeckContextMenu(null);
    setRenameModal({
      isOpen: true,
      deck,
      filename: deck.name
    });
  };

  const handleConfirmRename = async () => {
    if (!renameModal || !renameModal.deck) return;
    const { deck, filename } = renameModal;

    let targetName = filename.trim();
    if (!targetName) return;
    if (!targetName.toLowerCase().endsWith('.pdf')) {
      targetName += '.pdf';
    }

    try {
      setIsProcessing(true);
      setErrorMessage('');
      await RenameCombinedPDF(deck.name, targetName);
      await refreshPDFList();
      setRenameModal(null);
    } catch (err: any) {
      console.error('Failed to rename deck:', err);
      setErrorMessage(`Failed to rename deck: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Delete a compiled presentation deck
  const handleDeleteDeck = async (deck: CompiledPDF) => {
    setDeckContextMenu(null);
    triggerDeleteConfirm([], deck);
  };

  // Open file directory location
  const handleOpenDeckLocation = async () => {
    setDeckContextMenu(null);
    try {
      await OpenDirectory();
    } catch (err: any) {
      console.error('Failed to open directory location:', err);
    }
  };

  // Duplicate Selected Pages
  const handleDuplicateSelected = () => {
    if (selectedPageIds.size === 0) return;
    setContextMenu(null);

    const newPages = [...pages];
    const duplicates: StudioPageItem[] = [];

    pages.forEach((p) => {
      if (selectedPageIds.has(p.id)) {
        duplicates.push({
          ...p,
          id: `duplicate-${Date.now()}-${Math.random()}`,
          slideName: `${p.slideName} (Copy)`
        });
      }
    });

    let lastSelectedIndex = -1;
    pages.forEach((p, idx) => {
      if (selectedPageIds.has(p.id)) {
        lastSelectedIndex = idx;
      }
    });

    newPages.splice(lastSelectedIndex + 1, 0, ...duplicates);
    setPages(newPages);

    // Auto-select the newly duplicated slides
    setSelectedPageIds(new Set(duplicates.map((d) => d.id)));
  };

  // Convert Selection subset to a brand new PDF presentation deck (Triggers custom naming modal)
  const handleConvertSelectionToPDF = () => {
    if (selectedPageIds.size === 0) return;
    setContextMenu(null);

    const defaultName = `Selection_${Date.now().toString().slice(-5)}.pdf`;
    setConvertModal({
      isOpen: true,
      filename: defaultName
    });
  };

  // Execute actual subset stitching compilation
  const handleConfirmConvert = async (filename: string) => {
    if (!filename || selectedPageIds.size === 0) return;

    let targetName = filename.trim();
    if (!targetName.toLowerCase().endsWith('.pdf')) {
      targetName += '.pdf';
    }

    try {
      setIsProcessing(true);
      setErrorMessage('');

      const selectedPages = pages.filter((p) => selectedPageIds.has(p.id));
      const paths = selectedPages.map((p) => p.path);
      const metadatas = selectedPages.map((p) => p.metadata);

      await RebuildCombinedPDF(targetName, paths, metadatas);
      
      await refreshPDFList();
      setSelectedPageIds(new Set());
      setConvertModal(null);
    } catch (err: any) {
      console.error('Selection conversion failed:', err);
      setErrorMessage(`Failed to convert selection to PDF: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // Import external PDF file
  const handleImportPDF = async () => {
    try {
      const path = await SelectPDFFile();
      if (path) {
        const filename = path.split(/[/\\]/).pop() || 'Imported.pdf';
        
        const fallbackMeta = JSON.stringify({
          presentationId: 'imported',
          slideName: filename,
          folderName: '',
          type: 'slide',
          timestamp: new Date().toISOString()
        });

        const newPage: StudioPageItem = {
          id: `external-${Date.now()}`,
          path: path,
          originalIndex: pages.length + 1,
          metadata: fallbackMeta,
          slideName: filename,
          isExternal: true,
          serveUrl: ''
        };

        const updatedPages = [...pages, newPage];
        setPages(updatedPages);
        setActivePageId(newPage.id);
      }
    } catch (err: any) {
      console.error('Import PDF failed:', err);
      setErrorMessage(`Failed to import PDF: ${err.message || err}`);
    }
  };

  // Save specific page metadata changes
  const saveMetadata = () => {
    if (!activePageId) return;
    try {
      const parsed = JSON.parse(editingMetadata);
      const minified = JSON.stringify(parsed);
      
      let slideName = parsed.slideName || 'Page';
      if (parsed.openPopups && parsed.openPopups.length > 0) {
        slideName += ` (${parsed.openPopups[0].type || 'popup'})`;
      }

      setPages(
        pages.map((p) =>
          p.id === activePageId
            ? { ...p, metadata: minified, slideName: slideName }
            : p
        )
      );
      
      // Flash a brief success confirmation in border
      const btn = document.getElementById('save-metadata-btn');
      if (btn) {
        const origText = btn.innerHTML;
        btn.innerHTML = 'Saved!';
        btn.style.borderColor = 'var(--success)';
        btn.style.color = 'var(--success)';
        setTimeout(() => {
          btn.innerHTML = origText;
          btn.style.borderColor = '';
          btn.style.color = '';
        }, 1200);
      }
    } catch (err: any) {
      alert(`Invalid JSON format: ${err.message}`);
    }
  };

  // Re-merge pages and update presentation
  const handleRebuild = async () => {
    if (!selectedDeck) return;
    if (pages.length === 0) {
      setErrorMessage('Please arrange at least one page to save.');
      return;
    }

    try {
      setIsProcessing(true);
      setErrorMessage('');

      const paths = pages.map((p) => p.path);
      const metadatas = pages.map((p) => p.metadata);

      await RebuildCombinedPDF(selectedDeck.name, paths, metadatas);

      await refreshPDFList();
      setSelectedDeck(null);
      setPages([]);
      setActivePageId(null);
    } catch (err: any) {
      console.error('Rebuild failed:', err);
      setErrorMessage(`Failed to rebuild presentation: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const activePage = pages.find(p => p.id === activePageId);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        height: '100%',
        backgroundColor: 'var(--bg-deep)',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Decorative grid overlay matching modern aesthetic */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundImage: theme === 'dark' 
          ? 'linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px)'
          : 'linear-gradient(rgba(0, 0, 0, 0.015) 1px, transparent 1px), linear-gradient(90deg, rgba(0, 0, 0, 0.015) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        pointerEvents: 'none',
        zIndex: 0
      }} />

      {/* Header bar (Theme aware background and borders) */}
      <div
        style={{
          padding: '16px 24px',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'center',
          background: 'var(--bg-base)',
          backdropFilter: 'blur(20px)',
          zIndex: 10,
          flexShrink: 0
        }}
      >
        <button
          onClick={selectedDeck ? () => { setSelectedDeck(null); setPages([]); setActivePageId(null); } : onClose}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-1)',
            cursor: 'pointer',
            padding: '8px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginRight: '16px',
            transition: 'all 0.2s',
            boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
          }}
          className="action-btn"
          title={selectedDeck ? "Back to presentation list" : "Back to Dashboard"}
        >
          <ArrowLeft size={15} />
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flex: 1 }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.15), rgba(139, 92, 246, 0.15))',
              border: '1px solid var(--border-accent)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent)',
              boxShadow: '0 0 15px rgba(var(--accent-rgb), 0.1)'
            }}
          >
            <Sparkles size={16} />
          </div>
          <div>
            <h2 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-1)', margin: 0, letterSpacing: '0.3px' }}>
              {selectedDeck ? `Studio: ${selectedDeck.name}` : 'NoCodeX ePDF Studio'}
            </h2>
            <p style={{ fontSize: '10px', color: 'var(--text-3)', margin: '4px 0 0 0', fontWeight: 600 }}>
              {selectedDeck
                ? 'Rearrange slides, import page components, and customize properties'
                : 'Select a stitched presentation deck to enter custom workspace'}
            </p>
          </div>
        </div>
      </div>

      {/* Main workspace */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, zIndex: 5 }}>
        {!selectedDeck ? (
          /* LIST VIEW: Show available combined PDFs */
          <div style={{ flex: 1, overflowY: 'auto', padding: '28px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: '4px' }}>
              STITCHED PRESENTATION DECKS ({combinedDecks.length})
            </div>

            {combinedDecks.length === 0 ? (
              <div
                style={{
                  flex: 1,
                  border: '1px dashed var(--border-2)',
                  borderRadius: '16px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--text-3)',
                  fontSize: '11px',
                  gap: '12px',
                  padding: '64px 0',
                  backgroundColor: 'var(--bg-elevated)'
                }}
              >
                <BookOpen size={36} style={{ opacity: 0.4, color: 'var(--accent)' }} />
                <div style={{ fontWeight: 700, color: 'var(--text-2)' }}>No Stitched presentations found</div>
                <p style={{ fontSize: '10px', color: 'var(--text-3)', maxWidth: '280px', textAlign: 'center', lineHeight: 1.5 }}>
                  Merge all output slides or compile using "Full Auto" to generate combined decks first.
                </p>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
                {combinedDecks.map((deck) => (
                  <div
                    key={deck.name}
                    onClick={() => handleOpenDeck(deck)}
                    onContextMenu={(e) => handleDeckContextMenu(e, deck)}
                    style={{
                      background: 'var(--bg-base)',
                      border: '1px solid var(--border-1)',
                      borderLeft: '4px solid var(--accent)',
                      borderRadius: '14px',
                      padding: '20px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '16px',
                      cursor: 'pointer',
                      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                      position: 'relative',
                      boxShadow: 'var(--shadow-main)'
                    }}
                    className="deck-card"
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{
                        width: '40px',
                        height: '40px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--accent-dim)',
                        border: '1px solid var(--border-accent)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: 'var(--accent)',
                        flexShrink: 0
                      }}>
                        <BookOpen size={18} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: 'var(--text-1)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {deck.name}
                        </div>
                        <div style={{ fontSize: '9px', color: 'var(--text-3)', marginTop: '4px', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                          {formatFileSize(deck.size)}
                        </div>
                      </div>
                    </div>

                    <div style={{
                      borderTop: '1px solid var(--border-1)',
                      paddingTop: '12px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}>
                      <span style={{ fontSize: '10px', color: 'var(--accent)', fontWeight: 800, display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Play size={11} fill="currentColor" /> ENTER WORKSPACE
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* EDITOR VIEW: Grid view with document previews & Drag rearrangement */
          <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
            {/* Left page sequence list (Refactored to dynamic grid with preview thumbnails) */}
            <div
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={handleCanvasMouseMove}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              data-canvas-bg="true"
              style={{
                flex: '1 1 65%',
                borderRight: '1px solid var(--border-1)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                padding: '20px',
                position: 'relative',
                overflowY: 'auto',
                userSelect: 'none'
              }}
            >
              {/* Floating select-box drawing overlay */}
              {isSelecting && dragRect && (
                <div style={{
                  position: 'absolute',
                  left: dragRect.left,
                  top: dragRect.top,
                  width: dragRect.width,
                  height: dragRect.height,
                  backgroundColor: 'rgba(0, 242, 254, 0.06)',
                  border: '1px solid var(--accent)',
                  borderRadius: '4px',
                  pointerEvents: 'none',
                  zIndex: 1000,
                  boxShadow: '0 0 10px rgba(var(--accent-rgb), 0.15)'
                }} />
              )}

              <div
                data-canvas-bg="true"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '16px',
                  flexShrink: 0
                }}
              >
                <span data-canvas-bg="true" style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '1px' }}>
                  ARRANGEMENT CANVAS ({pages.length} PAGES - DRAG & DROP TO REORDER)
                </span>

                <button
                  onClick={handleImportPDF}
                  style={{
                    background: 'var(--bg-elevated)',
                    border: '1px solid var(--border-2)',
                    color: 'var(--text-1)',
                    padding: '6px 14px',
                    borderRadius: '8px',
                    fontSize: '11px',
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                  }}
                  className="action-btn"
                >
                  <Plus size={13} />
                  Import PDF
                </button>
              </div>

              {/* scrollable page grid cards */}
              <div
                data-canvas-bg="true"
                style={{
                  flex: 1,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '16px',
                  alignContent: 'start',
                  paddingRight: '8px',
                  paddingBottom: '80px' // Added buffer space for floating bulk actions bar
                }}
              >
                {pages.length === 0 ? (
                  <div style={{ gridColumn: '1 / -1', height: '240px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', fontSize: '11px' }}>
                    {isProcessing ? 'Generating slide captures...' : 'No pages found.'}
                  </div>
                ) : (
                  pages.map((p, idx) => {
                    const isSelected = selectedPageIds.has(p.id);
                    const isActive = p.id === activePageId;
                    return (
                      <div
                        key={p.id}
                        data-page-id={p.id}
                        draggable={!isProcessing}
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        onDragEnd={handleDragEnd}
                        onMouseEnter={() => setHoveredIndex(idx)}
                        onMouseLeave={() => setHoveredIndex(null)}
                        onClick={(e) => handleCardClick(e, p, idx)}
                        onContextMenu={(e) => handleContextMenu(e, p, idx)}
                        style={{
                          background: 'var(--bg-elevated)',
                          border: `1px solid ${isSelected ? 'var(--accent)' : draggedIndex === idx ? 'var(--accent)' : hoveredIndex === idx ? 'var(--border-2)' : 'var(--border-1)'}`,
                          borderRadius: '14px',
                          padding: '12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '10px',
                          position: 'relative',
                          cursor: 'grab',
                          opacity: draggedIndex === idx ? 0.3 : 1,
                          transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                          boxShadow: isSelected 
                            ? '0 0 14px rgba(var(--accent-rgb), 0.25)' 
                            : draggedIndex === idx 
                            ? '0 20px 25px -5px rgba(0,0,0,0.1)' 
                            : hoveredIndex === idx 
                            ? '0 8px 20px rgba(0,0,0,0.08)' 
                            : 'none',
                          transform: hoveredIndex === idx && draggedIndex !== idx ? 'translateY(-3px)' : 'none'
                        }}
                        className="studio-page-card"
                      >
                        {/* Document Preview Frame */}
                        <div
                          style={{
                            width: '100%',
                            height: '115px',
                            borderRadius: '10px',
                            border: '1px solid var(--border-2)',
                            backgroundColor: theme === 'dark' ? '#0f172a' : '#f1f5f9',
                            overflow: 'hidden',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            position: 'relative',
                            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.05)'
                          }}
                        >
                          {p.serveUrl ? (
                            <div style={{
                              width: '580px',
                              height: '435px',
                              transform: 'scale(0.26)',
                              transformOrigin: 'center center',
                              flexShrink: 0,
                              pointerEvents: 'none'
                            }}>
                              <iframe
                                src={`${p.serveUrl}#view=Fit&toolbar=0&navpanes=0&scrollbar=0`}
                                scrolling="no"
                                loading="lazy"
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  border: 'none',
                                  backgroundColor: '#fff'
                                }}
                              />
                            </div>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', color: 'var(--text-3)' }}>
                              <FileText size={22} />
                              <span style={{ fontSize: '8px' }}>No Preview</span>
                            </div>
                          )}

                          {/* Page sequence tag */}
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            left: '8px',
                            minWidth: '20px',
                            height: '20px',
                            borderRadius: '5px',
                            backgroundColor: 'var(--bg-deep)',
                            border: `1px solid ${isSelected ? 'var(--border-accent)' : 'var(--border-2)'}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '10px',
                            fontWeight: 800,
                            color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                            fontFamily: 'var(--font-mono)',
                            zIndex: 10,
                            boxShadow: isSelected ? '0 0 10px rgba(var(--accent-rgb), 0.2)' : 'none'
                          }}>
                            {idx + 1}
                          </div>

                          {/* Drag handle overlay */}
                          <div style={{
                            position: 'absolute',
                            top: '8px',
                            right: '8px',
                            padding: '4px',
                            borderRadius: '5px',
                            backgroundColor: 'var(--bg-deep)',
                            color: 'var(--text-2)',
                            cursor: 'grab',
                            display: 'flex',
                            alignItems: 'center',
                            zIndex: 10,
                            border: '1px solid var(--border-2)'
                          }}>
                            <GripVertical size={11} />
                          </div>
                        </div>

                        {/* Info details */}
                        <div style={{ minWidth: 0 }}>
                          <div style={{
                            fontSize: '11px',
                            fontWeight: 800,
                            color: 'var(--text-1)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }} title={p.slideName}>
                            {p.slideName}
                          </div>
                          <div style={{ fontSize: '9px', color: 'var(--text-3)', display: 'flex', gap: '6px', marginTop: '3px', fontWeight: 600 }}>
                            <span>Original: {p.originalIndex}</span>
                            {p.isExternal && <span style={{ color: 'var(--purple)', fontWeight: 700 }}>• Imported</span>}
                          </div>
                        </div>

                        {/* Card Actions Footer */}
                        <div style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'flex-end',
                          borderTop: '1px solid var(--border-1)',
                          paddingTop: '8px',
                          gap: '6px'
                        }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); setActivePageId(p.id); }}
                            title="Inspect page properties"
                            style={{
                              background: isSelected ? 'var(--accent-dim)' : 'var(--bg-base)',
                              border: `1px solid ${isSelected ? 'var(--border-accent)' : 'var(--border-2)'}`,
                              color: isSelected ? 'var(--accent)' : 'var(--text-2)',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '9px',
                              fontWeight: 700,
                              transition: 'all 0.2s'
                            }}
                            className="feed-action-btn"
                          >
                            <Settings2 size={10} />
                            Meta
                          </button>

                          <button
                            onClick={(e) => { e.stopPropagation(); triggerDeleteConfirm([idx]); }}
                            title="Remove page"
                            style={{
                              background: 'var(--bg-base)',
                              border: '1px solid var(--border-2)',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '4px 8px',
                              borderRadius: '6px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '4px',
                              fontSize: '9px',
                              fontWeight: 700,
                              transition: 'all 0.2s'
                            }}
                            className="feed-action-btn"
                          >
                            <Trash2 size={10} />
                            Delete
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right page metadata inspector + LIVE PREVIEW split render */}
            <div
              style={{
                flex: '1 1 35%',
                backgroundColor: 'var(--bg-base)',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                padding: '20px',
                borderLeft: '1px solid var(--border-1)'
              }}
            >
              {activePage ? (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  
                  {/* Part 1: Live Large Preview */}
                  <div style={{ marginBottom: '20px', display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                    <div style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.8px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <Eye size={12} style={{ color: 'var(--accent)' }} />
                      LIVE PAGE PREVIEW
                    </div>
                    
                    <div style={{
                      width: '100%',
                      aspectRatio: '1024 / 768',
                      borderRadius: '12px',
                      border: '1px solid var(--border-2)',
                      overflow: 'hidden',
                      backgroundColor: '#fff',
                      boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
                      position: 'relative'
                    }}>
                      {activePage.serveUrl ? (
                        <iframe
                          src={`${activePage.serveUrl}#toolbar=0`}
                          style={{ width: '100%', height: '100%', border: 'none', display: 'block' }}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '8px', backgroundColor: 'var(--bg-elevated)', color: 'var(--text-3)' }}>
                          <FileText size={28} style={{ opacity: 0.5 }} />
                          <span style={{ fontSize: '10px' }}>No Live Preview Available</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Part 2: Properties Editor */}
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px', flexShrink: 0 }}>
                      <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Properties Editor
                      </span>
                      <button
                        id="save-metadata-btn"
                        onClick={saveMetadata}
                        style={{
                          backgroundColor: 'var(--accent-dim)',
                          border: '1px solid var(--border-accent)',
                          color: 'var(--accent)',
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '10px',
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px',
                          transition: 'all 0.2s'
                        }}
                      >
                        <Save size={11} />
                        Apply
                      </button>
                    </div>

                    <textarea
                      value={editingMetadata}
                      onChange={(e) => setEditingMetadata(e.target.value)}
                      style={{
                        flex: 1,
                        backgroundColor: 'var(--bg-deep)',
                        color: 'var(--text-1)',
                        border: '1px solid var(--border-1)',
                        borderRadius: '10px',
                        padding: '12px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '10px',
                        resize: 'none',
                        lineHeight: '1.45',
                        outline: 'none'
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', textAlign: 'center', padding: '24px' }}>
                  <Settings2 size={28} style={{ opacity: 0.4, marginBottom: '12px', color: 'var(--accent)' }} />
                  <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-2)', marginBottom: '4px' }}>
                    Inspector Panel
                  </div>
                  <p style={{ fontSize: '9px', color: 'var(--text-3)', maxWidth: '220px', lineHeight: 1.5 }}>
                    Select "Meta" or click any slide card to inspect its live preview render and edit its structural properties.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer bar */}
      <div
        style={{
          padding: '14px 24px',
          borderTop: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--bg-base)',
          backdropFilter: 'blur(20px)',
          zIndex: 10,
          flexShrink: 0
        }}
      >
        <div style={{ fontSize: '10px', color: '#ef4444', fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {errorMessage}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button
            onClick={selectedDeck ? () => { setSelectedDeck(null); setPages([]); setActivePageId(null); } : onClose}
            style={{
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-2)',
              color: 'var(--text-1)',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            {selectedDeck ? 'Cancel Edit' : 'Go Back'}
          </button>
          {selectedDeck && (
            <button
              onClick={handleRebuild}
              disabled={isProcessing || pages.length === 0}
              style={{
                background: 'linear-gradient(135deg, var(--accent), var(--blue))',
                border: 'none',
                color: 'var(--bg-deep)',
                padding: '8px 20px',
                borderRadius: '8px',
                fontSize: '11px',
                fontWeight: 800,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                boxShadow: '0 3px 12px rgba(var(--accent-rgb), 0.25)',
                opacity: (isProcessing || pages.length === 0) ? 0.6 : 1
              }}
              className="action-btn"
            >
              <Save size={12} />
              {isProcessing ? 'Stitching Campaign...' : 'Save Presentation'}
            </button>
          )}
        </div>
      </div>

      {/* Custom Right-Click Context Menu */}
      {contextMenu?.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: contextMenu.y,
            left: contextMenu.x,
            width: '180px',
            backgroundColor: 'var(--bg-glass)',
            backdropFilter: 'blur(25px)',
            border: '1px solid var(--border-accent)',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2), 0 0 15px rgba(var(--accent-rgb), 0.08)',
            padding: '6px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            animation: 'fadeIn 0.15s ease-out'
          }}
          onClick={(e) => e.stopPropagation()} // Prevent closing instantly on click inside
        >
          <button
            onClick={() => {
              const indices = pages
                .map((p, idx) => (selectedPageIds.has(p.id) ? idx : -1))
                .filter(idx => idx !== -1);
              triggerDeleteConfirm(indices);
              setContextMenu(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#ef4444',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span>Delete</span>
            <span style={{ fontSize: '9px', opacity: 0.6, fontWeight: 500 }}>Del</span>
          </button>

          <button
            onClick={() => {
              setSelectedPageIds(new Set());
              setContextMenu(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-1)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span>Clear Selection</span>
            <span style={{ fontSize: '9px', opacity: 0.6, fontWeight: 500 }}>Esc</span>
          </button>

          <button
            onClick={handleDuplicateSelected}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-1)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span>Duplicate</span>
            <span style={{ fontSize: '9px', opacity: 0.6, fontWeight: 500 }}>Ctrl+D</span>
          </button>

          <div style={{ height: '1px', backgroundColor: 'var(--border-1)', margin: '4px 6px' }} />

          <button
            onClick={handleConvertSelectionToPDF}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--accent)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span>Convert to PDF</span>
            <span style={{ fontSize: '9px', opacity: 0.6, fontWeight: 500 }}>Ctrl+S</span>
          </button>
        </div>
      )}

      {/* Custom Deck/Workspace Context Menu */}
      {deckContextMenu?.isOpen && (
        <div
          style={{
            position: 'fixed',
            top: deckContextMenu.y,
            left: deckContextMenu.x,
            width: '180px',
            backgroundColor: 'var(--bg-glass)',
            backdropFilter: 'blur(25px)',
            border: '1px solid var(--border-accent)',
            borderRadius: '12px',
            boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2), 0 0 15px rgba(var(--accent-rgb), 0.08)',
            padding: '6px',
            zIndex: 9999,
            display: 'flex',
            flexDirection: 'column',
            gap: '2px',
            animation: 'fadeIn 0.15s ease-out'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleRenameDeck(deckContextMenu.deck)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-1)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Edit3 size={12} /> Rename
            </span>
          </button>

          <button
            onClick={handleOpenDeckLocation}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-1)',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <FolderOpen size={12} /> Open File Location
            </span>
          </button>

          <div style={{ height: '1px', backgroundColor: 'var(--border-1)', margin: '4px 6px' }} />

          <button
            onClick={() => handleDeleteDeck(deckContextMenu.deck)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              background: 'transparent',
              border: 'none',
              color: '#ef4444',
              padding: '8px 12px',
              borderRadius: '8px',
              fontSize: '11px',
              fontWeight: 800,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s'
            }}
            className="feed-action-btn"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Trash2 size={12} /> Delete Deck
            </span>
          </button>
        </div>
      )}

      {/* Custom Delete Confirmation Modal */}
      {deleteConfirmModal?.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(7, 8, 13, 0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-accent)',
            borderRadius: '16px',
            width: '400px',
            padding: '24px',
            boxShadow: 'var(--shadow-main)',
            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
          }}>
            <h3 style={{ fontSize: '16px', fontWeight: 800, color: 'var(--text-1)', margin: '0 0 10px 0' }}>
              {deleteConfirmModal.deckToDelete ? 'Delete Presentation Deck' : 'Confirm Deletion'}
            </h3>
            <p style={{ fontSize: '12px', color: 'var(--text-2)', margin: '0 0 20px 0', lineHeight: '1.5' }}>
              {deleteConfirmModal.deckToDelete
                ? `Are you sure you want to permanently delete the stitched deck "${deleteConfirmModal.deckToDelete.name}"?`
                : (deleteConfirmModal.indices.length === 1
                  ? 'Are you sure you want to delete this page from the compilation?'
                  : `Are you sure you want to delete these ${deleteConfirmModal.indices.length} pages from the compilation?`
                )}
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setDeleteConfirmModal(null)}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-1)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  backgroundColor: '#ef4444',
                  border: 'none',
                  color: '#fff',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.3)',
                  transition: 'all 0.2s'
                }}
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Selection Naming and Compilation Modal */}
      {convertModal?.isOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(7, 8, 13, 0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-accent)',
            borderRadius: '16px',
            width: '450px',
            padding: '24px',
            boxShadow: 'var(--shadow-main)',
            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-1)', margin: '0 0 4px 0' }}>
                Stitch Selection to New PDF
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0, fontWeight: 600 }}>
                Convert {selectedPageIds.size} selected slides into an independent presentation deck.
              </p>
            </div>

            {/* Slide title list preview in order of selection layout */}
            <div style={{
              maxHeight: '120px',
              overflowY: 'auto',
              border: '1px solid var(--border-1)',
              borderRadius: '10px',
              padding: '10px',
              backgroundColor: 'var(--bg-deep)',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px'
            }}>
              {pages.filter(p => selectedPageIds.has(p.id)).map((p, idx) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)', backgroundColor: 'var(--accent-dim)', width: '18px', height: '18px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyItems: 'center', justifyContent: 'center' }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {p.slideName}
                  </span>
                </div>
              ))}
            </div>

            {/* Filename configure form */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Configure Presentation Filename
              </label>
              <input
                type="text"
                value={convertModal.filename}
                onChange={(e) => setConvertModal({ ...convertModal, filename: e.target.value })}
                placeholder="presentation_deck.pdf"
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-deep)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border-1)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.15)'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-1)'}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => setConvertModal(null)}
                disabled={isProcessing}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-1)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmConvert(convertModal.filename)}
                disabled={isProcessing || !convertModal.filename.trim()}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--blue))',
                  border: 'none',
                  color: 'var(--bg-deep)',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(var(--accent-rgb), 0.3)',
                  transition: 'all 0.2s',
                  opacity: (isProcessing || !convertModal.filename.trim()) ? 0.6 : 1
                }}
              >
                {isProcessing ? 'Compiling Deck...' : 'Compile Deck'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Rename Modal */}
      {renameModal?.isOpen && renameModal.deck && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(7, 8, 13, 0.75)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10000,
          animation: 'fadeIn 0.2s ease-out'
        }}>
          <div style={{
            background: 'var(--bg-glass)',
            border: '1px solid var(--border-accent)',
            borderRadius: '16px',
            width: '400px',
            padding: '24px',
            boxShadow: 'var(--shadow-main)',
            animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div>
              <h3 style={{ fontSize: '15px', fontWeight: 800, color: 'var(--text-1)', margin: '0 0 4px 0' }}>
                Rename Presentation Deck
              </h3>
              <p style={{ fontSize: '11px', color: 'var(--text-3)', margin: 0, fontWeight: 600 }}>
                Specify a new filename for the stitched presentation deck.
              </p>
            </div>

            {/* Filename Input */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-2)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Enter New Filename
              </label>
              <input
                type="text"
                value={renameModal.filename}
                onChange={(e) => setRenameModal({ ...renameModal, filename: e.target.value })}
                placeholder="presentation_deck.pdf"
                style={{
                  width: '100%',
                  backgroundColor: 'var(--bg-deep)',
                  color: 'var(--text-1)',
                  border: '1px solid var(--border-1)',
                  borderRadius: '8px',
                  padding: '10px 14px',
                  fontSize: '11px',
                  fontWeight: 600,
                  outline: 'none',
                  transition: 'border-color 0.2s',
                  boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.15)'
                }}
                onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
                onBlur={(e) => e.target.style.borderColor = 'var(--border-1)'}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '4px' }}>
              <button
                onClick={() => setRenameModal(null)}
                disabled={isProcessing}
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  border: '1px solid var(--border-2)',
                  color: 'var(--text-1)',
                  padding: '8px 16px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRename}
                disabled={isProcessing || !renameModal.filename.trim()}
                style={{
                  background: 'linear-gradient(135deg, var(--accent), var(--blue))',
                  border: 'none',
                  color: 'var(--bg-deep)',
                  padding: '8px 20px',
                  borderRadius: '8px',
                  fontSize: '11px',
                  fontWeight: 800,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(var(--accent-rgb), 0.3)',
                  transition: 'all 0.2s',
                  opacity: (isProcessing || !renameModal.filename.trim()) ? 0.6 : 1
                }}
              >
                {isProcessing ? 'Renaming...' : 'Rename Deck'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
