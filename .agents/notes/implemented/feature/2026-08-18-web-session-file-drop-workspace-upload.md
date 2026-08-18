# Agent Note: Web sessions accept arbitrary file drops via a workspace upload RPC

Status: implemented

English | [中文](2026-08-18-web-session-file-drop-workspace-upload.zh.md)

## Problem

The dsh web composer accepted only PNG/JPG/WebP/GIF drops. The restriction was not a missing `accept` attribute: a complete image-only pipeline runs from the browser to the model adapters — `imageMediaType()` MIME whitelisting in `ui-conversation`, the `session.prompt` wire parts (`text | image`, four image MIME literals), sharp-based durable admission in `dsh-attachment-local`, and the DeepSeek chat-completions adapter rejecting image blocks outright. Dragging a PDF/TXT/JSON was rejected or ignored, so users could not hand files to the Agent through the session UI.

## Decision

**Add a `session.uploadFile` RPC that persists a browser file into the session workspace `uploads/` directory, and have the composer attach files as a text mention.** The Agent already owns file tools and a sandbox workspace; the file lands where those tools can read it (`uploads/<name>` relative to the session `cwd`), and the user message carries `[用户上传了文件] {name}（已保存至工作区 uploads/{name}）` so the Agent sees the path and reads it itself (`pdftotext` for PDFs on typical hosts). This deliberately does not add a durable `file` content block, model-adapter support, or message-history rendering: PDFs are binary and would need host-side text extraction to reach model context, and the message-format change would ripple through every consumer of durable content. The mention text is ordinary user-visible text, so history, compaction, and model routing are untouched.

**Wire contract.** Request: `{ sessionId, name (1..200), mediaType? (≤200), data }` where `data` is canonical base64. Response: `{ name, path, bytes }` with `path` workspace-relative. New error reasons on the existing `attachment-error` code: `INVALID_FILE_BASE64`, `FILE_EMPTY`, `FILE_TOO_LARGE`, `FILE_WRITE_FAILED`; the client maps them to product copy.

**Host admission.** The handler resolves the live session's `header.cwd`, decodes via the shared canonical-base64 check, refuses empty files, enforces a 32 MiB per-file cap (far below the 160 MiB HTTP carrier body cap), sanitizes the name with `basename` + control-character strip + 120-char truncation (path traversal is impossible; `../../evil.txt` stores as `evil.txt`), and writes with `flag: 'wx'` under `uploads/`. Content is deduplicated by SHA-256: an existing file with identical bytes is reused as-is (same-name match first, then any other same-size file), so re-uploads never duplicate bytes and keep the original path; only genuinely different content under a taken name gets a numeric suffix before the final extension (`a.txt` → `a-1.txt`), and the exclusive write keeps overwrite impossible.

**Client.** `client-connection` gains the RPC on the sessions API and the fixture world; `client-runtime`'s session face gains `uploadFile()` (contract interface + implementation). `ui-conversation` gains: draft-file descriptors sharing the existing draft-attachment registry (`kind: 'file'`, no preview URL), `fileIds` in the input state with `addFiles/removeFile/pruneFiles/restoreFiles` actions mirroring the image actions, MIME-based intake splitting (`image/*` keeps the image channel and limits; everything else takes the file channel with its own 32 MiB pre-check), a chip row rendering `📎 name ×` with per-chip removal, upload-before-send in the hub sink (failure → one composer notice + draft chips restored for retry), and the drop overlay copy generalized to images-or-files with both limits on the desc line. The image intake decisions of [[2026-08-12-web-image-intake-and-limits-alignment]] (whole-page drop, limits projection, rail/thumbnail geometry) are unchanged; this note extends the same intake points with a parallel file channel.

## Alternatives considered

**Full `file` content block** (wire part, durable block, generic attachment store, model-visible injection, history rendering): rejected because it touches the message format and every model adapter for a feature the Agent's existing tools already cover, and because binary formats would still need host-side extraction to be model-visible.

**Client-side inlining of small text files into the message**: kept as future work; it would save one tool call but has no benefit for binary files and duplicates the mention path.

## Consequences

Verified end-to-end against a live deployment: upload of a JSON file round-trips byte-identical; a second upload with the same name stores as `uploads/<name>-1.<ext>`; empty files and `../../evil.txt` are refused/sanitized as specified; a real session then read a 5.7 KB Markdown file and a 754-page (8.4 MB) English PDF via `pdftotext`. Client bundles are served per-request from disk with `cache-control: no-cache`, so UI changes apply on refresh; the host handler required a `dsh-web` restart, executed as a one-shot systemd timer so the in-process session turn could finish first.

## Deferred

Small text files could inline client-side; PDF text extraction could move host-side behind the same RPC; a durable `file` block remains the path for file chips in message history, should product direction call for it.
