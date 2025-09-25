import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import { listCategories, addCategory, renameCategory, deleteCategory } from '../lib/api';
import type { Category } from '../types';

export default function Categories() {
  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);

  // create
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');

  // delete confirm + error dialog
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const list = await listCategories();
      setItems(list);
    } catch (e) {
      console.error(e);
      setErrorMsg('Failed to load categories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const beginCreate = () => {
    setCreating(true);
    setNewName('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await addCategory(name);
      await refresh();
      setNewName('');
      setCreating(false);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.toString() || 'Failed to add category.');
    }
  };

  const beginEdit = (c: Category) => {
    setEditId(c.id);
    setEditName(c.name);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const saveEdit = async () => {
    if (editId == null) return;
    const name = editName.trim();
    if (!name) { setEditId(null); return; }
    try {
      await renameCategory(editId, name);
      await refresh();
      setEditId(null);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.toString() || 'Failed to rename category.');
    }
  };

  const requestDelete = (id: number) => setConfirmDeleteId(id);

  const confirmDelete = async () => {
    const id = confirmDeleteId!;
    setConfirmDeleteId(null);
    try {
      await deleteCategory(id);
      await refresh();
    } catch (e: any) {
      const msg = String(e || '');
      const friendly = /in use/i.test(msg)
        ? 'Cannot delete this category because it is used by one or more transactions.'
        : 'Delete failed.';
      setErrorMsg(friendly);
    }
  };

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [items]
  );

  return (
    <div className="px-3 sm:px-4 md:px-6 pt-4 grid gap-6">
      <div className="card">
        <div className="p-4 border-b border-neutral-200/50 dark:border-neutral-800/50 flex items-center justify-between">
          <h2 className="text-base font-semibold">Categories</h2>
          <button className="btn btn-primary h-9 px-3" onClick={beginCreate} disabled={creating || loading}>
            New category
          </button>
        </div>

        {/* Create row */}
        {creating && (
          <div className="p-4 border-b border-neutral-200/50 dark:border-neutral-800/50">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="input h-9 w-full sm:max-w-md"
                placeholder="Category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveCreate();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <button className="btn h-9 px-3" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn-primary h-9 px-3" onClick={saveCreate} disabled={!newName.trim()}>
                Add
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto">
          <table className="min-w-[480px] w-full">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2 w-28 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id} className="border-t border-neutral-200/50 dark:border-neutral-800/50">
                  <td className="px-4 py-2">
                    {editId === c.id ? (
                      <input
                        ref={inputRef}
                        className="input h-9 w-full sm:max-w-md"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit();
                          if (e.key === 'Escape') setEditId(null);
                        }}
                      />
                    ) : (
                      <span className="leading-9">{c.name}</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {editId === c.id ? (
                      <div className="flex gap-1 justify-end">
                        <IconBtn label="Save" onClick={saveEdit}>
                          <IconCheck />
                        </IconBtn>
                        <IconBtn label="Cancel" onClick={() => setEditId(null)}>
                          <IconX />
                        </IconBtn>
                      </div>
                    ) : (
                      <div className="flex gap-1 justify-end">
                        <IconBtn label="Edit" onClick={() => beginEdit(c)}>
                          <IconPencil />
                        </IconBtn>
                        <IconBtn label="Delete" onClick={() => requestDelete(c.id)}>
                          <IconTrash />
                        </IconBtn>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {sorted.length === 0 && !creating && (
                <tr>
                  <td className="px-4 py-6 text-sm text-neutral-500" colSpan={2}>
                    No categories yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="p-4 text-sm text-neutral-500 border-t border-neutral-200/50 dark:border-neutral-800/50">
            Loading…
          </div>
        )}
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete category?"
        description="This will only work if the category is not used by any transaction."
        confirmText="Delete"
        cancelText="Cancel"
        danger
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={confirmDelete}
      />

      {/* Error dialog (app-styled) */}
      <ConfirmDialog
        open={!!errorMsg}
        title="Action failed"
        description={errorMsg ?? ''}
        confirmText="OK"
        onConfirm={() => setErrorMsg(null)}
        onCancel={() => setErrorMsg(null)}
      />
    </div>
  );
}

/* Icon button + inline icons (exactly like Transactions) */
function IconBtn({
  label, onClick, children,
}: { label: string; onClick?: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      className="icon-btn"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function IconPencil(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z" strokeWidth="1.8"/></svg>)}
function IconTrash(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 6h18" strokeWidth="1.8"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" strokeWidth="1.8"/><path d="M10 11v6M14 11v6" strokeWidth="1.8"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" strokeWidth="1.8"/></svg>)}
function IconCheck(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6 9 17l-5-5" strokeWidth="1.8"/></svg>)}
function IconX(){return(<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18M6 6l12 12" strokeWidth="1.8"/></svg>)}
