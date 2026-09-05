import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { temporal } from 'zundo';
import { validateFile, generateProxy, generateId } from '../utils/fileUtils';
import { saveMediaFile, deleteMediaFile, createObjectURL, revokeObjectURL } from '../utils/idb';

export type AspectRatio = '9:16' | '16:9';
export type ExecutionMode = 'auto-pilot' | 'step-by-step';
export type PipelineStage = 
  | 'idle'
  | 'grouping'
  | 'writing-edl'
  | 'generating-narration'
  | 'synthesizing-tts'
  | 'complete'
  | 'error';

export interface PipelineProgress {
  stage: PipelineStage;
  percent: number;
  message: string;
  error?: string;
}

export interface MediaFile {
  id: string;
  name: string;
  type: 'image' | 'audio';
  file: File | Blob;
  proxyUrl?: string;
  originalUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
  description?: string;
  hookScore?: number;
}

export interface Group {
  id: string;
  name: string;
  imageIds: string[];
  stylePreset?: string;
  hookImageId?: string;
}

export interface Transition {
  id: string;
  type: string;
  duration: number;
  layer: 'background' | 'subject' | 'effects' | 'typography';
  description: string;
  startTime: number;
  endTime: number;
}

export interface EDLClip {
  id: string;
  groupId: string;
  imageId: string;
  startTime: number;
  duration: number;
  transitions: Transition[];
  focalPoint?: { x: number; y: number };
  motionPath?: { x: number; y: number }[];
  typography?: {
    text: string;
    position: { x: number; y: number };
    duration: number;
  };
}

export interface VoicePersona {
  id: string;
  name: string;
  pitch: number;
  speed: number;
}

export interface AudioTrack {
  id: string;
  name: string;
  type: 'narration' | 'music' | 'sfx' | 'ambient';
  url?: string;
  blob?: Blob;
  volume: number;
  startTime: number;
  duration: number;
}

export interface ProjectState {
  mediaFiles: MediaFile[];
  aspectRatio: AspectRatio;
  groups: Group[];
  visualStylePreset: string;
  edlClips: EDLClip[];
  scriptKeywords: string;
  thematicScript: string;
  narrationText: string;
  selectedVoice: VoicePersona | null;
  audioTracks: AudioTrack[];
  duckingEnabled: boolean;
  duckingDepth: number;
  previewResolution: '720p' | '1080p' | '4K';
  previewFrameRate: 24 | 30 | 60;
  previewCodec: 'h264' | 'h265';
  isPreviewReady: boolean;
  executionMode: ExecutionMode;
  projectName: string;
  projectHistory: string[];
  autoSaveEnabled: boolean;
  currentTab: 'catalog' | 'groups' | 'script' | 'audio' | 'preview' | 'project' | 'terminal';
  isLoading: boolean;
  validationErrors: string[];
  _initialized: boolean;
  // AI Library state
  aiStatus: 'not-installed' | 'installing' | 'ready' | 'skipped' | 'error';
  aiManifestVersion: string | null;
  aiModelProgress: Record<string, { percent: number; status: string; error?: string }>;
  // Pipeline progress state (not tracked in undo/redo)
  pipelineProgress: PipelineProgress;
}

const defaultVoicePersonas: VoicePersona[] = [
  { id: 'v1', name: 'Narrator (Neutral)', pitch: 1.0, speed: 1.0 },
  { id: 'v2', name: 'Energetic Host', pitch: 1.1, speed: 1.15 },
  { id: 'v3', name: 'Calm Storyteller', pitch: 0.95, speed: 0.9 },
  { id: 'v4', name: 'Dramatic Voice', pitch: 0.85, speed: 0.85 },
];

export const getSystemVoices = (): SpeechSynthesisVoice[] => {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    return window.speechSynthesis.getVoices();
  }
  return [];
};

export const getHighQualityVoices = (): SpeechSynthesisVoice[] => {
  const voices = getSystemVoices();
  return voices.filter((voice) => 
    voice.default || 
    voice.name.toLowerCase().includes('premium') ||
    voice.name.toLowerCase().includes('enhanced') ||
    voice.name.toLowerCase().includes('google') ||
    voice.name.toLowerCase().includes('microsoft')
  );
};

const initialState: ProjectState = {
  mediaFiles: [],
  aspectRatio: '9:16',
  groups: [],
  visualStylePreset: 'default',
  edlClips: [],
  scriptKeywords: '',
  thematicScript: '',
  narrationText: '',
  selectedVoice: null,
  audioTracks: [],
  duckingEnabled: true,
  duckingDepth: -12,
  previewResolution: '1080p',
  previewFrameRate: 30,
  previewCodec: 'h264',
  isPreviewReady: false,
  executionMode: 'step-by-step',
  projectName: 'Untitled Project',
  projectHistory: [],
  autoSaveEnabled: true,
  currentTab: 'catalog',
  isLoading: false,
  validationErrors: [],
  _initialized: false,
  aiStatus: 'not-installed',
  aiManifestVersion: null,
  aiModelProgress: {},
  pipelineProgress: { stage: 'idle', percent: 0, message: 'Idle' },
};

interface ProjectActions {
  initializeFromDB: () => Promise<void>;
  addMediaFiles: (files: File[]) => Promise<void>;
  removeMediaFile: (id: string) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  generateGroups: () => Promise<void>;
  updateGroup: (groupId: string, updates: Partial<Group>) => void;
  mergeGroups: (group1Id: string, group2Id: string) => void;
  splitGroup: (groupId: string, imageIds: string[]) => void;
  removeGroup: (groupId: string) => void;
  moveImageBetweenGroups: (imageId: string, fromGroupId: string, toGroupId: string) => void;
  setVisualStylePreset: (preset: string) => void;
  generateEDL: () => Promise<void>;
  updateEDLClip: (clipId: string, updates: Partial<EDLClip>) => void;
  removeEDLClip: (clipId: string) => void;
  swapEDLClips: (index1: number, index2: number) => void;
  setScriptKeywords: (keywords: string) => void;
  approveScript: () => void;
  generateNarration: () => Promise<void>;
  updateNarrationText: (text: string) => void;
  selectVoice: (voice: VoicePersona) => void;
  addAudioTrack: (track: AudioTrack) => void;
  updateAudioTrack: (trackId: string, updates: Partial<AudioTrack>) => void;
  removeAudioTrack: (trackId: string) => void;
  setDucking: (enabled: boolean, depth?: number) => void;
  previewAudio: () => void;
  stopAudio: () => void;
  generatePreview: () => Promise<void>;
  setPreviewSettings: (settings: Partial<Pick<ProjectState, 'previewResolution' | 'previewFrameRate' | 'previewCodec'>>) => void;
  validateProject: () => string[];
  saveProject: () => Promise<void>;
  loadProject: (projectName: string) => Promise<void>;
  setExecutionMode: (mode: ExecutionMode) => void;
  setProjectName: (name: string) => void;
  setCurrentTab: (tab: ProjectState['currentTab']) => void;
  setLoading: (loading: boolean) => void;
  addValidationError: (error: string) => void;
  clearValidationErrors: () => void;
  // AI actions
  setAIStatus: (status: ProjectState['aiStatus']) => void;
  setAIManifestVersion: (version: string) => void;
  updateAIModelProgress: (modelId: string, progress: { percent: number; status: string; error?: string }) => void;
  // Pipeline actions
  setPipelineProgress: (progress: PipelineProgress) => void;
  // Undo/Redo actions (provided by zundo temporal middleware)
  undo?: () => void;
  redo?: () => void;
}

const activeObjectUrls: Set<string> = new Set();

const revokeAllObjectURLs = (): void => {
  activeObjectUrls.forEach((url) => {
    URL.revokeObjectURL(url);
  });
  activeObjectUrls.clear();
};

const _cascadeInvalidation = (set: (fn: (s: ProjectState) => void) => void, _get: () => ProjectState, source: 'mediaFiles' | 'groups' | 'edlClips') => {
  if (source === 'mediaFiles') {
    set((s: ProjectState) => {
      s.groups = [];
      s.edlClips = [];
      s.narrationText = '';
      s.audioTracks = [];
      s.isPreviewReady = false;
    });
  } else if (source === 'groups') {
    set((s: ProjectState) => {
      s.edlClips = [];
      s.narrationText = '';
      s.audioTracks = [];
      s.isPreviewReady = false;
    });
  } else if (source === 'edlClips') {
    set((s: ProjectState) => {
      s.narrationText = '';
      s.audioTracks = [];
      s.isPreviewReady = false;
    });
  }
};

// Fields that should be tracked in undo/redo history (creative actions only)
const TEMPORAL_OPTIONS = {
  partialize: (state: ProjectState & ProjectActions) => ({
    // Only track creative modifications, NOT async AI results or file operations
    groups: state.groups,
    edlClips: state.edlClips,
    narrationText: state.narrationText,
    audioTracks: state.audioTracks,
    duckingEnabled: state.duckingEnabled,
    duckingDepth: state.duckingDepth,
    aspectRatio: state.aspectRatio,
    visualStylePreset: state.visualStylePreset,
    scriptKeywords: state.scriptKeywords,
    thematicScript: state.thematicScript,
    selectedVoice: state.selectedVoice,
  }),
};

export const useProjectStore = create<ProjectState & ProjectActions>()(
  temporal(
    immer((set) => ({
      ...initialState,
      
      initializeFromDB: async () => {},
      addMediaFiles: async () => {},
      removeMediaFile: () => {},
      setAspectRatio: () => {},
      generateGroups: async () => {},
      updateGroup: () => {},
      mergeGroups: () => {},
      splitGroup: () => {},
      removeGroup: () => {},
      moveImageBetweenGroups: () => {},
      setVisualStylePreset: () => {},
      generateEDL: async () => {},
      updateEDLClip: (clipId, updates) => {
        set((s) => {
          const index = s.edlClips.findIndex(c => c.id === clipId);
          if (index !== -1) {
            s.edlClips[index] = { ...s.edlClips[index], ...updates };
          }
        });
      },
      removeEDLClip: (clipId) => {
        set((s) => {
          s.edlClips = s.edlClips.filter(c => c.id !== clipId);
        });
      },
      swapEDLClips: (index1, index2) => {
        set((s) => {
          const newClips = [...s.edlClips];
          const temp = newClips[index1];
          newClips[index1] = newClips[index2];
          newClips[index2] = temp;
          // Recalculate start times after swap
          let currentTime = 0;
          newClips.forEach(clip => {
            clip.startTime = currentTime;
            currentTime += clip.duration;
          });
          s.edlClips = newClips;
        });
      },
      setScriptKeywords: () => {},
      approveScript: () => {},
      generateNarration: async () => {},
      updateNarrationText: () => {},
      selectVoice: () => {},
      addAudioTrack: () => {},
      updateAudioTrack: () => {},
      removeAudioTrack: () => {},
      setDucking: () => {},
      previewAudio: () => {},
      stopAudio: () => {},
      generatePreview: async () => {},
      setPreviewSettings: () => {},
      validateProject: () => [],
      saveProject: async () => {},
      loadProject: async () => {},
      setExecutionMode: () => {},
      setProjectName: () => {},
      setCurrentTab: () => {},
      setLoading: () => {},
      addValidationError: () => {},
      clearValidationErrors: () => {},
      // AI actions (not tracked in undo/redo)
      setAIStatus: (status) => {
        set((s) => {
          s.aiStatus = status;
        });
      },
      setAIManifestVersion: (version) => {
        set((s) => {
          s.aiManifestVersion = version;
        });
      },
      updateAIModelProgress: (modelId, progress) => {
        set((s) => {
          s.aiModelProgress[modelId] = progress;
        });
      },
      // Pipeline actions (not tracked in undo/redo)
      setPipelineProgress: (progress) => {
        set((s) => {
          s.pipelineProgress = progress;
        });
      },
    })),
    TEMPORAL_OPTIONS
  )
);

async function _generateProxyBlob(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    img.onload = () => {
      const maxSize = 512;
      let width = img.width;
      let height = img.height;
      if (width > height) {
        if (width > maxSize) { height = (height * maxSize) / width; width = maxSize; }
      } else {
        if (height > maxSize) { width = (width * maxSize) / height; height = maxSize; }
      }
      canvas.width = width;
      canvas.height = height;
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => { if (blob) resolve(blob); else reject(new Error('Failed')); }, 'image/jpeg', 0.8);
      } else reject(new Error('No context'));
    };
    img.onerror = () => reject(new Error('Failed to load'));
    img.src = URL.createObjectURL(file);
  });
}

function _loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed'));
    img.src = src;
  });
}

export const cleanupStore = () => { revokeAllObjectURLs(); };
export { defaultVoicePersonas };
