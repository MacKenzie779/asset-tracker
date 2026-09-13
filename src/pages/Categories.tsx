import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../components/ConfirmDialog';
import EmptyState from '../components/EmptyState';
import IconButton from '../components/IconButton';
import PageContainer from '../components/PageContainer';
import Skeleton from '../components/Skeleton';
import { useToast } from '../components/Toast';
import { IconCheck, IconPencil, IconTag, IconTrash, IconX } from '../components/icons';
import { useMutation } from '../hooks/useMutation';
import { listCategories, addCategory, renameCategory, deleteCategory } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { Category } from '../types';

export default function Categories() {
  const toast = useToast();
  const mutate = useMutation();

  const [items, setItems] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const createInputRef = useRef<HTMLInputElement | null>(null);

  // edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const editInputRef = useRef<HTMLInputElement | null>(null);

  // delete confirm
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await listCategories());
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const beginCreate = () => {
    setEditId(null);
    setCreating(true);
    setNewName('');
    setTimeout(() => createInputRef.current?.focus(), 0);
  };

  const saveCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await mutate(() => addCategory(name), { success: 'Category added', error: 'Could not add category' });
      await refresh();
      setNewName('');
      setCreating(false);
    } catch {
      // reported by the toast; keep the row open
    }
  };

  const beginEdit = (c: Category) => {
    setCreating(false);
    setEditId(c.id);
    setEditName(c.name);
    setTimeout(() => editInputRef.current?.focus(), 0);
  };

  const saveEdit = async () => {
    if (editId == null) return;
    const name = editName.trim();
    if (!name) {
      setEditId(null);
      return;
    }
    const current = items.find((c) => c.id === editId);
    if (current && current.name === name) {
      setEditId(null);
      return;
    }
    try {
      await mutate(() => renameCategory(editId, name), {
        success: 'Category renamed',
        error: 'Could not rename category',
      });
      await refresh();
      setEditId(null);
    } catch {
      // reported by the toast; keep editing
    }
  };

  const confirmDelete = async () => {
    if (confirmDeleteId == null) return;
    const id = confirmDeleteId;
    setConfirmDeleteId(null);
    try {
      await deleteCategory(id);
      toast.success('Category deleted');
      await refresh();
    } catch (e) {
      const msg = String(e || '');
      const friendly = /in use/i.test(msg)
        ? 'It is used by one or more transactions.'
        : errorMessage(e, 'Delete failed.');
      toast.error('Could not delete category', { description: friendly });
    }
  };

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [items]
  );

  const firstLoad = loading && items.length === 0;

  return (
    <PageContainer>
      <div className="card">
        <div className="flex items-center justify-between gap-3 border-b border-neutral-200/50 p-4 dark:border-neutral-800/50">
          <h2 className="text-base font-semibold">
            Categories
            {!firstLoad && (
              <span className="ml-2 text-sm font-normal text-neutral-500">{items.length}</span>
            )}
          </h2>
          <button className="btn btn-primary h-9 px-3" onClick={beginCreate} disabled={creating || firstLoad}>
            New category
          </button>
        </div>

        {error && (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200/50 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-neutral-800/50 dark:bg-rose-950/40 dark:text-rose-200"
          >
            <span>Could not load categories: {error}</span>
            <button type="button" className="btn" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}

        {/* Create row */}
        {creating && (
          <div className="border-b border-neutral-200/50 p-4 dark:border-neutral-800/50">
            <div className="flex gap-2">
              <input
                ref={createInputRef}
                className="input h-9 w-full sm:max-w-md"
                placeholder="Category name"
                aria-label="New category name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void saveCreate(); }
                  if (e.key === 'Escape') { e.preventDefault(); setCreating(false); }
                }}
              />
              <button className="btn h-9 px-3" onClick={() => setCreating(false)}>Cancel</button>
              <button className="btn btn-primary h-9 px-3" onClick={() => void saveCreate()} disabled={!newName.trim()}>
                Add
              </button>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="overflow-auto">
          <table className="w-full min-w-[480px]">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-neutral-500">
                <th scope="col" className="px-4 py-2">Name</th>
                <th scope="col" className="w-28 px-4 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody aria-busy={loading || undefined}>
              {firstLoad &&
                Array.from({ length: 4 }, (_, i) => (
                  <tr key={`sk-${i}`} className="border-t border-neutral-200/50 dark:border-neutral-800/50">
                    <td className="px-4 py-3"><Skeleton className="h-4 w-40" /></td>
                    <td className="px-4 py-3"><Skeleton className="ml-auto h-4 w-14" /></td>
                  </tr>
                ))}

              {sorted.map((c) => {
                const isEditing = editId === c.id;
                return (
                  <tr
                    key={c.id}
                    className={[
                      'border-t border-neutral-200/50 dark:border-neutral-800/50',
                      isEditing ? 'bg-blue-50/50 dark:bg-blue-950/20' : '',
                    ].join(' ')}
                  >
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          className="input h-9 w-full sm:max-w-md"
                          aria-label="Category name"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); void saveEdit(); }
                            if (e.key === 'Escape') { e.preventDefault(); setEditId(null); }
                          }}
                        />
                      ) : (
                        <span className="leading-9">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <div className="flex justify-end gap-1">
                          <IconButton label="Save" onClick={() => void saveEdit()}>
                            <IconCheck />
                          </IconButton>
                          <IconButton label="Cancel" onClick={() => setEditId(null)}>
                            <IconX />
                          </IconButton>
                        </div>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <IconButton label="Edit" onClick={() => beginEdit(c)}>
                            <IconPencil />
                          </IconButton>
                          <IconButton label="Delete" tone="danger" onClick={() => setConfirmDeleteId(c.id)}>
                            <IconTrash />
                          </IconButton>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}

              {!loading && !error && sorted.length === 0 && !creating && (
                <tr>
                  <td colSpan={2}>
                    <EmptyState
                      compact
                      icon={IconTag}
                      title="No categories yet"
                      description="Categories are also created when you pick “Create” in the transaction form."
                      action={{ label: 'New category', onClick: beginCreate }}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete confirmation */}
      <ConfirmDialog
        open={confirmDeleteId !== null}
        title="Delete category?"
        description="This will only work if the category is not used by any transaction."
        confirmText="Delete"
        variant="danger"
        onCancel={() => setConfirmDeleteId(null)}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  );
}
