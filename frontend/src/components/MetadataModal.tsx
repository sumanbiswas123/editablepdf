import React from 'react';
import { X, Calendar, Layers, Folder, Shield, Info, Clipboard } from 'lucide-react';

interface CompiledPDF {
  name: string;
  size: number;
  serveUrl: string;
  metadata: string;
}

interface MetadataModalProps {
  pdf: CompiledPDF | null;
  onClose: () => void;
}

export const MetadataModal: React.FC<MetadataModalProps> = ({ pdf, onClose }) => {
  if (!pdf) return null;

  let parsedMetadata: any = null;
  let isDeckIndex = false;

  try {
    parsedMetadata = JSON.parse(pdf.metadata || '{}');
    isDeckIndex = Array.isArray(parsedMetadata);
  } catch (err) {
    console.error('Failed to parse PDF metadata JSON:', err);
  }

  const getBadgeStyles = (type: string) => {
    switch (type) {
      case 'slide':
        return { background: 'linear-gradient(135deg, #3b82f6, #06b6d4)', color: '#0f172a' };
      case 'popup':
        return { background: 'linear-gradient(135deg, var(--rose), var(--purple))', color: '#ffffff' };
      case 'shared_on_slide':
        return { background: 'linear-gradient(135deg, #a78bfa, #c084fc)', color: '#0f172a' };
      case 'shared_on_popup':
        return { background: 'linear-gradient(135deg, #fbbf24, #fb923c)', color: '#0f172a' };
      default:
        return { background: 'var(--border-2)', color: 'var(--text-2)' };
    }
  };

  const getSharedBadgeStyles = (sharedType: string) => {
    switch (sharedType) {
      case 'ref':
        return { background: 'linear-gradient(135deg, #10b981, #34d399)', color: '#0f172a' };
      case 'pi':
        return { background: 'linear-gradient(135deg, #ec4899, #f43f5e)', color: '#ffffff' };
      case 'isi':
        return { background: 'linear-gradient(135deg, #f97316, #eab308)', color: '#0f172a' };
      case 'si':
        return { background: 'linear-gradient(135deg, #ea580c, #f59e0b)', color: '#0f172a' };
      case 'menu':
        return { background: 'linear-gradient(135deg, #0284c7, #06b6d4)', color: '#0f172a' };
      case 'flow':
        return { background: 'linear-gradient(135deg, #3b82f6, #1d4ed8)', color: '#ffffff' };
      default:
        return { background: 'var(--purple-mid)', color: 'var(--purple)' };
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(5, 7, 12, 0.92)',
        backdropFilter: 'blur(12px)',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
        padding: '20px'
      }}
    >
      <div
        className="glass-panel"
        style={{
          width: '100%',
          maxWidth: '580px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-base)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--border-accent)',
          boxShadow: 'var(--shadow-main), 0 0 40px rgba(var(--accent-rgb), 0.05)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'slideUp 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      >
        {/* Modal Header */}
        <div style={{
          padding: '16px 20px',
          borderBottom: '1px solid var(--border-1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Info size={14} style={{ color: 'var(--accent)' }} />
            <h3 style={{ fontSize: '14px', fontWeight: 800, color: 'var(--text-1)' }}>PDF Compilation Metadata</h3>
          </div>
          <button
            onClick={onClose}
            style={{
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
            className="action-btn"
          >
            <X size={15} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '14px'
        }}>
          {!parsedMetadata || (typeof parsedMetadata === 'object' && Object.keys(parsedMetadata).length === 0) ? (
            <div style={{
              textAlign: 'center',
              color: 'var(--text-3)',
              padding: '24px',
              fontSize: '12px'
            }}>
              No compilation metadata records found inside this document.
            </div>
          ) : isDeckIndex ? (
            /* RENDER COMBINED DECK SLIDES ACCORDION INDEX */
            <>
              <div style={{
                borderLeft: '4px solid var(--accent)',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '0 var(--radius) var(--radius) 0',
                padding: '12px 16px',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'var(--text-3)', fontWeight: 700 }}>
                  Combined Presentation Deck
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>
                  {parsedMetadata[0]?.presentationId || 'Merged Presentation'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--text-2)', marginTop: '2px', fontWeight: 500 }}>
                  Total Stitched Pages: <span style={{ color: 'var(--text-1)', fontWeight: 700 }}>{parsedMetadata.length} slices</span>
                </div>
              </div>

              <div style={{
                fontWeight: 700,
                color: 'var(--text-1)',
                fontSize: '10px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                borderBottom: '1px solid var(--border-2)',
                paddingBottom: '6px',
                marginTop: '10px'
              }}>
                Chronological Slide Index
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {parsedMetadata.map((page: any, idx: number) => {
                  const badge = getBadgeStyles(page.type);
                  return (
                    <div
                      key={idx}
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        border: '1px solid var(--border-1)',
                        borderRadius: 'var(--radius)',
                        padding: '12px 16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px'
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-1)', paddingBottom: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-1)' }}>
                          📄 Page {page.startPage && page.endPage ? (page.startPage === page.endPage ? page.startPage : `${page.startPage} - ${page.endPage}`) : idx + 1}
                        </span>
                        <span style={{
                          background: badge.background,
                          color: badge.color,
                          padding: '2px 8px',
                          borderRadius: '12px',
                          fontSize: '8px',
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px'
                        }}>
                          {page.type.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px' }}>
                        <div style={{ color: 'var(--text-1)', fontWeight: 600 }}>
                          Slide: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', fontWeight: 'normal' }}>{page.slideName}</span>
                        </div>
                        <div style={{ color: 'var(--text-3)', fontSize: '10px' }}>
                          Folder: <span style={{ fontFamily: 'var(--font-mono)' }}>{page.folderName}</span>
                        </div>
                      </div>

                      {page.sharedType && (
                        <div style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          backgroundColor: 'var(--bg-surface)',
                          padding: '4px 10px',
                          borderRadius: 'var(--radius-sm)',
                          marginTop: '2px'
                        }}>
                          <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>Active Overlay</span>
                          <span style={{
                            ...getSharedBadgeStyles(page.sharedType),
                            padding: '1px 6px',
                            borderRadius: '4px',
                            fontSize: '8px',
                            fontWeight: 700,
                            textTransform: 'uppercase'
                          }}>{page.sharedType}</span>
                        </div>
                      )}

                      {page.openPopups && page.openPopups.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                          <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 600 }}>Active Popups Stack ({page.openPopups.length})</span>
                          {page.openPopups.map((popup: any, pIdx: number) => (
                            <div
                              key={pIdx}
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                backgroundColor: 'var(--bg-surface)',
                                borderLeft: `2px solid ${popup.type === 'slide_popup' ? 'var(--rose)' : 'var(--accent)'}`,
                                padding: '3px 8px',
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                                color: 'var(--text-2)'
                              }}
                            >
                              <span>#{popup.id || 'dialog'}</span>
                              <span style={{ color: 'var(--text-3)', fontSize: '9px' }}>zIndex: {popup.zIndex}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            /* RENDER SINGLE SLIDE METADATA CARD */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Layers size={10} /> Presentation ID
                </span>
                <span style={{ fontSize: '12px', fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginTop: '3px' }}>
                  {parsedMetadata.presentationId}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Slide Number (Name)</span>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: 'var(--text-1)', marginTop: '2px' }}>
                  {parsedMetadata.slideName}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Folder size={10} /> Folder Name
                </span>
                <span style={{ fontSize: '11px', fontFamily: 'var(--font-mono)', color: 'var(--text-2)', marginTop: '2px' }}>
                  {parsedMetadata.folderName}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Compile Type</span>
                <span style={{
                  ...getBadgeStyles(parsedMetadata.type),
                  padding: '3px 10px',
                  borderRadius: '12px',
                  fontSize: '9px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}>
                  {parsedMetadata.type?.replace(/_/g, ' ') || 'slide'}
                </span>
              </div>

              {parsedMetadata.sharedType && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Shared Popup Type</span>
                  <span style={{
                    ...getSharedBadgeStyles(parsedMetadata.sharedType),
                    padding: '3px 10px',
                    borderRadius: '12px',
                    fontSize: '9px',
                    fontWeight: 700,
                    textTransform: 'uppercase'
                  }}>{parsedMetadata.sharedType}</span>
                </div>
              )}

              {parsedMetadata.parentPopup && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Parent Slide Popup</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', fontSize: '11px', marginTop: '2px' }}>
                    <div style={{ color: 'var(--rose)', fontWeight: 600 }}>
                      ID: <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-1)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: '4px' }}>{parsedMetadata.parentPopup.id || 'N/A'}</span>
                    </div>
                    {parsedMetadata.parentPopup.className && (
                      <div style={{ color: 'var(--text-3)', fontSize: '10px', wordBreak: 'break-all', fontFamily: 'var(--font-mono)', marginTop: '2px' }}>
                        Class: .{parsedMetadata.parentPopup.className}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {parsedMetadata.openPopups && parsedMetadata.openPopups.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                  <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700 }}>Active Popups Stack ({parsedMetadata.openPopups.length})</span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginTop: '3px' }}>
                    {parsedMetadata.openPopups.map((p: any, idx: number) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--bg-surface)',
                          borderLeft: `3px solid ${p.type === 'slide_popup' ? 'var(--rose)' : 'var(--accent)'}`,
                          padding: '8px 12px',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                          fontSize: '11px'
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--font-mono)' }}>
                          <span style={{ color: 'var(--text-1)', fontWeight: 600 }}>#{p.id || 'Unnamed'}</span>
                          <span style={{ color: 'var(--text-3)', fontSize: '10px' }}>z: {p.zIndex}</span>
                        </div>
                        {p.className && <div style={{ color: 'var(--text-3)', fontSize: '9.5px', fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>.{p.className}</div>}
                        <div style={{ fontSize: '9px', color: p.type === 'slide_popup' ? 'var(--rose)' : 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', marginTop: '2px' }}>
                          Role: {p.type.replace(/_/g, ' ')}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border-1)', borderRadius: 'var(--radius)', padding: '12px 14px' }}>
                <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-3)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Calendar size={10} /> Compiled Timestamp
                </span>
                <span style={{ fontSize: '11px', color: 'var(--text-2)', marginTop: '2px' }}>
                  {new Date(parsedMetadata.timestamp).toLocaleString()}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
