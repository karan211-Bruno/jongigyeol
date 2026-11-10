import { Capacitor } from '@capacitor/core';

/** 네이티브 앱(iOS/Android)인지 확인합니다. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('파일을 읽지 못했습니다.'));
    reader.readAsDataURL(blob);
  });
}

function browserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * 웹에서는 일반 다운로드로, 네이티브 앱에서는 문서 폴더에 저장한 뒤
 * 공유 시트를 열어 Files/드라이브로 내보냅니다.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<void> {
  if (!isNativeApp()) {
    browserDownload(blob, filename);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = await blobToBase64(blob);
  const path = `내보내기/${filename}`;

  let uri: string;
  try {
    await Filesystem.writeFile({ path, data, directory: Directory.Documents, recursive: true });
    uri = (await Filesystem.getUri({ path, directory: Directory.Documents })).uri;
  } catch {
    await Filesystem.writeFile({ path, data, directory: Directory.Cache, recursive: true });
    uri = (await Filesystem.getUri({ path, directory: Directory.Cache })).uri;
  }

  await Share.share({
    title: filename,
    url: uri,
    dialogTitle: '내보낸 파일 저장',
  });
}
