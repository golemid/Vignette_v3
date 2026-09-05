import React, { useState, useRef } from 'react';
import { useProjectStore } from '../../store/useStore';
import { Wand2, Clock, Type, Check, Edit3, AlertCircle, GripVertical, Trash2 } from 'lucide-react';
import { generateEDL as generateRealEDL, generateFallbackEDL } from '../../ai/services/textService';
import './ScriptTab.css';

interface DragState {
  isDragging: boolean;
  clipId: string | null;
  edge: 'left' | 'right' | 'move' | null;
  startX: number;
  originalDuration: number;
  originalStartTime: number;
}

export const ScriptTab: React.FC = () => {
  const { 
    groups, 
    edlClips, 
    scriptKeywords, 
    thematicScript,
    generateEDL,
    updateEDLClip,
    setScriptKeywords,
    approveScript,
    setCurrentTab,
    isLoading,
    executionMode,
    aiStatus,
    removeEDLClip,
    swapEDLClips
  } = useProjectStore();
  
  const [editingClip, setEditingClip] = useState<string | null>(null);
  const [localDuration, setLocalDuration] = useState<number>(0);
  const [dragState, setDragState] = useState<DragState>({
    isDragging: false,
    clipId: null,
    edge: null,
    startX: 0,
    originalDuration: 0,
    originalStartTime: 0,
  });
  const timelineRef = useRef<HTMLDivElement>(null);
  
  const handleGenerateEDL = async () => {
    if (groups.length === 0) return;
    
    try {
      let result;
      
      if (aiStatus === 'ready') {
        // Use real AI EDL generation
        result = await generateRealEDL(groups, scriptKeywords, thematicScript);
      } else {
        // Fallback to simple generation
        result = generateFallbackEDL(groups);
      }
      
      // Update store with generated clips using the store action
      result.clips.forEach((clip: any) => {
        updateEDLClip(clip.id, clip);
      });
    } catch (error: any) {
      console.error('EDL generation failed:', error);
      // Fallback
      const fallbackResult = generateFallbackEDL(groups);
      fallbackResult.clips.forEach((clip: any) => {
        updateEDLClip(clip.id, clip);
      });
    }
  };
  
  const handleProceedToAudio = () => {
    if (edlClips.length > 0) {
      setCurrentTab('audio');
    }
  };
  
  const handleEditClip = (clipId: string, currentDuration: number) => {
    setEditingClip(clipId);
    setLocalDuration(currentDuration);
  };
  
  const handleSaveClipEdit = (clipId: string) => {
    updateEDLClip(clipId, { duration: localDuration });
    setEditingClip(null);
  };
  
  // Interactive timeline handlers
  const handleTrimStart = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    const clip = edlClips.find(c => c.id === clipId);
    if (!clip) return;
    
    setDragState({
      isDragging: true,
      clipId,
      edge: 'left',
      startX: e.clientX,
      originalDuration: clip.duration,
      originalStartTime: clip.startTime,
    });
  };
  
  const handleTrimEnd = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    const clip = edlClips.find(c => c.id === clipId);
    if (!clip) return;
    
    setDragState({
      isDragging: true,
      clipId,
      edge: 'right',
      startX: e.clientX,
      originalDuration: clip.duration,
      originalStartTime: clip.startTime,
    });
  };
  
  const handleMoveClip = (e: React.MouseEvent, clipId: string) => {
    e.preventDefault();
    const clip = edlClips.find(c => c.id === clipId);
    if (!clip) return;
    
    setDragState({
      isDragging: true,
      clipId,
      edge: 'move',
      startX: e.clientX,
      originalDuration: clip.duration,
      originalStartTime: clip.startTime,
    });
  };
  
  const handleMouseMove = (e: MouseEvent) => {
    if (!dragState.isDragging || !dragState.clipId) return;
    
    const deltaX = e.clientX - dragState.startX;
    const pixelsPerSecond = 100; // Adjust based on timeline width
    const deltaSeconds = deltaX / pixelsPerSecond;
    
    const clip = edlClips.find(c => c.id === dragState.clipId);
    if (!clip) return;
    
    if (dragState.edge === 'left') {
      // Trim start: adjust startTime and duration
      const newStartTime = Math.max(0, dragState.originalStartTime + deltaSeconds);
      const maxStartTime = dragState.originalStartTime + dragState.originalDuration - 0.5;
      const clampedStartTime = Math.min(newStartTime, maxStartTime);
      const newDuration = dragState.originalDuration - (clampedStartTime - dragState.originalStartTime);
      
      updateEDLClip(dragState.clipId, {
        startTime: clampedStartTime,
        duration: newDuration,
      });
    } else if (dragState.edge === 'right') {
      // Trim end: adjust duration only
      const newDuration = Math.max(0.5, dragState.originalDuration + deltaSeconds);
      updateEDLClip(dragState.clipId, { duration: newDuration });
    } else if (dragState.edge === 'move') {
      // Move clip: reorder by adjusting startTime relative to other clips
      // For simplicity, we'll just shift the start time
      const newStartTime = Math.max(0, dragState.originalStartTime + deltaSeconds);
      updateEDLClip(dragState.clipId, { startTime: newStartTime });
    }
  };
  
  const handleMouseUp = () => {
    if (dragState.isDragging) {
      setDragState({
        isDragging: false,
        clipId: null,
        edge: null,
        startX: 0,
        originalDuration: 0,
        originalStartTime: 0,
      });
    }
  };
  
  // Attach global mouse handlers for drag operations
  React.useEffect(() => {
    if (dragState.isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [dragState.isDragging, dragState.clipId, dragState.edge]);
  
  // Typography editor handlers
  const handleTypographyChange = (clipId: string, text: string, position: string) => {
    const clip = edlClips.find(c => c.id === clipId);
    if (!clip) return;
    
    const positionMap: Record<string, { x: number; y: number }> = {
      top: { x: 50, y: 10 },
      bottom: { x: 50, y: 90 },
      center: { x: 50, y: 50 },
    };
    
    updateEDLClip(clipId, {
      typography: {
        text,
        position: positionMap[position] || { x: 50, y: 50 },
        duration: clip.duration,
      },
    });
  };
  
  const totalDuration = edlClips.reduce((sum, clip) => sum + clip.duration, 0);
  
  return (
    <div className="script-tab">
      <div className="tab-header">
        <h1>Script & EDL</h1>
        <p className="tab-description">Generate and refine the Edit Decision List with transitions and timing</p>
      </div>
      
      {/* Keyword Input */}
      <div className="keyword-section">
        <label>Thematic Keywords (optional):</label>
        <input
          type="text"
          value={scriptKeywords}
          onChange={(e) => setScriptKeywords(e.target.value)}
          placeholder="e.g., adventure, nostalgia, urban, nature..."
          className="keyword-input"
        />
        <p className="keyword-hint">These keywords will guide the AI in generating your narrative script</p>
      </div>
      
      {/* Generate Button */}
      <div className="generate-section">
        <button
          className="action-btn primary"
          onClick={handleGenerateEDL}
          disabled={groups.length === 0 || isLoading}
        >
          <Wand2 size={18} />
          {isLoading ? 'Generating...' : 'Generate EDL with AI'}
        </button>
        
        {executionMode === 'step-by-step' && edlClips.length > 0 && (
          <div className="approval-notice">
            <Check size={20} />
            <span>EDL generated. Review transitions and timing below, then proceed.</span>
          </div>
        )}
      </div>
      
      {/* Thematic Script Display */}
      {thematicScript && (
        <div className="thematic-script">
          <h3>Narrative Theme</h3>
          <p>{thematicScript}</p>
        </div>
      )}
      
      {/* Timeline / EDL Display */}
      {edlClips.length > 0 ? (
        <div className="timeline-section">
          <div className="timeline-header">
            <h2>
              <Clock size={20} />
              Edit Decision List (Total: {totalDuration.toFixed(1)}s)
            </h2>
          </div>
          
          <div className="timeline-container">
            {/* Timeline Visualization */}
            <div className="timeline-visual">
              {edlClips.map((clip, index) => (
                <div
                  key={clip.id}
                  className="timeline-clip"
                  style={{ width: `${(clip.duration / totalDuration) * 100}%` }}
                >
                  <span className="clip-label">Scene {index + 1}</span>
                  <span className="clip-duration">{clip.duration}s</span>
                </div>
              ))}
            </div>
            
            {/* Detailed Clip List */}
            <div className="clips-list">
              {edlClips.map((clip, index) => (
                <div key={clip.id} className="clip-card">
                  <div className="clip-header">
                    <h4>
                      Scene {index + 1} - {clip.duration}s
                    </h4>
                    {editingClip === clip.id ? (
                      <div className="duration-edit">
                        <input
                          type="number"
                          value={localDuration}
                          onChange={(e) => setLocalDuration(parseFloat(e.target.value))}
                          min="0.5"
                          step="0.5"
                          className="duration-input"
                        />
                        <button
                          className="save-btn"
                          onClick={() => handleSaveClipEdit(clip.id)}
                        >
                          <Check size={16} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="edit-btn"
                        onClick={() => handleEditClip(clip.id, clip.duration)}
                      >
                        <Edit3 size={16} />
                      </button>
                    )}
                  </div>
                  
                  <div className="clip-transitions">
                    <h5>Transitions:</h5>
                    {clip.transitions.map(trans => (
                      <div key={trans.id} className="transition-tag">
                        <span className={`layer-badge layer-${trans.layer}`}>
                          {trans.layer}
                        </span>
                        <span>{trans.type}</span>
                        <span className="transition-desc">{trans.description}</span>
                      </div>
                    ))}
                  </div>
                  
                  {clip.typography && (
                    <div className="clip-typography">
                      <Type size={16} />
                      <span>"{clip.typography.text}"</span>
                      <span>at {clip.typography.position.x}, {clip.typography.position.y}</span>
                    </div>
                  )}
                  
                  {clip.focalPoint && (
                    <div className="clip-focal">
                      <span>Focal Point: ({clip.focalPoint.x}, {clip.focalPoint.y})</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
          
          <div className="approve-section">
            <button
              className="action-btn primary"
              onClick={() => {
                approveScript();
                handleProceedToAudio();
              }}
            >
              <Check size={18} />
              Approve & Proceed to Audio
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-state">
          <Wand2 size={64} />
          <h3>No EDL Yet</h3>
          <p>Click "Generate EDL with AI" to create transitions and timing for your groups</p>
        </div>
      )}
      
      {/* Manual Navigation */}
      {edlClips.length > 0 && (
        <div className="tab-actions">
          <button
            className="proceed-btn"
            onClick={handleProceedToAudio}
          >
            Proceed to Audio
          </button>
        </div>
      )}
    </div>
  );
};
