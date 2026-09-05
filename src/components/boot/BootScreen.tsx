/**
 * Boot Screen - AI Library Initialization Wizard
 * 
 * First launch: Folder picker → Model list → Download All with progress
 * Subsequent launches: Three-point checklist (folder/permission/models)
 */

import React, { useState, useEffect } from 'react';
import { useProjectStore } from '../../store/useStore';
import {
  pickLibraryFolder,
  restoreLibrary,
  unlockLibrary,
  type LibraryStatus,
} from '../../ai/libraryManager';
import { downloadModel, cancelDownload, type DownloadProgress } from '../../ai/downloadManager';
import { MODEL_MANIFEST, MANIFEST_VERSION, formatBytes } from '../../ai/modelManifest';
import { CheckCircle, AlertTriangle, Download, FolderOpen, X, Play, Pause } from 'lucide-react';
import './BootScreen.css';

type BootState = 'checking' | 'first-launch' | 'downloading' | 'unlocking' | 'ready' | 'skipped';

interface DownloadState {
  modelId: string;
  progress: number;
  status: 'pending' | 'downloading' | 'verifying' | 'complete' | 'error';
  bytesPerSec: number;
  eta: number;
  error?: string;
}

export const BootScreen: React.FC<{ onComplete: () => void }> = ({ onComplete }) => {
  const [bootState, setBootState] = useState<BootState>('checking');
  const [libraryStatus, setLibraryStatus] = useState<LibraryStatus | null>(null);
  const [downloadStates, setDownloadStates] = useState<Map<string, DownloadState>>(new Map());
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  
  const { aiStatus, setAIStatus } = useProjectStore();

  useEffect(() => {
    checkLibrary();
  }, []);

  const checkLibrary = async () => {
    try {
      const result = await restoreLibrary();
      
      if (!result || !result.libraryHandle) {
        // No library found - first launch
        setLibraryStatus(result?.status || {
          folderFound: false,
          permissionGranted: false,
          modelsVerified: false,
          manifestVersionMatch: false,
          installedModels: [],
          missingModels: MODEL_MANIFEST.map((m) => m.id),
        });
        setBootState('first-launch');
        return;
      }
      
      setLibraryStatus(result.status);
      
      // Check if everything is ready
      if (
        result.status.folderFound &&
        result.status.permissionGranted &&
        result.status.modelsVerified &&
        result.status.manifestVersionMatch
      ) {
        setBootState('ready');
        setTimeout(onComplete, 500);
      } else if (!result.status.permissionGranted) {
        setBootState('unlocking');
      } else {
        // Missing models or version mismatch
        setBootState('downloading');
      }
    } catch (error) {
      console.error('Failed to check library:', error);
      setBootState('first-launch');
    }
  };

  const handlePickFolder = async () => {
    try {
      const handle = await pickLibraryFolder();
      
      if (handle) {
        // Persist the library
        const { persistLibrary } = await import('../../ai/libraryManager');
        await persistLibrary(handle, MANIFEST_VERSION);
        
        // Re-check
        await checkLibrary();
      }
    } catch (error: any) {
      console.error('Failed to pick folder:', error);
    }
  };

  const handleUnlock = async () => {
    const granted = await unlockLibrary();
    
    if (granted) {
      await checkLibrary();
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    try {
      const { getModelDirectory } = await import('../../ai/libraryManager');
      const libEntry = await import('../../utils/idb').then((idb) => idb.getLibraryDirectory(modelId));
      
      if (!libEntry) {
        throw new Error(`No directory found for model ${modelId}`);
      }
      
      setDownloadStates((prev) => {
        const next = new Map(prev);
        next.set(modelId, {
          modelId,
          progress: 0,
          status: 'downloading',
          bytesPerSec: 0,
          eta: 0,
        });
        return next;
      });
      
      await downloadModel(
        modelId,
        libEntry.directoryHandle,
        (progress: DownloadProgress) => {
          setDownloadStates((prev) => {
            const next = new Map(prev);
            const existing = next.get(modelId);
            next.set(modelId, {
              modelId,
              progress: progress.percent,
              status: progress.status,
              bytesPerSec: progress.bytesPerSec,
              eta: progress.eta,
              error: progress.error,
            });
            return next;
          });
        }
      );
      
      // Mark as complete
      setDownloadStates((prev) => {
        const next = new Map(prev);
        next.set(modelId, {
          modelId,
          progress: 100,
          status: 'complete',
          bytesPerSec: 0,
          eta: 0,
        });
        return next;
      });
      
      // Check if all models are done
      checkAllDownloadsComplete();
    } catch (error: any) {
      console.error(`Failed to download ${modelId}:`, error);
      
      setDownloadStates((prev) => {
        const next = new Map(prev);
        next.set(modelId, {
          modelId,
          progress: 0,
          status: 'error',
          bytesPerSec: 0,
          eta: 0,
          error: error.message,
        });
        return next;
      });
    }
  };

  const handleDownloadAll = async () => {
    setIsDownloadingAll(true);
    
    for (const model of MODEL_MANIFEST) {
      if (!libraryStatus?.installedModels.includes(model.id)) {
        await handleDownloadModel(model.id);
      }
    }
    
    setIsDownloadingAll(false);
    checkAllDownloadsComplete();
  };

  const handleCancelDownload = (modelId: string) => {
    cancelDownload(modelId);
    
    setDownloadStates((prev) => {
      const next = new Map(prev);
      const existing = next.get(modelId);
      if (existing && existing.status === 'downloading') {
        next.set(modelId, {
          ...existing,
          status: 'pending',
          progress: 0,
        });
      }
      return next;
    });
  };

  const checkAllDownloadsComplete = async () => {
    // Re-verify library status
    const result = await restoreLibrary();
    if (result?.status.modelsVerified && result.status.manifestVersionMatch) {
      setBootState('ready');
      setTimeout(onComplete, 1000);
    }
  };

  const handleSkip = () => {
    setBootState('skipped');
    setAIStatus('skipped');
    setTimeout(onComplete, 100);
  };

  const formatSpeed = (bytesPerSec: number): string => {
    if (bytesPerSec < 1024) return `${Math.round(bytesPerSec)} B/s`;
    if (bytesPerSec < 1024 * 1024) return `${Math.round(bytesPerSec / 1024)} KB/s`;
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  };

  const formatETA = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    return `${mins}m ${Math.round(seconds % 60)}s`;
  };

  const getStatusIcon = (status: DownloadState['status']) => {
    switch (status) {
      case 'complete':
        return <CheckCircle size={20} className="status-complete" />;
      case 'error':
        return <AlertTriangle size={20} className="status-error" />;
      case 'verifying':
        return <span className="status-verifying">✓</span>;
      default:
        return null;
    }
  };

  // Rendering
  if (bootState === 'checking') {
    return (
      <div className="boot-screen">
        <div className="boot-content">
          <div className="spinner-large"></div>
          <p>Checking AI library...</p>
        </div>
      </div>
    );
  }

  if (bootState === 'ready') {
    return (
      <div className="boot-screen">
        <div className="boot-content">
          <CheckCircle size={64} className="success-icon" />
          <h1>All systems ready</h1>
          <p>Entering Vignette...</p>
        </div>
      </div>
    );
  }

  if (bootState === 'skipped') {
    return null;
  }

  if (bootState === 'first-launch') {
    return (
      <div className="boot-screen">
        <div className="boot-content wizard">
          <h1>Welcome to Vignette</h1>
          <p className="wizard-intro">
            Vignette uses local AI models for all inference. 
            Choose a folder to store your AI library (~320MB total).
          </p>
          
          <div className="model-list">
            {MODEL_MANIFEST.map((model) => (
              <div key={model.id} className="model-item">
                <div className="model-info">
                  <h3>{model.displayName}</h3>
                  <p>{model.description}</p>
                  <span className="model-size">
                    Size: {formatBytes(model.files.reduce((s, f) => s + f.sizeBytes, 0))}
                  </span>
                </div>
              </div>
            ))}
          </div>
          
          <div className="total-size">
            Total: {formatBytes(MODEL_MANIFEST.reduce((s, m) => s + m.files.reduce((sf, f) => sf + f.sizeBytes, 0), 0))}
          </div>
          
          <div className="wizard-actions">
            <button className="action-btn secondary" onClick={handleSkip}>
              Skip for now
            </button>
            <button className="action-btn primary" onClick={handlePickFolder}>
              <FolderOpen size={20} />
              Choose Folder & Download All
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bootState === 'unlocking') {
    return (
      <div className="boot-screen">
        <div className="boot-content">
          <AlertTriangle size={48} className="warning-icon" />
          <h2>Permission Required</h2>
          <p>The AI library folder needs permission to continue.</p>
          
          <div className="unlock-actions">
            <button className="action-btn secondary" onClick={handleSkip}>
              Skip for now
            </button>
            <button className="action-btn primary" onClick={handleUnlock}>
              Unlock Library
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (bootState === 'downloading') {
    return (
      <div className="boot-screen">
        <div className="boot-content downloading">
          <h2>AI Library Setup</h2>
          <p>Download required models to continue</p>
          
          <div className="download-list">
            {MODEL_MANIFEST.map((model) => {
              const isInstalled = libraryStatus?.installedModels.includes(model.id);
              const state = downloadStates.get(model.id);
              
              return (
                <div key={model.id} className={`download-item ${isInstalled ? 'installed' : ''}`}>
                  <div className="download-info">
                    <h4>{model.displayName}</h4>
                    <span className="download-size">
                      {formatBytes(model.files.reduce((s, f) => s + f.sizeBytes, 0))}
                    </span>
                  </div>
                  
                  {isInstalled ? (
                    <CheckCircle size={24} className="installed-icon" />
                  ) : state ? (
                    <div className="download-progress">
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${state.progress}%` }}
                        />
                      </div>
                      <div className="progress-details">
                        <span>{state.progress}%</span>
                        {state.bytesPerSec > 0 && (
                          <>
                            <span>{formatSpeed(state.bytesPerSec)}</span>
                            <span>ETA: {formatETA(state.eta)}</span>
                          </>
                        )}
                        {state.error && <span className="error-text">{state.error}</span>}
                      </div>
                      <div className="progress-status">
                        {getStatusIcon(state.status)}
                        {state.status === 'downloading' && (
                          <button
                            className="cancel-btn"
                            onClick={() => handleCancelDownload(model.id)}
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <button
                      className="download-btn"
                      onClick={() => handleDownloadModel(model.id)}
                    >
                      <Download size={18} />
                      Download
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          
          <div className="download-actions">
            <button className="action-btn secondary" onClick={handleSkip}>
              Skip for now
            </button>
            <button
              className="action-btn primary"
              onClick={handleDownloadAll}
              disabled={isDownloadingAll}
            >
              {isDownloadingAll ? (
                <>
                  <Pause size={20} />
                  Downloading...
                </>
              ) : (
                <>
                  <Download size={20} />
                  Download All
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
};
