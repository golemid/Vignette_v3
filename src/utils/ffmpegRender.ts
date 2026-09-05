import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import type { MediaFile, EDLClip, AudioTrack } from '../store/useStore';
import * as idb from './idb';

let ffmpegInstance: FFmpeg | null = null;

export interface RenderSettings {
  resolution: '720p' | '1080p' | '4K';
  frameRate: 24 | 30 | 60;
  codec: 'h264' | 'h265';
  duckingEnabled: boolean;
  duckingDepth: number;
}

/**
 * Get or create the FFmpeg instance with CDN-loaded core.
 * Uses multi-threaded core if SharedArrayBuffer is available (COOP/COEP enabled).
 */
const getFFmpeg = async (): Promise<FFmpeg> => {
  if (!ffmpegInstance) {
    ffmpegInstance = new FFmpeg();

    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

    // Load multi-threaded core if SharedArrayBuffer is available (COOP/COEP enabled)
    if (hasSharedArrayBuffer) {
      await ffmpegInstance.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm/ffmpeg-core.wasm',
      });
      console.log('FFmpeg multi-threaded core loaded (SharedArrayBuffer available)');
    } else {
      await ffmpegInstance.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.wasm',
      });
      console.log('FFmpeg single-threaded core loaded (SharedArrayBuffer NOT available)');
    }

    console.log(`WASM Threading: ${hasSharedArrayBuffer ? 'Multi-threaded' : 'Single-threaded'}`);
  }

  return ffmpegInstance;
};

/**
 * Resolve resolution string to width/height based on aspect ratio
 */
const resolveResolution = (resolution: string, aspectRatio: '9:16' | '16:9' = '9:16'): { width: number; height: number } => {
  const isVertical = aspectRatio === '9:16';
  
  switch (resolution) {
    case '720p':
      return isVertical ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
    case '1080p':
      return isVertical ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    case '4K':
      return isVertical ? { width: 2160, height: 3840 } : { width: 3840, height: 2160 };
    default:
      return isVertical ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
  }
};

/**
 * Map EDL transition types to FFmpeg xfade transition names
 */
const mapTransitionType = (type: string): string => {
  const transitionMap: Record<string, string> = {
    'fade': 'fade',
    'fadeblack': 'fadeblack',
    'fadewhite': 'fadewhite',
    'slideleft': 'slideleft',
    'slideright': 'slideright',
    'slideup': 'slideup',
    'slidedown': 'slidedown',
    'zoomin': 'zoomin',
    'zoomout': 'zoomout',
    'circlecrop': 'circlecrop',
    'rectcrop': 'rectcrop',
    'distance': 'distance',
    'wipeleft': 'wipeleft',
    'wiperight': 'wiperight',
    'wipeup': 'wipeup',
    'wipedown': 'wipedown',
    'dissolve': 'dissolve',
    'default': 'fade',
  };
  return transitionMap[type.toLowerCase()] || 'fade';
};

/**
 * Generate drawtext filter for typography overlay
 */
const buildDrawtextFilter = (
  text: string,
  position: { x: number; y: number },
  duration: number,
  startTime: number,
  targetWidth: number,
  targetHeight: number
): string => {
  // Escape special characters for drawtext
  const escapedText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");
  
  // Convert normalized position (0-1) to pixel coordinates
  const x = Math.round(position.x * targetWidth);
  const y = Math.round(position.y * targetHeight);
  
  return `drawtext=text='${escapedText}':fontsize=24:fontcolor=white:borderw=2:bordercolor=black:x=${x}:y=${y}:enable='between(t,${startTime},${startTime + duration})'`;
};

/**
 * Build zoompan filter for focal point and motion path animation
 */
const buildZoompanFilter = (
  focalPoint: { x: number; y: number } | undefined,
  motionPath: { x: number; y: number }[] | undefined,
  duration: number,
  fps: number
): string => {
  const totalFrames = Math.floor(duration * fps);
  
  if (!focalPoint && (!motionPath || motionPath.length === 0)) {
    // Default slow zoom effect
    return `zoompan=z='min(zoom+0.0015,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  }
  
  if (focalPoint) {
    // Simple zoom to focal point
    const zoomX = focalPoint.x;
    const zoomY = focalPoint.y;
    return `zoompan=z='min(zoom+0.0015,1.3)':d=${totalFrames}:x='iw*${zoomX}-(iw/zoom/2)':y='ih*${zoomY}-(ih/zoom/2)'`;
  }
  
  if (motionPath && motionPath.length > 0) {
    // Motion path animation - simplified linear interpolation
    const startX = motionPath[0].x;
    const startY = motionPath[0].y;
    const endX = motionPath[motionPath.length - 1].x;
    const endY = motionPath[motionPath.length - 1].y;
    
    return `zoompan=z='min(zoom+0.001,1.2)':d=${totalFrames}:x='iw*(${startX}+(${endX}-${startX})*t/${duration})-(iw/zoom/2)':y='ih*(${startY}+(${endY}-${startY})*t/${duration})-(ih/zoom/2)'`;
  }
  
  return `zoompan=z='min(zoom+0.0015,1.5)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
};

/**
 * Fetch original image blob from IndexedDB, fall back to proxy
 */
const getImageBlob = async (imageId: string, mediaFiles: MediaFile[]): Promise<Blob | null> => {
  // First try to get from IndexedDB (original)
  try {
    const dbRecord = await idb.getMediaFile(imageId);
    if (dbRecord?.file) {
      console.log(`Found original blob in IndexedDB for ${imageId}`);
      return dbRecord.file;
    }
  } catch (_e) {
    console.warn(`Failed to get original from IndexedDB for ${imageId}`);
  }
  
  // Fall back to mediaFiles array (may be proxy or original File)
  const mediaFile = mediaFiles.find(f => f.id === imageId);
  if (mediaFile?.file) {
    console.log(`Falling back to store file for ${imageId}`);
    return mediaFile.file instanceof Blob ? mediaFile.file : new Blob([mediaFile.file], { type: 'image/jpeg' });
  }
  
  return null;
};

/**
 * Main render function that builds and executes the FFmpeg filtergraph
 */
export const renderFullEDL = async (
  edlClips: EDLClip[],
  settings: RenderSettings,
  mediaFiles: MediaFile[],
  audioTracks: AudioTrack[],
  onProgress?: (progress: number) => void
): Promise<string> => {
  const ffmpeg = await getFFmpeg();
  const cleanupFiles: string[] = [];
  
  try {
    // Validate inputs
    if (!edlClips || edlClips.length === 0) {
      throw new Error('No EDL clips provided');
    }
    
    // Filter out zero-length clips
    const validClips = edlClips.filter(clip => clip.duration > 0);
    if (validClips.length === 0) {
      throw new Error('No valid clips with positive duration');
    }
    
    console.log(`Rendering ${validClips.length} valid clips`);
    console.log(`Settings: ${settings.resolution}@${settings.frameRate}fps, codec=${settings.codec}`);
    console.log(`WASM Threading: ${typeof SharedArrayBuffer !== 'undefined' ? 'Multi-threaded' : 'Single-threaded'}`);
    
    // Resolve target resolution (default to 16:9 for now, can be extended)
    const targetRes = resolveResolution(settings.resolution, '16:9');
    const targetWidth = targetRes.width;
    const targetHeight = targetRes.height;
    const targetFps = settings.frameRate;
    
    // Input counter for FFmpeg
    let inputIndex = 0;
    const inputLabels: string[] = [];
    const segmentFilters: string[] = [];
    const audioInputs: string[] = [];
    
    // Process each clip
    for (let i = 0; i < validClips.length; i++) {
      const clip = validClips[i];
      const imageBlob = await getImageBlob(clip.imageId, mediaFiles);
      
      if (!imageBlob) {
        console.warn(`No image found for clip ${clip.id}, skipping`);
        continue;
      }
      
      const inputFilename = `input_${inputIndex}.jpg`;
      const imageData = await fetchFile(imageBlob);
      await ffmpeg.writeFile(inputFilename, imageData);
      cleanupFiles.push(inputFilename);
      
      inputLabels.push(inputFilename);
      
      // Build per-clip filter chain
      const clipFilters: string[] = [];
      
      // 1. Scale and crop to target resolution with SAR normalization
      clipFilters.push(`scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`);
      
      // 2. Apply focal point / motion path animation
      const zoompanFilter = buildZoompanFilter(clip.focalPoint, clip.motionPath, clip.duration, targetFps);
      clipFilters.push(zoompanFilter);
      
      // 3. Set duration
      clipFilters.push(`trim=duration=${clip.duration}`);
      
      // 4. Add typography overlay if present
      if (clip.typography && clip.typography.text) {
        const drawtextFilter = buildDrawtextFilter(
          clip.typography.text,
          clip.typography.position,
          clip.typography.duration,
          clip.startTime,
          targetWidth,
          targetHeight
        );
        clipFilters.push(drawtextFilter);
      }
      
      // Combine filters for this segment
      const filterChain = clipFilters.join(',');
      segmentFilters.push(`[${inputIndex}:v]${filterChain}[seg${i}]`);
      
      inputIndex++;
    }
    
    if (segmentFilters.length === 0) {
      throw new Error('No valid segments could be created');
    }
    
    // Build xfade chain for transitions
    let xfadeChain = '';
    let currentOutput = 'seg0';
    let cumulativeDuration = validClips[0].duration;
    
    for (let i = 1; i < segmentFilters.length && i < validClips.length; i++) {
      const prevClip = validClips[i - 1];
      const transitionDuration = 0.5; // Default 500ms transition
      
      // Map transition type
      const transitionType = prevClip.transitions?.length > 0 
        ? mapTransitionType(prevClip.transitions[0].type)
        : 'fade';
      
      const offset = cumulativeDuration - transitionDuration;
      
      if (xfadeChain === '') {
        xfadeChain = `[${currentOutput}][seg${i}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}[xfade${i}]`;
        currentOutput = `xfade${i}`;
      } else {
        xfadeChain += `;[${currentOutput}][seg${i}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset}[xfade${i}]`;
        currentOutput = `xfade${i}`;
      }
      
      cumulativeDuration += validClips[i].duration;
    }
    
    // Handle audio mixing
    let audioFilter = '';
    const musicTracks = audioTracks.filter(t => t.type === 'music');
    const narrationTracks = audioTracks.filter(t => t.type === 'narration');
    
    if (musicTracks.length > 0) {
      // Write music files to FS
      for (let i = 0; i < musicTracks.length; i++) {
        const track = musicTracks[i];
        if (track.url) {
          // For now, we'll create silent audio if no actual file
          // In production, fetch from URL or IndexedDB
          const audioFilename = `audio_music_${i}.mp3`;
          // Create minimal silent audio as placeholder
          await ffmpeg.writeFile(audioFilename, new Uint8Array(0));
          cleanupFiles.push(audioFilename);
          audioInputs.push(audioFilename);
        }
      }
      
      if (narrationTracks.length > 0 && settings.duckingEnabled) {
        // Ducking with sidechain compression
        // Music is ducked when narration is present
        audioFilter = `[1:a]sidechaincompress=threshold=-20dB:ratio=4:attack=5:release=50[ducked_music]`;
      } else {
        // No ducking, pass music through
        audioFilter = `[1:a]anull[ducked_music]`;
      }
    }
    
    // Build final filter_complex
    let filterComplex = segmentFilters.join(';');
    if (xfadeChain) {
      filterComplex += ';' + xfadeChain;
    }
    
    // Final video output
    const finalVideoLabel = segmentFilters.length > 1 ? currentOutput : 'seg0';
    
    // Add audio mixing if we have audio tracks
    if (audioInputs.length > 0 && audioFilter) {
      filterComplex += ';' + audioFilter;
      // Mix narration (if any) with ducked music
      if (narrationTracks.length > 0) {
        filterComplex += ';[ducked_music][2:a]amix=inputs=2:duration=shortest[aout]';
      } else {
        filterComplex += ';[ducked_music]anull[aout]';
      }
    }
    
    console.log('Filter graph structure:');
    console.log(filterComplex);
    
    // Prepare FFmpeg arguments
    const args: string[] = [];
    
    // Add inputs
    for (const label of inputLabels) {
      args.push('-i', label);
    }
    
    // Add audio inputs
    for (const audioInput of audioInputs) {
      args.push('-i', audioInput);
    }
    
    // Add filter complex
    args.push('-filter_complex', filterComplex);
    
    // Video encoding settings
    args.push('-map', `[${finalVideoLabel}]`);
    args.push('-c:v', settings.codec === 'h265' ? 'libx265' : 'libx264');
    args.push('-pix_fmt', 'yuv420p');
    args.push('-r', targetFps.toString());
    
    // Audio encoding (if we have audio)
    if (audioInputs.length > 0) {
      args.push('-map', '[aout]');
      args.push('-c:a', 'aac');
      args.push('-b:a', '128k');
    }
    
    // Output file
    const outputFilename = 'output.mp4';
    args.push(outputFilename);
    
    // Hook up progress reporting
    if (onProgress) {
      ffmpeg.on('progress', (progress) => {
        const pct = Math.round((progress.progress || 0) * 100);
        console.log(`FFmpeg progress: ${pct}%`);
        onProgress(pct);
      });
    }
    
    console.log('Executing FFmpeg with args:', args.join(' '));
    
    // Execute FFmpeg
    await ffmpeg.exec(args);
    
    // Read output - handle SharedArrayBuffer case
    const outputData = await ffmpeg.readFile(outputFilename);
    let blob: Blob;
    if (outputData instanceof Uint8Array) {
      // Copy bytes to ensure we have a regular ArrayBuffer for Blob
      const bytes = new Uint8Array(outputData.length);
      bytes.set(outputData);
      blob = new Blob([bytes], { type: 'video/mp4' });
    } else {
      blob = new Blob([new TextEncoder().encode(outputData as string)], { type: 'video/mp4' });
    }
    
    // Create blob URL
    const url = URL.createObjectURL(blob);
    console.log(`Render complete. Blob URL created: ${url.substring(0, 50)}...`);
    
    return url;
    
  } catch (error: any) {
    console.error('FFmpeg render error:', error);
    throw new Error(`Video render failed: ${error.message}`);
  } finally {
    // Cleanup all intermediate files from WASM FS
    const ffmpeg = ffmpegInstance;
    if (ffmpeg) {
      for (const filename of cleanupFiles) {
        try {
          await ffmpeg.deleteFile(filename);
          console.log(`Deleted FFmpeg FS file: ${filename}`);
        } catch (_e) {
          console.warn(`Failed to delete ${filename}`);
        }
      }
      
      // Also delete output file if it exists
      try {
        await ffmpeg.deleteFile('output.mp4');
      } catch (_e) {
        // Output file may not exist if render failed
      }
    }

    // Reset FFmpeg instance for next render
    ffmpegInstance = null;
    console.log('FFmpeg instance cleaned up');
  }
};

/**
 * Smoke test using the new pipeline (first 5 seconds / first 2 clips)
 */
export const renderTestVideo = async (
  edlClips: EDLClip[],
  mediaFiles: MediaFile[],
  audioTracks: AudioTrack[]
): Promise<string> => {
  console.log('Running smoke test with first 2 clips or 5 seconds');
  
  // Take first 2 clips or limit to 5 seconds total
  const testClips = edlClips.slice(0, 2).map(clip => ({
    ...clip,
    duration: Math.min(clip.duration, 2.5) // Max 2.5s per clip = 5s total
  }));
  
  const settings: RenderSettings = {
    resolution: '720p',
    frameRate: 30,
    codec: 'h264',
    duckingEnabled: false,
    duckingDepth: -12
  };
  
  const onProgress = (_pct: number) => {
    console.log(`Smoke test progress: ${_pct}%`);
  };
  
  const blobUrl = await renderFullEDL(testClips, settings, mediaFiles, audioTracks, onProgress);
  console.log('Smoke test complete:', blobUrl);
  return blobUrl;
};

/**
 * Render an isolated transition between two clips for preview
 * Builds a minimal filtergraph with just the xfade transition and typography
 */
export const renderIsolatedTransition = async (
  clipA: EDLClip,
  clipB: EDLClip,
  transitionDuration: number = 0.5,
  mediaFiles: MediaFile[],
  settings: RenderSettings
): Promise<string> => {
  const ffmpeg = await getFFmpeg();
  const cleanupFiles: string[] = [];
  
  try {
    console.log(`Rendering isolated transition: ${clipA.id} -> ${clipB.id}`);
    
    // Get image blobs for both clips
    const blobA = await getImageBlob(clipA.imageId, mediaFiles);
    const blobB = await getImageBlob(clipB.imageId, mediaFiles);
    
    if (!blobA || !blobB) {
      throw new Error('Missing image blobs for transition preview');
    }
    
    // Resolve target resolution
    const targetRes = resolveResolution(settings.resolution, '16:9');
    const targetWidth = targetRes.width;
    const targetHeight = targetRes.height;
    const targetFps = settings.frameRate;
    
    // Write input files
    await ffmpeg.writeFile('input_a.jpg', await fetchFile(blobA));
    await ffmpeg.writeFile('input_b.jpg', await fetchFile(blobB));
    cleanupFiles.push('input_a.jpg', 'input_b.jpg');
    
    // Build filter graph for isolated transition
    // Each clip shows for 1 second, then transition overlaps
    const clipDuration = 1.5; // Show each clip for 1.5s before transition
    
    // Process clip A
    const filtersA = [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`,
      buildZoompanFilter(clipA.focalPoint, clipA.motionPath, clipDuration + transitionDuration, targetFps),
      `trim=duration=${clipDuration + transitionDuration}`,
    ];
    
    // Add typography for clip A if present
    if (clipA.typography && clipA.typography.text) {
      filtersA.push(buildDrawtextFilter(
        clipA.typography.text,
        clipA.typography.position,
        clipA.typography.duration,
        0,
        targetWidth,
        targetHeight
      ));
    }
    
    // Process clip B
    const filtersB = [
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2`,
      buildZoompanFilter(clipB.focalPoint, clipB.motionPath, clipDuration + transitionDuration, targetFps),
      `trim=duration=${clipDuration + transitionDuration}`,
    ];
    
    // Add typography for clip B if present
    if (clipB.typography && clipB.typography.text) {
      filtersB.push(buildDrawtextFilter(
        clipB.typography.text,
        clipB.typography.position,
        clipB.typography.duration,
        0,
        targetWidth,
        targetHeight
      ));
    }
    
    const transitionType = clipA.transitions?.length > 0 
      ? mapTransitionType(clipA.transitions[0].type)
      : 'fade';
    
    // Build filter complex
    const filterA = filtersA.join(',');
    const filterB = filtersB.join(',');
    
    const filterComplex = `[0:v]${filterA}[a];[1:v]${filterB}[b];[a][b]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${clipDuration}[outv]`;
    
    console.log('Isolated transition filter graph:');
    console.log(filterComplex);
    
    // Execute FFmpeg
    const args = [
      '-i', 'input_a.jpg',
      '-i', 'input_b.jpg',
      '-filter_complex', filterComplex,
      '-map', '[outv]',
      '-c:v', settings.codec === 'h265' ? 'libx265' : 'libx264',
      '-pix_fmt', 'yuv420p',
      '-r', targetFps.toString(),
      '-t', (clipDuration * 2 + transitionDuration).toString(),
      'transition_preview.mp4'
    ];
    
    await ffmpeg.exec(args);
    
    // Read output
    const outputData = await ffmpeg.readFile('transition_preview.mp4');
    let blob: Blob;
    if (outputData instanceof Uint8Array) {
      const bytes = new Uint8Array(outputData.length);
      bytes.set(outputData);
      blob = new Blob([bytes], { type: 'video/mp4' });
    } else {
      blob = new Blob([new TextEncoder().encode(outputData as string)], { type: 'video/mp4' });
    }
    
    const url = URL.createObjectURL(blob);
    console.log(`Transition preview complete: ${url.substring(0, 50)}...`);
    
    return url;
    
  } catch (error: any) {
    console.error('Isolated transition render error:', error);
    throw new Error(`Transition preview failed: ${error.message}`);
  } finally {
    // Cleanup
    const ffmpeg = ffmpegInstance;
    if (ffmpeg) {
      for (const filename of cleanupFiles) {
        try {
          await ffmpeg.deleteFile(filename);
        } catch (_e) {
          // Ignore cleanup errors
        }
      }
      try {
        await ffmpeg.deleteFile('transition_preview.mp4');
      } catch (_e) {
        // Output may not exist
      }
    }
  }
};

/**
 * Reset the FFmpeg instance (useful for cleanup or reinitialization)
 */
export const resetFFmpeg = (): void => {
  if (ffmpegInstance) {
    ffmpegInstance = null;
    console.log('FFmpeg instance reset');
  }
};

/**
 * Check WASM threading capability
 */
export const checkWasmCapabilities = (): { sharedArrayBuffer: boolean; multiThreaded: boolean } => {
  const sab = typeof SharedArrayBuffer !== 'undefined';
  return {
    sharedArrayBuffer: sab,
    multiThreaded: sab
  };
};
