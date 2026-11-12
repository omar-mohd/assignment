import { useEffect, useRef, useState } from 'react';

/**
 * Small menu button with a checkmark on the selected option (Google Drive style).
 * `keepFocus` stops the trigger and items from stealing focus, so the editor selection survives.
 */
export default function Dropdown({
  label,
  options,
  value,
  onChange,
  keepFocus = false,
  align = 'left',
  className = '',
  title,
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const noFocus = keepFocus ? (e) => e.preventDefault() : undefined;

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button
        type="button"
        className="dropdown-trigger"
        onMouseDown={noFocus}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
      >
        <span className="dropdown-label">{label}</span>
        <span className="caret" aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <ul className={`dropdown-menu ${align}`} role="menu">
          {options.map((o) => (
            <li key={o.value} role="none">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={value === o.value}
                className="dropdown-item"
                style={o.style}
                onMouseDown={noFocus}
                onClick={() => {
                  setOpen(false);
                  onChange(o.value);
                }}
              >
                <span className="check" aria-hidden>
                  {value === o.value ? '✓' : ''}
                </span>
                <span>{o.label}</span>
                {o.hint && <span className="muted small dropdown-hint">{o.hint}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
