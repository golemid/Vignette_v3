import { useProjectStore, type VoicePersona } from '../store/useStore';
import { clusterImages } from '../ai/services/visionService';
import { generateEDL, generateNarration } from '../ai/services/textService';
import { synthesizeSpeech, type TTSPersona } from '../ai/services/ttsService';

class Orchestrator {
  private isRunning = false;

  async runPipeline(keywords?: string): Promise<void> {
    if (this.isRunning) {
      console.warn('Pipeline already running');
      return;
    }

    this.isRunning = true;
    const store = useProjectStore.getState();

    try {
      // Stage 1: Group images using vision service
      this._updateProgress('grouping', 10, 'Analyzing images with CLIP embeddings...');
      
      // Get current media files (images only)
      const imageFiles = store.mediaFiles.filter(m => m.type === 'image');
      if (imageFiles.length === 0) {
        throw new Error('No images found in project');
      }

      // Call vision service to group images
      await clusterImages(imageFiles);
      
      // Wait for groups to be populated in store
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this._updateProgress('grouping', 25, 'Image grouping complete');

      // Stage 2: Generate EDL using text service
      this._updateProgress('writing-edl', 30, 'Generating edit decision list with LLM...');
      
      const groups = useProjectStore.getState().groups;
      if (groups.length === 0) {
        throw new Error('No groups available for EDL generation');
      }

      const thematicScript = keywords || store.thematicScript || 'Create a compelling visual narrative';
      await generateEDL(groups, thematicScript, '');
      
      // Wait for EDL to be populated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this._updateProgress('writing-edl', 50, 'EDL generation complete');

      // Stage 3: Generate narration text
      this._updateProgress('generating-narration', 55, 'Writing narration script...');
      
      const edlClips = useProjectStore.getState().edlClips;
      if (edlClips.length === 0) {
        throw new Error('No EDL clips available for narration');
      }

      await generateNarration(edlClips, '', keywords || '');
      
      // Wait for narration to be populated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      this._updateProgress('generating-narration', 70, 'Narration script complete');

      // Stage 4: Synthesize TTS
      this._updateProgress('synthesizing-tts', 75, 'Synthesizing voice with neural TTS...');
      
      const narrationText = useProjectStore.getState().narrationText;
      if (!narrationText) {
        throw new Error('No narration text available for TTS');
      }

      const voice = useProjectStore.getState().selectedVoice;
      // Convert VoicePersona to TTSPersona for TTS service
      const ttsPersona: TTSPersona | undefined = voice ? {
        id: voice.id,
        name: voice.name,
        pitch: voice.pitch,
        speed: voice.speed,
      } : undefined;
      try {
        await synthesizeSpeech(narrationText, ttsPersona);
        this._updateProgress('synthesizing-tts', 95, 'TTS synthesis complete');
      } catch (ttsError) {
        // Graceful degradation: log error, set narration blob to null, continue
        console.error('TTS synthesis failed, proceeding without narration:', ttsError);
        this._updateProgress(
          'synthesizing-tts', 
          95, 
          'TTS failed - render will proceed with music only',
          ttsError instanceof Error ? ttsError.message : String(ttsError)
        );
        // Clear any partial TTS tracks
        const state = useProjectStore.getState();
        state.audioTracks
          .filter(t => t.type === 'narration')
          .forEach(t => {
            useProjectStore.getState().removeAudioTrack(t.id);
          });
      }

      this._updateProgress('complete', 100, 'Pipeline complete! Ready for preview.');
      
      // Auto-switch to preview tab
      useProjectStore.getState().setCurrentTab('preview');

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Pipeline failed:', errorMessage);
      this._updateProgress('error', 0, 'Pipeline failed', errorMessage);
    } finally {
      this.isRunning = false;
    }
  }

  private _updateProgress(stage: string, percent: number, message: string, error?: string): void {
    // Dispatch a custom event for UI components to listen to
    window.dispatchEvent(new CustomEvent('pipeline-progress', { 
      detail: { stage, percent, message, error } 
    }));
  }

  cancel(): void {
    this.isRunning = false;
    this._updateProgress('idle', 0, 'Pipeline cancelled');
  }
}

export const orchestrator = new Orchestrator();
