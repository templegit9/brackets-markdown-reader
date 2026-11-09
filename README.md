# Markdown Reader for Brackets

Markdown Reader adds a live, formatted preview panel to Brackets. It is designed to be installed locally and does not need an internet connection.

## Install

1. Zip the contents of this folder (not the containing folder).
2. In Brackets, select **File → Extension Manager**.
3. Drag the zip file onto the Extension Manager, or choose **Install from URL** if you host the zip.
4. Open a Markdown file and choose **View → Markdown Reader: Toggle Preview**.

The preview can also be toggled with `Ctrl-Shift-M` (`Cmd-Shift-M` on macOS in standard Brackets key bindings).

## Included Markdown

- Headings, paragraphs, emphasis, links, images, and automatic links
- Ordered and unordered lists, including task checkboxes
- Fenced and indented code blocks
- Blockquotes, rules, and GitHub-style tables
- Light and dark preview themes

## HTML preview

The second toolbar button (**H**), or **View → Markdown Reader: Toggle HTML Preview**, renders the current `.html`/`.htm` file in the same panel and updates as you type. Relative stylesheets, images and scripts resolve from the file's folder. The page runs in a sandboxed frame, so its scripts cannot reach Brackets.

External links open in the default browser. Raw HTML is rendered as text, and unsafe URL schemes are blocked.
