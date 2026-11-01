#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { constants, closeSync, existsSync, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createIdentityStore } from './identity-store.mjs';

class ManagementError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new ManagementError(code); };
const allowedErrors = new Set(['invalid_arguments', 'private_path_required', 'source_not_found', 'target_exists', 'private_input_permissions', 'invalid_input_file', 'invalid_import', 'import_requires_empty_store', 'bootstrap_unavailable', 'operation_failed']);
const usage = 'Usage: node manage-identity.mjs export --database /private/existing.sqlite --output /private/new-backup.json\n       node manage-identity.mjs import --database /private/new.sqlite --input /private/backup.json\n       node manage-identity.mjs bootstrap --database /private/identity.sqlite --output /private/new-setup.json\n';

function argumentsFor(argv) {
  const command = argv[0];
  if (!['export', 'import', 'bootstrap'].includes(command) || argv.length !== 5) fail('invalid_arguments');
  const accepted = new Set(['--database', command === 'import' ? '--input' : '--output']);
  const values = {};
  for (let index = 1; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!accepted.has(flag) || Object.hasOwn(values, flag) || typeof value !== 'string' || !value || value.startsWith('--')) fail('invalid_arguments');
    values[flag] = value;
  }
  if (Object.keys(values).length !== accepted.size) fail('invalid_arguments');
  return { command, databasePath: values['--database'], inputPath: values['--input'], outputPath: values['--output'] };
}

// Resolve existing ancestors before creating directories. A private-looking
// alias must not route an export, input or database into the public document root.
function privatePath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || /[\u0000-\u001f\u007f]/.test(value) || value.split(path.sep).includes('public_html')) fail('private_path_required');
  const result = path.resolve(value);
  if (result.split(path.sep).includes('public_html')) fail('private_path_required');
  let ancestor = result;
  while (!existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) fail('private_path_required');
    ancestor = parent;
  }
  if (realpathSync(ancestor).split(path.sep).includes('public_html')) fail('private_path_required');
  try { if (lstatSync(result).isSymbolicLink()) fail('private_path_required'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}

function existingPrivateFile(filePath, { maximumBytes, requirePrivatePermissions = true } = {}) {
  let fd;
  try {
    fd = openSync(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || (maximumBytes !== undefined && stat.size > maximumBytes)) fail('invalid_input_file');
    if (requirePrivatePermissions && (stat.mode & 0o077)) fail('private_input_permissions');
    return fd;
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (error.code === 'ENOENT') fail('source_not_found');
    throw error;
  }
}

function reservePrivateFile(filePath) {
  mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  try {
    const fd = openSync(filePath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    fchmodSync(fd, 0o600);
    return fd;
  } catch (error) { if (error.code === 'EEXIST') fail('target_exists'); throw error; }
}

function privateOutput(filePath, work) {
  const fd = reservePrivateFile(filePath);
  let completed = false;
  try {
    const result = work((value) => { writeFileSync(fd, JSON.stringify(value, null, 2) + '\n', 'utf8'); fsyncSync(fd); });
    completed = true;
    return result;
  } finally {
    closeSync(fd);
    if (!completed) unlinkSync(filePath); // Only the newly reserved file owned by this invocation.
  }
}

/** Private CLI entry point. It never prints accounts, credentials or setup codes. */
export function manageIdentity(argv, { stdout = process.stdout } = {}) {
  const args = argumentsFor(argv);
  const databasePath = privatePath(args.databasePath);
  const inputPath = args.inputPath ? privatePath(args.inputPath) : null;
  const outputPath = args.outputPath ? privatePath(args.outputPath) : null;
  let store;
  try {
    if (args.command === 'export') {
      const existing = existingPrivateFile(databasePath);
      closeSync(existing);
      return privateOutput(outputPath, write => {
        store = createIdentityStore({ databasePath });
        const bundle = store.exportPortable({ includePasswordHashes: true });
        write(bundle);
        const count = bundle.users.length;
        stdout.write(`Exported ${count} account${count === 1 ? '' : 's'} and ${bundle.grants.length} app grants.\n`);
        return { users: count, grants: bundle.grants.length };
      });
    }
    if (args.command === 'import') {
      if (existsSync(databasePath)) fail('target_exists');
      const input = existingPrivateFile(inputPath, { maximumBytes: 32 * 1024 * 1024 });
      let bundle;
      try { bundle = JSON.parse(readFileSync(input, 'utf8')); }
      catch { fail('invalid_import'); }
      finally { closeSync(input); }
      // Reserve atomically so another process cannot overwrite this destination.
      const destination = reservePrivateFile(databasePath);
      closeSync(destination);
      store = createIdentityStore({ databasePath });
      const result = store.importPortable(bundle);
      stdout.write(`Imported ${result.users} account${result.users === 1 ? '' : 's'} and ${result.grants} app grants. Existing sessions were not restored.\n`);
      return result;
    }
    if (existsSync(databasePath)) {
      const existing = existingPrivateFile(databasePath);
      closeSync(existing);
    }
    return privateOutput(outputPath, write => {
      store = createIdentityStore({ databasePath });
      const token = randomBytes(32).toString('base64url');
      const expiresAt = Date.now() + 7 * 24 * 60 * 60_000;
      // Persist the private code before binding it in SQLite; no stdout fallback.
      write({ format: 'celluloid-local-bootstrap', version: 1, token, expiresAt });
      if (!store.configureBootstrapToken(token, { expiresAt })) fail('bootstrap_unavailable');
      stdout.write('Created a private one-use setup file. It expires in 7 days.\n');
      return { expiresAt };
    });
  } finally { store?.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { manageIdentity(process.argv.slice(2)); }
  catch (error) {
    const code = allowedErrors.has(error.code) ? error.code : 'operation_failed';
    process.stderr.write(`Identity management failed: ${code}.\n${code === 'invalid_arguments' ? usage : ''}`);
    process.exitCode = 1;
  }
}
