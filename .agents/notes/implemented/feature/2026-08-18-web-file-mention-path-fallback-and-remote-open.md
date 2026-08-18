# Agent Note: Web file mentions open path-shaped tokens, remote sessions through the panel file route

Status: implemented

English | [中文](2026-08-18-web-file-mention-path-fallback-and-remote-open.zh.md)

## Problem

Closing-prose file mentions (the `chatFileMentions` vocabulary) resolved only paths the mutation tools produced: the deliverables accumulator records `locations` from diff/edit call views, and nothing else. Files produced by a terminal command were therefore inert in the conversation — clicking the path did nothing. The open action was also Host-bound: `host.openPath` opens the Host OS default application, which is useless on a phone or any client that cannot reach the Host filesystem, and the produced-file chip row is hidden entirely for non-loopback pages.

## Decision

**Widen the mention vocabulary and split the open strategy by reach.** `producedFileMentions` now additionally resolves tokens shaped like a file path (absolute POSIX/Windows paths, or any token containing a path separator) even when no produced path matches, so closing prose can link any workspace file. A new `remoteOpen` flag (set from `connection.isLoopback !== true` in the plugin apply) switches the open action: loopback pages keep the Host opener, non-loopback pages open a new tab on the same-origin panel route `/files?path=<encoded>` that serves the file to the viewing browser.

**Server side (deployment plugin, not this package).** The panel-auth profile plugin registers the `/files` prefix route: GET/HEAD only, resolves the `path` query against a configured workspace root (default `/root/dsh`) with traversal confinement, streams with the file's MIME type, and uses an ASCII fallback filename plus RFC 5987 `filename*` for non-ASCII names (Node rejects non-latin1 header values). The route sits behind the panel's existing password guard, so it inherits the same authentication as the rest of the panel.

**Vocabulary shape.** The turn-tail chip row still claims only produced files; the prose vocabulary is deliberately wider. `forClosing` therefore always returns a resolver — no produced files no longer means no mentions, only no chips.

## Alternatives considered

**Host RPC to read file bytes and synthesize a blob download client-side**: rejected — new API surface for what an authenticated same-origin route already provides, and blobs lose the server's filename/type negotiation.

**Serve arbitrary absolute paths from `/files` without a root check**: rejected — traversal to `/etc/passwd` and beyond is unacceptable even behind auth; confinement to the workspace root is the security invariant.

## Consequences

Verified against the live deployment: loopback keeps Host open; a phone (non-loopback) opens the PDF in a new tab through `/files`; non-ASCII filenames no longer blank the response (the original header throw surfaced as an empty 400). The package keeps 100% per-file coverage with new resolver tests; the plugin registration spec now exercises the non-loopback open path. Server behavior lives in the deployment plugin, so the web app needs no restart for the route; client bundles are served per-request with `no-cache`, so UI changes apply on refresh.

## Deferred

A mobile affordance for the produced-file chips (they stay loopback-only); a client-side blob fallback for deployments without the `/files` route.
