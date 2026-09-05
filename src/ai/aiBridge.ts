/**
 * AI Bridge - Main Thread RPC Client for AI Worker
 * 
 * Provides promise-based communication with the AI worker.
 * Features: timeouts, cancellation, and automatic task ID generation.
 */

interface WorkerResponse {
  taskId: string;
  status: 'progress' | 'result' | 'error';
  data: any;
}

interface PendingTask {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  onProgress?: (progress: any) => void;
  timeoutId: ReturnType<typeof setTimeout>;
  abortController: AbortController;
}

const DEFAULT_TIMEOUT_MS = 120000; // 2 minutes for LLM operations

export class AIBridge {
  private worker: Worker | null = null;
  private pendingTasks: Map<string, PendingTask> = new Map();
  private taskIdCounter = 0;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;

  constructor() {}

  /**
   * Initialize the AI worker
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializationPromise) return this.initializationPromise;

    this.initializationPromise = this._initializeWorker();
    return this.initializationPromise;
  }

  private async _initializeWorker(): Promise<void> {
    try {
      // Create worker from the aiWorker.ts file
      // In production, this would be bundled as a separate chunk
      const workerUrl = new URL('./aiWorker.ts', import.meta.url);
      this.worker = new Worker(workerUrl, { type: 'module' });

      // Set up message handler
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      };

      this.worker.onerror = (error) => {
        console.error('AI Worker error:', error);
        this.rejectAllPending('Worker encountered an error');
      };

      // Send init message and wait for response
      await this.sendTask('init', {}, DEFAULT_TIMEOUT_MS);

      this.initialized = true;
      console.log('AI Bridge initialized successfully');
    } catch (error: any) {
      this.initializationPromise = null;
      throw new Error(`Failed to initialize AI worker: ${error.message}`);
    }
  }

  /**
   * Handle incoming messages from the worker
   */
  private handleWorkerMessage(message: WorkerResponse): void {
    const { taskId, status, data } = message;
    const task = this.pendingTasks.get(taskId);

    if (!task) {
      console.warn(`Received message for unknown task: ${taskId}`);
      return;
    }

    switch (status) {
      case 'progress':
        task.onProgress?.(data);
        // Reset timeout on progress
        clearTimeout(task.timeoutId);
        task.timeoutId = setTimeout(
          () => this.cancelTask(taskId, 'Task timed out'),
          DEFAULT_TIMEOUT_MS
        );
        break;

      case 'result':
        clearTimeout(task.timeoutId);
        this.pendingTasks.delete(taskId);
        task.resolve(data);
        break;

      case 'error':
        clearTimeout(task.timeoutId);
        this.pendingTasks.delete(taskId);
        task.reject(new Error(data));
        break;
    }
  }

  /**
   * Send a task to the worker and return a promise
   */
  private sendTask<T>(
    type: string,
    payload: any,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    onProgress?: (progress: any) => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const taskId = `task_${Date.now()}_${this.taskIdCounter++}`;
      const abortController = new AbortController();

      const timeoutId = setTimeout(
        () => this.cancelTask(taskId, 'Task timed out'),
        timeoutMs
      );

      this.pendingTasks.set(taskId, {
        resolve,
        reject,
        onProgress,
        timeoutId,
        abortController,
      });

      this.worker.postMessage({
        taskId,
        type,
        payload,
      });
    });
  }

  /**
   * Cancel a pending task
   */
  public cancelTask(taskId: string, reason: string = 'Task cancelled'): void {
    const task = this.pendingTasks.get(taskId);
    if (task) {
      clearTimeout(task.timeoutId);
      task.abortController.abort();
      this.pendingTasks.delete(taskId);
      task.reject(new Error(reason));

      // Notify worker of cancellation
      this.worker?.postMessage({
        taskId,
        type: 'cancel',
        payload: {},
      });
    }
  }

  /**
   * Reject all pending tasks (e.g., on worker error)
   */
  private rejectAllPending(reason: string): void {
    for (const [taskId, task] of this.pendingTasks.entries()) {
      clearTimeout(task.timeoutId);
      task.reject(new Error(reason));
    }
    this.pendingTasks.clear();
  }

  /**
   * Generate embeddings for images (vision service)
   */
  public async embedImages(
    images: ImageBitmap[],
    onProgress?: (progress: { processed: number; total: number }) => void
  ): Promise<number[][]> {
    await this.initialize();

    return this.sendTask<{ embeddings: number[][] }>(
      'embed',
      { images },
      DEFAULT_TIMEOUT_MS,
      onProgress
    ).then((result) => result.embeddings);
  }

  /**
   * Generate EDL from groups and script
   */
  public async generateEDL(
    groups: Array<{ id: string; name: string; imageIds: string[]; hookImageId?: string }>,
    keywords: string,
    script: string,
    onProgress?: (progress: any) => void
  ): Promise<any> {
    await this.initialize();

    return this.sendTask(
      'generateEDL',
      { groups, keywords, script },
      DEFAULT_TIMEOUT_MS,
      onProgress
    );
  }

  /**
   * Generate narration text from EDL
   */
  public async generateNarration(
    edlClips: Array<{ id: string; duration: number; groupId: string }>,
    script: string,
    keywords: string,
    onProgress?: (progress: any) => void
  ): Promise<{ narration: string }> {
    await this.initialize();

    return this.sendTask(
      'generateNarration',
      { edlClips, script, keywords },
      DEFAULT_TIMEOUT_MS,
      onProgress
    );
  }

  /**
   * Synthesize speech from text (TTS)
   */
  public async synthesizeSpeech(
    text: string,
    pitch?: number,
    speed?: number,
    onProgress?: (progress: any) => void
  ): Promise<{ audioBlob: Blob }> {
    await this.initialize();

    return this.sendTask(
      'tts',
      { text, pitch, speed },
      DEFAULT_TIMEOUT_MS,
      onProgress
    );
  }

  /**
   * Terminate the worker (for cleanup)
   */
  public terminate(): void {
    this.cancelAllTasks('Worker terminated');
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.initialized = false;
    this.initializationPromise = null;
  }

  /**
   * Cancel all pending tasks
   */
  public cancelAllTasks(reason: string = 'Operation cancelled'): void {
    for (const taskId of this.pendingTasks.keys()) {
      this.cancelTask(taskId, reason);
    }
  }

  /**
   * Check if the bridge is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance
let aiBridgeInstance: AIBridge | null = null;

export const getAIBridge = (): AIBridge => {
  if (!aiBridgeInstance) {
    aiBridgeInstance = new AIBridge();
  }
  return aiBridgeInstance;
};
