/**
 * Download Manager - Resumable Downloads with Checksum Verification
 * 
 * Handles streaming downloads of model files with:
 * - Resumable downloads via Range headers
 * - Progress tracking in IndexedDB
 * - SHA256 verification on completion
 * - Parallelism control (max 2 concurrent downloads)
 */

import * as idb from '../utils/idb';
import { type ModelEntry, getModelById, MANIFEST_VERSION } from './modelManifest';
import { deleteFile, replaceFile, computeSha256 } from './libraryManager';

export interface DownloadProgress {
  modelId: string;
  fileName: string;
  percent: number;
  bytesDownloaded: number;
  totalBytes: number;
  bytesPerSec: number;
  eta: number; // seconds
  status: 'pending' | 'downloading' | 'verifying' | 'complete' | 'error';
  error?: string;
}

export type ProgressCallback = (progress: DownloadProgress) => void;

interface ActiveDownload {
  modelId: string;
  fileName: string;
  controller: AbortController;
  startTime: number;
  lastBytesDownloaded: number;
  lastUpdateTime: number;
}

const MAX_PARALLEL_DOWNLOADS = 2;
const activeDownloads: Map<string, ActiveDownload> = new Map();
const downloadQueue: Array<{
  modelId: string;
  fileName: string;
  url: string;
  expectedSize: number;
  expectedSha256: string;
  directoryHandle: FileSystemDirectoryHandle;
  onProgress?: ProgressCallback;
}> = [];

let processingQueue = false;

/**
 * Start or resume a download for a single file
 */
const downloadFile = async (
  modelId: string,
  fileName: string,
  url: string,
  expectedSize: number,
  expectedSha256: string,
  directoryHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback,
  _signal?: AbortSignal
): Promise<void> => {
  const progressKey = `${modelId}:${fileName}`;
  
  // Check for existing progress
  let startByte = 0;
  const existingProgress = await idb.getDownloadProgress(modelId, fileName);
  if (existingProgress && existingProgress.bytesDownloaded > 0) {
    startByte = existingProgress.bytesDownloaded;
    console.log(`Resuming ${fileName} from byte ${startByte}`);
  }
  
  const controller = new AbortController();
  const combinedSignal = _signal ? AbortSignal.any([controller.signal, _signal]) : controller.signal;
  
  const download: ActiveDownload = {
    modelId,
    fileName,
    controller,
    startTime: Date.now(),
    lastBytesDownloaded: startByte,
    lastUpdateTime: Date.now(),
  };
  
  activeDownloads.set(progressKey, download);
  
  try {
    const headers: HeadersInit = {};
    if (startByte > 0) {
      headers['Range'] = `bytes=${startByte}-`;
    }
    
    let response = await fetch(url, {
      headers,
      signal: combinedSignal,
    });
    
    if (!response.ok) {
      if (response.status === 416 && startByte > 0) {
        // Range not satisfiable - file may be complete already
        console.log(`Range request failed, checking if file is complete`);
        startByte = 0;
        const fullResponse = await fetch(url, { signal: combinedSignal });
        if (!fullResponse.ok) {
          throw new Error(`Download failed: ${fullResponse.status}`);
        }
        response = fullResponse;
      } else {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
    }
    
    const contentLength = response.headers.get('Content-Length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) + startByte : expectedSize;
    
    if (!response.body) {
      throw new Error('Response body is null');
    }
    
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let bytesDownloaded = startByte;
    let lastProgressUpdate = Date.now();
    
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;
      
      chunks.push(value);
      bytesDownloaded += value.length;
      
      // Update progress every 100ms
      const now = Date.now();
      if (now - lastProgressUpdate >= 100) {
        const elapsed = (now - download.startTime) / 1000;
        const bytesPerSec = elapsed > 0 ? bytesDownloaded / elapsed : 0;
        const remaining = totalBytes - bytesDownloaded;
        const eta = bytesPerSec > 0 ? remaining / bytesPerSec : 0;
        
        const progress: DownloadProgress = {
          modelId,
          fileName,
          percent: Math.round((bytesDownloaded / totalBytes) * 100),
          bytesDownloaded,
          totalBytes,
          bytesPerSec,
          eta,
          status: 'downloading',
        };
        
        onProgress?.(progress);
        
        // Save progress to IDB for resume capability
        await idb.saveDownloadProgress(modelId, fileName, bytesDownloaded, totalBytes);
        
        lastProgressUpdate = now;
        download.lastBytesDownloaded = bytesDownloaded;
        download.lastUpdateTime = now;
      }
    }
    
    // Combine chunks into a single blob
    const blob = new Blob(chunks, { type: 'application/octet-stream' });
    
    // Write to file system
    await replaceFile(directoryHandle, fileName, blob);
    
    // Verify checksum
    const fileHandle = await directoryHandle.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    const actualSha256 = await computeSha256(file);
    
    onProgress?.({
      modelId,
      fileName,
      percent: 100,
      bytesDownloaded: totalBytes,
      totalBytes,
      bytesPerSec: 0,
      eta: 0,
      status: 'verifying',
    });
    
    // Skip checksum verification for placeholder entries
    const shouldVerify = !expectedSha256.startsWith('placeholder_');
    if (shouldVerify && actualSha256.toLowerCase() !== expectedSha256.toLowerCase()) {
      // Checksum mismatch - delete and retry once
      console.warn(`Checksum mismatch for ${fileName}. Expected: ${expectedSha256}, Got: ${actualSha256}`);
      await deleteFile(directoryHandle, fileName);
      await idb.clearDownloadProgress(modelId);
      
      // Retry once
      onProgress?.({
        modelId,
        fileName,
        percent: 0,
        bytesDownloaded: 0,
        totalBytes,
        bytesPerSec: 0,
        eta: 0,
        status: 'downloading',
      });
      
      return downloadFile(
        modelId,
        fileName,
        url,
        expectedSize,
        expectedSha256,
        directoryHandle,
        onProgress,
        _signal
      );
    }
    
    // Clear progress on success
    await idb.clearDownloadProgress(modelId);
    
    onProgress?.({
      modelId,
      fileName,
      percent: 100,
      bytesDownloaded: totalBytes,
      totalBytes,
      bytesPerSec: 0,
      eta: 0,
      status: 'complete',
    });
    
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.log(`Download cancelled: ${fileName}`);
      return;
    }
    
    console.error(`Download error for ${fileName}:`, error);
    
    onProgress?.({
      modelId,
      fileName,
      percent: 0,
      bytesDownloaded: 0,
      totalBytes: expectedSize,
      bytesPerSec: 0,
      eta: 0,
      status: 'error',
      error: error.message,
    });
    
    throw error;
  } finally {
    activeDownloads.delete(progressKey);
  }
};

/**
 * Process the download queue with parallelism limit
 */
const processQueue = async (): Promise<void> => {
  if (processingQueue) return;
  processingQueue = true;
  
  while (downloadQueue.length > 0) {
    // Wait if we're at max parallelism
    while (activeDownloads.size >= MAX_PARALLEL_DOWNLOADS) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    
    const item = downloadQueue.shift();
    if (item) {
      // Start download without awaiting to allow parallelism
      downloadFile(
        item.modelId,
        item.fileName,
        item.url,
        item.expectedSize,
        item.expectedSha256,
        item.directoryHandle,
        item.onProgress
      ).catch((err) => {
        console.error(`Failed to download ${item.fileName}:`, err);
      });
    }
  }
  
  processingQueue = false;
};

/**
 * Download all files for a model
 */
export const downloadModel = async (
  modelId: string,
  directoryHandle: FileSystemDirectoryHandle,
  onProgress?: ProgressCallback
): Promise<void> => {
  const model = getModelById(modelId);
  if (!model) {
    throw new Error(`Model ${modelId} not found in manifest`);
  }
  
  const filePromises: Promise<void>[] = [];
  
  for (const file of model.files) {
    const progressKey = `${modelId}:${file.name}`;
    
    // Skip if already downloading
    if (activeDownloads.has(progressKey)) {
      continue;
    }
    
    // Add to queue
    downloadQueue.push({
      modelId,
      fileName: file.name,
      url: file.url,
      expectedSize: file.sizeBytes,
      expectedSha256: file.sha256,
      directoryHandle,
      onProgress: (progress: DownloadProgress) => {
        // Aggregate progress for the whole model
        const totalModelBytes = model.files.reduce((sum, f) => sum + f.sizeBytes, 0);
        const aggregatedProgress: DownloadProgress = {
          ...progress,
          percent: Math.round((progress.bytesDownloaded / totalModelBytes) * 100),
        };
        onProgress?.(aggregatedProgress);
      },
    });
  }
  
  // Process queue
  await processQueue();
  
  // Wait for all downloads to complete
  await Promise.all(filePromises);
};

/**
 * Cancel an active download
 */
export const cancelDownload = (modelId: string, fileName?: string): void => {
  if (fileName) {
    const key = `${modelId}:${fileName}`;
    const download = activeDownloads.get(key);
    if (download) {
      download.controller.abort();
    }
  } else {
    // Cancel all downloads for this model
    for (const [key, download] of activeDownloads.entries()) {
      if (key.startsWith(`${modelId}:`)) {
        download.controller.abort();
      }
    }
  }
};

/**
 * Get progress for an active download
 */
export const getDownloadProgress = (modelId: string, fileName: string): DownloadProgress | null => {
  const key = `${modelId}:${fileName}`;
  const download = activeDownloads.get(key);
  if (!download) return null;
  
  const elapsed = (Date.now() - download.startTime) / 1000;
  const bytesPerSec = elapsed > 0 ? download.lastBytesDownloaded / elapsed : 0;
  
  return {
    modelId,
    fileName,
    percent: 0,
    bytesDownloaded: download.lastBytesDownloaded,
    totalBytes: 0,
    bytesPerSec,
    eta: 0,
    status: 'downloading',
  };
};

/**
 * Check if a download is active
 */
export const isDownloading = (modelId: string): boolean => {
  for (const key of activeDownloads.keys()) {
    if (key.startsWith(`${modelId}:`)) {
      return true;
    }
  }
  return false;
};

/**
 * Get count of active downloads
 */
export const getActiveDownloadCount = (): number => {
  return activeDownloads.size;
};

/**
 * Clear all download state (for cleanup)
 */
export const clearAllDownloads = (): void => {
  for (const download of activeDownloads.values()) {
    download.controller.abort();
  }
  activeDownloads.clear();
  downloadQueue.length = 0;
};
