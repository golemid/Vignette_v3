import React, { useRef, useState } from 'react';
import { useProjectStore } from '../../store/useStore';
import { Upload, X, Image as ImageIcon, Grid3X3, Database } from 'lucide-react';
import { injectMockData } from '../../utils/mockData';
import './CatalogTab.css';

export const CatalogTab: React.FC = () => {
  const { 
    mediaFiles, 
    aspectRatio, 
    addMediaFiles, 
    removeMediaFile, 
    setAspectRatio,
    generateGroups,
    setCurrentTab,
    isLoading 
  } = useProjectStore();
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      await addMediaFiles(Array.from(files));
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };
  
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };
  
  const handleDragLeave = () => {
    setIsDragging(false);
  };
  
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      await addMediaFiles(files);
    }
  };
  
  const handleProceedToGroups = async () => {
    if (mediaFiles.filter(f => f.type === 'image').length > 0) {
      await generateGroups();
      setCurrentTab('groups');
    }
  };
  
  const handleLoadMockData = () => {
    injectMockData();
  };
  
  const images = mediaFiles.filter(f => f.type === 'image');
  const audios = mediaFiles.filter(f => f.type === 'audio');
  
  return (
    <div className="catalog-tab">
      <div className="tab-header">
        <h1>Catalog</h1>
        <p className="tab-description">Import and prepare raw media assets for your project</p>
      </div>
      
      {/* Debug: Load Mock Data Button */}
      <div className="debug-controls" style={{ marginBottom: '1rem', padding: '0.5rem', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '4px', border: '1px dashed rgba(59, 130, 246, 0.3)' }}>
        <button
          onClick={handleLoadMockData}
          disabled={isLoading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0.5rem 1rem',
            background: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.7 : 1,
          }}
        >
          <Database size={16} />
          Load Mock Data (Debug)
        </button>
        <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem', opacity: 0.8 }}>
          Injects 12 test images and 3 groups for UI testing
        </span>
      </div>
      
      {/* Aspect Ratio Toggle */}
      <div className="aspect-ratio-control">
        <label>Project Aspect Ratio:</label>
        <div className="ratio-buttons">
          <button
            className={aspectRatio === '9:16' ? 'active' : ''}
            onClick={() => setAspectRatio('9:16')}
          >
            9:16 (Vertical)
          </button>
          <button
            className={aspectRatio === '16:9' ? 'active' : ''}
            onClick={() => setAspectRatio('16:9')}
          >
            16:9 (Horizontal)
          </button>
        </div>
      </div>
      
      {/* Upload Area */}
      <div
        className={`upload-area ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,audio/*"
          onChange={handleFileSelect}
          style={{ display: 'none' }}
        />
        <Upload size={48} />
        <h3>Drag & Drop Files Here</h3>
        <p>or click to browse</p>
        <p className="supported-formats">
          Supported: JPEG, PNG, WebP (images) / MP3, WAV, M4A (audio)
        </p>
      </div>
      
      {/* Media Grid */}
      {mediaFiles.length > 0 && (
        <div className="media-sections">
          {/* Images Section */}
          {images.length > 0 && (
            <section className="media-section">
              <div className="section-header">
                <h2>
                  <ImageIcon size={20} />
                  Images ({images.length})
                </h2>
              </div>
              <div className="media-grid">
                {images.map(file => (
                  <div key={file.id} className="media-card">
                    <div className="media-preview">
                      {file.proxyUrl ? (
                        <img src={file.proxyUrl} alt={file.name} />
                      ) : (
                        <div className="loading-proxy">Generating proxy...</div>
                      )}
                    </div>
                    <div className="media-info">
                      <span className="media-name" title={file.name}>
                        {file.name}
                      </span>
                      {file.width && file.height && (
                        <span className="media-dimensions">
                          {file.width} × {file.height}
                        </span>
                      )}
                    </div>
                    <button
                      className="remove-btn"
                      onClick={() => removeMediaFile(file.id)}
                      title="Remove from catalog"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
          
          {/* Audio Section */}
          {audios.length > 0 && (
            <section className="media-section">
              <div className="section-header">
                <h2>Audio Files ({audios.length})</h2>
              </div>
              <div className="media-list">
                {audios.map(file => (
                  <div key={file.id} className="media-list-item">
                    <div className="media-icon">
                      <Grid3X3 size={24} />
                    </div>
                    <div className="media-info">
                      <span className="media-name">{file.name}</span>
                      <span className="media-type">Audio</span>
                    </div>
                    <button
                      className="remove-btn"
                      onClick={() => removeMediaFile(file.id)}
                    >
                      <X size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
      
      {/* Action Buttons */}
      <div className="tab-actions">
        <button
          className="proceed-btn"
          onClick={handleProceedToGroups}
          disabled={images.length === 0 || isLoading}
        >
          {isLoading ? 'Processing...' : `Proceed to Groups (${images.length} images)`}
        </button>
      </div>
      
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner"></div>
          <p>Generating proxies and organizing media...</p>
        </div>
      )}
    </div>
  );
};
