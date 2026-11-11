import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Segmented, Sheet, Toggle, useToast } from './ui';
import { createDictationSession, classifyDictationError, isSpeechSupported, type DictationProblem, type DictationSession, type DictationStatus } from '../lib/dictation';
import { AudioRecorderSession, preparePlayback, type RecordingResult } from '../lib/recorder';
import { isNativeApp } from '../lib/native';

type Language = 'ko-KR' | 'en-US';

const LANG_KEY = 'jg-dictation-language';
const RECORD_KEY = 'jg-dictation-record';

function loadLanguage(): Language {
  try {
    return localStorage.getItem(LANG_KEY) === 'en-US' ? 'en-US' : 'ko-KR';
  } catch {
    return 'ko-KR';
  }
}

function loadRecord(): boolean {
  try {
    return localStorage.getItem(RECORD_KEY) !== '0';
  } catch {
    return true;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onInsert: (text: string, recording: RecordingResult | null) => Promise<void>;
  onSaveAudio: (recording: RecordingResult) => Promise<void>;
}

export function DictationSheet({ open, onClose, onInsert, onSaveAudio }: Props) {
  const toast = useToast();
  const [language, setLanguage] = useState<Language>(loadLanguage);
  const [recordEnabled, setRecordEnabled] = useState(loadRecord);
  const [status, setStatus] = useState<DictationStatus>('idle');
  const [text, setText] = useState('');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [recordingActive, setRecordingActive] = useState(false);
  const [recording, setRecording] = useState<RecordingResult | null>(null);
  const [recordingNote, setRecordingNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState<DictationProblem | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sessionRef = useRef<DictationSession | null>(null);
  const recorderRef = useRef<AudioRecorderSession | null>(null);
  const textRef = useRef('');
  const timerRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const audioUrlRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const listening = status === 'listening' || status === 'starting' || status === 'stopping';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LANG_KEY, language);
    } catch {
      /* ignore */
    }
  }, [language]);

  useEffect(() => {
    try {
      localStorage.setItem(RECORD_KEY, recordEnabled ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, [recordEnabled]);

  const updateText = (value: string) => {
    textRef.current = value;
    if (mountedRef.current) setText(value);
  };

  const clearTimers = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (levelTimerRef.current) {
      window.clearInterval(levelTimerRef.current);
      levelTimerRef.current = null;
    }
  };

  const clearAudioUrl = () => {
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setAudioUrl(null);
  };

  const showError = (message: string) => {
    if (!mountedRef.current) return;
    setError(message);
    setHelp(classifyDictationError(message));
  };

  // 음성 인식이 치명적으로 실패하면 타이머와 녹음을 함께 정리합니다.
  useEffect(() => {
    if (status !== 'error') return;
    clearTimers();
    setLevel(0);
    const recorder = recorderRef.current;
    if (recorder) {
      recorderRef.current = null;
      setRecordingActive(false);
      void recorder.cancel();
    }
    setRecordingNote(null);
    // clearTimers는 매 렌더 새로 만들어지지만 status가 바뀔 때만 정리하면 됩니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const reset = () => {
    clearTimers();
    sessionRef.current = null;
    recorderRef.current = null;
    textRef.current = '';
    setText('');
    setLevel(0);
    setSeconds(0);
    setStatus('idle');
    setRecordingActive(false);
    setRecording(null);
    setRecordingNote(null);
    setError(null);
    setHelp(null);
    clearAudioUrl();
  };

  const stopSession = async () => {
    clearTimers();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) {
      try {
        await session.stop();
      } catch {
        /* ignore */
      }
    }
    const recorder = recorderRef.current;
    recorderRef.current = null;
    setRecordingActive(false);
    let result: RecordingResult | null = null;
    if (recorder) {
      result = await recorder.stop();
      if (result) {
        await preparePlayback();
        const url = URL.createObjectURL(result.blob);
        audioUrlRef.current = url;
        setAudioUrl(url);
        setRecording(result);
      }
    }
    setStatus('idle');
    setLevel(0);
    if (!textRef.current.trim() && !result) {
      setError('들은 내용이 없습니다. 마이크 가까이에서 다시 말해 보세요.');
    }
  };

  const start = async () => {
    setError(null);
    setHelp(null);
    setRecordingNote(null);
    clearAudioUrl();
    setRecording(null);
    setSeconds(0);
    setLevel(0);
    updateText('');

    if (!isSpeechSupported()) {
      showError('이 환경에서는 음성 인식을 사용할 수 없습니다. Chrome·Edge 또는 앱(iOS/Android)에서 사용해 주세요.');
      setStatus('error');
      return;
    }

    setStatus('starting');

    const callbacks = {
      onText: (value: string) => updateText(value),
      onLevel: (value: number) => {
        if (mountedRef.current) setLevel((prev) => Math.max(prev * 0.72, value));
      },
      onStatus: (next: DictationStatus) => {
        if (mountedRef.current) setStatus(next);
      },
      onError: (message: string) => {
        showError(message);
      },
    };

    const recorder = new AudioRecorderSession();
    let recorderStarted = false;
    if (recordEnabled) {
      try {
        await recorder.start();
        recorderRef.current = recorder;
        recorderStarted = true;
        setRecordingActive(true);
      } catch {
        setRecordingNote('녹음은 켜지 못했습니다. 받아쓰기만 계속합니다.');
      }
    }

    let session = createDictationSession(language, callbacks);
    try {
      await session.start();
    } catch (firstError) {
      try {
        await session.dispose();
      } catch {
        /* ignore */
      }
      if (recorderStarted) {
        await recorder.cancel();
        recorderRef.current = null;
        recorderStarted = false;
        setRecordingActive(false);
        setRecordingNote('받아쓰기와 녹음을 동시에 켤 수 없어 녹음은 꺼졌습니다. 글은 계속 받아쓰기합니다.');
        session = createDictationSession(language, callbacks);
        try {
          await session.start();
        } catch (retryError) {
          setStatus('error');
          showError(
            retryError instanceof Error
              ? retryError.message
              : firstError instanceof Error
                ? firstError.message
                : '음성 인식을 시작하지 못했습니다.',
          );
          return;
        }
      } else {
        setStatus('error');
        showError(firstError instanceof Error ? firstError.message : '음성 인식을 시작하지 못했습니다.');
        return;
      }
    }

    sessionRef.current = session;
    startedAtRef.current = Date.now();
    setStatus('listening');

    timerRef.current = window.setInterval(() => {
      if (mountedRef.current) setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
    }, 250);

    levelTimerRef.current = window.setInterval(() => {
      void (async () => {
        const activeRecorder = recorderRef.current;
        if (!activeRecorder) return;
        const value = await activeRecorder.amplitude();
        if (mountedRef.current) setLevel((prev) => Math.max(prev * 0.7, value));
      })();
    }, 130);
  };

  const toggle = () => {
    if (status === 'listening') {
      void stopSession();
    } else if (status === 'idle' || status === 'error') {
      void start();
    }
  };

  const handleClose = () => {
    clearTimers();
    const session = sessionRef.current;
    sessionRef.current = null;
    if (session) void session.cancel();
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (recorder) void recorder.cancel();
    reset();
    onClose();
  };

  const insert = async () => {
    const value = textRef.current.trim();
    if (!value) return;
    setBusy(true);
    try {
      await onInsert(value, recording);
      toast.show('받아쓴 글을 페이지에 넣었습니다.');
      reset();
      onClose();
    } catch {
      setError('페이지에 넣지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  };

  const saveAudio = async () => {
    if (!recording) return;
    try {
      await onSaveAudio(recording);
      toast.show('녹음 파일을 저장했습니다.');
    } catch {
      setError('녹음 파일을 저장하지 못했습니다.');
    }
  };

  const statusLabel =
    status === 'starting'
      ? '마이크를 준비하는 중…'
      : status === 'listening'
        ? '듣고 있어요'
        : status === 'stopping'
          ? '마무리하는 중…'
          : status === 'error'
            ? '받아쓰기를 시작하지 못했습니다'
            : '마이크를 눌러 시작하세요';

  const native = isNativeApp();
  const helpContent: Record<DictationProblem, { title: string; lines: string[] }> = {
    permission: {
      title: '마이크를 허용하는 방법',
      lines: native
        ? [
            '기기 설정 → 종이결 → 마이크 권한을 허용합니다.',
            'iOS는 설정 앱 → 개인정보 보호 및 보안 → 마이크, Android는 설정 → 앱 → 종이결 → 권한에서 허용합니다.',
            '허용한 뒤 아래 “권한 다시 요청”을 누릅니다.',
          ]
        : [
            '주소창 왼쪽의 자물쇠(사이트 설정) 아이콘을 누릅니다.',
            "마이크를 '허용'으로 바꾸고 페이지를 새로 고칩니다.",
            'iPad·iPhone은 설정 앱 → Safari → 마이크에서 허용할 수 있습니다.',
            '허용한 뒤 아래 “권한 다시 요청”을 누르면 바로 시작됩니다.',
          ],
    },
    device: {
      title: '마이크를 찾을 수 없습니다',
      lines: [
        '마이크나 헤드셋이 기기에 제대로 연결되어 있는지 확인합니다.',
        '다른 앱이 마이크를 사용 중이면 그 앱을 닫습니다.',
        '그래도 안 되면 기기를 다시 시작한 뒤 시도합니다.',
      ],
    },
    insecure: {
      title: '보안 연결이 필요합니다',
      lines: [
        '마이크는 HTTPS 주소 또는 localhost에서만 사용할 수 있습니다.',
        'http:// 주소로 열었다면 https:// 주소나 설치한 앱에서 사용해 주세요.',
      ],
    },
    network: {
      title: '음성 인식 서버에 연결하지 못했습니다',
      lines: [
        '인터넷 연결을 확인한 뒤 다시 시도합니다.',
        'Chrome의 음성 인식은 인터넷 연결이 필요합니다.',
        '오프라인에서는 글을 직접 입력해 주세요.',
      ],
    },
    unsupported: {
      title: '이 환경에서는 받아쓰기를 쓸 수 없습니다',
      lines: native
        ? [
            '기기 설정에서 음성 인식(받아쓰기)이 켜져 있는지 확인합니다.',
            '기기의 음성 인식 언어에 한국어가 추가되어 있는지 확인합니다.',
            '아래 글 상자에 직접 입력해 페이지에 넣을 수도 있습니다.',
          ]
        : [
            'Chrome 또는 Edge 최신 버전에서 열어 주세요.',
            'iPad·Android에서는 종이결 앱의 받아쓰기를 사용해 주세요.',
            '아래 글 상자에 직접 입력해 페이지에 넣을 수도 있습니다.',
          ],
    },
  };
  const helpInfo = help ? helpContent[help] : null;

  return (
    <Sheet open={open} title="받아쓰기" onClose={handleClose} wide>
      <div className="dictation">
        <div className={`dictation-hero ${status === 'listening' ? 'is-live' : ''}`}>
          <button
            type="button"
            className={`dictation-mic ${status === 'listening' ? 'is-on' : ''}`}
            onClick={toggle}
            disabled={status === 'starting' || status === 'stopping' || busy}
            aria-label={status === 'listening' ? '받아쓰기 중지' : '받아쓰기 시작'}
          >
            <Icon name={status === 'listening' ? 'stop' : 'mic'} size={30} />
          </button>
          <div className="dictation-meta">
            <div className="dictation-status-line">
              <strong>{statusLabel}</strong>
              {recordingActive ? (
                <span className="recording-dot">
                  <i /> 녹음 중
                </span>
              ) : null}
            </div>
            <span className="dictation-timer">{formatTime(seconds)}</span>
            <div className="dictation-level" aria-hidden="true">
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    transform: `scaleY(${Math.max(0.16, Math.min(1, level * (1 + i * 0.24)))})`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <p className="dictation-error" role="alert">
            {error}
          </p>
        ) : null}
        {helpInfo ? (
          <div className="dictation-helpbox" role="note">
            <div className="dictation-helpbox-head">
              <Icon name="info" size={16} />
              <strong>{helpInfo.title}</strong>
            </div>
            <ul>
              {helpInfo.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <div className="dictation-helpbox-actions">
              <button type="button" className="btn ghost" onClick={() => void start()} disabled={busy}>
                <Icon name="mic" size={15} />
                권한 다시 요청
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => document.getElementById('dictation-text')?.focus()}
              >
                <Icon name="pencil" size={15} />
                직접 입력
              </button>
            </div>
          </div>
        ) : null}
        {recordingNote ? <p className="dictation-note">{recordingNote}</p> : null}

        <div className="dictation-options">
          <div className="dictation-option">
            <span className="opt-label">언어</span>
            <Segmented<Language>
              value={language}
              options={[
                { value: 'ko-KR', label: '한국어' },
                { value: 'en-US', label: 'English' },
              ]}
              onChange={(value) => {
                if (!listening) setLanguage(value);
              }}
            />
          </div>
          <Toggle
            checked={recordEnabled}
            onChange={setRecordEnabled}
            disabled={listening}
            label="녹음도 함께 저장"
            hint="받아쓰는 동안 마이크 소리를 함께 녹음합니다."
          />
        </div>

        <label className="dictation-label" htmlFor="dictation-text">
          받아쓴 글
        </label>
        <textarea
          id="dictation-text"
          className="dictation-text"
          value={text}
          readOnly={listening}
          onChange={(e) => updateText(e.target.value)}
          placeholder="마이크를 누르고 말하면 여기에 글로 적힙니다. 멈춘 뒤 직접 고칠 수도 있습니다."
          rows={8}
        />

        {audioUrl ? (
          <div className="dictation-playback">
            <div className="dictation-playback-head">
              <span>
                <Icon name="mic" size={15} /> 녹음된 소리
              </span>
              {recording ? (
                <button type="button" className="mini-btn" onClick={() => void saveAudio()}>
                  <Icon name="download" size={15} />
                  오디오 저장
                </button>
              ) : null}
            </div>
            <audio
              controls
              src={audioUrl}
              onPlay={() => void preparePlayback()}
              aria-label="받아쓰기 녹음 재생"
            />
          </div>
        ) : null}

        <p className="muted small dictation-help">
          받아쓰기는 기기의 음성 인식 엔진을 사용합니다. 인터넷 연결이나 기기 언어 설정에 따라 정확도가
          달라질 수 있으며, 녹음과 글은 이 기기 안에만 저장됩니다.
        </p>

        <div className="dictation-actions">
          {status === 'listening' ? (
            <button type="button" className="btn ghost" onClick={() => void stopSession()}>
              <Icon name="stop" size={17} />
              중지
            </button>
          ) : (
            <button type="button" className="btn ghost" onClick={() => void start()} disabled={busy}>
              <Icon name="mic" size={17} />
              다시 시작
            </button>
          )}
          <button
            type="button"
            className="btn solid"
            onClick={() => void insert()}
            disabled={!text.trim() || listening || busy}
          >
            <Icon name="text" size={17} />
            페이지에 넣기
          </button>
        </div>
      </div>
    </Sheet>
  );
}
