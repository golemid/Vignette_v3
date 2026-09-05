import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface VignetteDB extends DBSchema {
  media: {
    key: string;
    value: {
      id: string;
      name: string;
      type: 'image' | 'audio';
      file: Blob;
      proxyBlob?: Blob;
      width?: number;
      height?: number;
      duration?: number;
      description?: string;
      hookScore?: number;
    };
    indexes: { 'by-type': string };
  };
  project: {
    key: string;
    value: {
      id: string;
      data: any;
      timestamp: number;
    };
  };
  aiLibrary: {
    key: string;
    value: {
      modelId: string;
      directoryHandle: FileSystemDirectoryHandle;
      lastVerified: number;
      manifestVersion: string;
    };
  };
  downloadProgress: {
    key: string;
    value: {
      modelId: string;
      fileName: string;
      bytesDownloaded: number;
      totalBytes: number;
      lastUpdated: number;
    };
  };
}

const DB_NAME = 'vignette-db';
const DB_VERSION = 2; // Incremented for AI library stores

let dbInstance: IDBPDatabase<VignetteDB> | null = null;

export const getDB = async (): Promise<IDBPDatabase<VignetteDB>> => {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<VignetteDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Media store for File/Blob objects
      if (!db.objectStoreNames.contains('media')) {
        const mediaStore = db.createObjectStore('media', { keyPath: 'id' });
        mediaStore.createIndex('by-type', 'type');
      }
      // Project store for state snapshots
      if (!db.objectStoreNames.contains('project')) {
        db.createObjectStore('project', { keyPath: 'id' });
      }
      // AI Library store for FileSystemDirectoryHandle persistence
      if (!db.objectStoreNames.contains('aiLibrary')) {
        db.createObjectStore('aiLibrary', { keyPath: 'modelId' });
      }
      // Download progress store for resumable downloads
      if (!db.objectStoreNames.contains('downloadProgress')) {
        db.createObjectStore('downloadProgress', { keyPath: 'modelId' });
      }
    },
  });

  return dbInstance;
};

export const saveMediaFile = async (
  id: string,
  file: Blob,
  metadata: {
    name: string;
    type: 'image' | 'audio';
    proxyBlob?: Blob;
    width?: number;
    height?: number;
    duration?: number;
    description?: string;
    hookScore?: number;
  }
): Promise<void> => {
  const db = await getDB();
  await db.put('media', {
    id,
    file,
    ...metadata,
  });
};

export const getMediaFile = async (id: string): Promise<{
  id: string;
  name: string;
  type: 'image' | 'audio';
  file: Blob;
  proxyBlob?: Blob;
  width?: number;
  height?: number;
  duration?: number;
  description?: string;
  hookScore?: number;
} | null> => {
  const db = await getDB();
  return (await db.get('media', id)) ?? null;
};

export const getAllMediaFiles = async (): Promise<Array<{
  id: string;
  name: string;
  type: 'image' | 'audio';
  file: Blob;
  proxyBlob?: Blob;
  width?: number;
  height?: number;
  duration?: number;
  description?: string;
  hookScore?: number;
}>> => {
  const db = await getDB();
  return db.getAll('media');
};

export const deleteMediaFile = async (id: string): Promise<void> => {
  const db = await getDB();
  await db.delete('media', id);
};

export const clearAllMedia = async (): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('media', 'readwrite');
  await tx.store.clear();
  await tx.done;
};

export const saveProjectState = async (
  projectId: string,
  data: any
): Promise<void> => {
  const db = await getDB();
  await db.put('project', {
    id: projectId,
    data,
    timestamp: Date.now(),
  });
};

export const loadProjectState = async (
  projectId: string
): Promise<any | null> => {
  const db = await getDB();
  const project = await db.get('project', projectId);
  return project?.data ?? null;
};

export const getAllProjectSnapshots = async (): Promise<Array<{
  id: string;
  data: any;
  timestamp: number;
}>> => {
  const db = await getDB();
  return db.getAll('project');
};

export const createObjectURL = (blob: Blob): string => {
  return URL.createObjectURL(blob);
};

export const revokeObjectURL = (url: string): void => {
  if (url && url.startsWith('blob:')) {
    URL.revokeObjectURL(url);
  }
};

export const blobToProxyUrl = async (proxyBlob: Blob): Promise<string> => {
  return createObjectURL(proxyBlob);
};

// AI Library persistence functions
export const saveLibraryDirectory = async (
  modelId: string,
  directoryHandle: FileSystemDirectoryHandle,
  manifestVersion: string
): Promise<void> => {
  const db = await getDB();
  await db.put('aiLibrary', {
    modelId,
    directoryHandle,
    lastVerified: Date.now(),
    manifestVersion,
  });
};

export const getLibraryDirectory = async (
  modelId: string
): Promise<{
  modelId: string;
  directoryHandle: FileSystemDirectoryHandle;
  lastVerified: number;
  manifestVersion: string;
} | null> => {
  const db = await getDB();
  return (await db.get('aiLibrary', modelId)) ?? null;
};

export const getAllLibraryDirectories = async (): Promise<Array<{
  modelId: string;
  directoryHandle: FileSystemDirectoryHandle;
  lastVerified: number;
  manifestVersion: string;
}>> => {
  const db = await getDB();
  return db.getAll('aiLibrary');
};

export const deleteLibraryDirectory = async (modelId: string): Promise<void> => {
  const db = await getDB();
  await db.delete('aiLibrary', modelId);
};

// Download progress tracking for resumable downloads
export const saveDownloadProgress = async (
  modelId: string,
  fileName: string,
  bytesDownloaded: number,
  totalBytes: number
): Promise<void> => {
  const db = await getDB();
  await db.put('downloadProgress', {
    modelId,
    fileName,
    bytesDownloaded,
    totalBytes,
    lastUpdated: Date.now(),
  });
};

export const getDownloadProgress = async (
  modelId: string,
  fileName: string
): Promise<{
  modelId: string;
  fileName: string;
  bytesDownloaded: number;
  totalBytes: number;
  lastUpdated: number;
} | null> => {
  const db = await getDB();
  const progress = await db.get('downloadProgress', modelId);
  if (progress && progress.fileName === fileName) {
    return progress;
  }
  return null;
};

export const clearDownloadProgress = async (modelId: string): Promise<void> => {
  const db = await getDB();
  await db.delete('downloadProgress', modelId);
};

export const clearAllDownloadProgress = async (): Promise<void> => {
  const db = await getDB();
  const tx = db.transaction('downloadProgress', 'readwrite');
  await tx.store.clear();
  await tx.done;
};
