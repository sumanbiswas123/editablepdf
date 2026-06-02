import React, { useState } from 'react';
import { Search, ChevronLeft, ChevronRight, Layers } from 'lucide-react';

interface Slide {
  name: string;
  folderName: string;
  url: string;
}

interface SidebarProps {
  slides: Slide[];
  currentSlideIndex: number;
  onSelectSlide: (index: number) => void;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
}

const SlideCard: React.FC<{
  slide: Slide & { originalIndex: number };
  isActive: boolean;
  onSelectSlide: (index: number) => void;
}> = ({ slide, isActive, onSelectSlide }) => {
  const [imgError, setImgError] = useState(false);
  const thumbUrl = slide.url.replace('index.html', 'thumb.png');

  return (
    <div
      onClick={() => onSelectSlide(slide.originalIndex)}
      style={{
        backgroundColor: 'transparent',
        borderRadius: 'var(--radius)',
        padding: '6px',
        marginBottom: '10px',
        cursor: 'pointer',
        transition: 'all var(--transition)',
        display: 'flex',
        flexDirection: 'column'
      }}
      className={`slide-card-item ${isActive ? 'active' : ''}`}
    >
      {/* Miniature CSS Slide Preview */}
      <div style={{
        width: '100%',
        aspectRatio: '4/3',
        backgroundColor: isActive ? 'var(--bg-glass)' : 'var(--bg-deep)',
        border: isActive ? '2px solid var(--accent)' : '1px solid var(--border-2)',
        boxShadow: isActive ? '0 0 12px rgba(0, 242, 254, 0.18)' : 'none',
        borderRadius: 'var(--radius)',
        position: 'relative',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all var(--transition)',
        marginBottom: '6px'
      }}>
        {!imgError ? (
          <img
            src={thumbUrl}
            alt={slide.name}
            onError={() => setImgError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transition: 'opacity 0.2s',
            }}
          />
        ) : (
          /* Schematic Wireframe Fallback */
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            padding: '8px',
            gap: '4px'
          }}>
            {/* Wireframe header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', borderBottom: '1px solid var(--border-1)', paddingBottom: '3px' }}>
              <div style={{ width: '30%', height: '2px', backgroundColor: 'var(--text-muted)', borderRadius: '1.5px' }} />
              <div style={{ width: '10%', height: '2px', backgroundColor: 'var(--text-muted)', borderRadius: '1.5px' }} />
            </div>
            {/* Wireframe body */}
            <div style={{ display: 'flex', flex: 1, gap: '6px', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ 
                width: '42%', 
                height: '24px', 
                backgroundColor: isActive ? 'rgba(0, 242, 254, 0.04)' : 'rgba(255,255,255,0.01)', 
                border: '1px dashed var(--border-2)', 
                borderRadius: '3px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Layers size={10} style={{ color: isActive ? 'var(--accent)' : 'var(--text-3)', opacity: 0.5 }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flex: 1 }}>
                <div style={{ width: '80%', height: '2px', backgroundColor: 'var(--text-muted)' }} />
                <div style={{ width: '50%', height: '2px', backgroundColor: 'var(--text-muted)' }} />
                <div style={{ width: '65%', height: '1.5px', backgroundColor: 'var(--text-muted)' }} />
              </div>
            </div>
          </div>
        )}

        {/* Circle Page index indicator in bottom left */}
        <div style={{
          position: 'absolute',
          left: '8px',
          bottom: '8px',
          backgroundColor: isActive ? 'var(--accent)' : 'var(--bg-elevated)',
          color: isActive ? '#0b0d14' : 'var(--text-2)',
          fontSize: '8.5px',
          fontWeight: 800,
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-mono)',
          border: '1px solid var(--border-1)',
          transition: 'all var(--transition)',
          zIndex: 2
        }}>
          {slide.originalIndex + 1}
        </div>

        {/* Small glowing check-dot */}
        {isActive && (
          <div style={{
            position: 'absolute',
            right: '8px',
            bottom: '8px',
            width: '5px',
            height: '5px',
            borderRadius: '50%',
            backgroundColor: 'var(--accent)',
            boxShadow: '0 0 6px var(--accent)',
            zIndex: 2
          }} />
        )}
      </div>

      {/* Slide text details */}
      <div style={{ padding: '0 2px' }}>
        <div style={{
          fontSize: '11px',
          fontWeight: isActive ? 700 : 600,
          color: isActive ? 'var(--accent)' : 'var(--text-1)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          transition: 'color var(--transition)'
        }}>
          {String(slide.originalIndex + 1).padStart(2, '0')}: {slide.name}
        </div>
        <div style={{
          fontSize: '9px',
          color: 'var(--text-3)',
          fontFamily: 'var(--font-mono)',
          marginTop: '1px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {slide.folderName}
        </div>
      </div>
    </div>
  );
};

export const Sidebar: React.FC<SidebarProps> = ({
  slides,
  currentSlideIndex,
  onSelectSlide,
  isCollapsed,
  setIsCollapsed,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSlides = slides.map((slide, originalIndex) => ({
    ...slide,
    originalIndex
  })).filter(slide =>
    slide.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    slide.folderName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div
      style={{
        position: 'relative',
        width: isCollapsed ? '0px' : '230px',
        minWidth: isCollapsed ? '0px' : '230px',
        borderRight: isCollapsed ? 'none' : '1px solid var(--border-1)',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        backgroundColor: 'transparent',
        zIndex: 5
      }}
    >
      {/* Collapse Handle button on the right edge */}
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          position: 'absolute',
          right: isCollapsed ? '-24px' : '-12px',
          top: '20px',
          width: '24px',
          height: '24px',
          borderRadius: '50%',
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border-2)',
          color: 'var(--text-2)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          zIndex: 100,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          transition: 'all 0.2s',
        }}
        title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        className="collapse-handle"
      >
        {isCollapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
      </button>

      {/* Sidebar Content (hidden when collapsed) */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '230px', /* Keep fixed width container inside transition wrapper */
        overflow: 'hidden',
        visibility: isCollapsed ? 'hidden' : 'visible',
        opacity: isCollapsed ? 0 : 1,
        transition: 'opacity 0.2s'
      }}>
        {/* Sidebar Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '16px 16px 12px 16px',
          flexShrink: 0
        }}>
          <span style={{
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '1.5px',
            color: 'var(--text-3)',
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}>
            <Layers size={11} style={{ color: 'var(--accent)' }} />
            Slides
          </span>
          <span style={{
            backgroundColor: 'var(--accent-dim)',
            color: 'var(--accent)',
            fontSize: '9px',
            padding: '2px 8px',
            borderRadius: '10px',
            fontWeight: 700,
            fontFamily: 'var(--font-mono)'
          }}>
            {slides.length}
          </span>
        </div>

        {/* Search Bar */}
        {slides.length > 0 && (
          <div style={{
            padding: '0 12px 12px 12px',
            flexShrink: 0,
            position: 'relative'
          }}>
            <input
              type="text"
              placeholder="Search slides..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '7px 10px 7px 30px',
                fontSize: '11px',
                borderRadius: 'var(--radius)',
                backgroundColor: 'var(--bg-elevated)',
                border: '1px solid var(--border-1)',
                color: 'var(--text-1)',
                outline: 'none',
                transition: 'border-color 0.2s'
              }}
              className="search-input"
            />
            <Search size={11} style={{
              position: 'absolute',
              left: '22px',
              top: '9px',
              color: 'var(--text-3)'
            }} />
          </div>
        )}

        {/* Slide List */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 8px 12px 8px'
        }}>
          {slides.length === 0 ? (
            <div style={{
              fontSize: '11px',
              textAlign: 'center',
              color: 'var(--text-3)',
              marginTop: '32px',
              padding: '0 12px',
              lineHeight: 1.6
            }}>
              No presentation loaded
            </div>
          ) : filteredSlides.length === 0 ? (
            <div style={{
              fontSize: '11px',
              textAlign: 'center',
              color: 'var(--text-3)',
              marginTop: '20px',
              padding: '0 12px'
            }}>
              No matching slides
            </div>
          ) : (
            filteredSlides.map((slide) => (
              <SlideCard
                key={slide.originalIndex}
                slide={slide}
                isActive={slide.originalIndex === currentSlideIndex}
                onSelectSlide={onSelectSlide}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
};
