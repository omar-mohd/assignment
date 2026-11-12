import { useEditorState } from '@tiptap/react';
import Dropdown from './Dropdown.jsx';

// Web-safe fonts: no font loading, render the same in the editor, export and PDF.
// Must match FONTS in server/content.js (the sanitizer drops anything else).
export const FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS'];
const FONT_OPTIONS = [
  { value: '', label: 'Default' },
  ...FONTS.map((f) => ({ value: f, label: f, style: { fontFamily: f } })),
];

const BLOCKS = [
  { value: 'p', label: 'Normal text' },
  { value: '1', label: 'Heading 1' },
  { value: '2', label: 'Heading 2' },
  { value: '3', label: 'Heading 3' },
];

function Btn({ active, onClick, label, title, disabled, className = '' }) {
  return (
    <button
      type="button"
      className={`tb-btn ${active ? 'active' : ''} ${className}`}
      onMouseDown={(e) => e.preventDefault()} // keep the selection in the editor
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
    >
      {label}
    </button>
  );
}

export default function Toolbar({ editor }) {
  // Re-render only when the formatting state under the cursor changes.
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      font: e.getAttributes('textStyle').fontFamily?.replace(/["']/g, '') ?? '',
      block: [1, 2, 3].find((level) => e.isActive('heading', { level }))?.toString() ?? 'p',
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });

  const chain = () => editor.chain().focus();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="↶" title="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!s.canUndo} />
      <Btn label="↷" title="Redo (Ctrl+Shift+Z)" onClick={() => chain().redo().run()} disabled={!s.canRedo} />
      <span className="tb-sep" />
      <select
        className="tb-select"
        value={s.block}
        aria-label="Text style"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') chain().setParagraph().run();
          else
            chain()
              .setHeading({ level: Number(v) })
              .run();
        }}
      >
        {BLOCKS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
      <span className="tb-sep" />
      <Dropdown
        className="font-picker"
        title="Font"
        keepFocus
        label={<span style={{ fontFamily: s.font || undefined }}>{s.font || 'Default font'}</span>}
        options={FONT_OPTIONS}
        value={s.font}
        onChange={(f) => (f ? chain().setFontFamily(f).run() : chain().unsetFontFamily().run())}
      />
      <span className="tb-sep" />
      <Btn label={<b>B</b>} title="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()} />
      <Btn label={<i>I</i>} title="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()} />
      <Btn
        label={<u>U</u>}
        title="Underline (Ctrl+U)"
        active={s.underline}
        onClick={() => chain().toggleUnderline().run()}
      />
      <span className="tb-sep" />
      <Btn
        label="• List"
        title="Bulleted list"
        active={s.bullet}
        onClick={() => chain().toggleBulletList().run()}
        className="wide"
      />
      <Btn
        label="1. List"
        title="Numbered list"
        active={s.ordered}
        onClick={() => chain().toggleOrderedList().run()}
        className="wide"
      />
    </div>
  );
}
