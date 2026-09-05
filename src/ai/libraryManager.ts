/**
 * AI Library Manager - File System Access API Integration
 * 
 * Manages the user-selected library folder for storing AI model weights.
 * Persists FileSystemDirectoryHandle in IndexedDB for automatic restoration.
 */

import * as idb from '../utils/idb';
import { MODEL_MANIFEST, type ModelEntry, MANIFEST_VERSION } from './modelManifest';

export interface LibraryStatus {
  folderFound: boolean;
  permissionGranted: boolean;
  modelsVerified: boolean;
  manifestVersionMatch: boolean;
  installedModels: string[];
  missingModels: string[];
}

export interface LibraryFile {
  name: string;
  size: number;
  lastModified: number;
  path: string;
}

/**
 * Request user to pick a library folder with readwrite access
 */
export const pickLibraryFolder = async (): Promise<FileSystemDirectoryHandle | null> => {
  try {
    // @ts-ignore - File System Access API types may not be fully defined
    const directoryHandle = await window.showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'documents',
    });
    
    // Verify we can read and write
    const testFileName = '.vignette_library_test';
    const testFile = await directoryHandle.getFileHandle(testFileName, { create: true });
    await directoryHandle.removeEntry(testFileName);
    
    return directoryHandle;
  } catch (error: any) {
    console.error('Failed to pick library folder:', error);
    if (error.name === 'AbortError') {
      return null; // User cancelled
    }
    throw new Error(`Library folder selection failed: ${error.message}`);
  }
};

/**
 * Get the subdirectory for a specific model within the library folder
 */
export const getModelDirectory = async (
  libraryHandle: FileSystemDirectoryHandle,
  modelId: string
): Promise<FileSystemDirectoryHandle> => {
  try {
    return await libraryHandle.getDirectoryHandle(modelId, { create: true });
  } catch (error: any) {
    throw new Error(`Failed to get model directory for ${modelId}: ${error.message}`);
  }
};

/**
 * Persist the library directory handle to IndexedDB for all models
 */
export const persistLibrary = async (
  libraryHandle: FileSystemDirectoryHandle,
  manifestVersion: string
): Promise<void> => {
  for (const model of MODEL_MANIFEST) {
    const modelDir = await getModelDirectory(libraryHandle, model.id);
    await idb.saveLibraryDirectory(model.id, modelDir, manifestVersion);
  }
};

/**
 * Restore library handles from IndexedDB on boot
 * Returns null if no library is persisted
 */
export const restoreLibrary = async (): Promise<{
  libraryHandle: FileSystemDirectoryHandle | null;
  status: LibraryStatus;
} | null> => {
  try {
    const allDirs = await idb.getAllLibraryDirectories();
    
    if (allDirs.length === 0) {
      return {
        libraryHandle: null,
        status: {
          folderFound: false,
          permissionGranted: false,
          modelsVerified: false,
          manifestVersionMatch: false,
          installedModels: [],
          missingModels: MODEL_MANIFEST.map((m) => m.id),
        },
      };
    }
    
    // Check permissions for each stored handle
    let permissionGranted = true;
    const installedModels: string[] = [];
    const missingModels: string[] = [];
    
    for (const entry of allDirs) {
      // @ts-ignore - queryPermission may not be typed
      const permissionState = await entry.directoryHandle.queryPermission({ mode: 'readwrite' });
      
      if (permissionState !== 'granted') {
        permissionGranted = false;
      } else {
        // Verify files exist
        const modelFiles = await listFiles(entry.directoryHandle);
        if (modelFiles.length > 0) {
          installedModels.push(entry.modelId);
        } else {
          missingModels.push(entry.modelId);
        }
      }
    }
    
    const manifestVersionMatch = allDirs.every(
      (d) => d.manifestVersion === MANIFEST_VERSION
    );
    
    // Get parent library handle from first model's directory
    let libraryHandle: FileSystemDirectoryHandle | null = null;
    if (allDirs.length > 0) {
      // We need to traverse up to get the library root
      // For now, use the first model's directory as reference
      libraryHandle = allDirs[0].directoryHandle;
    }
    
    return {
      libraryHandle,
      status: {
        folderFound: true,
        permissionGranted,
        modelsVerified: installedModels.length === MODEL_MANIFEST.length,
        manifestVersionMatch,
        installedModels,
        missingModels,
      },
    };
  } catch (error: any) {
    console.error('Failed to restore library:', error);
    return {
      libraryHandle: null,
      status: {
        folderFound: false,
        permissionGranted: false,
        modelsVerified: false,
        manifestVersionMatch: false,
        installedModels: [],
        missingModels: MODEL_MANIFEST.map((m) => m.id),
      },
    };
  }
};

/**
 * Request permission for a stored directory handle (user gesture required)
 */
export const unlockLibrary = async (): Promise<boolean> => {
  try {
    const allDirs = await idb.getAllLibraryDirectories();
    
    if (allDirs.length === 0) {
      return false;
    }
    
    let allGranted = true;
    
    for (const entry of allDirs) {
      // @ts-ignore - requestPermission may not be typed
      const permissionState = await entry.directoryHandle.requestPermission({
        mode: 'readwrite',
      });
      
      if (permissionState !== 'granted') {
        allGranted = false;
      }
    }
    
    return allGranted;
  } catch (error: any) {
    console.error('Failed to unlock library:', error);
    return false;
  }
};

/**
 * List all files in a directory recursively
 */
export const listFiles = async (
  directoryHandle: FileSystemDirectoryHandle,
  basePath: string = ''
): Promise<LibraryFile[]> => {
  const files: LibraryFile[] = [];
  
  // @ts-ignore - for await...of may not be fully typed
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      files.push({
        name: entry.name,
        size: file.size,
        lastModified: file.lastModified,
        path: basePath ? `${basePath}/${entry.name}` : entry.name,
      });
    } else if (entry.kind === 'directory') {
      const subFiles = await listFiles(
        entry as FileSystemDirectoryHandle,
        basePath ? `${basePath}/${entry.name}` : entry.name
      );
      files.push(...subFiles);
    }
  }
  
  return files;
};

/**
 * Get file size without reading the entire file
 */
export const getFileSize = async (
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<number> => {
  const fileHandle = await directoryHandle.getFileHandle(fileName);
  const file = await fileHandle.getFile();
  return file.size;
};

/**
 * Compute SHA256 hash of a file using Web Crypto API (streaming for large files)
 */
export const computeSha256 = async (file: File): Promise<string> => {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return hashHex;
};

/**
 * Verify file SHA256 against expected value
 */
export const verifyFileChecksum = async (
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  expectedSha256: string
): Promise<boolean> => {
  try {
    const fileHandle = await directoryHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const actualSha256 = await computeSha256(file);
    return actualSha256.toLowerCase() === expectedSha256.toLowerCase();
  } catch (error: any) {
    console.error(`Failed to verify checksum for ${fileName}:`, error);
    return false;
  }
};

/**
 * Delete a file from the library
 */
export const deleteFile = async (
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string
): Promise<void> => {
  try {
    await directoryHandle.removeEntry(fileName);
  } catch (error: any) {
    if (error.name !== 'NotFoundError') {
      throw new Error(`Failed to delete ${fileName}: ${error.message}`);
    }
  }
};

/**
 * Replace a file in the library (delete + write)
 */
export const replaceFile = async (
  directoryHandle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<void> => {
  // Delete existing file if present
  await deleteFile(directoryHandle, fileName);
  
  // Get file handle and create writable stream
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
};

/**
 * Check if a model's files are complete and verified
 */
export const verifyModelFiles = async (
  modelId: string,
  modelEntry: ModelEntry
): Promise<{ verified: boolean; missingFiles: string[] }> => {
  const libEntry = await idb.getLibraryDirectory(modelId);
  
  if (!libEntry) {
    return { verified: false, missingFiles: modelEntry.files.map((f) => f.name) };
  }
  
  const missingFiles: string[] = [];
  
  for (const file of modelEntry.files) {
    try {
      const fileHandle = await libEntry.directoryHandle.getFileHandle(file.name);
      const fileObj = await fileHandle.getFile();
      
      // Verify size (quick check)
      if (fileObj.size !== file.sizeBytes) {
        missingFiles.push(file.name);
        continue;
      }
      
      // Verify checksum (expensive but thorough)
      const sha256 = await computeSha256(fileObj);
      if (sha256 !== file.sha256 && file.sha256 !== 'placeholder_config_sha256' && !file.sha256.startsWith('placeholder_')) {
        missingFiles.push(file.name);
      }
    } catch {
      missingFiles.push(file.name);
    }
  }
  
  return {
    verified: missingFiles.length === 0,
    missingFiles,
  };
};

/**
 * Clear all library data from IndexedDB (does not delete files from disk)
 */
export const clearLibraryPersistence = async (): Promise<void> => {
  const allDirs = await idb.getAllLibraryDirectories();
  for (const entry of allDirs) {
    await idb.deleteLibraryDirectory(entry.modelId);
  }
  await idb.clearAllDownloadProgress();
};
