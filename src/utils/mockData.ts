import { useProjectStore } from '../store/useStore';
import { generateId } from './fileUtils';
import type { Group } from '../store/useStore';

const mockImageNames = [
  'sunset_beach.jpg',
  'city_skyline.png',
  'mountain_vista.jpg',
  'forest_path.png',
  'ocean_waves.jpg',
  'desert_dunes.png',
  'urban_street.jpg',
  'garden_flowers.png',
  'night_lights.jpg',
  'morning_mist.png',
  'autumn_leaves.jpg',
  'winter_snow.png',
  'spring_blossoms.jpg',
  'summer_field.png',
  'rainy_window.jpg',
];

const mockGroupThemes = [
  { name: 'Urban Exploration', description: 'A journey through city landscapes and hidden architectural gems' },
  { name: 'Natural Wonders', description: 'Capturing the raw beauty of untouched wilderness' },
  { name: 'Human Connection', description: 'Moments of intimacy and emotion in everyday life' },
  { name: 'Time & Memory', description: 'Nostalgic scenes that evoke feelings of the past' },
  { name: 'Light & Shadow', description: 'Playing with contrast to create dramatic visual narratives' },
];

const mockStylePresets = [
  'cinematic',
  'documentary',
  'vintage',
  'minimalist',
  'vibrant',
  'moody',
  'dreamy',
];

function generateMockProxyUrl(index: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    const hue = (index * 25) % 360;
    const gradient = ctx.createLinearGradient(0, 0, 512, 512);
    gradient.addColorStop(0, `hsl(${hue}, 70%, 50%)`);
    gradient.addColorStop(1, `hsl(${(hue + 40) % 360}, 60%, 40%)`);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`IMG ${index + 1}`, 256, 256);

    return canvas.toDataURL('image/jpeg', 0.8);
  }

  return '';
}

export function injectMockData(): void {
  const mockFiles = mockImageNames.map((name, index) => {
    const id = generateId('media');
    const proxyUrl = generateMockProxyUrl(index);

    return {
      id,
      name,
      type: 'image' as const,
      file: new File(['mock'], name, { type: 'image/jpeg' }),
      proxyUrl,
      originalUrl: proxyUrl,
      width: 512,
      height: 512,
      description: `Mock image ${index + 1}: ${name.replace(/\.[^/.]+$/, '').replace('_', ' ')}`,
      hookScore: Math.floor(Math.random() * 100),
    };
  });

  useProjectStore.setState(state => ({
    mediaFiles: [...state.mediaFiles, ...mockFiles],
  }));

  setTimeout(() => {
    const currentState = useProjectStore.getState();
    const imageIds = currentState.mediaFiles.filter(f => f.type === 'image').map(f => f.id);

    const groupSize = Math.ceil(imageIds.length / 3);
    const newGroups: Group[] = [];

    for (let i = 0; i < 3; i++) {
      const startIdx = i * groupSize;
      const endIdx = Math.min(startIdx + groupSize, imageIds.length);
      const groupImages = imageIds.slice(startIdx, endIdx);

      if (groupImages.length > 0) {
        const theme = mockGroupThemes[i % mockGroupThemes.length];
        newGroups.push({
          id: generateId('group'),
          name: theme.name,
          imageIds: groupImages,
          stylePreset: mockStylePresets[i % mockStylePresets.length],
          hookImageId: groupImages[0],
        });
      }
    }

    useProjectStore.setState({
      groups: newGroups,
    });

    console.log(`[Mock Data] Injected ${mockFiles.length} images and ${newGroups.length} groups`);
  }, 100);
}

export { mockGroupThemes, mockStylePresets };
