// lib/usageCard.js: compact mode keeps the name, the percentage, the bar and
// the reset countdown, and drops every other line. Loaded under plain node
// through the GJS stubs.
import {test} from 'node:test';
import assert from 'node:assert/strict';

import {stub} from './gjs-stub.js';
import {normalizeUsage} from '../claude-usage-panel@fschmutz.github.io/lib/pure/usage.js';

globalThis.global ??= {stage: {}};

async function cardWidget(t) {
    stub.overrides['gi://St'] = {ThemeContext: {get_for_stage: () => ({scale_factor: 1})}};
    t.after(() => { stub.overrides = {}; });
    const {UsageCard} = await import('../claude-usage-panel@fschmutz.github.io/lib/usageCard.js');
    const w = new UsageCard();
    w._classes = new Set();
    w.add_style_class_name = c => w._classes.add(c);
    w.remove_style_class_name = c => w._classes.delete(c);
    return w;
}

const now = Date.now();
const [fable] = normalizeUsage({limits: [
    {kind: 'weekly_all', percent: 40, resets_at: new Date(now + 3 * 86_400_000).toISOString()},
    {kind: 'weekly_scoped', percent: 30, scope: {model: {display_name: 'Fable'}},
        resets_at: new Date(now + 3 * 86_400_000).toISOString()},
]}).filter(c => c.scoped);
const history = [[now - 7_200_000, 10], [now - 3_600_000, 20], [now, 30]];
const fc = {pctPerHour: 10, projectedFullAt: now + 3_600_000, exhaustsBeforeReset: true, marginHours: -60};
const trend = {thisWeek: 30, lastWeek: 20};

test('full card: reset line carries the pool note, forecast and sparkline show', async t => {
    const w = await cardWidget(t);
    w.setCompact(false);
    w.update(fable, history, fc, trend);
    assert.match(w._reset.text, / · /, 'reset · pool note');
    assert.equal(w._forecast.visible, true);
    assert.equal(w._spark.visible, true);
});

test('compact card: reset countdown only, every other line hidden', async t => {
    const w = await cardWidget(t);
    w.setCompact(true);
    w.update(fable, history, fc, trend);
    assert.ok(w._classes.has('cu-card-compact'));
    assert.equal(w._pct.text, '30%');
    assert.ok(w._reset.text.length > 0);
    assert.doesNotMatch(w._reset.text, / · /, 'no pool note, pace or reading note');
    assert.equal(w._clockRow.visible, false);
    assert.equal(w._forecast.visible, false);
    assert.equal(w._spark.visible, false);
    assert.equal(w._trend.visible, false);
    w.setCompact(false);
    assert.ok(!w._classes.has('cu-card-compact'));
});
