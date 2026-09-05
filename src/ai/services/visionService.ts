/**
 * Vision Service - Image Embeddings and Clustering
 * 
 * Uses the vision model to generate embeddings and perform 
 * greedy cosine-similarity clustering into groups.
 */

import { getAIBridge } from '../aiBridge';
import type { MediaFile, Group } from '../../store/useStore';

export interface VisionService {
  clusterImages(images: MediaFile[], targetGroups: number): Promise<Group[]>;
}

/**
 * Compute cosine similarity between two vectors
 */
const cosineSimilarity = (a: number[], b: number[]): number => {
  const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
  const normA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const normB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (normA * normB);
};

/**
 * Convert image File/Blob to ImageBitmap for processing
 */
const imageToBitmap = async (file: Blob): Promise<ImageBitmap> => {
  return createImageBitmap(file);
};

/**
 * Calculate saliency/contrast score for an image
 * Higher score = more visually interesting (better hook candidate)
 */
const calculateSaliencyScore = async (file: Blob): Promise<number> => {
  try {
    const bitmap = await imageToBitmap(file);
    
    // Create canvas for analysis
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      bitmap.close();
      return 0.5;
    }
    
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Calculate contrast (variance of luminance)
    let luminanceSum = 0;
    const luminances: number[] = [];
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      luminances.push(luminance);
      luminanceSum += luminance;
    }
    
    const meanLuminance = luminanceSum / luminances.length;
    let variance = 0;
    
    for (const lum of luminances) {
      variance += Math.pow(lum - meanLuminance, 2);
    }
    variance /= luminances.length;
    
    // Normalize variance to 0-1 range (typical variance is 0-10000)
    const contrastScore = Math.min(variance / 5000, 1);
    
    // Calculate edge density (simple gradient-based)
    let edgeCount = 0;
    const width = canvas.width;
    const height = canvas.height;
    
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = (y * width + x) * 4;
        const rightIdx = (y * width + (x + 1)) * 4;
        const downIdx = ((y + 1) * width + x) * 4;
        
        const currentLum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const rightLum = 0.299 * data[rightIdx] + 0.587 * data[rightIdx + 1] + 0.114 * data[rightIdx + 2];
        const downLum = 0.299 * data[downIdx] + 0.587 * data[downIdx + 1] + 0.114 * data[downIdx + 2];
        
        if (Math.abs(currentLum - rightLum) > 30 || Math.abs(currentLum - downLum) > 30) {
          edgeCount++;
        }
      }
    }
    
    const edgeDensity = edgeCount / (width * height);
    
    // Combined score: 60% contrast, 40% edge density
    return 0.6 * contrastScore + 0.4 * Math.min(edgeDensity * 10, 1);
  } catch (error) {
    console.warn('Failed to calculate saliency score:', error);
    return 0.5;
  }
};

/**
 * Greedy clustering based on cosine similarity
 */
const greedyCluster = (
  embeddings: number[][],
  imageIds: string[],
  saliencyScores: number[],
  targetGroups: number
): Group[] => {
  const n = embeddings.length;
  if (n === 0) return [];
  
  // Track which images are assigned
  const assigned = new Array(n).fill(false);
  const groups: Group[] = [];
  
  // Select initial centroids using farthest-point heuristic with saliency boost
  const centroidIndices: number[] = [];
  
  // First centroid: highest saliency score
  let maxSaliencyIdx = 0;
  for (let i = 1; i < n; i++) {
    if (saliencyScores[i] > saliencyScores[maxSaliencyIdx]) {
      maxSaliencyIdx = i;
    }
  }
  centroidIndices.push(maxSaliencyIdx);
  assigned[maxSaliencyIdx] = true;
  
  // Remaining centroids: farthest from existing centroids
  while (centroidIndices.length < Math.min(targetGroups, n)) {
    let farthestIdx = -1;
    let maxMinDist = -1;
    
    for (let i = 0; i < n; i++) {
      if (assigned[i]) continue;
      
      let minDist = Infinity;
      for (const centroidIdx of centroidIndices) {
        const similarity = cosineSimilarity(embeddings[i], embeddings[centroidIdx]);
        const distance = 1 - similarity;
        if (distance < minDist) {
          minDist = distance;
        }
      }
      
      if (minDist > maxMinDist) {
        maxMinDist = minDist;
        farthestIdx = i;
      }
    }
    
    if (farthestIdx === -1) break;
    
    centroidIndices.push(farthestIdx);
    assigned[farthestIdx] = true;
  }
  
  // Assign remaining points to nearest centroid
  for (let i = 0; i < n; i++) {
    if (assigned[i]) continue;
    
    let nearestCentroidIdx = 0;
    let minDistance = Infinity;
    
    for (let c = 0; c < centroidIndices.length; c++) {
      const similarity = cosineSimilarity(embeddings[i], embeddings[centroidIndices[c]]);
      const distance = 1 - similarity;
      if (distance < minDistance) {
        minDistance = distance;
        nearestCentroidIdx = c;
      }
    }
    
    assigned[i] = true;
    
    // Add to group
    const groupId = `group_${centroidIndices[nearestCentroidIdx]}`;
    let group = groups.find((g) => g.id === groupId);
    
    if (!group) {
      group = {
        id: groupId,
        name: `Group ${groups.length + 1}`,
        imageIds: [],
        hookImageId: undefined,
      };
      groups.push(group);
    }
    
    group.imageIds.push(imageIds[i]);
  }
  
  // Add centroids to their own groups
  for (let c = 0; c < centroidIndices.length; c++) {
    const idx = centroidIndices[c];
    const groupId = `group_${idx}`;
    let group = groups.find((g) => g.id === groupId);
    
    if (!group) {
      group = {
        id: groupId,
        name: `Group ${groups.length + 1}`,
        imageIds: [],
        hookImageId: undefined,
      };
      groups.push(group);
    }
    
    group.imageIds.unshift(imageIds[idx]); // Add centroid first
    
    // Set hook image (highest saliency in group)
    let maxSaliencyInGroup = -1;
    for (const imgId of group.imageIds) {
      const imgIdx = imageIds.indexOf(imgId);
      if (saliencyScores[imgIdx] > maxSaliencyInGroup) {
        maxSaliencyInGroup = saliencyScores[imgIdx];
        group.hookImageId = imgId;
      }
    }
  }
  
  // Ensure each group has a hook image
  for (const group of groups) {
    if (!group.hookImageId && group.imageIds.length > 0) {
      group.hookImageId = group.imageIds[0];
    }
  }
  
  return groups;
};

/**
 * Cluster images using AI embeddings
 */
export const clusterImages = async (
  images: MediaFile[],
  targetGroups: number = 5
): Promise<Group[]> => {
  if (images.length === 0) {
    return [];
  }
  
  // Limit target groups to number of images
  const actualTargetGroups = Math.min(targetGroups, images.length);
  
  try {
    // Calculate saliency scores for all images
    const saliencyScores: number[] = [];
    for (const image of images) {
      const score = await calculateSaliencyScore(image.file);
      saliencyScores.push(score);
    }
    
    // Convert images to bitmaps for embedding
    const bitmaps: ImageBitmap[] = [];
    for (const image of images) {
      const bitmap = await imageToBitmap(image.file);
      bitmaps.push(bitmap);
    }
    
    // Get embeddings from AI worker
    const bridge = getAIBridge();
    const embeddings = await bridge.embedImages(bitmaps, (progress) => {
      console.log(`Embedding progress: ${progress.processed}/${progress.total}`);
    });
    
    // Close bitmaps
    for (const bitmap of bitmaps) {
      bitmap.close();
    }
    
    // Perform clustering
    const imageIds = images.map((img) => img.id);
    const groups = greedyCluster(embeddings, imageIds, saliencyScores, actualTargetGroups);
    
    console.log(`Clustered ${images.length} images into ${groups.length} groups`);
    return groups;
  } catch (error: any) {
    console.error('Vision clustering failed:', error);
    
    // Fallback: simple random grouping
    console.warn('Falling back to random grouping');
    const fallbackGroups: Group[] = [];
    const imagesPerGroup = Math.ceil(images.length / actualTargetGroups);
    
    for (let i = 0; i < actualTargetGroups; i++) {
      const startIdx = i * imagesPerGroup;
      const endIdx = Math.min(startIdx + imagesPerGroup, images.length);
      const groupImages = images.slice(startIdx, endIdx);
      
      if (groupImages.length > 0) {
        fallbackGroups.push({
          id: `group_${i}`,
          name: `Group ${i + 1}`,
          imageIds: groupImages.map((img) => img.id),
          hookImageId: groupImages[0].id,
        });
      }
    }
    
    return fallbackGroups;
  }
};
