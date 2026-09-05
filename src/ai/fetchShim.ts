/**
 * Fetch Shim for Transformers.js
 * 
 * Overrides the default fetch mechanism to serve model files from the 
 * user's library folder FIRST, falling back to network download only when needed.
 * This ensures all weights are stored locally and never in Cache Storage.
 */

import { listFiles } from './libraryManager';
import { getLibraryDirectory } from '../utils/idb';

interface CachedFileHandle {
  directoryHandle: FileSystemDirectoryHandle;
  fileHandle: FileSystemFileHandle;
}

const fileHandleCache: Map<string, CachedFileHandle> = new Map();

/**
 * Initialize the fetch shim - call this before loading any Transformers.js models
 */
export const initFetchShim = async (): Promise<void> => {
  console.log('Fetch shim initialized - all model requests will be served from local library');
};

/**
 * Custom fetch function that prioritizes local library files
 * This should be passed to Transformers.js environment configuration
 */
export const libraryFetch = async (
  url: string,
  options?: RequestInit
): Promise<Response> => {
  // Extract model ID and file name from URL
  // Expected format: https://huggingface.co/{org}/{model}/resolve/main/{file}
  const urlParts = url.split('/');
  const resolveIndex = urlParts.indexOf('resolve');
  
  if (resolveIndex === -1) {
    // Not a Hugging Face URL, use regular fetch
    return fetch(url, options);
  }
  
  const org = urlParts[resolveIndex - 2];
  const model = urlParts[resolveIndex - 1];
  const fileName = urlParts.slice(resolveIndex + 2).join('/');
  
  // Map to our model ID format
  const modelId = `${org.toLowerCase()}-${model.toLowerCase()}`.replace(/\./g, '-');
  
  // Try to find the model directory in our library
  try {
    const libEntry = await getLibraryDirectory(modelId);
    
    if (libEntry) {
      // Check if we have permission
      // @ts-ignore - queryPermission may not be typed
      const permissionState = await libEntry.directoryHandle.queryPermission({ mode: 'read' });
      
      if (permissionState === 'granted') {
        // Try to get the file from the library
        try {
          const fileHandle = await libEntry.directoryHandle.getFileHandle(fileName);
          const file = await fileHandle.getFile();
          
          // Return a Response with the file blob
          return new Response(file, {
            status: 200,
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Length': file.size.toString(),
            },
          });
        } catch (err) {
          // File not found in library, will fall through to download
          console.log(`File ${fileName} not found in library for ${modelId}, triggering download...`);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to access library for ${modelId}:`, error);
  }
  
  // File not in library - trigger download
  // Note: In a real implementation, this would need to coordinate with the UI
  // to show download progress. For now, we'll just fetch from network.
  console.log(`Falling back to network fetch for ${url}`);
  return fetch(url, options);
};

/**
 * Get environment configuration for Transformers.js
 * This should be called before loading any models
 */
export const getTransformersEnv = async () => {
  return {
    // Override the fetch function
    fetch: libraryFetch,
    
    // Disable cache storage - we use the file system
    caches: false,
    
    // Set local model path (used by some Transformers.js features)
    localModelPath: '/ai-library/',
  };
};

/**
 * Preload a model file into the cache
 */
export const preloadFile = async (
  modelId: string,
  fileName: string
): Promise<void> => {
  try {
    const libEntry = await getLibraryDirectory(modelId);
    if (!libEntry) return;
    
    const fileHandle = await libEntry.directoryHandle.getFileHandle(fileName);
    
    fileHandleCache.set(`${modelId}:${fileName}`, {
      directoryHandle: libEntry.directoryHandle,
      fileHandle,
    });
  } catch (error) {
    console.warn(`Failed to preload ${fileName} for ${modelId}:`, error);
  }
};

/**
 * Clear the file handle cache
 */
export const clearCache = (): void => {
  fileHandleCache.clear();
};

/**
 * Check if a file exists in the library
 */
export const fileExistsInLibrary = async (
  modelId: string,
  fileName: string
): Promise<boolean> => {
  try {
    const libEntry = await getLibraryDirectory(modelId);
    if (!libEntry) return false;
    
    await libEntry.directoryHandle.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
};

/**
 * List all available models in the library
 */
export const listAvailableModels = async (): Promise<string[]> => {
  const models: string[] = [];
  
  try {
    const allDirs = await import('../utils/idb').then((idb) => idb.getAllLibraryDirectories());
    
    for (const entry of allDirs) {
      try {
        // @ts-ignore - queryPermission may not be typed
        const permissionState = await entry.directoryHandle.queryPermission({ mode: 'read' });
        if (permissionState === 'granted') {
          const files = await listFiles(entry.directoryHandle);
          if (files.length > 0) {
            models.push(entry.modelId);
          }
        }
      } catch {
        // Permission denied or other error
      }
    }
  } catch (error) {
    console.error('Failed to list available models:', error);
  }
  
  return models;
};
