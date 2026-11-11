import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capgo/capacitor-speech-recognition';
import type { PluginListenerHandle } from '@capacitor/core';

export type DictationStatus = 'idle' | 'starting' | 'listening' | 'stopping' | 'error';

export interface DictationCallbacks {
  onText: (text: string) => void;
  onLevel: (level: number) => void;
  onStatus: (status: DictationStatus, detail?: string) => void;
  onError: (message: string) => void;
}

export interface DictationSession {
  start: () => Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  dispose: () => Promise<void>;
}

export function isSpeechSupported(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  if (typeof window === 'undefined') return false;
  const w = window as unknown as {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
}

function joinText(a: string, b: string): string {
  const left = a.trim();
  const right = b.trim();
  if (!left) return right;
  if (!right) return left;
  return `${left} ${right}`;
}

/* --------------------------------- native --------------------------------- */

class NativeDictationSession implements DictationSession {
  private handles: PluginListenerHandle[] = [];
  private active = false;
  private stopping = false;
  private restarting = false;
  private restartTimer: number | null = null;
  private committed = '';
  private sessionText = '';

  constructor(
    private readonly language: string,
    private readonly callbacks: DictationCallbacks,
  ) {}

  private emit(): void {
    this.callbacks.onText(joinText(this.committed, this.sessionText));
  }

  private async commitSession(): Promise<void> {
    try {
      const last = await SpeechRecognition.getLastPartialResult();
      if (last.available && last.text) this.sessionText = last.text;
    } catch {
      /* 마지막 부분 결과를 못 읽어도 진행합니다. */
    }
    if (this.sessionText.trim()) {
      this.committed = joinText(this.committed, this.sessionText);
    }
    this.sessionText = '';
    this.emit();
  }

  private async begin(): Promise<void> {
    if (!this.active) return;
    try {
      await SpeechRecognition.start({
        language: this.language,
        partialResults: true,
        addPunctuation: true,
        maxResults: 1,
      });
    } catch (error) {
      if (!this.active) return;
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.onError(`음성 인식을 시작하지 못했습니다. (${message})`);
      this.callbacks.onStatus('error');
      this.active = false;
    }
  }

  private scheduleRestart(): void {
    if (!this.active || this.restarting) return;
    this.restarting = true;
    if (this.restartTimer) window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => {
      this.restartTimer = null;
      this.restarting = false;
      if (this.active) void this.begin();
    }, 260);
  }

  async start(): Promise<void> {
    this.callbacks.onStatus('starting');
    const permission = await SpeechRecognition.requestPermissions();
    if (permission.speechRecognition !== 'granted') {
      throw new Error('음성 인식과 마이크 권한이 필요합니다. 설정에서 허용해 주세요.');
    }
    const availability = await SpeechRecognition.available();
    if (!availability.available) {
      throw new Error('이 기기에서는 음성 인식을 사용할 수 없습니다.');
    }

    this.handles.push(
      await SpeechRecognition.addListener('partialResults', (event) => {
        const text = event.accumulatedText || event.matches?.[0] || event.accumulated || '';
        if (text) {
          this.sessionText = text;
          this.emit();
        }
      }),
    );
    this.handles.push(
      await SpeechRecognition.addListener('audioLevel', (event) => {
        this.callbacks.onLevel(Math.max(0, Math.min(1, event.level)));
      }),
    );
    this.handles.push(
      await SpeechRecognition.addListener('error', (event) => {
        if (event.code === 'no-speech' || event.code === 'speech-timeout') return;
        this.callbacks.onError(event.message || '음성 인식 중 오류가 발생했습니다.');
      }),
    );
    this.handles.push(
      await SpeechRecognition.addListener('listeningState', (event) => {
        if (!this.active || this.stopping) return;
        if (event.state === 'stopped' || event.status === 'stopped') {
          if (event.reason === 'error' && event.errorCode) {
            this.callbacks.onError(`음성 인식이 중단되었습니다. (${event.errorCode})`);
          }
          void (async () => {
            await this.commitSession();
            this.scheduleRestart();
          })();
        }
      }),
    );

    this.active = true;
    this.callbacks.onStatus('listening');
    await this.begin();
  }

  async stop(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    this.stopping = true;
    this.callbacks.onStatus('stopping');
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      await SpeechRecognition.stop();
    } catch {
      /* 이미 멈춘 경우 무시합니다. */
    }
    await this.commitSession();
    await this.disposeListeners();
    this.stopping = false;
    this.callbacks.onStatus('idle');
  }

  async cancel(): Promise<void> {
    this.active = false;
    this.stopping = true;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      await SpeechRecognition.stop();
    } catch {
      /* ignore */
    }
    await this.disposeListeners();
    this.stopping = false;
    this.callbacks.onStatus('idle');
  }

  private async disposeListeners(): Promise<void> {
    const handles = this.handles;
    this.handles = [];
    await Promise.all(
      handles.map((handle) =>
        handle.remove().catch(() => {
          /* ignore */
        }),
      ),
    );
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}

/* ----------------------------------- web ---------------------------------- */

interface WebSpeechAlternative {
  transcript: string;
}
interface WebSpeechResult {
  isFinal: boolean;
  0: WebSpeechAlternative;
  length: number;
}
interface WebSpeechResultList {
  length: number;
  item: (index: number) => WebSpeechResult;
  [index: number]: WebSpeechResult;
}
interface WebSpeechEvent {
  resultIndex: number;
  results: WebSpeechResultList;
}
interface WebSpeechErrorEvent {
  error: string;
  message?: string;
}
interface WebSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: WebSpeechEvent) => void) | null;
  onerror: ((event: WebSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type WebSpeechConstructor = new () => WebSpeechRecognition;

function webSpeechConstructor(): WebSpeechConstructor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: WebSpeechConstructor;
    webkitSpeechRecognition?: WebSpeechConstructor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

class WebDictationSession implements DictationSession {
  private recognition: WebSpeechRecognition | null = null;
  private active = false;
  private stopping = false;
  private finalText = '';
  private interim = '';
  private restartTimer: number | null = null;

  constructor(
    private readonly language: string,
    private readonly callbacks: DictationCallbacks,
  ) {}

  private emit(): void {
    this.callbacks.onText(joinText(this.finalText, this.interim));
  }

  private create(): WebSpeechRecognition {
    const Ctor = webSpeechConstructor();
    if (!Ctor) throw new Error('이 브라우저에서는 음성 인식을 사용할 수 없습니다.');
    const recognition = new Ctor();
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      this.callbacks.onStatus('listening');
    };
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) {
          if (text.trim()) this.finalText = joinText(this.finalText, text);
        } else {
          interim += text;
        }
      }
      this.interim = interim;
      this.emit();
    };
    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        this.callbacks.onError('마이크와 음성 인식 권한이 필요합니다. 브라우저 설정에서 허용해 주세요.');
        this.active = false;
        this.callbacks.onStatus('error');
        return;
      }
      this.callbacks.onError(event.message || `음성 인식 오류: ${event.error}`);
    };
    recognition.onend = () => {
      if (!this.active || this.stopping) return;
      // Chrome은 침묵이 길면 세션을 끝냅니다. 계속 듣도록 다시 시작합니다.
      if (this.restartTimer) window.clearTimeout(this.restartTimer);
      this.restartTimer = window.setTimeout(() => {
        this.restartTimer = null;
        if (this.active) {
          try {
            this.recognition?.start();
          } catch {
            /* 이미 시작 중이면 무시합니다. */
          }
        }
      }, 320);
    };
    return recognition;
  }

  async start(): Promise<void> {
    this.callbacks.onStatus('starting');
    this.recognition = this.create();
    this.active = true;
    try {
      this.recognition.start();
    } catch (error) {
      this.active = false;
      this.callbacks.onStatus('error');
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  async stop(): Promise<void> {
    this.active = false;
    this.stopping = true;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.recognition?.stop();
    } catch {
      /* ignore */
    }
    this.interim = '';
    this.emit();
    this.recognition = null;
    this.stopping = false;
    this.callbacks.onStatus('idle');
  }

  async cancel(): Promise<void> {
    this.active = false;
    this.stopping = true;
    if (this.restartTimer) {
      window.clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    try {
      this.recognition?.abort();
    } catch {
      /* ignore */
    }
    this.recognition = null;
    this.stopping = false;
    this.callbacks.onStatus('idle');
  }

  async dispose(): Promise<void> {
    await this.cancel();
  }
}

export function createDictationSession(
  language: string,
  callbacks: DictationCallbacks,
): DictationSession {
  return Capacitor.isNativePlatform()
    ? new NativeDictationSession(language, callbacks)
    : new WebDictationSession(language, callbacks);
}
