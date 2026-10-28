/*
 * Markdown Reader for Brackets
 * A dependency-free, live Markdown preview. Kept deliberately self-contained
 * so it can be installed from a .zip and used without network access.
 */
define(function (require, exports, module) {
    "use strict";

    var AppInit             = brackets.getModule("utils/AppInit"),
        CommandManager      = brackets.getModule("command/CommandManager"),
        DocumentManager      = brackets.getModule("document/DocumentManager"),
        EditorManager        = brackets.getModule("editor/EditorManager"),
        ExtensionUtils       = brackets.getModule("utils/ExtensionUtils"),
        Menus                = brackets.getModule("command/Menus"),
        WorkspaceManager     = brackets.getModule("view/WorkspaceManager"),
        $                    = window.$;

    var COMMAND_ID = "markdown-reader.togglePreview",
        PANEL_ID = "markdown-reader.previewPanel",
        panel,
        $panel,
        $preview,
        $empty,
        $title,
        $toolbarButton,
        isVisible = false,
        activeDocument,
        observedDocument,
        renderTimer,
        theme = "light";

    ExtensionUtils.loadStyleSheet(module, "styles.css");

    var panelTemplate =
        '<section id="' + PANEL_ID + '" class="markdown-reader" aria-label="Markdown preview">' +
            '<header class="markdown-reader__toolbar">' +
                '<div class="markdown-reader__title"><span class="markdown-reader__dot"></span><span class="markdown-reader__filename"></span></div>' +
                '<div class="markdown-reader__actions">' +
                    '<button class="markdown-reader__action" data-action="theme" title="Toggle preview theme">Theme</button>' +
                    '<button class="markdown-reader__action" data-action="refresh" title="Refresh preview">Refresh</button>' +
                    '<button class="markdown-reader__action" data-action="close" title="Close preview">Close</button>' +
                '</div>' +
            '</header>' +
            '<div class="markdown-reader__viewport">' +
                '<article class="markdown-reader__content"></article>' +
                '<div class="markdown-reader__empty">Open a <strong>.md</strong> file to see its formatted preview.</div>' +
            '</div>' +
        '</section>';

    function isMarkdown(document) {
        var path = document && document.file && document.file.fullPath || "";
        return /\.(md|markdown|mdown|mkdn|mdtxt)$/i.test(path);
    }

    function escapeHTML(value) {
        return String(value || "").replace(/&/g, "&amp;")
            .replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }

    function safeUrl(url, image) {
        var value = String(url || "").trim();
        if (!value || /^(javascript|vbscript|data(?!:image\/(png|gif|jpe?g|webp);base64))/i.test(value)) {
            return "";
        }
        if (!image && /^data:/i.test(value)) {
            return "";
        }
        return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    }

    function inline(source) {
        var text = escapeHTML(source), tokens = [], tokenIndex = 0;

        function stash(html) {
            var marker = "\u0000MD" + (tokenIndex++) + "\u0000";
            tokens.push({ marker: marker, html: html });
            return marker;
        }

        // Code comes first so Markdown syntax inside it stays literal.
        text = text.replace(/`([^`]+)`/g, function (_, code) {
            return stash("<code>" + code + "</code>");
        });
        text = text.replace(/!\[([^\]]*)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, function (_, alt, url, title) {
            var safe = safeUrl(url, true);
            return safe ? stash('<img src="' + safe + '" alt="' + alt + '"' + (title ? ' title="' + title + '"' : "") + ">") : alt;
        });
        text = text.replace(/\[([^\]]+)\]\(([^\s)]+)(?:\s+["']([^"']*)["'])?\)/g, function (_, label, url, title) {
            var safe = safeUrl(url, false);
            return safe ? stash('<a href="' + safe + '" target="_blank" rel="noopener noreferrer"' + (title ? ' title="' + title + '"' : "") + ">" + label + "</a>") : label;
        });
        text = text.replace(/&lt;(https?:\/\/[^\s&]+|mailto:[^\s&]+|[^\s@&]+@[^\s@&]+\.[^\s@&]+)&gt;/g, function (_, url) {
            var href = url.indexOf("@") !== -1 && url.indexOf(":") === -1 ? "mailto:" + url : url;
            return stash('<a href="' + safeUrl(href, false) + '" target="_blank" rel="noopener noreferrer">' + url + "</a>");
        });
        text = text.replace(/(^|[^\\])\*\*([^*]+)\*\*/g, "$1<strong>$2</strong>")
            .replace(/(^|[^\\])__([^_]+)__/g, "$1<strong>$2</strong>")
            .replace(/(^|[^\\])~~([^~]+)~~/g, "$1<del>$2</del>")
            .replace(/(^|[^\\])\*([^*\n]+)\*/g, "$1<em>$2</em>")
            .replace(/(^|[^\\])_([^_\n]+)_/g, "$1<em>$2</em>")
            .replace(/  $/, "<br>");
        tokens.forEach(function (token) { text = text.split(token.marker).join(token.html); });
        return text.replace(/\\([\\`*{}_\[\]&lt;&gt;#+.!\-])/g, "$1");
    }

    function isTableDivider(line) {
        return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
    }

    function tableCells(line) {
        var cells = line.trim().replace(/^\||\|$/g, "").split("|");
        return cells.map(function (cell) { return cell.trim(); });
    }

    function renderTable(header, divider, rows) {
        var headings = tableCells(header), aligns = tableCells(divider), html = "<table><thead><tr>";
        headings.forEach(function (heading, index) {
            var spec = aligns[index] || "", align = /^:/.test(spec) && /:$/.test(spec) ? "center" : /^:/.test(spec) ? "left" : /:$/.test(spec) ? "right" : "";
            html += "<th" + (align ? ' style="text-align:' + align + '"' : "") + ">" + inline(heading) + "</th>";
        });
        html += "</tr></thead><tbody>";
        rows.forEach(function (row) {
            html += "<tr>";
            tableCells(row).forEach(function (cell, index) {
                var spec = aligns[index] || "", align = /^:/.test(spec) && /:$/.test(spec) ? "center" : /^:/.test(spec) ? "left" : /:$/.test(spec) ? "right" : "";
                html += "<td" + (align ? ' style="text-align:' + align + '"' : "") + ">" + inline(cell) + "</td>";
            });
            html += "</tr>";
        });
        return html + "</tbody></table>";
    }

    function renderMarkdown(markdown) {
        var lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n"), html = [], i = 0, paragraph = [];

        function flushParagraph() {
            if (paragraph.length) {
                html.push("<p>" + paragraph.map(inline).join("\n") + "</p>");
                paragraph = [];
            }
        }

        while (i < lines.length) {
            var line = lines[i], match, next = lines[i + 1];
            if (/^\s*$/.test(line)) { flushParagraph(); i++; continue; }
            if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
                flushParagraph();
                var fence = line.match(/^\s*(```+|~~~+)/)[1], language = (line.replace(/^\s*(```+|~~~+)/, "").trim() || "").replace(/[^\w+-]/g, ""), code = [];
                i++;
                while (i < lines.length && lines[i].indexOf(fence) !== 0) { code.push(lines[i++]); }
                if (i < lines.length) { i++; }
                html.push('<pre><code' + (language ? ' class="language-' + language + '"' : "") + ">" + escapeHTML(code.join("\n")) + "</code></pre>");
                continue;
            }
            if ((match = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/))) {
                flushParagraph();
                var level = match[1].length, id = match[2].toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
                html.push("<h" + level + (id ? ' id="' + id + '"' : "") + ">" + inline(match[2]) + "</h" + level + ">"); i++; continue;
            }
            if (next && /^\s*(=+|-+)\s*$/.test(next) && line.trim()) {
                flushParagraph();
                var setextLevel = /^\s*=/.test(next) ? 1 : 2;
                html.push("<h" + setextLevel + ">" + inline(line) + "</h" + setextLevel + ">"); i += 2; continue;
            }
            if (/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) { flushParagraph(); html.push("<hr>"); i++; continue; }
            if (/^\s*>/.test(line)) {
                flushParagraph(); var quote = [];
                while (i < lines.length && /^\s*>/.test(lines[i])) { quote.push(lines[i++].replace(/^\s*>\s?/, "")); }
                html.push("<blockquote>" + renderMarkdown(quote.join("\n")) + "</blockquote>"); continue;
            }
            if (next && isTableDivider(next) && line.indexOf("|") !== -1) {
                flushParagraph(); var rows = []; i += 2;
                while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim()) { rows.push(lines[i++]); }
                html.push(renderTable(line, next, rows)); continue;
            }
            if ((match = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/))) {
                flushParagraph();
                var ordered = /\d/.test(match[1]), items = [];
                while (i < lines.length && (match = lines[i].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/)) && (/\d/.test(match[1]) === ordered)) {
                    var content = match[2], task = content.match(/^\[([ xX])\]\s+(.*)$/);
                    if (task) { content = '<label class="task"><input type="checkbox" disabled' + (/x/i.test(task[1]) ? " checked" : "") + "> " + inline(task[2]) + "</label>"; }
                    else { content = inline(content); }
                    items.push("<li>" + content + "</li>"); i++;
                }
                html.push((ordered ? "<ol>" : "<ul>") + items.join("") + (ordered ? "</ol>" : "</ul>")); continue;
            }
            if (/^( {4}|\t)/.test(line)) {
                flushParagraph(); var indented = [];
                while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || !lines[i])) { indented.push(lines[i++].replace(/^( {4}|\t)/, "")); }
                html.push("<pre><code>" + escapeHTML(indented.join("\n").replace(/\n+$/, "")) + "</code></pre>"); continue;
            }
            paragraph.push(line); i++;
        }
        flushParagraph();
        return html.join("\n");
    }

    function currentDocument() {
        var editor = EditorManager.getActiveEditor();
        return editor && editor.document || DocumentManager.getCurrentDocument();
    }

    function updatePreview() {
        if (!isVisible || !$preview) { return; }
        var document = currentDocument();
        activeDocument = document;
        if (!isMarkdown(document)) {
            $preview.empty(); $empty.show(); $title.text("No Markdown file selected"); return;
        }
        $empty.hide();
        $title.text(document.file.name || "Markdown preview");
        $preview.html(renderMarkdown(document.getText()));
    }

    function scheduleUpdate() {
        window.clearTimeout(renderTimer);
        renderTimer = window.setTimeout(updatePreview, 120);
    }

    function watchCurrentDocument() {
        var document = currentDocument();
        if (observedDocument === document) { return; }
        if (observedDocument) { $(observedDocument).off("change.markdownReader"); }
        observedDocument = document;
        if (observedDocument) { $(observedDocument).on("change.markdownReader", scheduleUpdate); }
    }

    function setTheme(nextTheme) {
        theme = nextTheme || "light";
        $panel.toggleClass("markdown-reader--dark", theme === "dark");
    }

    function ensurePanel() {
        if (panel) { return; }
        panel = WorkspaceManager.createBottomPanel(PANEL_ID, $(panelTemplate), 310);
        $panel = panel.$panel;
        $preview = $panel.find(".markdown-reader__content");
        $empty = $panel.find(".markdown-reader__empty");
        $title = $panel.find(".markdown-reader__filename");
        setTheme(theme);
        $panel.on("click", "[data-action]", function () {
            var action = $(this).data("action");
            if (action === "close") { togglePreview(false); }
            if (action === "refresh") { updatePreview(); }
            if (action === "theme") { setTheme(theme === "dark" ? "light" : "dark"); }
        });
        $preview.on("click", "a", function (event) {
            event.preventDefault();
            var href = $(this).attr("href");
            if (href) { brackets.app.openURLInDefaultBrowser(href); }
        });
    }

    function togglePreview(show) {
        ensurePanel();
        isVisible = show === undefined ? !isVisible : show;
        if (isVisible) { panel.show(); updatePreview(); }
        else { panel.hide(); }
        if ($toolbarButton) { $toolbarButton.toggleClass("markdown-reader-toolbar-button--active", isVisible); }
    }

    function addToolbarButton() {
        var $toolbar = $("#main-toolbar .buttons");
        if (!$toolbar.length || $("#markdown-reader-toolbar-button").length) { return; }
        $toolbarButton = $("<a>", {
            id: "markdown-reader-toolbar-button",
            "class": "markdown-reader-toolbar-button",
            href: "#",
            title: "Toggle Markdown Reader preview"
        }).appendTo($toolbar);
        $toolbarButton.on("click", function (event) {
            event.preventDefault();
            togglePreview();
        });
    }

    AppInit.appReady(function () {
        CommandManager.register("Markdown Reader: Toggle Preview", COMMAND_ID, function () { togglePreview(); });
        var viewMenu = Menus.getMenu(Menus.AppMenuBar.VIEW_MENU);
        viewMenu.addMenuItem(COMMAND_ID, "Ctrl-Shift-M");
        addToolbarButton();
        DocumentManager.on("currentDocumentChange", function () { watchCurrentDocument(); scheduleUpdate(); });
        DocumentManager.on("documentRefreshed documentSaved", scheduleUpdate);
        EditorManager.on("activeEditorChange", function () { watchCurrentDocument(); scheduleUpdate(); });
        watchCurrentDocument();
    });
});
