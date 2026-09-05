import React, { useRef, useState, useEffect } from 'react';
import { useProjectStore } from '../../store/useStore';
import { Play, Settings, AlertTriangle, CheckCircle, Monitor, Pause } from 'lucide-react';
import { renderFullEDL, checkWasmCapabilities } from '../../utils/ffmpegRender';
import './PreviewTab.css';

export const PreviewTab: React.FC = () => {
  const { 
    previewResolution,
    previewFrameRate,
    previewCodec,
    validationErrors,
    mediaFiles,
    edlClips,
    audioTracks,
    duckingEnabled,
    duckingDepth,
    setPreviewSettings,
    validateProject,
    isLoading
  } = useProjectStore();
  
  const [showValidation, setShowValidation] = React.useState(false);
  const [isRendering, setIsRendering] = React.useState(false);
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [renderProgress, setRenderProgress] = useState(0);
  const [wasmInfo, setWasmInfo] = useState<{ sharedArrayBuffer: boolean; multiThreaded: boolean } | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  
  useEffect(() => {
    // Check WASM capabilities on mount
    const caps = checkWasmCapabilities();
    setWasmInfo(caps);
    console.log(`WASM Capabilities: SharedArrayBuffer=${caps.sharedArrayBuffer}, Multi-threaded=${caps.multiThreaded}`);
  }, []);

  useEffect(() => {
    // Auto-generate preview when settings change (not on every tab switch)
    if (!videoUrl && !isRendering && edlClips.length > 0) {
      handleRender();
    }
  }, [previewResolution, previewFrameRate, previewCodec]);
  
  useEffect(() => {
    // Cleanup video URL on unmount
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);
  
  const handleValidate = () => {
    const errors = validateProject();
    setShowValidation(true);
    return errors.length === 0;
  };
  
  const handleRender = async () => {
    setRenderError(null);
    setIsRendering(true);
    setRenderProgress(0);
    
    try {
      // Revoke old URL if exists
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      
      const settings = {
        resolution: previewResolution as '720p' | '1080p' | '4K',
        frameRate: previewFrameRate as 24 | 30 | 60,
        codec: previewCodec as 'h264' | 'h265',
        duckingEnabled,
        duckingDepth
      };
      
      const url = await renderFullEDL(edlClips, settings, mediaFiles, audioTracks, (progress) => {
        setRenderProgress(progress);
      });
      
      setVideoUrl(url);
      setRenderProgress(100);
      console.log('Render completed successfully');
    } catch (error: any) {
      console.error('Render failed:', error);
      setRenderError(error.message || 'Render failed. Please check console for details.');
    } finally {
      setIsRendering(false);
    }
  };
  
  const handlePlayPause = () => {
    if (!videoRef.current) return;
    
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    setCurrentTime(videoRef.current.currentTime);
  };
  
  const handleLoadedMetadata = () => {
    if (!videoRef.current) return;
    setDuration(videoRef.current.duration);
    setIsPlaying(true);
  };
  
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (!videoRef.current) return;
    videoRef.current.currentTime = time;
    setCurrentTime(time);
  };
  
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const resolutions = ['720p', '1080p', '4K'] as const;
  const frameRates = [24, 30, 60] as const;
  const codecs = ['h264', 'h265'] as const;
  
  return (
    <div className="preview-tab">
      <div className="tab-header">
        <h1>Preview & Export</h1>
        <p className="tab-description">Review the complete composition and configure export settings</p>
      </div>
      
      {/* WASM Info */}
      {wasmInfo && (
        <div className="wasm-info" style={{ 
          padding: '0.5rem 1rem', 
          background: wasmInfo.multiThreaded ? 'rgba(76, 175, 80, 0.2)' : 'rgba(255, 152, 0, 0.2)',
          borderRadius: '6px',
          marginBottom: '1rem',
          fontSize: '0.85rem'
        }}>
          <strong>WASM:</strong> {wasmInfo.multiThreaded ? 'Multi-threaded (SharedArrayBuffer enabled)' : 'Single-threaded (COOP/COEP not configured)'}
        </div>
      )}
      
      {/* Validation Status */}
      <div className="validation-section">
        <button
          className={`validation-btn ${validationErrors.length === 0 ? 'success' : 'warning'}`}
          onClick={handleValidate}
        >
          {validationErrors.length === 0 ? (
            <>
              <CheckCircle size={20} />
              <span>Project Validated</span>
            </>
          ) : (
            <>
              <AlertTriangle size={20} />
              <span>{validationErrors.length} Issues Found</span>
            </>
          )}
        </button>
        
        {showValidation && validationErrors.length > 0 && (
          <div className="validation-errors">
            {validationErrors.map((error, index) => (
              <div key={index} className="error-item">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Preview Player */}
      <section className="preview-section">
        <div className="section-header">
          <h2>
            <Monitor size={20} />
            Preview Player
          </h2>
          <button 
            className="action-btn primary" 
            onClick={handlePlayPause}
            disabled={!videoUrl || isRendering}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
            {isPlaying ? 'Pause' : 'Play'}
          </button>
        </div>
        
        <div className="preview-player">
          {isRendering ? (
            <div className="preview-loading">
              <div className="spinner"></div>
              <p>Rendering preview... {renderProgress}%</p>
              <div className="progress-bar-container" style={{ 
                width: '200px', 
                height: '8px', 
                background: 'rgba(255,255,255,0.2)',
                borderRadius: '4px',
                marginTop: '0.5rem'
              }}>
                <div className="progress-bar-fill" style={{
                  width: `${renderProgress}%`,
                  height: '100%',
                  background: 'var(--accent)',
                  borderRadius: '4px',
                  transition: 'width 0.2s'
                }}></div>
              </div>
            </div>
          ) : videoUrl ? (
            <div className="preview-content">
              <video
                ref={videoRef}
                src={videoUrl}
                className="preview-video"
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onEnded={() => setIsPlaying(false)}
                style={{
                  maxWidth: '100%',
                  maxHeight: '50vh',
                  background: '#000'
                }}
              />
              <div className="timeline-scrubber">
                <input 
                  type="range" 
                  min="0" 
                  max={duration || 100} 
                  step="0.1"
                  value={currentTime}
                  onChange={handleSeek}
                  className="scrubber-input"
                  style={{ width: '100%' }}
                />
                <div className="time-display">
                  <span>{formatTime(currentTime)}</span>
                  <span>{formatTime(duration)}</span>
                </div>
              </div>
            </div>
          ) : renderError ? (
            <div className="preview-error">
              <AlertTriangle size={48} />
              <p>Preview generation failed</p>
              <p style={{ fontSize: '0.9rem', color: '#f44336' }}>{renderError}</p>
              <button onClick={handleRender}>Retry</button>
            </div>
          ) : (
            <div className="preview-placeholder-wrapper">
              <div className="preview-placeholder">
                <Play size={64} />
                <p>Click "Generate Preview" to render</p>
              </div>
            </div>
          )}
        </div>
      </section>
      
      {/* Export Settings */}
      <section className="settings-section">
        <div className="section-header">
          <h2>
            <Settings size={20} />
            Export Settings
          </h2>
        </div>
        
        <div className="settings-grid">
          <div className="setting-group">
            <label>Resolution</label>
            <select
              value={previewResolution}
              onChange={(e) => setPreviewSettings({ previewResolution: e.target.value as any })}
            >
              {resolutions.map(res => (
                <option key={res} value={res}>{res}</option>
              ))}
            </select>
          </div>
          
          <div className="setting-group">
            <label>Frame Rate</label>
            <select
              value={previewFrameRate}
              onChange={(e) => setPreviewSettings({ previewFrameRate: parseInt(e.target.value) as any })}
            >
              {frameRates.map(fps => (
                <option key={fps} value={fps}>{fps} FPS</option>
              ))}
            </select>
          </div>
          
          <div className="setting-group">
            <label>Codec</label>
            <select
              value={previewCodec}
              onChange={(e) => setPreviewSettings({ previewCodec: e.target.value as any })}
            >
              {codecs.map(codec => (
                <option key={codec} value={codec}>
                  {codec === 'h264' ? 'H.264 (Compatible)' : 'H.265 (Efficient)'}
                </option>
              ))}
            </select>
          </div>
          
          <div className="setting-group">
            <label>Quality</label>
            <select defaultValue="high">
              <option value="low">Low (Smaller file)</option>
              <option value="medium">Medium</option>
              <option value="high">High (Best quality)</option>
            </select>
          </div>
        </div>
        
        <div className="export-info">
          <p><strong>Recommended:</strong> {previewResolution} at {previewFrameRate} FPS with H.264 for social media compatibility</p>
        </div>
      </section>
      
      {/* Filter Graph Info */}
      <section className="resources-section">
        <div className="section-header">
          <h2>Filter Graph Structure</h2>
        </div>
        <div style={{ 
          fontFamily: 'monospace', 
          fontSize: '0.75rem', 
          background: 'rgba(0,0,0,0.3)', 
          padding: '1rem', 
          borderRadius: '6px',
          overflowX: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }}>
          <p style={{ marginBottom: '0.5rem', color: '#81c784' }}>
            Video Chain: [N:v] → scale/pad → zoompan → trim → drawtext → [segN] → xfade chain → output
          </p>
          <p style={{ color: '#64b5f6' }}>
            Audio Chain: Music → sidechaincompress (ducking) → amix with narration → output
          </p>
          <p style={{ marginTop: '0.5rem', fontSize: '0.7rem', color: '#aaa' }}>
            Note: Actual filter_complex logged to console during render
          </p>
        </div>
      </section>
      
      {/* Export Actions */}
      <div className="export-actions">
        <button
          className="action-btn primary large"
          onClick={handleRender}
          disabled={isLoading || edlClips.length === 0}
        >
          {isRendering ? `Rendering ${renderProgress}%...` : 'Generate Preview'}
        </button>
        
        {edlClips.length === 0 && (
          <p className="export-warning" style={{ marginTop: '0.5rem' }}>
            ⚠️ Generate EDL clips before rendering
          </p>
        )}
      </div>
      
      {validationErrors.length > 0 && (
        <p className="export-warning">
          Please resolve validation errors before exporting
        </p>
      )}
    </div>
  );
};
