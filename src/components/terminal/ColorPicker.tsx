import clsx from 'clsx';

/** The eight entity colours from the handoff. Accounts keep whatever colour they already have. */
export const ENTITY_COLORS = ['#f0a13c', '#4c8dff', '#35d68f', '#f2e85c', '#e9edf5', '#ff6a4d', '#c8a98a', '#e88ae0'];

export default function ColorPicker({ value, onChange, label = 'Colour' }: { value: string; onChange: (c: string) => void; label?: string }) {
  const known = ENTITY_COLORS.includes(value.toLowerCase());
  const colors = known ? ENTITY_COLORS : [value, ...ENTITY_COLORS.slice(0, 7)];
  return (
    <div className="t-colors" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={c.toLowerCase() === value.toLowerCase()}
          aria-label={c}
          title={c}
          className={clsx('t-color', c.toLowerCase() === value.toLowerCase() && 'is-selected')}
          style={{ background: c }}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  );
}
