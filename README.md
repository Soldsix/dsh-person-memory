---
description: "Store scoped personal statements with source evidence, revisions, redaction and native owner controls."
kind: "package-bundle"
---
# dsh-person-memory

English | [中文](README.zh.md)

## Summary

An opt-in DSH bundle for sourced personal statements. It isolates namespace, account, conversation and person; retains correction history; and atomically forgets source-linked assertions. Native owner settings and inspection work independently of model tools. An optional authenticated tool proposes, reads, corrects and forgets one member’s memory. Statements remain attributed claims, not independently verified facts. This development release does not perform automatic extraction, semantic retrieval, context injection or complete backup/restore.

## Table of Contents

- [Install and compose](#install)
- [Identity and authority](#authority)
- [Sources and revisions](#revisions)
- [Forgetting](#forgetting)
- [Native model tool](#model-tool)
- [Owner interface](#owner-ui)
- [Storage and lifecycle](#storage)
- [Verification and limits](#verification)

<a id="install"></a>
## Install and compose

Use DSH 0.2.2-rc.1 with Cordis ~4.1.0. Native DSH profiles require Node >=24.9; Node 22.19 is covered for library/runtime compatibility. The bundle installs no binary or standalone server. It is disabled initially and does not load an existing robot’s data.

```sh
dsh plugin --profile MY_PROFILE add https://github.com/Soldsix/dsh-person-memory/releases/download/v0.1.0-development/dsh-person-memory-0.1.0-development.tgz
```

Open this bundle in the native Plugins page. Enable memory and select tenants, networks, bot accounts, groups or private peers. Scope lists intersect; they do not define account/group pairs. An empty directory uses `PROFILE/data/person-memory/NAMESPACE`. A custom directory must be absolute and dedicated to this namespace.

```yaml
- id: person-memory
  config:
    enabled: true
    namespace: personal
    tenants: [example-tenant]
    accounts: [example-bot]
    groups: [example-group]
    privatePeers: []
    operators: []
    toolsEnabled: false
```

An optional `im` provider records selected normalized sources, including unaddressed messages, without producing replies. The Host service also accepts explicit live or archive sources. This package owns its memory store; it does not require an archive, Chat or transport bundle unless that composition is wanted. `dsh-im-kit` and `dsh-im-requests` are public library dependencies.

<a id="authority"></a>
## Identity and authority

A person is identified by namespace plus tenant, network, bot account, conversation kind/ID and member ID. Private subjects must match the selected private peer. Ordinary Host callers can read and write their authenticated person. Configured operators may read another person in selected scopes; that does not grant model writes to another person. The profile owner separately manages assertions through owner-only RPCs.

Same-process Host plugins and local administrators are trusted. They must bind service arguments to authenticated events and choose an appropriate output audience. Model results may be quoted in public group replies; storage isolation is not private delivery. Malicious Host code cannot be sandboxed by this service. No account-linking or cross-group identity merging is inferred.

<a id="revisions"></a>
## Sources and revisions

`observe` preserves source text once with message identity, timestamps and a fingerprint. A reused message ID with different content or sender is a conflict. Attachments remain owned by their source; this store records their presence, not their bytes. Each proposal must cite an exact quote in that person’s source. Missing or mismatched evidence refuses the write.

Assertions use a logical key, optimistic `expectedVersion`, a mutation ID and separate `effectiveAt`/`recordedAt` times. A new source can correct a key or backdate its effective time without overwriting older versions. Old-source extraction cannot replace a newer correction. Recall resolves the newest version visible at both requested times before applying acceptance filters, so an unaccepted correction does not silently reveal an older accepted claim as current.

General extraction stays `candidate`. A supported initial remember directive in a live source, with literal content inside its evidence quote, may become `user-requested`. Explicit `joke`, `roleplay` and `third-party` categories remain excluded from default recall. An owner acceptance appends an `owner-confirmed` version with the same evidence. These labels record acceptance, not truth. Negation, sarcasm and arbitrary natural language are not semantically validated by these literal checks.

Recall is bounded, exact, case-sensitive substring retrieval in one person’s content and quotes. It is not semantic search. `partial` and `next` distinguish a bounded page from complete absence. Encrypted cursors bind namespace, person, requester, query, time window and person revision. Mutation or restart invalidates prior pagination.

<a id="forgetting"></a>
## Forgetting

Forgetting removes all versions of the selected key and every key transitively sharing its evidence sources. It clears those source texts and retains versioned tombstones, fingerprints and mutation receipts. This may forget several related keys; receipts report the total and whether their returned head list was bounded. A configured closure limit refuses the whole operation instead of partially forgetting.

Replay cannot restore redacted sources. A per-person ordinal fence blocks extraction from older material after forgetting. Later archive imports before that person’s forgetting cutoff are withheld. Fresh live sources can use coarse timestamps; reopening a forgotten key requires a new explicit remember request, `reopen: true` and its retained expected version. Old mutations return current bounded heads without reapplying their content.

This operation does not erase QQ archives, previously logged DSH tool results, other stores, exports or operating-system backups. It is not forensic secure erasure. Do not restore an older copied database over a newer one: that would also discard its newer forgetting markers. Cross-store removal and stale model-context replacement belong to the context-memory integration and remain unfinished.

<a id="model-tool"></a>
## Native model tool

Use dsh-qq-chat 0.3.0-development or a compatible `imRequests` provider. Enable sender-isolated group Sessions, allowlist `person_memory` in Chat, then enable this bundle’s `toolsEnabled`. Missing providers or shared group Sessions cannot activate the tool. Preview, copied agent IDs and stored Session metadata grant no authority. The actual native tool result is logged in the Session.

Actions are `recall`, `head`, `remember` and `forget`. Scope, actor, source message and mutation IDs are fixed by the live Host request. Only recall/head accept an optional subject, which still passes operator checks in the current conversation. Remember requires an exact source quote and current expected version; forgetting requires an explicit supported initial forget directive. Model arguments cannot accept candidates as owner-confirmed or invent evidence.

Canonical results distinguish refusal, query windows, bounded pages and mutation receipts. Cancellation or replacement of the live source discards late read results. A write may already have committed when its acknowledgement is lost; `write-uncertain` requires inspecting its current head rather than blindly retrying. Evidence text is untrusted data and cannot change tool permissions. Generic native tool cards and Web fallback presentation are supported.

<a id="owner-ui"></a>
## Owner interface

The native Plugins page exposes every persisted setting and body-free service/tool status. Revision-checked saving waits for idle memory/tool operations and restarts only this service. Failed drafts remain editable. A failed runtime can be disabled from the owner page before its configuration is repaired. Sources, assertion versions and forgetting markers survive supported reload/removal/reinstallation.

The inspector requires an explicit person/scope selection. It supports accepted/candidate views, time windows, bounded pagination, owner acceptance and source-linked forgetting. A changed generation clears visible stale data. Export revalidates the displayed selection and downloads one page as JSON with `completeBackup: false`; it is not a full export or restore package. Never publish these files as development evidence.

<a id="storage"></a>
## Storage and lifecycle

SQLite application identity and monotonic schema version 1 identify this store. Foreign or future generations and namespace mismatches fail without rewriting their database. A PID/nonce lease prevents two live owners; an abandoned lease can be reclaimed only after its process is gone. WAL, full synchronization and transactional updates retain committed revisions. Plaintext storage requires profile-level filesystem protection.

SQLite runs in an owned worker. Configurable queue counts/bytes, text limits, scan/result limits, lock waits and deadlines bound work. Timed-out writes remain tracked until acknowledged. Disposal cancels and joins owned work before worker exit. Storage failure is reported; it is not hidden by silently disabling memory. No model or transport is called by storage ingestion itself.

<a id="verification"></a>
## Verification and limits

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
npm pack --pack-destination artifacts
npm run test:consumer
npm run test:native
npm run test:browser -- --with-deps
npm run test:web
```

Tests use synthetic people and sources. Native model tests exercise the actual DSH adapter against controlled loopback HTTP, including parallel conversations, owner authorization, correction/forgetting, reload and a chat reply while SQLite is locked. Browser tests run an isolated headless native Web profile. Consumer tests verify installed archive bytes and strict declarations without ancestor dependencies. These do not establish real-model extraction quality or QQ client delivery.

The current release is a source-linked memory storage and tool component. Automatic extraction, vector/semantic retrieval, shared-topic context, token-budget injection/compaction, stale Session-result replacement, complete export/import/restore and offline-history recovery are separate unfinished work. No production profile, persona, skills, archive or memory is migrated by installing it.
