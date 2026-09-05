import { useEffect, useRef, useState } from 'react';
import { Terminal as TerminalIcon, Copy, Trash2, AlertCircle, Info, AlertTriangle, XCircle } from 'lucide-react';
import './TerminalTab.css';

interface LogEntry {
  id: string;
  timestamp: Date;
  type: 'log' | 'warn' | 'error' | 'info';
  message: string;
  stack?: string;
}

interface SystemInfo {
  url: string;
  viewportWidth: number;
  viewportHeight: number;
  memoryUsage?: number;
  loadTime?: number;
  localStorageUsed: number;
  sessionStorageUsed: number;
}

interface NetworkRequest {
  id: string;
  url: string;
  method: string;
  status?: number;
  timestamp: Date;
  failed?: boolean;
}

export function TerminalTab() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo>({
    url: window.location.href,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    localStorageUsed: 0,
    sessionStorageUsed: 0,
  });
  const [networkRequests, setNetworkRequests] = useState<NetworkRequest[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Capture console methods
  useEffect(() => {
    const originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
      info: console.info,
    };

    const addLog = (type: LogEntry['type'], args: any[]) => {
      const message = args.map(arg => 
        typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
      ).join(' ');

      const entry: LogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date(),
        type,
        message,
        stack: type === 'error' ? new Error().stack : undefined,
      };

      setLogs(prev => [...prev.slice(-499), entry]); // Keep last 500 entries
    };

    console.log = (...args) => {
      addLog('log', args);
      originalConsole.log(...args);
    };

    console.warn = (...args) => {
      addLog('warn', args);
      originalConsole.warn(...args);
    };

    console.error = (...args) => {
      addLog('error', args);
      originalConsole.error(...args);
    };

    console.info = (...args) => {
      addLog('info', args);
      originalConsole.info(...args);
    };

    // Capture global errors
    const handleError = (event: ErrorEvent) => {
      addLog('error', [`${event.message} at ${event.filename}:${event.lineno}:${event.colno}`]);
      if (event.error?.stack) {
        addLog('error', [event.error.stack]);
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      addLog('error', [`Unhandled Promise Rejection: ${event.reason}`]);
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // Capture network requests
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const request: NetworkRequest = {
        id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        url: typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].toString() : (args[0] as Request).url,
        method: args[1]?.method || 'GET',
        timestamp: new Date(),
      };

      setNetworkRequests(prev => [...prev.slice(-99), request]);

      try {
        const response = await originalFetch(...args);
        setNetworkRequests(prev => 
          prev.map(r => r.id === request.id ? { ...r, status: response.status } : r)
        );
        if (!response.ok) {
          addLog('warn', [`Network request failed: ${request.url} (${response.status})`]);
        }
        return response;
      } catch (error) {
        setNetworkRequests(prev => 
          prev.map(r => r.id === request.id ? { ...r, failed: true } : r)
        );
        addLog('error', [`Network request failed: ${request.url} - ${error}`]);
        throw error;
      }
    };

    // Calculate storage usage
    const updateStorageInfo = () => {
      let localStorageUsed = 0;
      let sessionStorageUsed = 0;

      for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
          localStorageUsed += localStorage[key].length + key.length;
        }
      }

      for (let key in sessionStorage) {
        if (sessionStorage.hasOwnProperty(key)) {
          sessionStorageUsed += sessionStorage[key].length + key.length;
        }
      }

      setSystemInfo(prev => ({
        ...prev,
        localStorageUsed: Math.round(localStorageUsed / 1024 * 100) / 100, // KB
        sessionStorageUsed: Math.round(sessionStorageUsed / 1024 * 100) / 100, // KB
      }));
    };

    updateStorageInfo();
    const storageInterval = setInterval(updateStorageInfo, 5000);

    // Update viewport on resize
    const handleResize = () => {
      setSystemInfo(prev => ({
        ...prev,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        url: window.location.href,
      }));
    };

    window.addEventListener('resize', handleResize);

    // Add initial load info
    if (performance.getEntriesByType) {
      const navigationEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
      if (navigationEntries.length > 0) {
        const loadTime = navigationEntries[0].loadEventEnd - navigationEntries[0].startTime;
        setSystemInfo(prev => ({ ...prev, loadTime: Math.round(loadTime) }));
        addLog('info', [`Page loaded in ${Math.round(loadTime)}ms`]);
      }
    }

    // Memory usage (if available)
    const updateMemory = () => {
      if ((window.performance as any).memory) {
        const memory = (window.performance as any).memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1048576);
        setSystemInfo(prev => ({ ...prev, memoryUsage: usedMB }));
      }
    };

    updateMemory();
    const memoryInterval = setInterval(updateMemory, 3000);

    addLog('info', ['Terminal Tab initialized. Capturing console logs and system telemetry.']);

    return () => {
      console.log = originalConsole.log;
      console.warn = originalConsole.warn;
      console.error = originalConsole.error;
      console.info = originalConsole.info;
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.fetch = originalFetch;
      window.removeEventListener('resize', handleResize);
      clearInterval(storageInterval);
      clearInterval(memoryInterval);
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString('en-US', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  const copyAllLogs = () => {
    const header = `
================================================================================
VIGNETTE DEBUG REPORT
Generated: ${new Date().toISOString()}
================================================================================

SYSTEM INFORMATION:
-------------------
URL: ${systemInfo.url}
Viewport: ${systemInfo.viewportWidth} x ${systemInfo.viewportHeight}px
Load Time: ${systemInfo.loadTime || 'N/A'}ms
Memory Usage: ${systemInfo.memoryUsage ? `${systemInfo.memoryUsage} MB` : 'N/A'}
LocalStorage: ${systemInfo.localStorageUsed} KB
SessionStorage: ${systemInfo.sessionStorageUsed} KB

FAILED NETWORK REQUESTS:
------------------------
${networkRequests.filter(r => r.failed || (r.status && r.status >= 400)).map(r => 
  `[${r.timestamp.toISOString()}] ${r.method} ${r.url} - ${r.failed ? 'FAILED' : `Status ${r.status}`}`
).join('\n') || 'No failed requests'}

CONSOLE LOGS:
-------------
${logs.map(log => `[${formatTimestamp(log.timestamp)}] [${log.type.toUpperCase()}] ${log.message}${log.stack ? `\n${log.stack}` : ''}`).join('\n\n')}

================================================================================
END OF REPORT
================================================================================
`.trim();

    navigator.clipboard.writeText(header).then(() => {
      addSystemLog('Debug report copied to clipboard');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  };

  const clearLogs = () => {
    setLogs([]);
    addSystemLog('Logs cleared');
  };

  const addSystemLog = (message: string) => {
    const entry: LogEntry = {
      id: `sys_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type: 'info',
      message: `[SYSTEM] ${message}`,
    };
    setLogs(prev => [...prev, entry]);
  };

  const getLogIcon = (type: LogEntry['type']) => {
    switch (type) {
      case 'error': return <XCircle size={16} />;
      case 'warn': return <AlertTriangle size={16} />;
      case 'info': return <Info size={16} />;
      default: return <TerminalIcon size={16} />;
    }
  };

  const getLogClass = (type: LogEntry['type']) => {
    return `log-entry log-${type}`;
  };

  const failedRequestsCount = networkRequests.filter(r => r.failed || (r.status && r.status >= 400)).length;
  const errorCount = logs.filter(l => l.type === 'error').length;
  const warnCount = logs.filter(l => l.type === 'warn').length;

  return (
    <div className="terminal-tab">
      <div className="terminal-header">
        <div className="terminal-title">
          <TerminalIcon size={20} />
          <h2>Debug Terminal</h2>
        </div>
        
        <div className="terminal-stats">
          <span className={`stat-badge ${errorCount > 0 ? 'badge-error' : ''}`}>
            <XCircle size={14} />
            {errorCount} Errors
          </span>
          <span className={`stat-badge ${warnCount > 0 ? 'badge-warn' : ''}`}>
            <AlertTriangle size={14} />
            {warnCount} Warnings
          </span>
          <span className={`stat-badge ${failedRequestsCount > 0 ? 'badge-error' : ''}`}>
            <AlertCircle size={14} />
            {failedRequestsCount} Failed Requests
          </span>
          <span className="stat-badge">
            {logs.length} Total Logs
          </span>
        </div>

        <div className="terminal-controls">
          <label className="auto-scroll-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            Auto-scroll
          </label>
          <button className="btn-copy" onClick={copyAllLogs} title="Copy all logs">
            <Copy size={16} />
            Copy All
          </button>
          <button className="btn-clear" onClick={clearLogs} title="Clear logs">
            <Trash2 size={16} />
            Clear
          </button>
        </div>
      </div>

      <div className="terminal-body">
        <div className="system-info-panel">
          <h3>System Information</h3>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">URL:</span>
              <span className="info-value">{systemInfo.url}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Viewport:</span>
              <span className="info-value">{systemInfo.viewportWidth} × {systemInfo.viewportHeight}px</span>
            </div>
            {systemInfo.loadTime && (
              <div className="info-item">
                <span className="info-label">Load Time:</span>
                <span className="info-value">{systemInfo.loadTime}ms</span>
              </div>
            )}
            {systemInfo.memoryUsage && (
              <div className="info-item">
                <span className="info-label">Memory:</span>
                <span className="info-value">{systemInfo.memoryUsage} MB</span>
              </div>
            )}
            <div className="info-item">
              <span className="info-label">LocalStorage:</span>
              <span className="info-value">{systemInfo.localStorageUsed} KB</span>
            </div>
            <div className="info-item">
              <span className="info-label">SessionStorage:</span>
              <span className="info-value">{systemInfo.sessionStorageUsed} KB</span>
            </div>
          </div>
        </div>

        <div className="terminal-content" ref={terminalRef}>
          {logs.length === 0 ? (
            <div className="no-logs">
              <TerminalIcon size={48} />
              <p>No logs captured yet. Interact with the app to see debug output.</p>
            </div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className={getLogClass(log.type)}>
                <div className="log-timestamp">
                  {getLogIcon(log.type)}
                  {formatTimestamp(log.timestamp)}
                </div>
                <div className="log-message">
                  <pre>{log.message}</pre>
                  {log.stack && (
                    <details className="log-stack">
                      <summary>Stack Trace</summary>
                      <pre>{log.stack}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))
          )}
          <div ref={logsEndRef} />
        </div>

        {networkRequests.length > 0 && (
          <div className="network-panel">
            <h3>Recent Network Activity</h3>
            <div className="network-list">
              {networkRequests.slice(-20).reverse().map((req) => (
                <div 
                  key={req.id} 
                  className={`network-item ${req.failed || (req.status && req.status >= 400) ? 'failed' : ''}`}
                >
                  <span className="network-method">{req.method}</span>
                  <span className="network-url" title={req.url}>{req.url}</span>
                  <span className="network-status">
                    {req.failed ? 'FAILED' : req.status ? `${req.status}` : 'Pending'}
                  </span>
                  <span className="network-time">{formatTimestamp(req.timestamp)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
