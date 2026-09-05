/**
 * AI Worker - Runs all Transformers.js inference in a dedicated Web Worker
 * 
 * Message Protocol:
 * Main → Worker: { taskId, type, payload }
 * Worker → Main: { taskId, status: 'progress' | 'result' | 'error', data }
 * 
 * Supports transferables for ImageBitmaps and AudioBuffers
 */

// Transformers.js will be loaded dynamically inside the worker
let visionPipeline: any = null;
let textPipeline: any = null;
let ttsPipeline: any = null;

interface WorkerMessage {
  taskId: string;
  type: 'init' | 'embed' | 'generateEDL' | 'generateNarration' | 'tts' | 'cancel';
  payload: any;
}

interface WorkerResponse {
  taskId: string;
  status: 'progress' | 'result' | 'error';
  data: any;
}

const sendResponse = (response: WorkerResponse) => {
  self.postMessage(response);
};

const sendProgress = (taskId: string, progress: any) => {
  sendResponse({ taskId, status: 'progress', data: progress });
};

const sendResult = (taskId: string, result: any, transferables?: Transferable[]) => {
  if (transferables && transferables.length > 0) {
    self.postMessage({ taskId, status: 'result', data: result }, { transfer: transferables } as any);
  } else {
    sendResponse({ taskId, status: 'result', data: result });
  }
};

const sendError = (taskId: string, error: string) => {
  sendResponse({ taskId, status: 'error', data: error });
};

// Initialize pipelines on first use
const initVisionPipeline = async () => {
  if (!visionPipeline) {
    // Dynamic import of Transformers.js - using bare specifier for bundler resolution
    const { pipeline } = await import('@huggingface/transformers');
    
    visionPipeline = await pipeline(
      'feature-extraction',
      'Xenova/mobileclip-s0',
      {
        dtype: 'q4',
        device: 'webgpu',
      }
    );
  }
  return visionPipeline;
};

const initTextPipeline = async () => {
  if (!textPipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    
    textPipeline = await pipeline(
      'text-generation',
      'HuggingFaceTB/SmolLM2-360M-Instruct',
      {
        dtype: 'q4',
        device: 'webgpu',
      }
    );
  }
  return textPipeline;
};

const initTTSPipeline = async () => {
  if (!ttsPipeline) {
    const { pipeline } = await import('@huggingface/transformers');
    
    ttsPipeline = await pipeline(
      'text-to-speech',
      'facebook/mms-tts-eng',
      {
        dtype: 'fp16',
        device: 'webgpu',
      }
    );
  }
  return ttsPipeline;
};

// Handle image embedding for clustering
const handleEmbed = async (taskId: string, payload: { images: ImageBitmap[] }) => {
  try {
    const pipeline = await initVisionPipeline();
    
    const embeddings: number[][] = [];
    
    for (let i = 0; i < payload.images.length; i++) {
      const image = payload.images[i];
      
      // Run embedding
      const result = await pipeline(image, {
        pooling: 'mean',
        normalize: true,
      });
      
      // Extract embedding vector - result.data is a TypedArray
      const embedding = Array.from(result.data as Float32Array | Float64Array);
      embeddings.push(embedding);
      
      // Report progress
      sendProgress(taskId, {
        processed: i + 1,
        total: payload.images.length,
      });
    }
    
    sendResult(taskId, { embeddings });
  } catch (error: any) {
    console.error('Embedding error:', error);
    sendError(taskId, error.message || 'Failed to generate embeddings');
  }
};

// Handle EDL generation from groups
const handleGenerateEDL = async (
  taskId: string,
  payload: {
    groups: Array<{ id: string; name: string; imageIds: string[]; hookImageId?: string }>;
    keywords: string;
    script: string;
  }
) => {
  try {
    const pipeline = await initTextPipeline();
    
    // Build prompt for EDL generation
    const groupsInfo = payload.groups
      .map((g) => `- Group ${g.name}: ${g.imageIds.length} images`)
      .join('\n');
    
    const prompt = `You are a video editing assistant. Generate an Edit Decision List (EDL) in strict JSON format.

Groups:
${groupsInfo}

Keywords: ${payload.keywords || 'none'}
Script theme: ${payload.script || 'none'}

Return ONLY valid JSON with this structure:
{
  "clips": [
    {
      "groupId": "string",
      "imageId": "string", 
      "duration": number,
      "transitions": [{"type": "fade", "duration": 0.5}],
      "focalPoint": {"x": 0.5, "y": 0.5},
      "typography": {"text": "string", "position": {"x": 0.1, "y": 0.8}, "duration": 3}
    }
  ]
}

Rules:
- Each group should have at least one clip
- Durations should be 2-5 seconds
- Include transitions between clips
- Add typography where appropriate`;

    const result = await pipeline(prompt, {
      max_new_tokens: 2000,
      temperature: 0.7,
      do_sample: true,
    });

    // Extract JSON from response
    const generatedText = result[0].generated_text;
    const jsonMatch = generatedText.match(/\{[\s\S]*\}/);
    
    if (!jsonMatch) {
      throw new Error('Failed to parse EDL JSON from response');
    }
    
    const edlData = JSON.parse(jsonMatch[0]);
    
    sendResult(taskId, edlData);
  } catch (error: any) {
    console.error('EDL generation error:', error);
    sendError(taskId, error.message || 'Failed to generate EDL');
  }
};

// Handle narration text generation
const handleGenerateNarration = async (
  taskId: string,
  payload: {
    edlClips: Array<{ id: string; duration: number; groupId: string }>;
    script: string;
    keywords: string;
  }
) => {
  try {
    const pipeline = await initTextPipeline();
    
    const totalDuration = payload.edlClips.reduce((sum, c) => sum + c.duration, 0);
    
    const prompt = `Write a narration script for a video that is approximately ${totalDuration} seconds long.

Theme: ${payload.script || 'General'}
Keywords: ${payload.keywords || ''}

The narration should:
- Be speakable at a natural pace (~150 words per minute)
- Match the video duration (${Math.round(totalDuration)} seconds ≈ ${Math.round(totalDuration * 2.5)} words)
- Flow naturally with visual transitions
- Be engaging and concise

Return ONLY the narration text, no quotes or formatting.`;

    const result = await pipeline(prompt, {
      max_new_tokens: Math.round(totalDuration * 2.5),
      temperature: 0.8,
      do_sample: true,
    });

    const narrationText = result[0].generated_text.replace(prompt, '').trim();
    
    sendResult(taskId, { narration: narrationText });
  } catch (error: any) {
    console.error('Narration generation error:', error);
    sendError(taskId, error.message || 'Failed to generate narration');
  }
};

// Handle TTS synthesis
const handleTTS = async (
  taskId: string,
  payload: {
    text: string;
    pitch?: number;
    speed?: number;
  }
) => {
  try {
    const pipeline = await initTTSPipeline();
    
    const result = await pipeline(payload.text, {
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    // Result contains audio data
    // Convert to Blob for main thread
    const audioBlob = result.audio; // Already a Blob or can be converted
    
    sendResult(taskId, { audioBlob }, audioBlob instanceof Blob ? [audioBlob] : undefined);
  } catch (error: any) {
    console.error('TTS error:', error);
    sendError(taskId, error.message || 'Failed to synthesize speech');
  }
};

// Message handler
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { taskId, type, payload } = event.data;
  
  try {
    switch (type) {
      case 'init':
        // Pre-initialize pipelines
        await Promise.all([initVisionPipeline(), initTextPipeline(), initTTSPipeline()]);
        sendResult(taskId, { initialized: true });
        break;
        
      case 'embed':
        await handleEmbed(taskId, payload);
        break;
        
      case 'generateEDL':
        await handleGenerateEDL(taskId, payload);
        break;
        
      case 'generateNarration':
        await handleGenerateNarration(taskId, payload);
        break;
        
      case 'tts':
        await handleTTS(taskId, payload);
        break;
        
      case 'cancel':
        // Cancellation is handled by AbortController in real implementation
        console.log(`Task ${taskId} cancellation requested`);
        break;
        
      default:
        sendError(taskId, `Unknown message type: ${type}`);
    }
  } catch (error: any) {
    console.error(`Worker error for task ${taskId}:`, error);
    sendError(taskId, error.message || 'Unknown worker error');
  }
};

console.log('AI Worker initialized');
