#!/usr/bin/env node
// Dependency-free structural checks for the exported n8n workflows.
// This is NOT a substitute for importing into n8n; it catches the mistakes
// that break imports or leak secrets. Usage: node scripts/validate.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'workflows');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const TRIGGERS = new Set([
  'n8n-nodes-base.webhook',
  'n8n-nodes-base.scheduleTrigger',
  'n8n-nodes-base.errorTrigger',
]);
const KNOWN = new Set([
  ...TRIGGERS,
  'n8n-nodes-base.code',
  'n8n-nodes-base.if',
  'n8n-nodes-base.set',
  'n8n-nodes-base.respondToWebhook',
  'n8n-nodes-base.slack',
  'n8n-nodes-base.gmail',
  'n8n-nodes-base.googleSheets',
  'n8n-nodes-base.httpRequest',
  'n8n-nodes-base.hubspot',
  'n8n-nodes-base.stickyNote',
]);

function* stringsIn(value) {
  if (typeof value === 'string') yield value;
  else if (Array.isArray(value)) for (const v of value) yield* stringsIn(v);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) yield* stringsIn(v);
}

const errors = [];
const warnings = [];

function check(file, wf) {
  const err = (m) => errors.push(`${file}: ${m}`);
  const warn = (m) => warnings.push(`${file}: ${m}`);

  for (const key of ['name', 'nodes', 'connections']) if (!(key in wf)) err(`missing top-level "${key}"`);
  if (wf.active !== false) err('"active" must be false in a shared export');

  const names = new Set();
  const ids = new Set();
  for (const n of wf.nodes) {
    for (const k of ['id', 'name', 'type', 'typeVersion', 'position', 'parameters']) {
      if (!(k in n)) err(`node "${n.name ?? '?'}" missing "${k}"`);
    }
    if (names.has(n.name)) err(`duplicate node name "${n.name}"`);
    if (ids.has(n.id)) err(`duplicate node id "${n.id}"`);
    names.add(n.name);
    ids.add(n.id);
    if (!KNOWN.has(n.type)) err(`unknown node type "${n.type}" on "${n.name}"`);
    if (!Array.isArray(n.position) || n.position.length !== 2) err(`bad position on "${n.name}"`);

    for (const [ctype, c] of Object.entries(n.credentials ?? {})) {
      if (!/^YOUR_/.test(c.name)) err(`credential "${c.name}" on "${n.name}" is not a YOUR_* placeholder`);
      if (c.id !== 'YOUR_CRED_ID') err(`credential id on "${n.name}" (${ctype}) is not the placeholder`);
    }

    if (n.type === 'n8n-nodes-base.code') {
      try {
        new AsyncFunction('$input', '$env', '$', 'require', n.parameters.jsCode);
      } catch (e) {
        err(`Code node "${n.name}" has a syntax error: ${e.message}`);
      }
    }

    if (n.type !== 'n8n-nodes-base.code') {
      for (const s of stringsIn(n.parameters)) {
        const opens = (s.match(/\{\{/g) ?? []).length;
        const closes = (s.match(/\}\}/g) ?? []).length;
        if (opens !== closes) err(`unbalanced {{ }} in "${n.name}": ${s.slice(0, 60)}`);
      }
    }

    if (n.type === 'n8n-nodes-base.webhook') {
      if (n.parameters.options?.rawBody !== true) err(`webhook "${n.name}" must enable rawBody for HMAC`);
      if (n.parameters.responseMode !== 'responseNode') warn(`webhook "${n.name}" does not use responseNode`);
    }
  }

  const reachable = new Set();
  for (const [from, outs] of Object.entries(wf.connections)) {
    if (!names.has(from)) err(`connection from unknown node "${from}"`);
    for (const branch of outs.main ?? []) {
      for (const t of branch) {
        if (!names.has(t.node)) err(`connection to unknown node "${t.node}"`);
        reachable.add(t.node);
      }
    }
  }
  for (const n of wf.nodes) {
    if (TRIGGERS.has(n.type) || n.type === 'n8n-nodes-base.stickyNote') continue;
    if (!reachable.has(n.name)) err(`node "${n.name}" is not reachable from any trigger`);
  }

  if (!wf.nodes.some((n) => n.type === 'n8n-nodes-base.errorTrigger')) err('no Error Trigger branch');
  if (!wf.nodes.some((n) => TRIGGERS.has(n.type) && n.type !== 'n8n-nodes-base.errorTrigger'))
    err('no primary trigger node');

  const hasWebhook = wf.nodes.some((n) => n.type === 'n8n-nodes-base.webhook');
  if (hasWebhook && !wf.nodes.some((n) => /HMAC/.test(n.name))) err('webhook workflow has no HMAC verification node');
}

for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  try {
    check(file, JSON.parse(readFileSync(join(dir, file), 'utf8')));
  } catch (e) {
    errors.push(`${file}: invalid JSON (${e.message})`);
  }
}

for (const w of warnings) console.warn('WARN ', w);
for (const e of errors) console.error('FAIL ', e);
console.log(errors.length ? `\n${errors.length} problem(s) found` : '\nAll workflow checks passed');
process.exit(errors.length ? 1 : 0);
