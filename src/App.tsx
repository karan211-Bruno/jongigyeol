import { useEffect, useState } from 'react';
import { Library } from './components/Library';
import { NotebookView } from './components/Notebook';
import { ToastHost } from './components/ui';
import { listNotebooks, getMeta, setMeta, saveNotebook, savePages } from './lib/db';
import { makeNotebook, makePage } from './lib/model';
import { isNativeApp } from './lib/native';

function readRoute(): string | null {
  const hash = window.location.hash;
  const match = hash.match(/^#\/n\/(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [notebookId, setNotebookId] = useState<string | null>(readRoute);
  const [ready, setReady] = useState(false);
  const [libraryKey, setLibraryKey] = useState(0);

  useEffect(() => {
    const onHash = () => setNotebookId(readRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!isNativeApp()) return;
    let alive = true;
    let handle: { remove: () => void } | undefined;
    void import('@capacitor/app').then(({ App: NativeApp }) => {
      if (!alive) return;
      void NativeApp.addListener('backButton', () => {
        if (readRoute()) {
          window.location.hash = '#/';
        } else {
          void NativeApp.exitApp();
        }
      }).then((h) => {
        if (alive) handle = h;
        else void h.remove();
      });
    });
    return () => {
      alive = false;
      handle?.remove();
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const seeded = await getMeta<boolean>('seeded');
        if (!seeded) {
          const existing = await listNotebooks();
          if (!existing.length) {
            const nb = makeNotebook('나의 첫 노트', '내 노트', 'linen', 'lined');
            nb.pageCount = 1;
            const page = makePage(nb.id, 0, 'lined');
            await saveNotebook(nb);
            await savePages([page]);
          }
          await setMeta('seeded', true);
        }
      } finally {
        if (alive) setReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openNotebook = (id: string) => {
    window.location.hash = `#/n/${encodeURIComponent(id)}`;
    setNotebookId(id);
  };

  const backToLibrary = () => {
    window.location.hash = '#/';
    setNotebookId(null);
    setLibraryKey((k) => k + 1);
  };

  return (
    <ToastHost>
      {ready && notebookId ? (
        <NotebookView notebookId={notebookId} onBack={backToLibrary} />
      ) : ready ? (
        <Library key={libraryKey} onOpen={openNotebook} />
      ) : (
        <div className="editor-loading">
          <span className="progress">
            <span className="spin" />
            <span>서재를 준비하는 중…</span>
          </span>
        </div>
      )}
    </ToastHost>
  );
}
