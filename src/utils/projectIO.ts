/**
 * Project Save/Load/Export - .vignette format
 * 
 * Handles project serialization/deserialization using File System Access API.
 * The .vignette format stores metadata only, not binary blobs.
 */

import { useProjectStore, type EDLClip, type AudioTrack } from '../store/useStore';

export interface VignetteProjectFile {
  version: string;
  projectName: string;
  executionMode: 'auto-pilot' | 'step-by-step';
  aspectRatio: '9:16' | '16:9';
  visualStylePreset: string;
  scriptKeywords: string;
  thematicScript: string;
  narrationText: string;
  selectedVoice: {
    id: string;
    name: string;
    pitch: number;
    speed: number;
  } | null;
  duckingEnabled: boolean;
  duckingDepth: number;
  previewResolution: '720p' | '1080p' | '4K';
  previewFrameRate: 24 | 30 | 60;
  previewCodec: 'h264' | 'h265';
  // Metadata-only arrays (no binary blobs)
  groups: Array<{
    id: string;
    name: string;
    imageIds: string[];
    stylePreset?: string;
    hookImageId?: string;
  }>;
  edlClips: EDLClip[];
  audioTracksMetadata: Array<{
    id: string;
    name: string;
    type: 'narration' | 'music' | 'sfx' | 'ambient';
    volume: number;
    startTime: number;
    duration: number;
    // Reference to media file by name (for relinking)
    mediaFileName?: string;
  }>;
  // Media file references (for relinking)
  mediaReferences: Array<{
    id: string;
    name: string;
    type: 'image' | 'audio';
    width?: number;
    height?: number;
    duration?: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

const PROJECT_VERSION = '1.0.0';

/**
 * Export project to .vignette file using File System Access API
 */
export const exportProject = async (): Promise<void> => {
  try {
    const state = useProjectStore.getState();
    
    // Build project file with metadata only
    const projectFile: VignetteProjectFile = {
      version: PROJECT_VERSION,
      projectName: state.projectName,
      executionMode: state.executionMode,
      aspectRatio: state.aspectRatio,
      visualStylePreset: state.visualStylePreset,
      scriptKeywords: state.scriptKeywords,
      thematicScript: state.thematicScript,
      narrationText: state.narrationText,
      selectedVoice: state.selectedVoice,
      duckingEnabled: state.duckingEnabled,
      duckingDepth: state.duckingDepth,
      previewResolution: state.previewResolution,
      previewFrameRate: state.previewFrameRate,
      previewCodec: state.previewCodec,
      groups: state.groups.map(g => ({
        id: g.id,
        name: g.name,
        imageIds: g.imageIds,
        stylePreset: g.stylePreset,
        hookImageId: g.hookImageId,
      })),
      edlClips: state.edlClips,
      audioTracksMetadata: state.audioTracks.map(t => ({
        id: t.id,
        name: t.name,
        type: t.type,
        volume: t.volume,
        startTime: t.startTime,
        duration: t.duration,
        // Store reference to original media file name for relinking
        mediaFileName: getMediaFileNameForTrack(t),
      })),
      mediaReferences: state.mediaFiles.map(m => ({
        id: m.id,
        name: m.name,
        type: m.type,
        width: m.width,
        height: m.height,
        duration: m.duration,
      })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    // Use File System Access API to save
    if (!('showSaveFilePicker' in window)) {
      throw new Error('File System Access API not supported');
    }
    
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: `${state.projectName.replace(/[^a-z0-9]/gi, '_')}.vignette`,
      types: [{
        description: 'Vignette Project File',
        accept: { 'application/json': ['.vignette'] },
      }],
    });
    
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(projectFile, null, 2));
    await writable.close();
    
    console.log('Project exported successfully');
  } catch (error: any) {
    console.error('Failed to export project:', error);
    throw new Error(`Export failed: ${error.message}`);
  }
};

/**
 * Import project from .vignette file using File System Access API
 */
export const importProject = async (): Promise<{
  projectData: VignetteProjectFile;
  missingMedia: string[];
}> => {
  try {
    if (!('showOpenFilePicker' in window)) {
      throw new Error('File System Access API not supported');
    }
    
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{
        description: 'Vignette Project File',
        accept: { 'application/json': ['.vignette'] },
      }],
      multiple: false,
    });
    
    const file = await handle.getFile();
    const text = await file.text();
    const projectData: VignetteProjectFile = JSON.parse(text);
    
    // Validate schema
    validateProjectFile(projectData);
    
    // Check for missing media
    const state = useProjectStore.getState();
    const currentMediaNames = new Set(state.mediaFiles.map(m => m.name));
    const missingMedia = projectData.mediaReferences
      .filter(ref => !currentMediaNames.has(ref.name))
      .map(ref => ref.name);
    
    return { projectData, missingMedia };
  } catch (error: any) {
    console.error('Failed to import project:', error);
    throw new Error(`Import failed: ${error.message}`);
  }
};

/**
 * Validate project file schema
 */
export const validateProjectFile = (data: any): void => {
  if (!data.version) {
    throw new Error('Invalid project file: missing version');
  }
  
  if (!data.projectName || !Array.isArray(data.groups) || !Array.isArray(data.edlClips)) {
    throw new Error('Invalid project file: missing required fields');
  }
  
  // Add more validation as needed
  console.log('Project file validated successfully');
};

/**
 * Hydrate store from imported project data
 */
export const hydrateStoreFromProject = (projectData: VignetteProjectFile): void => {
  const store = useProjectStore.getState();
  
  // Update project metadata
  store.setProjectName(projectData.projectName);
  store.setExecutionMode(projectData.executionMode);
  store.setAspectRatio(projectData.aspectRatio);
  store.setVisualStylePreset(projectData.visualStylePreset);
  store.setScriptKeywords(projectData.scriptKeywords);
  
  // Restore groups and EDL (these will trigger cascade invalidation if needed)
  // Note: We're directly updating through actions to ensure proper state management
  projectData.groups.forEach(group => {
    store.updateGroup(group.id, group);
  });
  
  projectData.edlClips.forEach(clip => {
    store.updateEDLClip(clip.id, clip);
  });
  
  // Restore narration and voice settings
  // Note: This would need a setNarrationText action or similar
  
  // Restore audio track metadata (without blobs - those need relinking)
  projectData.audioTracksMetadata.forEach(trackMeta => {
    store.addAudioTrack({
      id: trackMeta.id,
      name: trackMeta.name,
      type: trackMeta.type,
      volume: trackMeta.volume,
      startTime: trackMeta.startTime,
      duration: trackMeta.duration,
      // blob will be relinked separately
    });
  });
  
  // Restore preview settings
  store.setPreviewSettings({
    previewResolution: projectData.previewResolution,
    previewFrameRate: projectData.previewFrameRate,
    previewCodec: projectData.previewCodec,
  });
};

/**
 * Relink media files after import
 */
export const relinkMedia = async (
  projectData: VignetteProjectFile
): Promise<void> => {
  try {
    if (!('showDirectoryPicker' in window)) {
      throw new Error('File System Access API not supported');
    }
    
    // Prompt user to select media folder
    const directoryHandle = await (window as any).showDirectoryPicker({
      mode: 'read',
    });
    
    // Scan directory for files
    const foundFiles: Map<string, File> = new Map();
    
    for await (const entry of directoryHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        foundFiles.set(file.name, file);
      }
    }
    
    // Match found files to missing media references
    const matchedFiles: File[] = [];
    
    for (const ref of projectData.mediaReferences) {
      const file = foundFiles.get(ref.name);
      if (file) {
        matchedFiles.push(file);
      }
    }
    
    if (matchedFiles.length > 0) {
      // Add matched files to store
      const store = useProjectStore.getState();
      await store.addMediaFiles(matchedFiles);
      console.log(`Relinked ${matchedFiles.length} media files`);
    }
  } catch (error: any) {
    console.error('Failed to relink media:', error);
    throw new Error(`Relinking failed: ${error.message}`);
  }
};

/**
 * Helper to get media file name for an audio track
 */
const getMediaFileNameForTrack = (track: AudioTrack): string | undefined => {
  // This would need to be enhanced to actually track which media file each track came from
  // For now, we'll use the track name as a fallback
  return track.name;
};

/**
 * Export preset (UI settings only, no media or EDL)
 */
export const exportPreset = async (): Promise<void> => {
  try {
    const state = useProjectStore.getState();
    
    const preset = {
      version: PROJECT_VERSION,
      name: `${state.projectName}_preset`,
      visualStylePreset: state.visualStylePreset,
      duckingEnabled: state.duckingEnabled,
      duckingDepth: state.duckingDepth,
      previewResolution: state.previewResolution,
      previewFrameRate: state.previewFrameRate,
      previewCodec: state.previewCodec,
      aspectRatio: state.aspectRatio,
    };
    
    if (!('showSaveFilePicker' in window)) {
      throw new Error('File System Access API not supported');
    }
    
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: `${state.projectName.replace(/[^a-z0-9]/gi, '_')}_preset.json`,
      types: [{
        description: 'Vignette Preset File',
        accept: { 'application/json': ['.json'] },
      }],
    });
    
    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(preset, null, 2));
    await writable.close();
    
    console.log('Preset exported successfully');
  } catch (error: any) {
    console.error('Failed to export preset:', error);
    throw new Error(`Export failed: ${error.message}`);
  }
};

/**
 * Import preset
 */
export const importPreset = async (): Promise<void> => {
  try {
    if (!('showOpenFilePicker' in window)) {
      throw new Error('File System Access API not supported');
    }
    
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{
        description: 'Vignette Preset File',
        accept: { 'application/json': ['.json'] },
      }],
      multiple: false,
    });
    
    const file = await handle.getFile();
    const text = await file.text();
    const preset = JSON.parse(text);
    
    // Apply preset to current project
    const store = useProjectStore.getState();
    store.setVisualStylePreset(preset.visualStylePreset);
    store.setDucking(preset.duckingEnabled, preset.duckingDepth);
    store.setPreviewSettings({
      previewResolution: preset.previewResolution,
      previewFrameRate: preset.previewFrameRate,
      previewCodec: preset.previewCodec,
    });
    store.setAspectRatio(preset.aspectRatio);
    
    console.log('Preset imported successfully');
  } catch (error: any) {
    console.error('Failed to import preset:', error);
    throw new Error(`Import failed: ${error.message}`);
  }
};
