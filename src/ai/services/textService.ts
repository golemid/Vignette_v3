/**
 * Text Service - EDL and Narration Generation
 * 
 * Uses the text LLM to generate:
 * 1. Edit Decision Lists (EDL) from grouped images
 * 2. Narration scripts based on EDL timing
 */

import { getAIBridge } from '../aiBridge';
import type { Group, EDLClip } from '../../store/useStore';

export interface GeneratedEDL {
  clips: EDLClip[];
}

export interface GeneratedNarration {
  narration: string;
}

/**
 * Validate and parse EDL JSON response
 * Enforces strict schema matching
 */
const validateEDLSchema = (data: any): data is GeneratedEDL => {
  if (!data || typeof data !== 'object') return false;
  if (!Array.isArray(data.clips)) return false;
  
  for (const clip of data.clips) {
    if (typeof clip.groupId !== 'string') return false;
    if (typeof clip.imageId !== 'string') return false;
    if (typeof clip.duration !== 'number' || clip.duration <= 0) return false;
    if (typeof clip.startTime !== 'number') return false;
    
    // Transitions are optional but must be valid if present
    if (clip.transitions && !Array.isArray(clip.transitions)) return false;
    
    // Focal point is optional
    if (clip.focalPoint && typeof clip.focalPoint !== 'object') return false;
    
    // Typography is optional
    if (clip.typography && typeof clip.typography !== 'object') return false;
  }
  
  return true;
};

/**
 * Generate EDL from groups using the LLM
 * Returns strict JSON matching the EDLClip schema
 */
export const generateEDL = async (
  groups: Group[],
  keywords: string,
  script: string
): Promise<GeneratedEDL> => {
  if (groups.length === 0) {
    throw new Error('No groups provided for EDL generation');
  }
  
  try {
    const bridge = getAIBridge();
    
    // Call the worker to generate EDL
    const result = await bridge.generateEDL(groups, keywords, script);
    
    // Validate schema
    if (!validateEDLSchema(result)) {
      throw new Error('Invalid EDL schema returned from LLM');
    }
    
    // Post-process: ensure all required fields and calculate start times
    let currentTime = 0;
    const processedClips: EDLClip[] = result.clips.map((clip, index) => {
      const processedClip: EDLClip = {
        id: `clip_${index}`,
        groupId: clip.groupId,
        imageId: clip.imageId,
        startTime: currentTime,
        duration: clip.duration,
        transitions: clip.transitions || [],
        focalPoint: clip.focalPoint,
        motionPath: clip.motionPath,
        typography: clip.typography,
      };
      
      currentTime += clip.duration;
      return processedClip;
    });
    
    return { clips: processedClips };
  } catch (error: any) {
    console.error('EDL generation failed:', error);
    
    // Retry once on parse failure
    console.log('Retrying EDL generation...');
    try {
      const bridge = getAIBridge();
      const result = await bridge.generateEDL(groups, keywords, script);
      
      if (!validateEDLSchema(result)) {
        throw new Error('Invalid EDL schema on retry');
      }
      
      let currentTime = 0;
      const processedClips: EDLClip[] = result.clips.map((clip, index) => {
        const processedClip: EDLClip = {
          id: `clip_${index}`,
          groupId: clip.groupId,
          imageId: clip.imageId,
          startTime: currentTime,
          duration: clip.duration,
          transitions: clip.transitions || [],
          focalPoint: clip.focalPoint,
          motionPath: clip.motionPath,
          typography: clip.typography,
        };
        
        currentTime += clip.duration;
        return processedClip;
      });
      
      return { clips: processedClips };
    } catch (retryError: any) {
      console.error('EDL generation retry failed:', retryError);
      throw new Error(`Failed to generate EDL: ${retryError.message}`);
    }
  }
};

/**
 * Generate narration text from EDL
 */
export const generateNarration = async (
  edlClips: EDLClip[],
  script: string,
  keywords: string
): Promise<GeneratedNarration> => {
  if (edlClips.length === 0) {
    throw new Error('No EDL clips provided for narration generation');
  }
  
  try {
    const bridge = getAIBridge();
    
    const result = await bridge.generateNarration(edlClips, script, keywords);
    
    if (!result || typeof result.narration !== 'string') {
      throw new Error('Invalid narration response from LLM');
    }
    
    return { narration: result.narration.trim() };
  } catch (error: any) {
    console.error('Narration generation failed:', error);
    throw new Error(`Failed to generate narration: ${error.message}`);
  }
};

/**
 * Simple fallback EDL generator (when AI is unavailable)
 * Creates a basic sequential edit
 */
export const generateFallbackEDL = (groups: Group[]): GeneratedEDL => {
  const clips: EDLClip[] = [];
  let currentTime = 0;
  let clipIndex = 0;
  
  for (const group of groups) {
    if (group.imageIds.length === 0) continue;
    
    // Create one clip per group using hook image
    const imageId = group.hookImageId || group.imageIds[0];
    
    const clip: EDLClip = {
      id: `clip_${clipIndex++}`,
      groupId: group.id,
      imageId,
      startTime: currentTime,
      duration: 3, // Default 3 seconds
      transitions: [
        {
          id: `trans_${clipIndex}`,
          type: 'fade',
          duration: 0.5,
          layer: 'background',
          description: 'Fade transition',
          startTime: currentTime,
          endTime: currentTime + 0.5,
        },
      ],
      focalPoint: { x: 0.5, y: 0.5 },
      typography: group.name
        ? {
            text: group.name,
            position: { x: 0.1, y: 0.85 },
            duration: 2,
          }
        : undefined,
    };
    
    clips.push(clip);
    currentTime += clip.duration;
  }
  
  return { clips };
};

/**
 * Simple fallback narration (when AI is unavailable)
 */
export const generateFallbackNarration = (
  edlClips: EDLClip[],
  script: string
): GeneratedNarration => {
  const totalDuration = edlClips.reduce((sum, c) => sum + c.duration, 0);
  const wordCount = Math.round(totalDuration * 2.5); // ~150 WPM
  
  const fallbackText = script || `This video showcases ${edlClips.length} visual segments over ${Math.round(totalDuration)} seconds. Each segment has been carefully selected and arranged to create a cohesive narrative experience.`;
  
  // Truncate to approximate word count
  const words = fallbackText.split(/\s+/).slice(0, wordCount);
  const narration = words.join(' ');
  
  return { narration };
};
