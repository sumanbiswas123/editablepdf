import React, { useState } from 'react';
import { Sparkles, X, Clipboard, Check } from 'lucide-react';

interface ConfirmModalProps {
  items: string[];
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  items,
  onConfirm,
  onCancel,
}) => {
  const [copied, setCopied] = useState(false);
  const copiableText = items.join('\n');

  const handleCopy = () => {
    navigator.clipboard.writeText(copiableText);
    setCopied(true);
    setTimeout(() => {
      setCopied(false);
    }, 2000);
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        backgroundColor: 'rgba(5, 7, 12, 0.8)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 999999,
        animation: 'fadeIn 0.25s ease',
        padding: '20px'
      }}
    >
      <div
        className="glass-panel"
        style={{
          backgroundColor: 'var(--bg-base)',
          border: '1px solid var(--border-accent)',
          borderRadius: 'var(--radius-xl)',
          padding: '24px',
          width: '100%',
          maxWidth: '480px',
          boxShadow: 'var(--shadow-main), 0 0 30px rgba(var(--accent-rgb), 0.1)',
          animation: 'slideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{
            margin: 0,
            color: 'var(--accent)',
            fontSize: '15px',
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            <Sparkles size={16} />
            Scan Results: Slide Automation
          </h3>
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={15} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: '11.5px', color: 'var(--text-2)', lineHeight: '1.5' }}>
          The automation scanned this slide and detected the following states to capture. Review the selectors/triggers below:
        </p>

        <div style={{ position: 'relative', marginTop: '6px' }}>
          <textarea
            readOnly
            value={copiableText}
            style={{
              width: '100%',
              height: '160px',
              backgroundColor: 'var(--bg-deep)',
              border: '1px solid var(--border-1)',
              borderRadius: 'var(--radius)',
              padding: '12px',
              color: 'var(--blue)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              resize: 'none',
              outline: 'none',
              boxSizing: 'border-box',
              lineHeight: '1.4'
            }}
          />
          <button
            onClick={handleCopy}
            style={{
              position: 'absolute',
              right: '10px',
              bottom: '14px',
              backgroundColor: 'var(--bg-elevated)',
              border: '1px solid var(--border-2)',
              color: copied ? 'var(--success)' : 'var(--text-2)',
              padding: '4px 10px',
              borderRadius: 'var(--radius-sm)',
              fontSize: '9.5px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              transition: 'all 0.2s ease',
              boxShadow: '0 2px 6px rgba(0,0,0,0.1)'
            }}
          >
            {copied ? (
              <>
                <Check size={10} />
                Copied!
              </>
            ) : (
              <>
                <Clipboard size={10} />
                Copy List
              </>
            )}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
          <button
            onClick={onCancel}
            style={{
              backgroundColor: 'transparent',
              border: '1px solid var(--border-2)',
              color: 'var(--text-2)',
              padding: '8px 16px',
              borderRadius: 'var(--radius)',
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
            onClick={onConfirm}
            style={{
              background: 'linear-gradient(135deg, var(--accent), var(--blue))',
              border: 'none',
              color: '#0b0d14',
              padding: '8px 18px',
              borderRadius: 'var(--radius)',
              fontSize: '11px',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 242, 254, 0.2)',
              transition: 'all 0.2s'
            }}
            className="action-btn"
          >
            Proceed
          </button>
        </div>
      </div>
    </div>
  );
};
