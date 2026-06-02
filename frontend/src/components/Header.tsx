import { FolderOpen, Sun, Moon, RefreshCw, Sliders, Cpu, Sparkles } from 'lucide-react';
import { StartWSClient, StopWSClient, SelectDirectory } from '../../wailsjs/go/main/App';
import React, { useState } from 'react';

interface HeaderProps {
  rootDirectory: string;
  onDirectoryLoaded: (dir: string) => Promise<void>;
  sleepMs: number;
  onSleepMsChange: (val: number) => void;
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  onOpenStudio?: () => void;
}


export const Header: React.FC<HeaderProps> = ({
  rootDirectory,
  onDirectoryLoaded,
  sleepMs,
  onSleepMsChange,
  theme,
  toggleTheme,
  onOpenStudio
}) => {
  const [isMac] = useState<boolean>(() => typeof navigator !== 'undefined' && /Mac|Darwin/i.test(navigator.platform));
  const [wsRunning, setWsRunning] = useState(false);
  const [macMode, setMacMode] = useState<string>(() => { try{ return localStorage.getItem('macDefaultMode') || 'builder' }catch(e){ return 'builder' } });
  const [saveDefault, setSaveDefault] = useState<boolean>(() => { try{ return !!localStorage.getItem('macDefaultMode') }catch(e){ return false } });

  const handleStartWS = async () => {
    try {
      // create a room code from server
      const proto = location.protocol === 'https:' ? 'https' : 'http';
      const res = await fetch(proto + '://' + location.hostname + ':8081/create-room');
      const j = await res.json();
      const room = j.room;
      const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.hostname + ':8081/ws';
      await StartWSClient(wsUrl, room, macMode);
      setWsRunning(true);
      if (saveDefault) localStorage.setItem('macDefaultMode', macMode);
    } catch (err) {
      console.error('Failed to start WS client:', err);
      alert('Failed to start WS client. See console for details.');
    }
  };

  const handleStopWS = async () => {
    try {
      await StopWSClient();
      setWsRunning(false);
    } catch (err) {
      console.error('Failed to stop WS client:', err);
    }
  };
  const handleOpenProject = async () => {
    try {
      const dir = await SelectDirectory();
      if (dir) {
        await onDirectoryLoaded(dir);
      }
    } catch (err) {
      console.error('Directory selection failed:', err);
    }
  };

  const handleRefreshProject = async () => {
    if (rootDirectory) {
      await onDirectoryLoaded(rootDirectory);
    }
  };

  return (
    <header className="header glass-panel" style={{
      height: '52px',
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
      padding: '0 16px',
      borderBottom: '1px solid var(--border-1)',
      zIndex: 10,
      flexShrink: 0,
      backgroundColor: 'transparent'
    }}>
      {/* Brand logo & title */}
      <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        <div className="brand-logo" style={{
          width: '26px',
          height: '26px',
          background: 'linear-gradient(135deg, var(--accent), var(--blue))',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 800,
          fontSize: '11px',
          color: 'var(--bg-deep)',
          letterSpacing: '-0.3px',
          boxShadow: '0 2px 8px rgba(var(--accent-rgb), 0.2)'
        }}>
          P
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span className="brand-title" style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '-0.2px', color: 'var(--text-1)' }}>
            NoCodeX ePDF Studio
          </span>
          <span style={{ fontSize: '8px', color: 'var(--text-3)', fontWeight: 600 }}>v2.0.0 (React TS)</span>
        </div>
      </div>

      {/* Integrated Address Bar (Browser/IDE style URL bar) */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        flex: 1,
        height: '32px',
        backgroundColor: 'var(--bg-raised)',
        border: '1px solid var(--border-1)',
        borderRadius: '8px',
        padding: '2px 4px 2px 8px',
        gap: '8px',
        minWidth: 0,
        transition: 'border-color 0.2s, box-shadow 0.2s'
      }} className="address-bar-wrapper">
        
        {/* Open Project CTA Inside Address Bar */}
        <button
          onClick={handleOpenProject}
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-2)',
            color: 'var(--text-2)',
            padding: '4px 10px',
            borderRadius: '6px',
            fontWeight: 700,
            fontSize: '10.5px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
            flexShrink: 0,
            transition: 'all var(--transition)'
          }}
          className="action-btn"
        >
          <FolderOpen size={11} style={{ color: 'var(--accent)' }} />
          <span>Open</span>
        </button>

        {/* Directory path readout */}
        <div style={{
          fontSize: '10.5px',
          color: rootDirectory ? 'var(--text-2)' : 'var(--text-3)',
          fontFamily: rootDirectory ? 'var(--font-mono)' : 'inherit',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          flex: 1,
          minWidth: 0
        }}>
          {rootDirectory ? (
            <span>{rootDirectory}</span>
          ) : (
            <span>No campaign workspace loaded. Click Open to begin.</span>
          )}
        </div>

        {/* Rescan button integrated on the far-right inside the address bar */}
        {rootDirectory && (
          <button
            onClick={handleRefreshProject}
            title="Rescan directory files"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-3)',
              width: '24px',
              height: '24px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all var(--transition)'
            }}
            className="refresh-btn-integrated"
          >
            <RefreshCw size={11} />
          </button>
        )}
      </div>

      {/* Parameter Control Panel (Settle Time Slider) */}
      <div className="settle-slider" style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        backgroundColor: 'var(--bg-raised)',
        padding: '5px 12px',
        borderRadius: '8px',
        border: '1px solid var(--border-1)',
        height: '32px',
        flexShrink: 0
      }}>
        <Sliders size={11} style={{ color: 'var(--text-3)' }} />
        <label style={{ fontSize: '10px', color: 'var(--text-2)', fontWeight: 700, whiteSpace: 'nowrap' }}>
          Settle: <span style={{ color: 'var(--accent)', fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{sleepMs}ms</span>
        </label>
        <input
          type="range"
          min="300"
          max="3000"
          step="100"
          value={sleepMs}
          onChange={(e) => onSleepMsChange(parseInt(e.target.value, 10))}
          style={{
            cursor: 'pointer',
            height: '3px',
            width: '70px',
            accentColor: 'var(--accent)',
            backgroundColor: 'var(--border-2)',
            borderRadius: '2px',
            outline: 'none'
          }}
        />
      </div>

      {/* Studio Mode Button */}
      {isMac && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <select value={macMode} onChange={(e) => setMacMode(e.target.value)} style={{ height: '32px', borderRadius: '8px' }}>
            <option value="builder">Builder</option>
            <option value="capture">Capture</option>
          </select>
          <label style={{ fontSize: '11px' }}>
            <input type="checkbox" checked={saveDefault} onChange={(e) => { setSaveDefault(e.target.checked); if(!e.target.checked) localStorage.removeItem('macDefaultMode'); }} /> Save
          </label>
          {!wsRunning ? (
            <button onClick={handleStartWS} style={{ height: '32px', padding: '0 10px', borderRadius: '8px' }}>Start WS</button>
          ) : (
            <button onClick={handleStopWS} style={{ height: '32px', padding: '0 10px', borderRadius: '8px' }}>Stop WS</button>
          )}
        </div>
      )}
      <button
        onClick={onOpenStudio}
        style={{
          background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.15), rgba(139, 92, 246, 0.15))',
          border: '1px solid var(--border-accent)',
          color: 'var(--accent)',
          height: '32px',
          padding: '0 12px',
          borderRadius: '8px',
          fontSize: '11px',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          transition: 'all var(--transition)'
        }}
        className="action-btn"
        title="Open NoCodeX ePDF Studio"
      >
        <Sparkles size={11} />
        Studio
      </button>

      {/* Theme Toggle Button */}

      <button
        onClick={toggleTheme}
        style={{
          background: 'var(--bg-raised)',
          border: '1px solid var(--border-1)',
          color: 'var(--text-2)',
          width: '32px',
          height: '32px',
          borderRadius: '8px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all var(--transition)',
          flexShrink: 0
        }}
        className="action-btn"
        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </button>
    </header>
  );
};
export default Header;
