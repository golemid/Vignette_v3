/**
 * Model Manifest - Single Source of Truth for AI Models
 * 
 * This manifest defines all models used by Vignette for local AI inference.
 * All models are quantized for browser execution via Transformers.js v3.
 */

export const MANIFEST_VERSION = '1.0.0';

export interface ModelFile {
  name: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export interface ModelConfig {
  dtype: 'fp16' | 'q4' | 'q8';
  device: 'webgpu' | 'wasm';
  fallback: 'wasm' | 'cpu';
}

export interface ModelEntry {
  id: string;
  purpose: 'vision' | 'text' | 'tts';
  runtime: 'transformers' | 'custom';
  files: ModelFile[];
  config: ModelConfig;
  displayName: string;
  description: string;
  minMemoryMB: number;
}

/**
 * Initial model manifest with three core models:
 * 1. Vision: MobileCLIP (quantized) for embeddings/clustering
 * 2. Text: Qwen2.5-0.5B-Instruct q4 for EDL generation + narration
 * 3. TTS: MMS-TTS English for neural voice synthesis
 * 
 * Note: All models use Hugging Face Hub URLs with ONNX quantized weights.
 * WebGPU is primary target; WASM fallback available for incompatible devices.
 */
export const MODEL_MANIFEST: ModelEntry[] = [
  {
    id: 'mobileclip-s0',
    purpose: 'vision',
    runtime: 'transformers',
    displayName: 'MobileCLIP-S0 (Vision Embeddings)',
    description: 'Lightweight vision model for image embeddings and similarity clustering. Optimized for visual grouping.',
    minMemoryMB: 512,
    config: {
      dtype: 'q4',
      device: 'webgpu',
      fallback: 'wasm',
    },
    files: [
      {
        name: 'config.json',
        url: 'https://huggingface.co/xenova/mobileclip-s0/resolve/main/config.json',
        sizeBytes: 1024,
        sha256: 'placeholder_config_sha256',
      },
      {
        name: 'preprocessor_config.json',
        url: 'https://huggingface.co/xenova/mobileclip-s0/resolve/main/preprocessor_config.json',
        sizeBytes: 512,
        sha256: 'placeholder_preprocessor_sha256',
      },
      {
        name: 'tokenizer.json',
        url: 'https://huggingface.co/xenova/mobileclip-s0/resolve/main/tokenizer.json',
        sizeBytes: 720000,
        sha256: 'placeholder_tokenizer_sha256',
      },
      {
        name: 'model.onnx',
        url: 'https://huggingface.co/xenova/mobileclip-s0/resolve/main/model.onnx',
        sizeBytes: 45000000, // ~45MB quantized
        sha256: 'placeholder_model_sha256',
      },
    ],
  },
  {
    id: 'qwen2-5-0_5b-instruct-q4',
    purpose: 'text',
    runtime: 'transformers',
    displayName: 'Qwen2.5-0.5B-Instruct (Q4)',
    description: 'Compact LLM for EDL generation, script writing, and narration text. Quantized to 4-bit for browser efficiency.',
    minMemoryMB: 1024,
    config: {
      dtype: 'q4',
      device: 'webgpu',
      fallback: 'wasm',
    },
    files: [
      {
        name: 'config.json',
        url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/config.json',
        sizeBytes: 2048,
        sha256: 'placeholder_qwen_config_sha256',
      },
      {
        name: 'tokenizer.json',
        url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/tokenizer.json',
        sizeBytes: 1500000,
        sha256: 'placeholder_qwen_tokenizer_sha256',
      },
      {
        name: 'tokenizer_config.json',
        url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/tokenizer_config.json',
        sizeBytes: 4096,
        sha256: 'placeholder_qwen_tokenizer_config_sha256',
      },
      {
        name: 'model.onnx',
        url: 'https://huggingface.co/HuggingFaceTB/SmolLM2-360M-Instruct/resolve/main/onnx/model.onnx',
        sizeBytes: 180000000, // ~180MB quantized q4
        sha256: 'placeholder_qwen_model_sha256',
      },
    ],
  },
  {
    id: 'mms-tts-eng',
    purpose: 'tts',
    runtime: 'transformers',
    displayName: 'MMS-TTS English',
    description: 'Massively Multilingual Speech TTS for English neural voice synthesis. Supports persona customization.',
    minMemoryMB: 256,
    config: {
      dtype: 'fp16',
      device: 'webgpu',
      fallback: 'wasm',
    },
    files: [
      {
        name: 'config.json',
        url: 'https://huggingface.co/facebook/mms-tts-eng/resolve/main/config.json',
        sizeBytes: 1536,
        sha256: 'placeholder_mms_config_sha256',
      },
      {
        name: 'preprocessor_config.json',
        url: 'https://huggingface.co/facebook/mms-tts-eng/resolve/main/preprocessor_config.json',
        sizeBytes: 768,
        sha256: 'placeholder_mms_preprocessor_sha256',
      },
      {
        name: 'tokenizer.json',
        url: 'https://huggingface.co/facebook/mms-tts-eng/resolve/main/tokenizer.json',
        sizeBytes: 300000,
        sha256: 'placeholder_mms_tokenizer_sha256',
      },
      {
        name: 'model.onnx',
        url: 'https://huggingface.co/facebook/mms-tts-eng/resolve/main/model.onnx',
        sizeBytes: 95000000, // ~95MB
        sha256: 'placeholder_mms_model_sha256',
      },
    ],
  },
];

/**
 * Get model entry by ID
 */
export const getModelById = (id: string): ModelEntry | undefined => {
  return MODEL_MANIFEST.find((m) => m.id === id);
};

/**
 * Get total download size in bytes
 */
export const getTotalDownloadSize = (): number => {
  return MODEL_MANIFEST.reduce((total, model) => {
    return total + model.files.reduce((sum, file) => sum + file.sizeBytes, 0);
  }, 0);
};

/**
 * Format bytes to human-readable string
 */
export const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Get estimated download time in seconds at given bandwidth (Mbps)
 */
export const estimateDownloadTime = (bandwidthMbps: number): number => {
  const totalBytes = getTotalDownloadSize();
  const totalBits = totalBytes * 8;
  const bandwidthBps = bandwidthMbps * 1000000;
  return totalBits / bandwidthBps;
};
