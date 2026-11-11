import { Capacitor } from '@capacitor/core';
import { CapacitorAudioRecorder } from '@capgo/capacitor-audio-recorder';

export interface RecordingResult {
  blob: Blob;
  mime: string;
  duration: number;
}

export function audioExtension(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return 'm4a';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('ogg')) return 'ogg';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('caf')) return 'caf';
  return 'webm';
}

function guessMime(uri: string | undefined, blob: Blob | undefined): string {
  if (blob?.type) return blob.type;
  if (uri) {
    if (uri.endsWith('.m4a') || uri.endsWith('.mp4')) return 'audio/mp4';
    if (uri.endsWith('.wav')) return 'audio/wav';
    if (uri.endsWith('.caf')) return 'audio/x-caf';
    if (uri.endsWith('.ogg')) return 'audio/ogg';
  }
  return Capacitor.getPlatform() === 'ios' ? 'audio/mp4' : 'audio/webm';
}

/**
 * 받아쓰기와 함께 마이크를 녹음합니다.
 * 네이티브에서는 AVFoundation/MediaRecorder, 웹에서는 MediaRecorder를 씁니다.
 */
export class AudioRecorderSession {
  private active = false;

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<void> {
    if (this.active) return;
    if (Capacitor.isNativePlatform()) {
      const current = await CapacitorAudioRecorder.checkPermissions();
      if (current.recordAudio !== 'granted') {
        const requested = await CapacitorAudioRecorder.requestPermissions();
        if (requested.recordAudio !== 'granted') {
          throw new Error('녹음을 위해 마이크 권한이 필요합니다.');
        }
      }
    }
    await CapacitorAudioRecorder.startRecording({
      resetToPlaybackOnStop: true,
    });
    this.active = true;
  }

  async amplitude(): Promise<number> {
    if (!this.active) return 0;
    try {
      const { value } = await CapacitorAudioRecorder.getCurrentAmplitude();
      return Math.max(0, Math.min(1, value));
    } catch {
      return 0;
    }
  }

  async stop(): Promise<RecordingResult | null> {
    if (!this.active) return null;
    this.active = false;
    try {
      const result = await CapacitorAudioRecorder.stopRecording();
      let blob = result.blob ?? null;
      if (!blob && result.uri) {
        try {
          const url = Capacitor.convertFileSrc(result.uri);
          const response = await fetch(url);
          if (response.ok) blob = await response.blob();
        } catch {
          /* 네이티브 파일을 읽지 못하면 녹음 없이 글만 저장합니다. */
        }
      }
      if (!blob) return null;
      const mime = guessMime(result.uri, blob);
      return {
        blob,
        mime,
        duration: result.duration ?? 0,
      };
    } catch {
      return null;
    }
  }

  async cancel(): Promise<void> {
    if (!this.active) return;
    this.active = false;
    try {
      await CapacitorAudioRecorder.cancelRecording();
    } catch {
      /* ignore */
    }
  }
}

/** 녹음 재생 전에 iOS 오디오 세션을 재생 모드로 돌립니다. */
export async function preparePlayback(): Promise<void> {
  try {
    await CapacitorAudioRecorder.resetAudioSessionForPlayback();
  } catch {
    /* 웹/안드로이드에서는 할 일이 없습니다. */
  }
}
