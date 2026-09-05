/**
 * Render Queue - Batch Processing for Multiple Projects
 * 
 * Manages a queue of .vignette project files for sequential rendering.
 * Each item in the queue goes through: load → relink media → render → download → next.
 */

import { relinkMedia, validateProjectFile, type VignetteProjectFile } from '../utils/projectIO';
import { renderFullEDL, type RenderSettings as FFmpegRenderSettings } from '../utils/ffmpegRender';
import type { EDLClip, AudioTrack, MediaFile } from '../store/useStore';
import { useProjectStore } from '../store/useStore';

export interface QueueItem {
  id: string;
  fileName: string;
  fileHandle?: File; // Store File object for dynamic loading
  status: 'pending' | 'loading' | 'relinking' | 'rendering' | 'completed' | 'failed';
  progress: number; // 0-100
  error?: string;
  outputBlobUrl?: string;
  projectData?: VignetteProjectFile; // Hydrated project data after import
}

interface RenderSettings {
  resolution: '720p' | '1080p' | '4K';
  frameRate: 24 | 30 | 60;
  codec: 'h264' | 'h265';
  duckingEnabled: boolean;
  duckingDepth: number;
}

// Queue state (not in Zustand to avoid persistence)
let queue: QueueItem[] = [];
let isProcessing = false;
let currentItemId: string | null = null;

// Event callbacks for UI updates
type QueueChangeCallback = () => void;
const changeCallbacks: QueueChangeCallback[] = [];

const notifyChange = () => {
  changeCallbacks.forEach(cb => cb());
};

export const subscribeToQueueChanges = (callback: QueueChangeCallback): (() => void) => {
  changeCallbacks.push(callback);
  return () => {
    const index = changeCallbacks.indexOf(callback);
    if (index > -1) {
      changeCallbacks.splice(index, 1);
    }
  };
};

/**
 * Add a .vignette file to the render queue
 */
export const addToQueue = async (file: File): Promise<string> => {
  const id = `queue_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  
  const item: QueueItem = {
    id,
    fileName: file.name,
    fileHandle: file, // Store the File object for later processing
    status: 'pending',
    progress: 0,
  };
  
  queue.push(item);
  notifyChange();
  
  return id;
};

/**
 * Remove an item from the queue
 */
export const removeFromQueue = (id: string): void => {
  const index = queue.findIndex(item => item.id === id);
  if (index > -1) {
    // Revoke blob URL if exists
    const item = queue[index];
    if (item.outputBlobUrl) {
      URL.revokeObjectURL(item.outputBlobUrl);
    }
    queue.splice(index, 1);
    notifyChange();
  }
};

/**
 * Clear completed items from the queue
 */
export const clearCompleted = (): void => {
  queue = queue.filter(item => {
    if (item.status === 'completed' || item.status === 'failed') {
      if (item.outputBlobUrl) {
        URL.revokeObjectURL(item.outputBlobUrl);
      }
      return false;
    }
    return true;
  });
  notifyChange();
};

/**
 * Get current queue state
 */
export const getQueue = (): QueueItem[] => [...queue];

/**
 * Is the queue currently processing?
 */
export const getIsProcessing = (): boolean => isProcessing;

/**
 * Helper function to relink media for a specific project
 */
async function relinkMediaForProject(
  projectData: VignetteProjectFile,
  dirHandle: FileSystemDirectoryHandle
): Promise<void> {
  // Scan directory for files
  const foundFiles: Map<string, File> = new Map();
  
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      foundFiles.set(file.name, file);
    }
  }
  
  // Match found files to missing media references
  const matchedFiles: File[] = [];
  
  for (const ref of projectData.mediaReferences || []) {
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
}

/**
 * Start processing the queue sequentially
 */
export const startQueue = async (
  settings: RenderSettings,
  onMediaFolderPick: () => Promise<FileSystemDirectoryHandle | null>,
  _onProjectLoaded: (data: VignetteProjectFile) => void,
  onDownload: (blob: Blob, filename: string) => void
): Promise<void> => {
  if (isProcessing) {
    console.warn('Queue is already processing');
    return;
  }
  
  if (queue.length === 0) {
    console.warn('Queue is empty');
    return;
  }
  
  isProcessing = true;
  notifyChange();
  
  try {
    for (const item of queue) {
      if (item.status === 'completed' || item.status === 'failed') {
        continue; // Skip already processed items
      }
      
      currentItemId = item.id;
      
      try {
        // Step 1: Load and parse the .vignette file dynamically
        item.status = 'loading';
        item.progress = 10;
        notifyChange();
        
        if (!item.fileHandle) {
          throw new Error('No file handle available for queue item');
        }
        
        // Read and parse the .vignette JSON file
        const fileText = await item.fileHandle.text();
        const projectData: VignetteProjectFile = JSON.parse(fileText);
        
        // Validate schema
        validateProjectFile(projectData);
        item.projectData = projectData;
        item.progress = 20;
        notifyChange();
        
        console.log(`Project loaded: ${projectData.projectName}`);
        
        // Step 2: Prompt for media folder relinking if needed
        const state = useProjectStore.getState();
        const currentMediaNames = new Set(state.mediaFiles.map(m => m.name));
        const missingMedia = projectData.mediaReferences
          ? projectData.mediaReferences.filter(ref => !currentMediaNames.has(ref.name))
          : [];
        
        if (missingMedia.length > 0) {
          item.status = 'relinking';
          item.progress = 30;
          notifyChange();
          
          console.log(`Missing ${missingMedia.length} media files, prompting for folder...`);
          
          const dirHandle = await onMediaFolderPick();
          if (!dirHandle) {
            throw new Error('Media folder selection cancelled');
          }
          
          // Perform relinking using the imported project data structure
          await relinkMediaForProject(projectData, dirHandle);
          item.progress = 50;
          notifyChange();
        } else {
          item.progress = 50;
          notifyChange();
        }
        
        // Step 3: Render the project
        item.status = 'rendering';
        item.progress = 60;
        notifyChange();
        
        const edlClips: EDLClip[] = item.projectData?.edlClips || [];
        const audioTracksMeta = item.projectData?.audioTracksMetadata || [];
        
        if (edlClips.length === 0) {
          throw new Error('No EDL clips found in project');
        }
        
        // Convert audio track metadata to AudioTrack format (blobs should be relinked)
        const audioTracks: AudioTrack[] = audioTracksMeta.map(t => ({
          id: t.id,
          name: t.name,
          type: t.type,
          volume: t.volume,
          startTime: t.startTime,
          duration: t.duration,
          // blob would have been relinked via mediaFiles
        }));
        
        // Get relinked media files from store
        const mediaFiles: MediaFile[] = useProjectStore.getState().mediaFiles;
        
        // Convert settings to FFmpeg format
        const ffmpegSettings: FFmpegRenderSettings = {
          resolution: settings.resolution,
          frameRate: settings.frameRate,
          codec: settings.codec,
          duckingEnabled: settings.duckingEnabled,
          duckingDepth: settings.duckingDepth
        };
        
        // Render with progress tracking
        const blobUrl = await renderFullEDL(
          edlClips,
          ffmpegSettings,
          mediaFiles,
          audioTracks,
          (progress: number) => {
            item.progress = 60 + Math.round(progress * 0.4); // 60-100%
            notifyChange();
          }
        );
        
        item.outputBlobUrl = blobUrl;
        item.progress = 100;
        notifyChange();
        
        // Step 4: Trigger download
        const response = await fetch(blobUrl);
        const blob = await response.blob();
        const outputFilename = `${item.fileName.replace('.vignette', '')}_rendered.mp4`;
        onDownload(blob, outputFilename);
        
        item.status = 'completed';
        console.log(`Queue item completed: ${item.fileName}`);
        
      } catch (error: any) {
        console.error(`Queue item failed: ${item.fileName}`, error);
        item.status = 'failed';
        item.error = error.message;
      }
      
      // Small delay between items
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
  } finally {
    isProcessing = false;
    currentItemId = null;
    notifyChange();
  }
};

/**
 * Cancel the current queue processing
 */
export const cancelQueue = (): void => {
  isProcessing = false;
  currentItemId = null;
  notifyChange();
};

/**
 * Export queue state for debugging
 */
export const exportQueueState = (): { queue: QueueItem[], isProcessing: boolean } => ({
  queue: [...queue],
  isProcessing
});
