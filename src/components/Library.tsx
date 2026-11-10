import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoverId, Notebook, Page, TemplateId } from '../types';
import { COVERS, TEMPLATES } from '../types';
import {
  deleteNotebookDeep,
  getPages,
  importBackup,
  listNotebooks,
  saveNotebook,
  savePage,
  savePages,
  setMeta,
  wipeAll,
  type Backup,
} from '../lib/db';
import { formatRelative, makeNotebook, makePage, withPages } from '../lib/model';
import { exportAllBackup, exportNotebookPDF } from '../lib/export';
import { isNativeApp } from '../lib/native';
import { imageFileToDataUrl, pdfToPageImages } from '../lib/pdf';
import { useToast, Sheet, Confirm, Menu, Segmented, Toggle, Spinner } from './ui';
import { Icon } from './Icon';

interface Props {
  onOpen: (id: string) => void;
}

export function Library({ onOpen }: Props) {
  const toast = useToast();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [folder, setFolder] = useState('전체');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Notebook | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Notebook | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const pdfRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);
  const backupRef = useRef<HTMLInputElement>(null);
  const [fingerHint, setFingerHint] = useState(false);

  const load = useCallback(async () => {
    const list = await listNotebooks();
    setNotebooks(list);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const folders = useMemo(() => {
    const set = new Set<string>();
    notebooks.forEach((n) => set.add(n.folder));
    return ['전체', ...[...set].sort((a, b) => a.localeCompare(b, 'ko'))];
  }, [notebooks]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notebooks.filter((n) => {
      if (folder !== '전체' && n.folder !== folder) return false;
      if (!q) return true;
      return n.title.toLowerCase().includes(q) || n.folder.toLowerCase().includes(q);
    });
  }, [notebooks, folder, query]);

  async function createNotebook(draft: { title: string; folder: string; cover: CoverId; template: TemplateId }) {
    const nb = makeNotebook(draft.title, draft.folder, draft.cover, draft.template);
    const page = makePage(nb.id, 0, draft.template);
    nb.pageCount = 1;
    await saveNotebook(nb);
    await savePage(page);
    setCreateOpen(false);
    toast.show('새 노트를 만들었습니다.');
    onOpen(nb.id);
  }

  async function updateNotebook(id: string, patch: Partial<Notebook>) {
    const current = notebooks.find((n) => n.id === id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: Date.now() };
    await saveNotebook(next);
    setNotebooks((list) => list.map((n) => (n.id === id ? next : n)));
    setEditTarget(null);
    toast.show('노트 정보를 저장했습니다.');
  }

  async function duplicateNotebook(nb: Notebook) {
    setBusy('노트를 복제하는 중…');
    try {
      const pages = await getPages(nb.id);
      const copy = makeNotebook(`${nb.title} 복사본`, nb.folder, nb.cover, nb.template);
      const copiedPages: Page[] = pages.map((p, i) => ({
        ...p,
        id: `${copy.id}_p${i}`,
        notebookId: copy.id,
        order: i,
        createdAt: Date.now() + i,
        updatedAt: Date.now(),
      }));
      copy.pageCount = copiedPages.length || 1;
      if (!copiedPages.length) copiedPages.push(makePage(copy.id, 0, nb.template));
      await saveNotebook(copy);
      await savePages(copiedPages);
      await load();
      toast.show('복제했습니다.');
    } catch {
      toast.show('복제하지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function deleteNotebook(nb: Notebook) {
    setDeleteTarget(null);
    await deleteNotebookDeep(nb.id);
    setNotebooks((list) => list.filter((n) => n.id !== nb.id));
    toast.show('노트를 삭제했습니다.');
  }

  async function exportPdf(nb: Notebook) {
    setBusy('PDF를 만드는 중…');
    try {
      const pages = await getPages(nb.id);
      if (!pages.length) throw new Error('empty');
      await exportNotebookPDF(nb, pages, (done, total) => setBusy(`PDF 만드는 중… ${done}/${total}`));
      toast.show('PDF를 내려받았습니다.');
    } catch {
      toast.show('PDF를 만들지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function handlePdf(file: File) {
    setImportOpen(false);
    setBusy('PDF를 불러오는 중…');
    try {
      const result = await pdfToPageImages(file, (done, total) =>
        setProgress(`PDF 페이지 변환 ${done}/${total}`),
      );
      const title = file.name.replace(/\.pdf$/i, '');
      const nb = makeNotebook(title, '가져온 문서', 'slate', 'blank');
      const pages = result.images.map((img, i) => makePage(nb.id, i, 'blank', img));
      nb.pageCount = pages.length;
      await saveNotebook(nb);
      await savePages(pages);
      await load();
      toast.show(`${pages.length}쪽 PDF를 노트로 가져왔습니다.`);
      onOpen(nb.id);
    } catch {
      toast.show('PDF를 가져오지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
      setProgress(null);
    }
  }

  async function handleImage(files: FileList) {
    setImportOpen(false);
    setBusy('이미지를 불러오는 중…');
    try {
      const nb = makeNotebook(files[0].name.replace(/\.[^.]+$/, '') || '이미지 노트', '가져온 문서', 'kraft', 'blank');
      const pages: Page[] = [];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const dataUrl = await imageFileToDataUrl(file);
        pages.push(makePage(nb.id, pages.length, 'blank', dataUrl));
      }
      if (!pages.length) throw new Error('empty');
      nb.pageCount = pages.length;
      await saveNotebook(nb);
      await savePages(pages);
      await load();
      toast.show('이미지를 노트로 가져왔습니다.');
      onOpen(nb.id);
    } catch {
      toast.show('이미지를 가져오지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function handleRestore(file: File) {
    setImportOpen(false);
    setBusy('백업을 복원하는 중…');
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as Backup;
      const result = await importBackup(backup);
      await load();
      toast.show(`노트 ${result.notebooks}개, 페이지 ${result.pages}장을 복원했습니다.`);
    } catch {
      toast.show('백업 파일을 읽지 못했습니다.', 'warn');
    } finally {
      setBusy(null);
    }
  }

  async function doWipe() {
    setWipeOpen(false);
    setSettingsOpen(false);
    setBusy('모든 데이터를 지우는 중…');
    await wipeAll();
    await setMeta('seeded', true);
    setNotebooks([]);
    setBusy(null);
    toast.show('저장된 노트를 모두 지웠습니다.');
  }

  return (
    <div className="library">
      <header className="lib-top">
        <button className="brand" onClick={() => setFolder('전체')} aria-label="종이결 홈">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand-name">종이결</span>
        </button>

        <div className="lib-search">
          <Icon name="search" size={18} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="노트 검색"
            aria-label="노트 검색"
            enterKeyHint="search"
          />
          {query ? (
            <button className="mini-x" onClick={() => setQuery('')} aria-label="검색 지우기">
              <Icon name="close" size={15} />
            </button>
          ) : null}
        </div>

        <div className="lib-actions">
          <button className="btn ghost hide-sm" onClick={() => setImportOpen(true)}>
            <Icon name="upload" size={18} />
            <span>가져오기</span>
          </button>
          <button className="icon-btn mobile-only" onClick={() => setImportOpen(true)} aria-label="가져오기">
            <Icon name="upload" />
          </button>
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="설정">
            <Icon name="settings" />
          </button>
          <button className="btn solid" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={18} />
            <span>새 노트</span>
          </button>
        </div>
      </header>

      <div className="lib-body">
        <aside className="folder-rail" aria-label="폴더">
          <p className="rail-label">서재</p>
          {folders.map((f) => {
            const count = f === '전체' ? notebooks.length : notebooks.filter((n) => n.folder === f).length;
            return (
              <button
                key={f}
                className={`folder-item ${folder === f ? 'is-on' : ''}`}
                onClick={() => setFolder(f)}
              >
                <Icon name={f === '전체' ? 'book' : 'folder'} size={17} />
                <span className="folder-name">{f}</span>
                <span className="folder-count">{count}</span>
              </button>
            );
          })}
          <div className="rail-foot">
            <button
              className="rail-link"
              onClick={() => {
                setFingerHint(true);
                setSettingsOpen(true);
              }}
            >
              <Icon name="info" size={17} />
              사용 방법
            </button>
            <button className="rail-link" onClick={() => setSettingsOpen(true)}>
              <Icon name="settings" size={17} />
              설정
            </button>
          </div>
        </aside>

        <main className="lib-content">
          <div className="mobile-folders">
            {folders.map((f) => (
              <button
                key={f}
                className={`chip ${folder === f ? 'is-on' : ''}`}
                onClick={() => setFolder(f)}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="lib-hero">
            <div>
              <p className="eyebrow">태블릿 필기 노트</p>
              <h1>{folder === '전체' ? '내 서재' : folder}</h1>
              <p className="lib-sub">
                {query
                  ? `‘${query}’ 검색 결과 ${filtered.length}개`
                  : `${filtered.length}권의 노트 · 종이처럼 조용하게`}
              </p>
            </div>
            <button className="hero-new" onClick={() => setCreateOpen(true)}>
              <Icon name="plus" size={22} />
              <span>새 노트</span>
            </button>
          </div>

          {loading ? (
            <div className="empty-state">
              <Spinner text="서재를 여는 중…" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-glyph">
                <Icon name="book" size={30} />
              </div>
              <h2>{query ? '해당하는 노트가 없습니다' : '아직 노트가 없습니다'}</h2>
              <p>
                {query
                  ? '다른 검색어로 찾아보거나 폴더를 바꿔 보세요.'
                  : '펜을 들고 첫 장을 넘겨 보세요. 모든 필기는 이 기기에 저장됩니다.'}
              </p>
              <button className="btn solid" onClick={() => setCreateOpen(true)}>
                <Icon name="plus" size={18} />
                첫 노트 만들기
              </button>
            </div>
          ) : (
            <div className="note-grid">
              {filtered.map((nb) => (
                <article className="note-card" key={nb.id}>
                  <button
                    className={`cover cover-${nb.cover}`}
                    onClick={() => onOpen(nb.id)}
                    aria-label={`${nb.title} 열기`}
                  >
                    <span className="cover-topline" />
                    <span className="cover-title">{nb.title}</span>
                    <span className="cover-meta">
                      {nb.pageCount}쪽 · {formatRelative(nb.updatedAt)}
                    </span>
                    <span className="cover-brand">종이결</span>
                  </button>
                  <div className="card-foot">
                    <button className="card-title" onClick={() => onOpen(nb.id)}>
                      {nb.title}
                    </button>
                    <Menu
                      label={`${nb.title} 관리`}
                      items={[
                        { label: '노트 정보', icon: 'info', onSelect: () => setEditTarget(nb) },
                        { label: '복제', icon: 'copy', onSelect: () => void duplicateNotebook(nb) },
                        { label: 'PDF로 내보내기', icon: 'download', onSelect: () => void exportPdf(nb) },
                        { label: '삭제', icon: 'trash', danger: true, onSelect: () => setDeleteTarget(nb) },
                      ]}
                    />
                  </div>
                </article>
              ))}
            </div>
          )}

          <footer className="lib-foot">
            <span>종이결 · iPad와 Android 태블릿을 위한 필기 노트</span>
            <span>{isNativeApp() ? '데이터는 이 기기에만 저장됩니다' : '데이터는 이 브라우저에만 저장됩니다'}</span>
          </footer>
        </main>
      </div>

      <input
        ref={pdfRef}
        type="file"
        accept="application/pdf"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handlePdf(f);
        }}
      />
      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = e.target.files;
          if (files?.length) void handleImage(files);
          e.target.value = '';
        }}
      />
      <input
        ref={backupRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void handleRestore(f);
        }}
      />

      <CreateSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(draft) => void createNotebook(draft)}
        folders={folders.filter((f) => f !== '전체')}
      />

      <EditSheet
        notebook={editTarget}
        onClose={() => setEditTarget(null)}
        onSave={(id, patch) => void updateNotebook(id, patch)}
      />

      <Confirm
        open={!!deleteTarget}
        title="노트를 삭제할까요?"
        body={`‘${deleteTarget?.title ?? ''}’의 모든 페이지가 이 기기에서 삭제됩니다. 이 작업은 되돌릴 수 없습니다.`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && void deleteNotebook(deleteTarget)}
      />

      <Sheet open={importOpen} title="가져오기" onClose={() => setImportOpen(false)}>
        <div className="import-list">
          <button
            className="import-row"
            onClick={() => {
              setImportOpen(false);
              pdfRef.current?.click();
            }}
          >
            <span className="import-icon">
              <Icon name="file" />
            </span>
            <span>
              <strong>PDF 가져오기</strong>
              <small>각 페이지를 노트로 만들어 그 위에 필기합니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
          <button
            className="import-row"
            onClick={() => {
              setImportOpen(false);
              imageRef.current?.click();
            }}
          >
            <span className="import-icon">
              <Icon name="grid" />
            </span>
            <span>
              <strong>이미지 가져오기</strong>
              <small>사진이나 스캔본 위에 메모를 더합니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
          <button
            className="import-row"
            onClick={() => {
              setImportOpen(false);
              backupRef.current?.click();
            }}
          >
            <span className="import-icon">
              <Icon name="download" />
            </span>
            <span>
              <strong>백업 복원</strong>
              <small>종이결 JSON 백업 파일에서 노트를 되살립니다.</small>
            </span>
            <Icon name="chevronRight" size={18} />
          </button>
        </div>
      </Sheet>

      <Sheet open={settingsOpen} title="설정과 안내" onClose={() => setSettingsOpen(false)} wide>
        <div className="settings-block">
          <h3>태블릿에서 쓰기</h3>
          <p className="muted">
            홈 화면에 추가하면 주소창 없는 전체 화면 앱으로 열립니다. iPad는 공유 → ‘홈 화면에 추가’,
            Android는 Chrome 메뉴 → ‘앱 설치’를 선택하세요.
          </p>
          <ul className="gesture-list">
            <li>
              <strong>쓰기</strong> Apple Pencil · S Pen · (설정 시) 손가락
            </li>
            <li>
              <strong>이동</strong> 손가락 한 개로 끌기, 두 손가락으로 확대·축소
            </li>
            <li>
              <strong>지우개</strong> 문지르면 획이 통째로 지워집니다
            </li>
          </ul>
          <Toggle
            checked={fingerHint}
            onChange={(v) => {
              setFingerHint(v);
              localStorage.setItem('jg-finger-draw', v ? '1' : '0');
            }}
            label="손가락으로도 그리기"
            hint="끄면 손가락은 화면 이동에만 쓰입니다. 새 노트의 기본값입니다."
          />
          <p className="muted small">
            펜 도구의 손가락 설정은 노트 화면의 도구 막대에서도 바꿀 수 있습니다.
          </p>
        </div>

        <div className="settings-block">
          <h3>데이터</h3>
          <p className="muted">
            노트와 필기는 기기의 IndexedDB에 저장되며 서버로 전송되지 않습니다. 앱 데이터를 지우면
            노트도 사라지니, 중요한 노트는 백업을 내려받아 두세요.
          </p>
          <div className="row-start wrap">
            <button
              className="btn ghost"
              onClick={() => {
                void exportAllBackup()
                  .then(() => toast.show('백업 파일을 내려받았습니다.'))
                  .catch(() => toast.show('백업하지 못했습니다.', 'warn'));
              }}
            >
              <Icon name="download" size={18} />
              전체 백업
            </button>
            <button
              className="btn ghost"
              onClick={() => {
                setSettingsOpen(false);
                backupRef.current?.click();
              }}
            >
              <Icon name="upload" size={18} />
              백업 복원
            </button>
            <button className="btn quiet-danger" onClick={() => setWipeOpen(true)}>
              <Icon name="trash" size={18} />
              모든 데이터 지우기
            </button>
          </div>
        </div>

        <div className="settings-block about">
          <h3>종이결에 대하여</h3>
          <p className="muted">
            종이결은 종이 태블릿의 필기 경험에서 영감을 받아 새로 만든 독립 앱입니다. reMarkable
            또는 그 어떤 제품과도 제휴·연관 관계가 없으며, 상표와 디자인을 사용하지 않습니다.
            필기는 기기를 떠나지 않습니다.
          </p>
          <p className="muted small">버전 1.0 · 오프라인 지원 · 필압 필기</p>
        </div>
      </Sheet>

      <Confirm
        open={wipeOpen}
        title="모든 데이터를 지울까요?"
        body="이 기기에 저장된 모든 노트, 페이지, 필기가 삭제됩니다. 백업하지 않은 내용은 복구할 수 없습니다."
        confirmLabel="모두 지우기"
        onCancel={() => setWipeOpen(false)}
        onConfirm={() => void doWipe()}
      />

      {busy ? (
        <div className="busy-veil" role="alert">
          <div className="busy-card">
            <Spinner text={progress ?? busy} />
            <p className="muted small">창을 닫지 마세요.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------- create ---------------------------------- */

interface Draft {
  title: string;
  folder: string;
  cover: CoverId;
  template: TemplateId;
}

function CreateSheet({
  open,
  onClose,
  onCreate,
  folders,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (draft: Draft) => void;
  folders: string[];
}) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('내 노트');
  const [cover, setCover] = useState<CoverId>('linen');
  const [template, setTemplate] = useState<TemplateId>('lined');

  useEffect(() => {
    if (open) {
      setTitle('');
      setFolder('내 노트');
      setCover('linen');
      setTemplate('lined');
    }
  }, [open]);

  return (
    <Sheet open={open} title="새 노트" onClose={onClose} wide>
      <div className="form-grid">
        <label className="field span-2">
          <span>이름</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 주간 회의 노트"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim()) onCreate({ title, folder, cover, template });
            }}
          />
        </label>
        <label className="field">
          <span>폴더</span>
          <input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="내 노트"
            list="folder-list"
          />
          <datalist id="folder-list">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <div className="field">
          <span>종이</span>
          <Segmented
            value={template}
            options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
            onChange={setTemplate}
          />
        </div>
        <div className="field span-2">
          <span>표지</span>
          <div className="cover-picks">
            {COVERS.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`cover-pick ${cover === c.id ? 'is-on' : ''}`}
                style={{ background: c.swatch }}
                onClick={() => setCover(c.id)}
                aria-label={c.label}
                title={c.label}
              >
                {cover === c.id ? <Icon name="check" size={16} /> : null}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="row-end">
        <button className="btn ghost" onClick={onClose}>
          취소
        </button>
        <button
          className="btn solid"
          disabled={!title.trim()}
          onClick={() => onCreate({ title: title.trim(), folder, cover, template })}
        >
          만들기
        </button>
      </div>
    </Sheet>
  );
}

/* --------------------------------- edit ----------------------------------- */

function EditSheet({
  notebook,
  onClose,
  onSave,
}: {
  notebook: Notebook | null;
  onClose: () => void;
  onSave: (id: string, patch: Partial<Notebook>) => void;
}) {
  const [title, setTitle] = useState('');
  const [folder, setFolder] = useState('');
  const [cover, setCover] = useState<CoverId>('linen');
  const [template, setTemplate] = useState<TemplateId>('lined');

  useEffect(() => {
    if (notebook) {
      setTitle(notebook.title);
      setFolder(notebook.folder);
      setCover(notebook.cover);
      setTemplate(notebook.template);
    }
  }, [notebook]);

  return (
    <Sheet open={!!notebook} title="노트 정보" onClose={onClose} wide>
      {notebook ? (
        <>
          <div className="form-grid">
            <label className="field span-2">
              <span>이름</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <label className="field">
              <span>폴더</span>
              <input value={folder} onChange={(e) => setFolder(e.target.value)} />
            </label>
            <div className="field">
              <span>새 페이지 기본 종이</span>
              <Segmented
                value={template}
                options={TEMPLATES.map((t) => ({ value: t.id, label: t.label }))}
                onChange={setTemplate}
              />
            </div>
            <div className="field span-2">
              <span>표지</span>
              <div className="cover-picks">
                {COVERS.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`cover-pick ${cover === c.id ? 'is-on' : ''}`}
                    style={{ background: c.swatch }}
                    onClick={() => setCover(c.id)}
                    aria-label={c.label}
                  >
                    {cover === c.id ? <Icon name="check" size={16} /> : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="meta-line">
            <span>{notebook.pageCount}쪽</span>
            <span>만든 날 {new Date(notebook.createdAt).toLocaleDateString('ko-KR')}</span>
          </div>
          <div className="row-end">
            <button className="btn ghost" onClick={onClose}>
              취소
            </button>
            <button
              className="btn solid"
              disabled={!title.trim()}
              onClick={() => onSave(notebook.id, { title: title.trim(), folder, cover, template })}
            >
              저장
            </button>
          </div>
        </>
      ) : null}
    </Sheet>
  );
}
