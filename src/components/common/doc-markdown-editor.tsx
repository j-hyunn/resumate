"use client"

/**
 * DocTextarea — S-10 STAR 칸 / S-44 본문: a Notion-style markdown editor (TipTap + @tiptap/markdown).
 *
 * The value stays a **markdown string** (what the DB, the AI and the page save already use): the editor parses it
 * on load and serializes on every edit, so nothing outside this file changes shape. Plain text from before
 * (single newlines included) round-trips unchanged; Enter starts a new paragraph ("\n\n").
 * Typing shortcuts come from TipTap: `- ` / `1. ` lists, `# ` headings, `**굵게**`, `*기울임*`, `` `코드` ``, `> 인용`,
 * ``` code blocks; markdown tables and links are kept (shown, editable as text).
 * Tab indents a list item; elsewhere it moves focus (no keyboard trap).
 *
 * `ref` → the editable element (focus(), flashElement, getElementById by `id`). `highlightRange` finds a quote
 * in the editor's text (doc-inputs.tsx).
 */
import * as React from "react"
import { EditorContent, Extension, useEditor, type Editor } from "@tiptap/react"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import type { Node as PMNode } from "@tiptap/pm/model"
import StarterKit from "@tiptap/starter-kit"
import { Markdown, type MarkdownManager } from "@tiptap/markdown"
import { TableKit } from "@tiptap/extension-table"
import { Placeholder } from "@tiptap/extensions"
import { cn } from "@/lib/utils"

export interface DocTextareaProps {
  value: string
  onValueChange: (value: string) => void
  id?: string
  placeholder?: string
  /**
   * on the markdown string (what is saved): typing past it is ignored, a paste is cut to what still fits.
   * Content set from outside (AI fill, restore) is not cut — the page shows that as an error.
   */
  maxLength?: number
  /** an edit or a paste ran into `maxLength` (typing blocked / the paste cut) — the page shows the error */
  onLimitReached?: () => void
  className?: string
  onFocus?: () => void
  onBlur?: () => void
  "aria-label"?: string
  "aria-labelledby"?: string
  "aria-describedby"?: string
  "aria-invalid"?: boolean | "true" | "false"
}

// up to 400px tall, then it scrolls inside; thin thumb, no track / gutter, shown only while scrolling (+1s)
const EDITOR_CLASS =
  "doc-md -mx-2 max-h-[400px] min-h-[5.25rem] overflow-y-auto scrollbar-thin scrollbar-thumb-transparent scrollbar-track-transparent data-scrolling:scrollbar-thumb-muted-foreground/30 w-full rounded-md bg-transparent px-2 py-1.5 text-base leading-[1.75] outline-none hover:bg-accent/50 focus-visible:bg-transparent aria-invalid:ring-2 aria-invalid:ring-destructive"

const LIMIT_KEY = new PluginKey("docMaxLength")
/** meta on transactions the limit must let through (content replaced from outside) */
const EXTERNAL = "docExternalContent"

/** markdown length of a document */
function mdLength(editor: Editor, doc: PMNode): number {
  return editor.markdown ? editor.markdown.serialize(doc.toJSON()).length : doc.textContent.length
}

/** 글자 수 한도: block an edit that grows the markdown past `max()`, cut a paste to fit (plain text) */
function maxLengthExtension(max: () => number | undefined, reached: () => void) {
  return Extension.create({
    name: "docMaxLength",
    addProseMirrorPlugins() {
      const editor = this.editor
      return [
        new Plugin({
          key: LIMIT_KEY,
          filterTransaction(tr, state) {
            const limit = max()
            if (!limit || !tr.docChanged || tr.getMeta(EXTERNAL) || tr.getMeta("paste-cut")) return true
            const next = mdLength(editor, tr.doc)
            // shrinking (or staying) is always fine, even when the content is already over
            const ok = next <= limit || next <= mdLength(editor, state.doc)
            if (!ok) queueMicrotask(reached)
            return ok
          },
          props: {
            handlePaste(view, event) {
              const limit = max()
              if (!limit) return false
              const text = event.clipboardData?.getData("text/plain") ?? ""
              if (!text) return false
              const fits = (n: number) => mdLength(editor, view.state.tr.insertText(text.slice(0, n)).doc) <= limit
              if (fits(text.length)) return false // the normal paste (formatting kept); the filter still guards it
              // the longest prefix that still fits (markdown escaping can add characters, so measure, don't count)
              let lo = 0
              let hi = text.length
              while (lo < hi) {
                const mid = Math.ceil((lo + hi) / 2)
                if (fits(mid)) lo = mid
                else hi = mid - 1
              }
              if (lo > 0) view.dispatch(view.state.tr.insertText(text.slice(0, lo)).setMeta("paste-cut", true).scrollIntoView())
              queueMicrotask(reached)
              return true
            },
          },
        }),
      ]
    },
  })
}

/**
 * Text escaping for what we save: @tiptap/markdown turns `&` / `<` / `>` into HTML entities and backslash-escapes
 * `_` everywhere, so "R&D" was saved as "R&amp;D" and "snake_case" as "snake\_case" — the AI reads that text and
 * compares it with its proposals (V-9). Keep the text literal; escape only what would change the meaning on the
 * next parse: inline markers, `_` at a word edge (emphasis), and `<` that would open an HTML tag. Code is untouched.
 */
const patched = new WeakSet<MarkdownManager>()
export function patchMarkdownEscaping(m: MarkdownManager | undefined): void {
  if (!m || patched.has(m)) return
  patched.add(m)
  const target = m as unknown as { encodeTextForMarkdown: (text: string, node: unknown, parent: unknown) => string }
  const original = target.encodeTextForMarkdown.bind(m)
  target.encodeTextForMarkdown = (text, node, parent) => {
    // the original returns the text as is inside code (or when nothing needs escaping)
    if (original(text, node, parent) === text) return text
    return text
      .replace(/([\\`*[\]~])/g, "\\$1")
      .replace(/(?<![\p{L}\p{N}])_|_(?![\p{L}\p{N}])/gu, "\\_")
      .replace(/<(?=[A-Za-z/!?])/g, "&lt;")
  }
}

/** the editor behind an editable element + the last value it was given / emitted (highlightRange) */
const EDITORS = new WeakMap<HTMLElement, { editor: Editor; raw: () => string }>()
export function editorOf(el: HTMLElement | null): Editor | null {
  return el ? (EDITORS.get(el)?.editor ?? null) : null
}
/** the saved markdown string behind the field — what server offsets (`source_locator`) point into */
export function rawValueOf(el: HTMLElement | null): string | null {
  return el ? (EDITORS.get(el)?.raw() ?? null) : null
}

export const DocTextarea = React.forwardRef<HTMLElement, DocTextareaProps>(function DocTextarea(
  { value, onValueChange, id, placeholder, maxLength, onLimitReached, className, onFocus, onBlur, ...aria },
  ref,
) {
  // the last markdown this editor emitted / was given — a `value` that differs came from outside (AI fill, restore)
  const known = React.useRef(value)
  const handlers = React.useRef({ onValueChange, onFocus, onBlur, maxLength, onLimitReached })
  React.useEffect(() => {
    handlers.current = { onValueChange, onFocus, onBlur, maxLength, onLimitReached }
  })

  const attributes = React.useMemo(() => {
    const a: Record<string, string> = { role: "textbox", "aria-multiline": "true", class: cn(EDITOR_CLASS, className) }
    if (id) a.id = id
    if (aria["aria-label"]) a["aria-label"] = aria["aria-label"]
    if (aria["aria-labelledby"]) a["aria-labelledby"] = aria["aria-labelledby"]
    if (aria["aria-describedby"]) a["aria-describedby"] = aria["aria-describedby"]
    if (aria["aria-invalid"] === true || aria["aria-invalid"] === "true") a["aria-invalid"] = "true"
    return a
  }, [id, className, aria["aria-label"], aria["aria-labelledby"], aria["aria-describedby"], aria["aria-invalid"]]) // eslint-disable-line react-hooks/exhaustive-deps

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      // codeBlock / link / tables stay on: AI-13 drafts can hold table and code blocks, and a field that can't
      // show a block drops it on the next save (backend QA R-1)
      StarterKit.configure({
        horizontalRule: false,
        underline: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: false },
        heading: { levels: [1, 2, 3] },
        // no trailing empty paragraph: it was added on the first focus when the saved value ends in a list /
        // heading / quote / table / code block, so a field changed (and the page went dirty) just by clicking
        // it (backend QA R9 QA-01). Opening and saving without typing must keep the stored string.
        trailingNode: false,
      }),
      TableKit,
      Markdown.configure({ indentation: { style: "space", size: 2 } }),
      Placeholder.configure({ placeholder: placeholder ?? "" }),
      maxLengthExtension(
        () => handlers.current.maxLength,
        () => handlers.current.onLimitReached?.(),
      ),
    ],
    content: value,
    contentType: "markdown",
    editorProps: { attributes },
    onUpdate: ({ editor: e }) => {
      const md = e.getMarkdown()
      known.current = md
      handlers.current.onValueChange(md)
    },
    onCreate: ({ editor: e }) => patchMarkdownEscaping(e.markdown),
    onFocus: () => handlers.current.onFocus?.(),
    onBlur: () => handlers.current.onBlur?.(),
  })

  React.useEffect(() => {
    if (!editor) return
    const dom = editor.view.dom
    patchMarkdownEscaping(editor.markdown)
    EDITORS.set(dom, { editor, raw: () => known.current })
    // auto-hide scrollbar: data-scrolling while scrolling and 1s after (the class shows the thumb then)
    let timer: number | undefined
    const onScroll = () => {
      dom.dataset.scrolling = ""
      window.clearTimeout(timer)
      timer = window.setTimeout(() => delete dom.dataset.scrolling, 1000)
    }
    dom.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      EDITORS.delete(dom)
      dom.removeEventListener("scroll", onScroll)
      window.clearTimeout(timer)
    }
  }, [editor])

  React.useEffect(() => {
    editor?.setOptions({ editorProps: { attributes } })
  }, [editor, attributes])

  // value from outside (AI [반영] / 되돌리기 / input restore): replace the content, no update event, no undo step
  React.useEffect(() => {
    if (!editor || value === known.current) return
    known.current = value
    editor
      .chain()
      .command(({ tr }) => {
        tr.setMeta("addToHistory", false).setMeta(EXTERNAL, true)
        return true
      })
      .setContent(value, { contentType: "markdown", emitUpdate: false })
      .run()
  }, [editor, value])

  React.useImperativeHandle(ref, () => (editor?.view.dom ?? null) as HTMLElement, [editor])

  return <EditorContent editor={editor} />
})
