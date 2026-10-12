// `./install.sh macos` on an account without admin: where the app goes
// (/Applications when writable, else ~/Applications, or --appdir), and
// --prebuilt, the release zip checked against the sha256 the release's cask
// pins. uname says Darwin, the release is a file:// dir, ditto/open/osascript
// are stubs: nothing touches a real /Applications or the network.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

import {run, stubbedHome} from './helpers.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INSTALL = path.join(ROOT, 'install.sh');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const APP = 'ClaudeUsagePanel.app';
// root writes through a 0555 dir, so "not writable" cannot be staged as root
const asRoot = process.getuid?.() === 0;

function stub(home, name, body) {
    fs.writeFileSync(path.join(home, 'bin', name), `#!/bin/sh\n${body}\n`);
    fs.chmodSync(path.join(home, 'bin', name), 0o755);
}

/** A Mac with no Swift: a fake /Applications (`writable` or not), and a
 *  release dir holding the zip, the cask pinning `sha` (default: the zip's),
 *  and the bundle `ditto` "unpacks" (version `bundleVersion`). */
function mac(t, {writable = false, sha = null, bundleVersion = VERSION} = {}) {
    const home = stubbedHome(t, {prefix: 'cup-macapp-'});
    stub(home, 'uname', 'case "$1" in -s|"") echo Darwin ;; *) /bin/uname "$@" ;; esac');
    for (const tool of ['osascript', 'open', 'codesign', 'xattr']) stub(home, tool, 'exit 0');
    // The quit: pgrep/pkill are real tools and `pkill -f ClaudeUsagePanel`
    // would end the app of whoever runs the tests. The stubs play a running
    // app that ignores the Apple event: alive until pkill, every call logged.
    const calls = path.join(home, 'quit-calls');
    stub(home, 'osascript', `echo "osascript $*" >>"${calls}"`);
    stub(home, 'pgrep', `echo "pgrep $*" >>"${calls}"; [ -e "${calls}.killed" ] && exit 1; exit 0`);
    stub(home, 'pkill', `echo "pkill $*" >>"${calls}"; : >"${calls}.killed"`);
    stub(home, 'open', `echo "open $*" >>"${calls}"`);
    const system = path.join(home, 'system-Applications');
    fs.mkdirSync(system);
    if (!writable) {
        fs.chmodSync(system, 0o555);
        t.after(() => fs.existsSync(system) && fs.chmodSync(system, 0o755));
    }
    const release = path.join(home, 'release', `v${VERSION}`);
    fs.mkdirSync(release, {recursive: true});
    const zip = path.join(release, 'ClaudeUsagePanel-macos.zip');
    fs.writeFileSync(zip, `zip of v${bundleVersion}\n`);
    const real = crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');
    fs.writeFileSync(path.join(release, 'claude-usage-panel.rb'), `cask "x" do\n  sha256 "${sha ?? real}"\nend\n`);
    // the unpacked bundle ditto stands in for
    const unpacked = path.join(home, 'unpacked', APP);
    fs.mkdirSync(path.join(unpacked, 'Contents', 'MacOS'), {recursive: true});
    fs.writeFileSync(path.join(unpacked, 'Contents', 'MacOS', 'ClaudeUsagePanel'), '#!/bin/sh\n', {mode: 0o755});
    fs.writeFileSync(path.join(unpacked, 'Contents', 'Info.plist'),
        `<key>CFBundleShortVersionString</key>\n<string>${bundleVersion}</string>\n`);
    stub(home, 'ditto', `cp -R "${unpacked}" "$4/"`);
    const env = {
        ...process.env,
        HOME: home,
        XDG_STATE_HOME: path.join(home, 'state'),
        XDG_CONFIG_HOME: path.join(home, '.config'),
        XDG_DATA_HOME: path.join(home, '.local', 'share'),
        // no swift anywhere on it
        PATH: `${path.join(home, 'bin')}:/usr/bin:/bin`,
        CUP_TEST_SCHEDULER: 'cron',
        CUP_TEST_SYSTEM_APPS: system,
        CUP_RELEASE_BASE: pathToFileURL(path.join(home, 'release')).href,
    };
    return {home, system, env, userApps: path.join(home, 'Applications'), calls};
}

const installed = (dir) => fs.existsSync(path.join(dir, APP, 'Contents', 'MacOS', 'ClaudeUsagePanel'));

test('no admin: the release zip goes to ~/Applications, nothing written to /Applications', {skip: asRoot}, (t) => {
    const m = mac(t);
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /sha256 checked/);
    assert.ok(installed(m.userApps));
    assert.ok(!installed(m.system));
    assert.match(r.stdout, new RegExp(`installed to ${m.userApps}/${APP}`));
});

test('an install quits the running app by bundle id, pkill as the fallback, then relaunches', {skip: asRoot}, (t) => {
    const m = mac(t);
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const calls = fs.readFileSync(m.calls, 'utf8').split('\n').filter(Boolean);
    const quit = calls.findIndex(c => c === 'osascript -e tell application id "io.github.fschmutz.claude-usage-panel" to quit');
    const kill = calls.findIndex(c => c.startsWith('pkill -f /ClaudeUsagePanel.app/Contents/MacOS/ClaudeUsagePanel'));
    const open = calls.findIndex(c => c.startsWith('open '));
    assert.ok(quit >= 0, `no quit by bundle id in ${calls}`);
    assert.ok(kill > quit, 'pkill backs up the Apple event, after it');
    assert.ok(open > kill, 'the new bundle is opened once the old app is gone');
    assert.ok(calls.filter(c => c.startsWith('pgrep ')).length <= 10, 'the wait is bounded');
});

test('no Swift toolchain picks the release zip on its own', {skip: asRoot || fs.existsSync('/usr/bin/swift')}, (t) => {
    const m = mac(t);
    const r = run('bash', [INSTALL, 'macos'], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(installed(m.userApps));
});

test('a writable /Applications is still where it goes', (t) => {
    const m = mac(t, {writable: true});
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(installed(m.system));
    assert.ok(!fs.existsSync(m.userApps));
});

test('--appdir=DIR wins', (t) => {
    const m = mac(t, {writable: true});
    const dir = path.join(m.home, 'mine');
    const r = run('bash', [INSTALL, 'macos', '--prebuilt', `--appdir=${dir}`], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(installed(dir));
    assert.ok(!installed(m.system));
});

test('a zip whose sha256 the release does not pin is never installed or stamped', (t) => {
    const m = mac(t, {sha: 'f'.repeat(64)});
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /prebuilt v[\d.]+ not installed: the zip's sha256 .* is not the one release/);
    assert.ok(!installed(m.userApps));
    assert.ok(!fs.existsSync(path.join(m.home, 'state', 'claude-usage-panel', 'installed-version')));
});

test('a zip of another version is refused', (t) => {
    const m = mac(t, {bundleVersion: '0.0.1'});
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, new RegExp(`the zip is v0\\.0\\.1, not v${VERSION.replace(/\./g, '\\.')}`));
});

test('a release without the zip fails loudly', (t) => {
    const m = mac(t);
    fs.rmSync(path.join(m.home, 'release', `v${VERSION}`, 'ClaudeUsagePanel-macos.zip'));
    const r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /no ClaudeUsagePanel-macos\.zip in release/);
});

test('--build-only never takes the zip: it is what makes the zip', (t) => {
    const m = mac(t);
    const r = run('bash', [INSTALL, 'macos', '--prebuilt', '--build-only'], {env: m.env});
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /--build-only needs the Swift toolchain/);
});

test('an install in ~/Applications is listed, updated in place and uninstalled', {skip: asRoot}, (t) => {
    const m = mac(t);
    assert.equal(run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env}).status, 0);
    assert.match(run('bash', [INSTALL, '--list'], {env: m.env}).stdout, /macos/);
    // no --prebuilt: update keeps how it was installed, even with a swift
    // on PATH (a stub that would fail the build)
    stub(m.home, 'swift', 'exit 1');
    const r = run('bash', [INSTALL, 'update', 'macos'], {env: m.env});
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /sha256 checked/);
    assert.match(r.stdout, new RegExp(`installed to ${m.userApps}/${APP}`));
    assert.equal(run('bash', [INSTALL, '--uninstall', 'macos'], {env: m.env}).status, 0);
    assert.ok(!fs.existsSync(path.join(m.userApps, APP)));
});

test('an admin copy it cannot replace fails and says how to install per account', {skip: asRoot}, (t) => {
    const m = mac(t, {writable: true});
    fs.mkdirSync(path.join(m.system, APP));
    fs.chmodSync(m.system, 0o555);
    // restored here, not in t.after: the HOME's own cleanup runs first and
    // cannot empty a 0555 dir
    let r;
    try {
        r = run('bash', [INSTALL, 'macos', '--prebuilt'], {env: m.env});
    } finally {
        fs.chmodSync(m.system, 0o755);
    }
    assert.notEqual(r.status, 0);
    assert.match(r.stdout, /could not replace .*not writable by/);
    assert.match(r.stdout, /--appdir="\$HOME\/Applications"/);
});
