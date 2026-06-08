import React, { useState } from 'react';
import { FileText, BookOpen, Trash2, Info, Merge, Eye, HardDrive, Cpu, Layers, Share2, Copy, Check, X } from 'lucide-react';
import { ShareFile } from '../../bindings/htmltoepdf/app';

interface Slide {
  name: string;
  folderName: string;
  url: string;
}

interface CompiledPDF {
  name: string;
  size: number;
  serveUrl: string;
  metadata: string;
}

interface OutputPanelProps {
  slides: Slide[];
  compiledPDFs: CompiledPDF[];
  combinedDecks: CompiledPDF[];
  onDeletePDF: (name: string, type: 'single' | 'deck') => Promise<void>;
  onCombineDecks: () => Promise<void>;
  onOpenPDFViewer: (pdf: CompiledPDF) => void;
  onOpenMetadata: (pdf: CompiledPDF) => void;
  isCompiling: boolean;
  appMode?: 'select' | 'builder' | 'capture';
  osPlatform?: 'darwin' | 'windows' | '' | null;
}

export const OutputPanel: React.FC<OutputPanelProps> = ({
  slides,
  compiledPDFs,
  combinedDecks,
  onDeletePDF,
  onCombineDecks,
  onOpenPDFViewer,
  onOpenMetadata,
  isCompiling,
  appMode,
  osPlatform,
}) => {
  const [sharedUrl, setSharedUrl] = useState<string | null>(null);
  const [sharedFileName, setSharedFileName] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isMacBuilder = osPlatform === 'darwin' && appMode === 'builder';

  const handleShareFile = async (e: React.MouseEvent, filename: string) => {
    e.stopPropagation();
    try {
      const url = await ShareFile(filename);
      setSharedUrl(url);
      setSharedFileName(filename);
      setCopied(false);
    } catch (err) {
      console.error('Failed to share file:', err);
      alert('Failed to generate sharing link: ' + err);
    }
  };

  const handleCopyLink = () => {
    if (sharedUrl) {
      navigator.clipboard.writeText(sharedUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const singles = compiledPDFs || [];
  const decks = combinedDecks || [];

  const formatFileSize = (bytes: number) => {
    if (!bytes) return '0 B';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  // Calculate telemetry stats
  const totalSize = [...singles, ...decks].reduce((sum, f) => sum + (f.size || 0), 0);

  return (
    <div
      style={{
        width: '270px',
        minWidth: '270px',
        borderLeft: '1px solid var(--border-1)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: 'transparent',
        zIndex: 5,
        flexShrink: 0
      }}
    >
      {/* Telemetry Dashboard Widget Header */}
      <div style={{
        padding: '16px',
        backgroundColor: 'transparent',
        borderBottom: '1px solid var(--border-1)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        flexShrink: 0
      }}>

        {/* Stats Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <div style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-1)',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Layers size={12} style={{ color: 'var(--accent)' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '8px', color: 'var(--text-3)', fontWeight: 600 }}>SINGLES</span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>{singles.length}</span>
            </div>
          </div>

          <div style={{
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border-1)',
            padding: '8px',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <HardDrive size={12} style={{ color: 'var(--purple)' }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <span style={{ fontSize: '8px', color: 'var(--text-3)', fontWeight: 600 }}>STORAGE</span>
              <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--text-1)', fontFamily: 'var(--font-mono)' }}>
                {formatFileSize(totalSize)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Asset Stream Feed */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '16px 0 16px 16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        
        {/* Section 1: Single Slide Outputs */}
        <div style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
          <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '1px', textTransform: 'uppercase', paddingRight: '16px' }}>
            Compiled Slide Captures
          </div>

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px', paddingRight: '16px' }}>
            {singles.length === 0 ? (
              <div style={{
                border: '1px dashed var(--border-2)',
                borderRadius: '10px',
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: '10px',
                color: 'var(--text-3)',
                lineHeight: 1.5,
                backgroundColor: 'var(--bg-base)'
              }}>
                No asset captures registered. Use "Save Slide" to compile presentation files.
              </div>
            ) : (
              singles.map((pdf) => {
                let thumbUrl = '';
                try {
                  if (pdf.metadata) {
                    const meta = JSON.parse(pdf.metadata);
                    const slide = slides.find((s) => s.folderName === meta.folderName);
                    if (slide) {
                      thumbUrl = slide.url.replace('index.html', 'thumb.png');
                    }
                  }
                } catch (_) {}

                if (!thumbUrl) {
                  const match = pdf.name.match(/\d+/);
                  if (match) {
                    const idx = parseInt(match[0], 10) - 1;
                    if (idx >= 0 && idx < slides.length) {
                      thumbUrl = slides[idx].url.replace('index.html', 'thumb.png');
                    }
                  }
                }

                return (
                  <div
                    key={pdf.name}
                    onClick={() => onOpenPDFViewer(pdf)}
                    style={{
                      backgroundColor: 'var(--bg-base)',
                      border: '1px solid var(--border-1)',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                      transition: 'all 0.2s',
                      position: 'relative',
                      cursor: 'pointer',
                      flexShrink: 0,
                      '--card-thumb': thumbUrl ? `url("${thumbUrl.replace(/\\/g, '/')}")` : 'none'
                    } as React.CSSProperties}
                    className="premium-feed-card"
                  >
                  {/* Card Content Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ef4444',
                      flexShrink: 0
                    }}>
                      <FileText size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        WebkitMaskImage: 'linear-gradient(to right, #000 40%, transparent 75%)',
                        maskImage: 'linear-gradient(to right, #000 40%, transparent 75%)'
                      }} title={pdf.name}>
                        {pdf.name}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px dashed var(--border-1)',
                    paddingTop: '8px',
                    marginTop: '2px'
                  }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {formatFileSize(pdf.size)}
                    </span>
                    
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {isMacBuilder && (
                        <button
                          onClick={(e) => handleShareFile(e, pdf.name)}
                          title="Share File to Network"
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-2)',
                            color: 'var(--text-2)',
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
                          <Share2 size={10} />
                          Share
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenMetadata(pdf); }}
                        title="Properties Info"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-2)',
                          color: 'var(--text-2)',
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
                        <Info size={10} />
                        Info
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeletePDF(pdf.name, 'single'); }}
                        disabled={isCompiling}
                        title="Delete output file"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-2)',
                          color: 'var(--text-2)',
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
                </div>
              );
            })
          )}
          </div>
        </div>

        {/* Section divider line */}
        <div style={{ height: '1px', backgroundColor: 'var(--border-1)', marginRight: '16px', flexShrink: 0 }} />

        {/* Section 2: Combined Decks */}
        <div style={{ flex: '1 1 0%', display: 'flex', flexDirection: 'column', gap: '8px', minHeight: 0 }}>
          <div style={{ fontSize: '9px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '1px', textTransform: 'uppercase', display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: '16px' }}>
            <span>Stitched Presentations</span>
            {decks.length > 0 && (
              <span style={{ color: 'var(--blue)', fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{decks.length} DECKS</span>
            )}
          </div>

          {singles.length > 1 && (
            <div style={{ paddingRight: '16px', flexShrink: 0 }}>
              <button
                onClick={onCombineDecks}
                disabled={isCompiling}
                style={{
                  width: '100%',
                  background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.12), rgba(139, 92, 246, 0.12))',
                  border: '1px solid var(--border-accent)',
                  color: 'var(--accent)',
                  padding: '9px 12px',
                  borderRadius: '10px',
                  fontWeight: 800,
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  transition: 'all 0.2s',
                  boxShadow: '0 2px 8px rgba(var(--accent-rgb), 0.05)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
                className="action-btn"
              >
                <Merge size={12} />
                Merge All Outputs
              </button>
            </div>
          )}

          <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '16px' }}>
            {decks.length === 0 ? (
              <div style={{
                border: '1px dashed var(--border-2)',
                borderRadius: '10px',
                padding: '24px 12px',
                textAlign: 'center',
                fontSize: '10px',
                color: 'var(--text-3)',
                lineHeight: 1.5,
                backgroundColor: 'var(--bg-base)'
              }}>
                No combined decks compiled yet. Stitch slide pages to bundle presentations.
              </div>
            ) : (
              decks.map((pdf) => {
                let deckThumbUrl = '';
                if (slides.length > 0) {
                  deckThumbUrl = slides[0].url.replace('index.html', 'thumb.png');
                }

                return (
                  <div
                    key={pdf.name}
                    onClick={() => onOpenPDFViewer(pdf)}
                    style={{
                      backgroundColor: 'var(--bg-base)',
                      border: '1px solid var(--border-accent)',
                      borderLeft: '4px solid var(--blue)',
                      borderRadius: '12px',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px',
                      boxShadow: '0 4px 14px rgba(var(--accent-rgb), 0.03)',
                      transition: 'all 0.2s',
                      position: 'relative',
                      cursor: 'pointer',
                      flexShrink: 0,
                      '--card-thumb': deckThumbUrl ? `url("${deckThumbUrl.replace(/\\/g, '/')}")` : 'none'
                    } as React.CSSProperties}
                    className="premium-feed-card deck-card"
                  >
                  {/* Card Content Row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--blue-dim)',
                      border: '1px solid var(--blue-mid)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--blue)',
                      flexShrink: 0
                    }}>
                      <BookOpen size={13} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        color: 'var(--text-1)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        WebkitMaskImage: 'linear-gradient(to right, #000 40%, transparent 75%)',
                        maskImage: 'linear-gradient(to right, #000 40%, transparent 75%)'
                      }} title={pdf.name}>
                        {pdf.name}
                      </div>
                    </div>
                  </div>

                  {/* Card Actions Footer */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderTop: '1px dashed var(--border-1)',
                    paddingTop: '8px',
                    marginTop: '2px'
                  }}>
                    <span style={{ fontSize: '9px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                      {formatFileSize(pdf.size)}
                    </span>
                    
                    <div style={{ display: 'flex', gap: '6px' }}>
                      {isMacBuilder && (
                        <button
                          onClick={(e) => handleShareFile(e, pdf.name)}
                          title="Share File to Network"
                          style={{
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border-2)',
                            color: 'var(--text-2)',
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
                          <Share2 size={10} />
                          Share
                        </button>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); onOpenMetadata(pdf); }}
                        title="Properties Info"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-2)',
                          color: 'var(--text-2)',
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
                        <Info size={10} />
                        Info
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onDeletePDF(pdf.name, 'deck'); }}
                        disabled={isCompiling}
                        title="Delete presentation bundle"
                        style={{
                          background: 'var(--bg-elevated)',
                          border: '1px solid var(--border-2)',
                          color: 'var(--text-2)',
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
                </div>
              );
            })
          )}
        </div>
      </div>

      {sharedUrl && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.65)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '24px'
        }}>
          <div style={{
            background: 'var(--bg-base)',
            border: '1px solid var(--border-accent)',
            borderRadius: '16px',
            padding: '24px',
            width: '100%',
            maxWidth: '420px',
            boxShadow: '0 20px 40px rgba(0, 0, 0, 0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px',
            position: 'relative'
          }}>
            <button
              onClick={() => setSharedUrl(null)}
              style={{
                position: 'absolute',
                top: '16px',
                right: '16px',
                background: 'none',
                border: 'none',
                color: 'var(--text-3)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '4px',
                borderRadius: '50%',
                transition: 'background-color 0.2s'
              }}
              className="hover-bg-raised"
            >
              <X size={16} />
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                backgroundColor: 'var(--accent-dim)',
                border: '1px solid var(--border-accent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--accent)'
              }}>
                <Share2 size={16} />
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 800, color: 'var(--text-1)' }}>
                  Share File to Local Network
                </h3>
                <p style={{ margin: '2px 0 0 0', fontSize: '10px', color: 'var(--text-3)', fontWeight: 600 }}>
                  Instantly shared from this Mac
                </p>
              </div>
            </div>

            <div style={{
              backgroundColor: 'var(--bg-raised)',
              border: '1px solid var(--border-1)',
              padding: '12px',
              borderRadius: '8px',
              fontSize: '11px',
              color: 'var(--text-2)',
              wordBreak: 'break-all',
              fontFamily: 'var(--font-mono)'
            }}>
              <strong>File:</strong> {sharedFileName}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <span style={{ fontSize: '10px', fontWeight: 800, color: 'var(--text-3)', letterSpacing: '0.5px' }}>
                RECEIVE LINK (ANY BROWSER ON SAME WI-FI / LAN):
              </span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  readOnly
                  value={sharedUrl}
                  style={{
                    flex: 1,
                    backgroundColor: 'var(--bg-deep)',
                    border: '1px solid var(--border-2)',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    fontSize: '11px',
                    color: 'var(--text-1)',
                    fontFamily: 'var(--font-mono)',
                    outline: 'none'
                  }}
                />
                <button
                  onClick={handleCopyLink}
                  style={{
                    backgroundColor: copied ? 'var(--success)' : 'var(--accent)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: '8px',
                    padding: '0 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    fontSize: '11px',
                    fontWeight: 700,
                    transition: 'all 0.2s'
                  }}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  <span>{copied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <p style={{ margin: 0, fontSize: '10px', color: 'var(--text-3)', lineHeight: 1.5, textAlign: 'center' }}>
              Ensure the receiving device is connected to the same Wi-Fi network. Just type or paste this link in any web browser to view or download the PDF file directly.
            </p>
          </div>
        </div>
      )}
      </div>
    </div>
  );
};
