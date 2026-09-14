// CATEGORIES tab (4c): every category with usage count and net, dimmed when
// used fewer than five times. Rename in place; delete asks inline.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import clsx from 'clsx';
import Money from './Money';
import { useToast } from '../Toast';
import { addCategory, deleteCategory, renameCategory } from '../../lib/api';
import { categoryUsage } from '../../lib/analytics';
import { afterMutation, useData } from '../../lib/data';
import { errorMessage } from '../../lib/errors';
import { useShell } from '../../lib/shell';
import { useI18n } from '../../hooks/useI18n';
import type { Category } from '../../types';

const DIM_BELOW = 5;

export default function CategoriesTab({ filter }: { filter: string }) {
  const data = useData();
  const shell = useShell();
  const toast = useToast();
  const { t, tn } = useI18n();
  const { hidden } = shell;

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);

  const beginEdit = (c: Category) => {
    setPendingDelete(null);
    setEditingId(c.id);
    setEditName(c.name);
    window.setTimeout(() => { editRef.current?.focus(); editRef.current?.select(); }, 0);
  };

  useEffect(() => {
    const it = shell.ledgerIntent;
    if (!it) return;
    if (it.kind === 'edit-category') {
      const c = data.categories.find((x) => x.id === it.id);
      if (c) beginEdit(c);
    } else if (it.kind === 'delete-category') {
      setEditingId(null);
      setPendingDelete(it.id);
    }
    shell.consumeLedgerIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shell.ledgerIntent]);

  const usage = useMemo(() => categoryUsage(data.txAll), [data.txAll]);
  const q = filter.trim().toLowerCase();
  const rows = useMemo(
    () => [...data.categories].filter((c) => !q || c.name.toLowerCase().includes(q)).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [data.categories, q]
  );

  const submitAdd = async () => {
    const name = newName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await addCategory(name);
      toast.success(t('cat.added'), { description: name });
      setNewName('');
      afterMutation();
      addRef.current?.focus();
    } catch (e) {
      toast.error(t('cat.addFailed'), { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const submitEdit = async () => {
    if (editingId == null || busy) return;
    const name = editName.trim();
    const cur = data.categories.find((c) => c.id === editingId);
    if (!name || !cur || cur.name === name) { setEditingId(null); return; }
    setBusy(true);
    try {
      await renameCategory(editingId, name);
      toast.success(t('cat.renamed'), { description: `${cur.name} → ${name}` });
      setEditingId(null);
      afterMutation();
    } catch (e) {
      toast.error(t('cat.renameFailed'), { description: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (pendingDelete == null || busy) return;
    const cur = data.categories.find((c) => c.id === pendingDelete);
    setBusy(true);
    try {
      await deleteCategory(pendingDelete);
      toast.success(t('cat.deleted'), { description: cur?.name });
      setPendingDelete(null);
      afterMutation();
    } catch (e) {
      toast.error(t('cat.deleteFailed'), { description: /in use/i.test(errorMessage(e)) ? t('cat.inUse') : errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const addKeys = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') { e.preventDefault(); void submitAdd(); } };
  const editKeys = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void submitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); setEditingId(null); }
  };

  return (
    <>
      <div className="t-addblock t-frow">
        <input ref={addRef} className="t-in" placeholder={t('cat.newPlaceholder')} aria-label={t('cat.newAria')} value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={addKeys} />
        <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitAdd()} disabled={busy || !newName.trim()}>{t('action.addEnter')}</button>
      </div>

      <div className="t-sec t-sec--mgmt">
        <span className="t-label">{t('cat.allCount', { n: rows.length })}</span>
        <div className="t-sec-rule" />
        <span className="t-sec-meta">{t('cat.netAllTime')}</span>
      </div>
      <div className="t-cat-head" role="row">
        <span>{t('cat.colName')}</span>
        <span className="t-right">{t('cat.colUsed')}</span>
        <span className="t-right">{t('cat.colNet')}</span>
        <span /><span />
      </div>
      <div className="t-pad">
        {rows.length === 0 && <div className="t-none">{q ? t('cat.noMatch') : t('cat.empty')}</div>}
        {rows.map((c) => {
          const u = usage.get(c.name.toLowerCase()) ?? { used: 0, net: 0 };
          if (editingId === c.id) {
            return (
              <div key={c.id} className="t-cat-edit">
                <input ref={editRef} className="t-in" value={editName} aria-label={t('cat.nameAria')} onChange={(e) => setEditName(e.target.value)} onKeyDown={editKeys} />
                <button type="button" className="t-btn t-btn--primary t-btn--sm" onClick={() => void submitEdit()} disabled={busy || !editName.trim()}>{t('action.saveEnter')}</button>
                <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setEditingId(null)} disabled={busy}>{t('action.esc')}</button>
              </div>
            );
          }
          return (
            <div key={c.id}>
              <div className="t-cat-row" role="row">
                <span className={clsx('n', u.used < DIM_BELOW && 'is-dim')} title={c.name}>{c.name}</span>
                <span className="c">{u.used}</span>
                <span className="v"><Money value={u.net} hidden={hidden} tone={Math.abs(u.net) < 0.005 ? 'none' : 'sign'} className={Math.abs(u.net) < 0.005 ? 'ink2' : undefined} /></span>
                <button type="button" className="t-edit-btn" style={{ width: 'auto' }} aria-label={t('cat.renameAria', { name: c.name })} title={t('action.renameTitle')} onClick={() => beginEdit(c)}>✎</button>
                <button type="button" className="t-del-btn" style={{ width: 'auto' }} aria-label={t('acc.deleteAria', { name: c.name })} title={t('action.deleteTitle')} onClick={() => { setEditingId(null); setPendingDelete(c.id); }}>⌫</button>
              </div>
              {pendingDelete === c.id && (
                <div className="t-confirm" role="alertdialog" aria-label={t('confirm.deleteAria', { name: c.name })} style={{ margin: '8px 0 0' }}>
                  <div className="h">{t('confirm.deleteHead', { name: c.name })}</div>
                  <div className="b">
                    {u.used > 0 ? tn('cat.deleteBlocked', u.used) : t('cat.deleteFree')}
                  </div>
                  <div className="a">
                    <button type="button" className="t-btn t-btn--danger t-btn--sm" onClick={() => void confirmDelete()} disabled={busy || u.used > 0}>{t('action.delete')}</button>
                    <button type="button" className="t-btn t-btn--secondary t-btn--sm" onClick={() => setPendingDelete(null)} disabled={busy}>{t('action.keep')}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="t-spacer" style={{ minHeight: 12 }} />
      <div className="t-footnote">{t('cat.footnote', { n: DIM_BELOW })}</div>
    </>
  );
}
