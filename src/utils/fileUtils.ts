/**
 * Media Proxy Generator
 * Creates optimized 512px max dimension proxies for images
 */

export async function generateProxy(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    img.onload = () => {
      const maxSize = 512;
      let width = img.width;
      let height = img.height;
      
      // Maintain aspect ratio while fitting within 512px max
      if (width > height) {
        if (width > maxSize) {
          height = Math.round((height * maxSize) / width);
          width = maxSize;
        }
      } else {
        if (height > maxSize) {
          width = Math.round((width * maxSize) / height);
          height = maxSize;
        }
      }
      
      canvas.width = width;
      canvas.height = height;
      
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      } else {
        reject(new Error('Could not get canvas context'));
      }
      
      // Clean up object URL
      URL.revokeObjectURL(img.src);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(img.src);
      reject(new Error('Failed to load image'));
    };
    
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Load image from URL
 */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = src;
  });
}

/**
 * Validate file type and size
 */
export function validateFile(file: File, maxSizeMB: number = 50): { valid: boolean; error?: string } {
  const validImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
  const validAudioTypes = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/aac'];
  
  const isImage = validImageTypes.includes(file.type);
  const isAudio = validAudioTypes.includes(file.type);
  
  if (!isImage && !isAudio) {
    return { valid: false, error: `Unsupported file type: ${file.type}` };
  }
  
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > maxSizeMB) {
    return { valid: false, error: `File too large: ${sizeMB.toFixed(2)}MB (max: ${maxSizeMB}MB)` };
  }
  
  return { valid: true };
}

/**
 * Generate unique ID
 */
export function generateId(prefix: string = 'id'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
