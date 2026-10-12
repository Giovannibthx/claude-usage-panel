// The dropdown's session sections as one group: "Waiting on you",
// "Pause / resume", "Today's sessions" and the board that shows them merged
// or tabbed. Each section reads its own source on its own switch (read());
// the group keeps the latest read of each and draws them in one place
// (render()): the board for the merged and tabbed layouts, the three
// sections for 'separate'. Sections never know the board exists, and a
// layout change is just the next render.

import {BoardController} from './boardSection.js';
import {PauseController} from './pauseSection.js';
import {SessionsController} from './sessionsSection.js';
import {WaitingController} from './waitingSection.js';
import {sessionsLayout} from './pure.js';

const KINDS = ['waiting', 'pause', 'today'];

export class SessionGroup {
    /**
     * @param {object} deps  the section deps (settings, menu, notify,
     *   isDestroyed); the items are appended in menu order: board, waiting,
     *   pause, today
     * @param {(n: number) => void} deps.setBadge  the top bar's waiting count
     */
    constructor(deps) {
        this._settings = deps.settings;
        this._isDestroyed = deps.isDestroyed;
        this._setBadge = deps.setBadge ?? (() => {});
        this._data = {waiting: null, pause: null, today: null};
        this._scans = {waiting: 0, pause: 0, today: 0};
        this._draws = 0;
        this._board = new BoardController({
            ...deps,
            actions: {
                pause: (action, row) => this._sections.pause.act(action, row),
                open: session => this._sections.today.open(session),
            },
        });
        const sectionDeps = {...deps, setBadge: undefined};
        this._sections = {
            waiting: new WaitingController(sectionDeps),
            pause: new PauseController({...sectionDeps, requestRefresh: () => this.refresh('pause')}),
            today: new SessionsController({...sectionDeps, requestRefresh: () => this.refresh('today')}),
        };
    }

    /** Re-read one section (`kind`); the poll calls this per section, each
     *  under its own deadline, then render() once. */
    async read(kind) {
        // Only the newest read of a section is kept: a follow-up and a poll
        // can overlap.
        const scan = ++this._scans[kind];
        const drawn = this._draws;
        const data = await this._sections[kind].read();
        if (scan !== this._scans[kind])
            return;
        this._data[kind] = data;
        // A read that outlived the poll's deadline lands after its draw:
        // draw it now rather than a whole poll later.
        if (this._draws !== drawn)
            this.render();
    }

    /** Draw what the sections last read, in the current layout. */
    render() {
        if (this._isDestroyed())
            return;
        this._draws++;
        const {waiting, pause, today} = this._data;
        this._setBadge(waiting?.length ?? 0);
        const layout = sessionsLayout(this._settings.get_string('sessions-layout'));
        if (layout === 'separate') {
            this._board.hide();
            for (const kind of KINDS)
                this._sections[kind].render(this._data[kind]);
            return;
        }
        for (const kind of KINDS)
            this._sections[kind].render(null);
        this._board.render({
            layout, waiting, today,
            pause: pause && {...pause, busy: this._sections.pause.busy},
        });
    }

    /** Re-read one section, or all of them, then draw. */
    async refresh(kind = null) {
        await Promise.all((kind ? [kind] : KINDS).map(k => this.read(k)));
        this.render();
    }

    destroy() {
        for (const kind of KINDS)
            this._sections[kind].destroy();
    }
}
