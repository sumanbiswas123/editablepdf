import React, { useEffect } from 'react';
import { ArrowLeft, ArrowRight, X, FileText } from 'lucide-react';

interface CompiledPDF {
  name: string;
  size: number;
  serveUrl: string;
  metadata: string;
}

interface PDFViewerProps {
  pdf: CompiledPDF | null;
  currentIndex: number;
  totalPDFs: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({
  pdf,
  currentIndex,
  totalPDFs,
  onClose,
  onPrev,
  onNext,
}) => {
  // Listen for escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  if (!pdf) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(7, 8, 13, 0.98)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      {/* Viewer Control Header */}
      <div
        className="glass-panel"
        style={{
          height: '48px',
          minHeight: '48px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--border-1)',
          backgroundColor: 'var(--bg-base)',
          zIndex: 10
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
          <div style={{
            width: '26px',
            height: '26px',
            borderRadius: '6px',
            backgroundColor: 'var(--accent-dim)',
            border: '1px solid var(--border-accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--accent)',
            flexShrink: 0
          }}>
            <FileText size={13} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <span style={{
              fontSize: '8px',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              color: 'var(--text-3)',
              fontWeight: 800,
              fontFamily: 'var(--font-mono)'
            }}>
              PDF Document Preview
            </span>
            <span style={{
              fontSize: '12px',
              fontWeight: 700,
              color: 'var(--text-1)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginTop: '1px'
            }} title={pdf.name}>
              {pdf.name}
            </span>
          </div>
        </div>

        {/* compiled PDFs navigation controls */}
        {totalPDFs > 1 && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'var(--bg-elevated)',
            padding: '4px 10px',
            borderRadius: '16px',
            border: '1px solid var(--border-2)',
            marginRight: '12px'
          }}>
            <button
              onClick={onPrev}
              disabled={currentIndex <= 0}
              style={{
                background: 'none',
                border: 'none',
                color: currentIndex <= 0 ? 'var(--text-muted)' : 'var(--text-2)',
                cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.2s',
                padding: '2px'
              }}
              className="nav-btn"
            >
              <ArrowLeft size={12} />
            </button>

            <span style={{
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: 'var(--text-3)',
              minWidth: '40px',
              textAlign: 'center',
              userSelect: 'none'
            }}>
              {currentIndex + 1} / {totalPDFs}
            </span>

            <button
              onClick={onNext}
              disabled={currentIndex >= totalPDFs - 1}
              style={{
                background: 'none',
                border: 'none',
                color: currentIndex >= totalPDFs - 1 ? 'var(--text-muted)' : 'var(--text-2)',
                cursor: currentIndex >= totalPDFs - 1 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'color 0.2s',
                padding: '2px'
              }}
              className="nav-btn"
            >
              <ArrowRight size={12} />
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          style={{
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-2)',
            padding: '5px 12px',
            borderRadius: '14px',
            fontWeight: 700,
            fontSize: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all var(--transition)'
          }}
          className="action-btn"
        >
          <X size={12} />
          Close
        </button>
      </div>

      {/* PDF View Frame */}
      <iframe
        src={pdf.serveUrl}
        style={{
          flex: 1,
          border: 'none',
          backgroundColor: '#0e1017'
        }}
        title="PDF Document View"
      />
    </div>
  );
};
