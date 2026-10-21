import 'should';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { replaceInFile, pickVersions, readCurrentVersions } from '../auto-upgrade-node/upgrade.js';

describe('replaceInFile', () => {
  let dir;
  let file;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'replace-in-file-'));
    file = join(dir, 'Dockerfile');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const write = (content) => writeFileSync(file, content);
  const read = () => readFileSync(file, 'utf8');

  it('replaces an exact version match', () => {
    write('FROM node:20.11.0\n');
    replaceInFile(file, '20.11.0', '24.3.0').should.be.true();
    read().should.equal('FROM node:24.3.0\n');
  });

  it('does not corrupt a longer version sharing the same digit prefix', () => {
    write('FROM node:20.11.10\n');
    replaceInFile(file, '20.11.1', '24.3.0').should.be.false();
    read().should.equal('FROM node:20.11.10\n');
  });

  it('does not corrupt a longer dotted tag sharing the same prefix', () => {
    write('FROM node:20.11.0.5\n');
    replaceInFile(file, '20.11.0', '24.3.0').should.be.false();
    read().should.equal('FROM node:20.11.0.5\n');
  });

  it('still matches a version followed by an OS/variant suffix', () => {
    write('FROM node:20.11.0-alpine\n');
    replaceInFile(file, '20.11.0', '24.3.0').should.be.true();
    read().should.equal('FROM node:24.3.0-alpine\n');
  });

  it('returns false and writes nothing when there is no match', () => {
    write('FROM node:18.0.0\n');
    replaceInFile(file, '20.11.0', '24.3.0').should.be.false();
    read().should.equal('FROM node:18.0.0\n');
  });
});

describe('pickVersions', () => {
  it('upgrades when the latest version is newer', () => {
    const { nodeVersion } = pickVersions({
      currentNode: '24.1.0', latestNode: '24.3.0', currentPnpmVersion: '', latestPnpm: ''
    });
    nodeVersion.should.equal('24.3.0');
  });

  it('does not upgrade when versions are equal', () => {
    const { nodeVersion } = pickVersions({
      currentNode: '24.3.0', latestNode: '24.3.0', currentPnpmVersion: '', latestPnpm: ''
    });
    nodeVersion.should.equal('');
  });

  it('does not downgrade when the current version is newer than the resolved latest', () => {
    const { nodeVersion } = pickVersions({
      currentNode: '24.5.0', latestNode: '24.3.0', currentPnpmVersion: '', latestPnpm: ''
    });
    nodeVersion.should.equal('');
  });

  it('upgrades pnpm only when a current pin exists and the latest is newer', () => {
    const { pnpmVersion } = pickVersions({
      currentNode: '', latestNode: '', currentPnpmVersion: '10.0.0', latestPnpm: '10.5.0'
    });
    pnpmVersion.should.equal('10.5.0');
  });

  it('does not downgrade pnpm when the current pin is newer than the resolved latest', () => {
    const { pnpmVersion } = pickVersions({
      currentNode: '', latestNode: '', currentPnpmVersion: '10.9.0', latestPnpm: '10.5.0'
    });
    pnpmVersion.should.equal('');
  });
});

describe('readCurrentVersions', () => {
  let dir;

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('treats a partial (non-full-semver) .node-version as unknown', () => {
    dir = mkdtempSync(join(tmpdir(), 'read-current-versions-'));
    writeFileSync(join(dir, '.node-version'), '24\n');
    readCurrentVersions(dir).currentNode.should.equal('');
  });

  it('reads a full x.y.z .node-version as-is', () => {
    dir = mkdtempSync(join(tmpdir(), 'read-current-versions-'));
    writeFileSync(join(dir, '.node-version'), '24.3.0\n');
    readCurrentVersions(dir).currentNode.should.equal('24.3.0');
  });

  it('treats a partial packageManager pnpm pin as unknown', () => {
    dir = mkdtempSync(join(tmpdir(), 'read-current-versions-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@10' }));
    readCurrentVersions(dir).currentPnpmVersion.should.equal('');
  });
});
