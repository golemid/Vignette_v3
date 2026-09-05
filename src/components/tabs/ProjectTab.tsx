import React from 'react';
import { useProjectStore } from '../../store/useStore';
import { Settings, Save, FolderOpen, Keyboard, LayoutTemplate, Download as DownloadIcon, Upload as UploadIcon } from 'lucide-react';
import './ProjectTab.css';

export const ProjectTab: React.FC = () => {
  const { 
    executionMode,
    projectName,
    projectHistory,
    autoSaveEnabled,
    setExecutionMode,
    setProjectName,
    saveProject,
    setCurrentTab
  } = useProjectStore();
  
  const handleSave = () => {
    saveProject();
  };
  
  const handleLoad = () => {
    // In a real app, this would open a file picker
    console.log('Load project');
  };
  
  return (
    <div className="project-tab">
      <div className="tab-header">
        <h1>Project Settings</h1>
        <p className="tab-description">Manage project files, settings, and system configuration</p>
      </div>
      
      {/* Project Info */}
      <section className="project-section">
        <div className="section-header">
          <h2>Project Information</h2>
        </div>
        
        <div className="form-group">
          <label>Project Name</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Enter project name"
          />
        </div>
        
        <div className="project-stats">
          <div className="stat-item">
            <span className="stat-label">Created</span>
            <span className="stat-value">{new Date().toLocaleDateString()}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Last Saved</span>
            <span className="stat-value">{projectHistory.length > 0 ? projectHistory[projectHistory.length - 1] : 'Never'}</span>
          </div>
        </div>
      </section>
      
      {/* Execution Mode */}
      <section className="project-section">
        <div className="section-header">
          <h2>
            <Settings size={20} />
            Execution Mode
          </h2>
        </div>
        
        <div className="mode-toggle">
          <button
            className={`mode-btn ${executionMode === 'step-by-step' ? 'active' : ''}`}
            onClick={() => setExecutionMode('step-by-step')}
          >
            <div className="mode-icon">🎯</div>
            <h3>Step-by-Step</h3>
            <p>Review and approve each AI-generated step before proceeding</p>
          </button>
          
          <button
            className={`mode-btn ${executionMode === 'auto-pilot' ? 'active' : ''}`}
            onClick={() => setExecutionMode('auto-pilot')}
          >
            <div className="mode-icon">🚀</div>
            <h3>Auto-Pilot</h3>
            <p>Let AI handle the entire workflow with minimal intervention</p>
          </button>
        </div>
      </section>
      
      {/* File Operations */}
      <section className="project-section">
        <div className="section-header">
          <h2>File Operations</h2>
        </div>
        
        <div className="file-actions">
          <button className="action-btn primary" onClick={handleSave}>
            <Save size={18} />
            Save Project
          </button>
          
          <button className="action-btn secondary" onClick={handleLoad}>
            <FolderOpen size={18} />
            Load Project
          </button>
          
          <button className="action-btn">
            <DownloadIcon size={18} />
            Export Preset
          </button>
          
          <button className="action-btn">
            <UploadIcon size={18} />
            Import Preset
          </button>
        </div>
      </section>
      
      {/* Project History */}
      {projectHistory.length > 0 && (
        <section className="project-section">
          <div className="section-header">
            <h2>Version History</h2>
          </div>
          
          <div className="history-list">
            {projectHistory.slice(-5).reverse().map((entry, index) => (
              <div key={index} className="history-item">
                <span>{entry}</span>
                <button className="restore-btn">Restore</button>
              </div>
            ))}
          </div>
        </section>
      )}
      
      {/* Preferences */}
      <section className="project-section">
        <div className="section-header">
          <h2>Preferences</h2>
        </div>
        
        <div className="preference-item">
          <label className="toggle-label">
            <input type="checkbox" checked={autoSaveEnabled} readOnly />
            <span>Auto-save enabled</span>
          </label>
          <p className="preference-hint">Automatically save project state every 5 minutes</p>
        </div>
        
        <div className="preference-item">
          <button className="action-btn">
            <Keyboard size={18} />
            Configure Keyboard Shortcuts
          </button>
        </div>
        
        <div className="preference-item">
          <button className="action-btn">
            <LayoutTemplate size={18} />
            Customize Workspace Layout
          </button>
        </div>
      </section>
      
      {/* System Info */}
      <section className="project-section">
        <div className="section-header">
          <h2>System Information</h2>
        </div>
        
        <div className="system-info">
          <div className="info-row">
            <span className="info-label">App Version:</span>
            <span className="info-value">1.0.0 (Beta)</span>
          </div>
          <div className="info-row">
            <span className="info-label">AI Models:</span>
            <span className="info-value">Vision LLM v2.1, Text LLM v3.0</span>
          </div>
          <div className="info-row">
            <span className="info-label">Storage Used:</span>
            <span className="info-value">~24 MB</span>
          </div>
        </div>
        
        <div className="system-actions">
          <button className="action-btn small">
            Check for Updates
          </button>
          <button className="action-btn small">
            View Diagnostic Logs
          </button>
        </div>
      </section>
      
      {/* Navigation Back */}
      <div className="tab-actions">
        <button
          className="proceed-btn"
          onClick={() => setCurrentTab('catalog')}
        >
          Back to Catalog
        </button>
      </div>
    </div>
  );
};
