// The GNOME session board (lib/boardSection.js) and the session group that
// feeds it (lib/sessionGroup.js), over the GJS stubs. Asserted through what
// the dropdown shows - the menu items handed to addMenuItem, their text and
// visibility - never through private fields: merged and tabbed draw one
// list, separate draws the three sections, a layout switch never shows both,
// a running row raises its tab by pid through `claudectl session focus`, an
// ended one resumes through the sessions section, and Pause goes through the
// pause section.
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {stub} from './gjs-stub.js';

const CLI = '/home/tester/.local/bin/claudectl';

/** St with a widget tree a test can read: children, text, labels, clicks. */
function installSt(rec) {
    class Actor {
        constructor(props = {}) {
            Object.assign(this, {visible: true, reactive: true, children: []}, props);
            this._handlers = {};
        }

        add_child(c) { this.children.push(c); }

        destroy_all_children() { this.children = []; }

        connect(sig, fn) { this._handlers[sig] = fn; }

        click() {
            if (this.reactive)
                this._handlers.clicked?.();
        }
    }
    class BoxLayout extends Actor {
        static find_property() { return null; }
    }
    class Button extends Actor {
        constructor(props = {}) {
            super(props);
            if (props.child)
                this.children.push(props.child);
        }
    }
    stub.overrides['gi://St'] = {BoxLayout, Button, Label: class extends Actor {
        get clutter_text() { return {}; }
    }};
    stub.overrides['gi://GLib'] = {
        PRIORITY_LOW: 300,
        SOURCE_REMOVE: false,
        FileTest: {IS_EXECUTABLE: 1},
        getenv: () => null,
        get_home_dir: () => '/home/tester',
        build_filenamev: parts => parts.join('/'),
        file_test: path => path === CLI,
        find_program_in_path: () => null,
        timeout_add_seconds: () => 1,
        Source: {remove: () => {}},
    };
    stub.overrides['gi://Gio'] = {
        SubprocessFlags: {STDOUT_PIPE: 1, STDERR_PIPE: 2},
        Cancellable: class { cancel() {} },
        Subprocess: {
            new: argv => {
                rec.spawned.push(argv);
                return {
                    communicate_utf8_async: (_i, _c, cb) => cb(null, null),
                    communicate_utf8_finish: () => [true, '', ''],
                    get_successful: () => true,
                    get_exit_status: () => 0,
                };
            },
        },
    };
    stub.overrides['resource:///org/gnome/shell/ui/popupMenu.js'] = {PopupBaseMenuItem: Actor};
}

/** Every visible text under `w` (labels and button labels), depth first. */
function texts(w, out = []) {
    if (!w || w.visible === false)
        return out;
    if (typeof w.text === 'string' && w.text)
        out.push(w.text);
    if (typeof w.label === 'string')
        out.push(w.label);
    for (const c of w.children ?? [])
        texts(c, out);
    return out;
}

/** The first visible widget under `w` whose own text or label matches. */
function find(w, re) {
    if (!w || w.visible === false)
        return null;
    if (re.test(w.label ?? '') || re.test(w.text ?? ''))
        return w;
    for (const c of w.children ?? []) {
        const hit = find(c, re);
        if (hit)
            return hit;
    }
    return null;
}

/** The nearest clickable ancestor-or-self of the widget showing `re`. */
function button(w, re) {
    if (!w || w.visible === false)
        return null;
    if (w._handlers?.clicked && texts(w).some(t => re.test(t)) && !(w.children ?? []).some(c => button(c, re)))
        return w;
    for (const c of w.children ?? []) {
        const hit = button(c, re);
        if (hit)
            return hit;
    }
    return null;
}

const fresh = () => ({spawned: [], notes: [], pause: [], opened: [], closed: 0, items: []});

async function board(rec) {
    const {BoardController} = await import('../claude-usage-panel@fschmutz.github.io/lib/boardSection.js');
    const b = new BoardController({
        menu: {addMenuItem: i => rec.items.push(i), close: () => rec.closed++},
        notify: (_t, body) => rec.notes.push(body),
        isDestroyed: () => false,
        actions: {
            pause: (action, row) => rec.pause.push([action, row?.pid ?? null]),
            open: session => rec.opened.push(session.sessionId),
        },
    });
    return b;
}

const WAITING = [{sessionId: 'w1', pid: 11, name: 'API', cwd: '/w/api', reason: 'permission', at: 1, age: '4m'}];
const PAUSE = {request: null, summary: null, busy: false, rows: [
    {sessionId: 'w1', pid: 11, name: 'API', cwd: '/w/api', state: null},
    {sessionId: 'l1', pid: 33, name: 'CONSOLE', cwd: '/w/console', state: null},
]};
const TODAY = {pending: false, sessions: [
    {sessionId: 'e1', cwd: '/w/done', label: 'done thing', tokens: 4000, when: '08:00', lastMs: 4},
]};

test('merged: one list, waiting first, ended folded behind a toggle', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = fresh();
    installSt(rec);
    const b = await board(rec);
    b.render({layout: 'merged', waiting: WAITING, pause: PAUSE, today: TODAY});
    assert.equal(b.item.visible, true);
    const shown = texts(b.item);
    assert.ok(shown.includes('1 waiting · 2 live · 1 today (est.)'));
    assert.ok(shown.indexOf('▸ API') < shown.indexOf('▸ CONSOLE'), 'waiting before live');
    assert.ok(shown.includes('waiting 4m · permission'));
    assert.ok(!shown.includes('▸ done thing'), 'ended is folded');
    button(b.item, /1 ended today/).click();
    assert.ok(texts(b.item).includes('▸ done thing'));
});

test('tabs: Waiting / Live / Today with counts, opening on the first tab that has rows', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = fresh();
    installSt(rec);
    const b = await board(rec);
    b.render({layout: 'tabs', waiting: [], pause: PAUSE, today: TODAY});
    const shown = texts(b.item);
    for (const tab of ['Waiting 0', 'Live 2', 'Today 1'])
        assert.ok(shown.includes(tab), tab);
    assert.match(find(b.item, /^Live 2$/).style_class, /cu-active/);
    button(b.item, /^Today 1$/).click();
    assert.deepEqual(texts(b.item).filter(s => s.startsWith('▸')), ['▸ done thing']);
});

test('clicks: a running row raises its tab by pid, an ended one resumes, Pause goes to the pause section', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = fresh();
    installSt(rec);
    const b = await board(rec);
    b.render({layout: 'merged', waiting: null, pause: PAUSE, today: TODAY});
    button(b.item, /^▸ API$/).click();
    await new Promise(r => setTimeout(r, 10));
    assert.deepEqual(rec.spawned[0], [CLI, 'session', 'focus', '11']);
    button(b.item, /1 ended today/).click();
    button(b.item, /^▸ done thing$/).click();
    assert.deepEqual(rec.opened, ['e1']);
    button(b.item, /^Pause all$/).click();
    assert.deepEqual(rec.pause, [['pause-all', null]]);
});

test('busy: a pause action greys the buttons until the next draw says it is done', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = fresh();
    installSt(rec);
    const b = await board(rec);
    b.render({layout: 'merged', waiting: null, pause: PAUSE, today: null});
    button(b.item, /^Pause all$/).click();
    button(b.item, /^Resume all$/).click();
    assert.deepEqual(rec.pause, [['pause-all', null]], 'the second click is dropped while busy');
    assert.equal(find(b.item, /^Resume all$/).reactive, false);
    b.render({layout: 'merged', waiting: null, pause: {...PAUSE, busy: false}, today: null});
    assert.equal(find(b.item, /^Resume all$/).reactive, true);
});

test('a section that is off says so: no count for it, no Pause buttons', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = fresh();
    installSt(rec);
    const b = await board(rec);
    b.render({layout: 'merged', waiting: null, pause: null, today: TODAY});
    const shown = texts(b.item);
    assert.ok(shown.includes('1 today (est.)'));
    assert.equal(find(b.item, /^Pause all$/), null);
});

test('boardMeta words every part; boardFocusCommand is by pid', async t => {
    t.after(() => { stub.overrides = {}; });
    installSt(fresh());
    const {boardMeta, boardFocusCommand} = await import('../claude-usage-panel@fschmutz.github.io/lib/boardSection.js');
    assert.equal(boardMeta({status: 'live', waiting: null, pause: null, today: null}), 'running');
    assert.equal(boardMeta({status: 'ended', waiting: null, pause: {state: 'lost'}, today: {tokens: 1500, when: '09:10'}}),
        'ended without a verdict · 1.5k  09:10');
    assert.deepEqual(boardFocusCommand('cli', {pid: 7}), ['cli', 'session', 'focus', '7']);
});

// ── The session group: one draw, in the layout of the moment ───────────────

async function group(t, rec, layout) {
    const {SessionGroup} = await import('../claude-usage-panel@fschmutz.github.io/lib/sessionGroup.js');
    const {WaitingController} = await import('../claude-usage-panel@fschmutz.github.io/lib/waitingSection.js');
    const {PauseController} = await import('../claude-usage-panel@fschmutz.github.io/lib/pauseSection.js');
    const {SessionsController} = await import('../claude-usage-panel@fschmutz.github.io/lib/sessionsSection.js');
    t.mock.method(WaitingController.prototype, 'read', async () => WAITING);
    t.mock.method(PauseController.prototype, 'read', async () => ({request: null, summary: null, rows: PAUSE.rows}));
    t.mock.method(SessionsController.prototype, 'read', async () => TODAY);
    const settings = {layout, get_string: () => settings.layout, get_boolean: () => true};
    const g = new SessionGroup({
        settings,
        menu: {addMenuItem: i => rec.items.push(i), close: () => {}},
        notify: () => {},
        isDestroyed: () => false,
        setBadge: n => rec.badges.push(n),
    });
    return {g, settings};
}

const visibleItems = rec => rec.items.filter(i => i.visible).map(i => texts(i)[0]);

test('group: merged draws only the board; a switch to separate draws only the sections, never both', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = {...fresh(), badges: []};
    installSt(rec);
    const {g, settings} = await group(t, rec, 'merged');
    await g.refresh();
    assert.deepEqual(visibleItems(rec), ['Sessions']);
    assert.deepEqual(rec.badges, [1]);
    settings.layout = 'separate';
    g.render();
    assert.deepEqual(visibleItems(rec), ['Waiting on you', 'Pause / resume', 'Today’s sessions (est.)']);
    settings.layout = 'tabs';
    g.render();
    assert.deepEqual(visibleItems(rec), ['Sessions']);
});

test('group: a read that an older one overtakes is dropped', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = {...fresh(), badges: []};
    installSt(rec);
    const {g} = await group(t, rec, 'merged');
    const {WaitingController} = await import('../claude-usage-panel@fschmutz.github.io/lib/waitingSection.js');
    let release;
    const slow = new Promise(r => { release = r; });
    WaitingController.prototype.read.mock.mockImplementationOnce(async () => {
        await slow;
        return [];
    });
    const older = g.read('waiting');
    await g.read('waiting');
    release();
    await older;
    g.render();
    assert.deepEqual(rec.badges, [1], 'the newer read (one waiting) wins over the slower, older one');
});

test('group: a read that lands after the poll drew is drawn at once', async t => {
    t.after(() => { stub.overrides = {}; });
    const rec = {...fresh(), badges: []};
    installSt(rec);
    const {g} = await group(t, rec, 'merged');
    const {WaitingController} = await import('../claude-usage-panel@fschmutz.github.io/lib/waitingSection.js');
    let release;
    const slow = new Promise(r => { release = r; });
    WaitingController.prototype.read.mock.mockImplementationOnce(async () => {
        await slow;
        return [];
    });
    const late = g.read('waiting');
    g.render();
    assert.deepEqual(rec.badges, [0], 'drawn before the read came back');
    release();
    await late;
    assert.deepEqual(rec.badges, [0, 0], 'drawn again when it landed');
});
