// The session board (lib/pure/board.js): the three session sections joined
// into one row per session for the merged and tabbed layouts. The Swift twin
// runs the same fixture (SessionBoardParityTests).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {
    BOARD_TABS, boardDefaultTab, boardMetaParts, boardTab, boardVisible, sessionBoard, sessionsLayout,
} from '../claude-usage-panel@fschmutz.github.io/lib/pure/board.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fix = JSON.parse(fs.readFileSync(path.join(here, 'fixtures', 'board.json'), 'utf8'));

for (const c of fix.layouts) {
    test(`sessionsLayout(${JSON.stringify(c.value)}) is ${c.expected}`, () => {
        assert.equal(sessionsLayout(c.value), c.expected);
    });
}

for (const c of fix.cases) {
    test(`sessionBoard - ${c.name}`, () => {
        const {rows, counts} = sessionBoard(c.input);
        const e = c.expected;
        assert.deepEqual(rows.map(r => r.sessionId), e.order);
        const by = Object.fromEntries(rows.map(r => [r.sessionId, r]));
        for (const [id, s] of Object.entries(e.status))
            assert.equal(by[id].status, s, `status ${id}`);
        for (const [id, n] of Object.entries(e.names))
            assert.equal(by[id].name, n, `name ${id}`);
        for (const [id, p] of Object.entries(e.pids))
            assert.equal(by[id].pid, p, `pid ${id}`);
        for (const r of rows) {
            assert.deepEqual(r.pause, e.pause[r.sessionId] ?? null, `pause ${r.sessionId}`);
            assert.deepEqual(boardMetaParts(r), e.meta[r.sessionId], `meta ${r.sessionId}`);
        }
        for (const r of rows)
            assert.equal(r.today?.tokens ?? null, e.tokens[r.sessionId] ?? null, `tokens ${r.sessionId}`);
        assert.deepEqual(counts, e.counts);
        for (const tab of BOARD_TABS)
            assert.deepEqual(boardTab(rows, tab).map(r => r.sessionId), e.tabs[tab], `tab ${tab}`);
    });
}

for (const c of fix.visible) {
    test(`boardVisible - ${c.name}`, () => {
        const rows = Array.from({length: c.rows}, (_, i) => ({sessionId: String(i)}));
        assert.equal(boardVisible(c.layout, rows, c.pauseRequest ? {} : null), c.expected);
    });
}

for (const c of fix.defaultTab) {
    test(`boardDefaultTab - ${c.name}`, () => {
        assert.equal(boardDefaultTab(c.counts, c.remembered), c.expected);
    });
}

test('sessionBoard tolerates missing and non-array inputs', () => {
    assert.deepEqual(sessionBoard(), {rows: [], counts: {waiting: 0, live: 0, today: 0}});
    assert.deepEqual(sessionBoard({waiting: null, pause: 'x', today: {}}).rows, []);
});
