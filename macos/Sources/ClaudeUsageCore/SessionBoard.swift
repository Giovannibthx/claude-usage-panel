import Foundation

// The session board: "Waiting on you", "Pause sessions" and "Today's
// sessions" joined into one row per Claude Code session, for the popup's
// merged and tabbed layouts (setting `sessionsLayout`), plus what a row says
// and when the board shows.
// Mirrors the GNOME extension's lib/pure.js (lib/pure/board.js); pinned by
// tests/fixtures/board.json.

public enum SessionsLayout: String, CaseIterable, Sendable {
    case merged, tabs, separate

    public static let `default` = SessionsLayout.merged

    /// A stored value, or the default for anything unknown.
    public static func of(_ value: String?) -> SessionsLayout {
        value.flatMap(SessionsLayout.init(rawValue:)) ?? .default
    }
}

public enum BoardTab: String, CaseIterable, Sendable {
    case waiting, live, today
}

public struct BoardCounts: Equatable, Sendable {
    public let waiting: Int
    public let live: Int
    public let today: Int

    public init(waiting: Int, live: Int, today: Int) {
        self.waiting = waiting
        self.live = live
        self.today = today
    }

    public subscript(tab: BoardTab) -> Int {
        switch tab {
        case .waiting: return waiting
        case .live: return live
        case .today: return today
        }
    }
}

public struct SessionBoardRow: Equatable, Sendable, Identifiable {
    public enum Status: String, Sendable {
        case waiting, live, ended
    }

    public struct Waiting: Equatable, Sendable {
        public let reason: String
        public let age: String
        public let at: Double
    }

    public struct Pause: Equatable, Sendable {
        public let state: String
        public let via: String?
        public let reason: String?
    }

    public struct Today: Equatable, Sendable {
        public let tokens: Int
        public let when: String
        public let lastMs: Double
        public let label: String
    }

    public let sessionId: String
    public let name: String
    public let cwd: String
    /// The running process; nil once the session ended.
    public let pid: Int?
    public let status: Status
    public let waiting: Waiting?
    public let pause: Pause?
    public let today: Today?

    public var id: String { sessionId }
    public var live: Bool { pid != nil }
}

/// What a row says after its name, in display order; each port words it.
public enum BoardMetaPart: Equatable, Sendable {
    case waiting(reason: String, age: String)
    case pause(SessionBoardRow.Pause)
    case running
    case today(tokens: Int, when: String)
}

public enum SessionBoard {
    /// What one section saw of a session: one shape per section, the same
    /// as the JS port's. A session is live when a section saw its pid.
    public struct Waiting: Sendable {
        let sessionId: String
        let pid: Int?
        let name: String
        let cwd: String
        let reason: String
        let at: Double
        let age: String

        public init(
            sessionId: String, pid: Int?, name: String, cwd: String, reason: String, at: Double,
            age: String
        ) {
            (self.sessionId, self.pid, self.name, self.cwd) = (sessionId, pid, name, cwd)
            (self.reason, self.at, self.age) = (reason, at, age)
        }
    }

    public struct Pause: Sendable {
        let sessionId: String
        let pid: Int?
        let name: String
        let cwd: String
        let state: String?
        let via: String?
        let reason: String?

        public init(
            sessionId: String, pid: Int?, name: String, cwd: String, state: String?,
            via: String? = nil, reason: String? = nil
        ) {
            (self.sessionId, self.pid, self.name, self.cwd) = (sessionId, pid, name, cwd)
            (self.state, self.via, self.reason) = (state, via, reason)
        }
    }

    public struct Today: Sendable {
        let sessionId: String
        let cwd: String
        let label: String
        let tokens: Int
        let when: String
        let lastMs: Double

        public init(
            sessionId: String, cwd: String, label: String, tokens: Int, when: String, lastMs: Double
        ) {
            (self.sessionId, self.cwd, self.label) = (sessionId, cwd, label)
            (self.tokens, self.when, self.lastMs) = (tokens, when, lastMs)
        }
    }

    private struct Acc {
        var name = ""
        var cwd = ""
        var pid: Int?
        var waiting: SessionBoardRow.Waiting?
        var pause: SessionBoardRow.Pause?
        var today: SessionBoardRow.Today?
    }

    private static func positive(_ v: Int?) -> Int? { v.flatMap { $0 > 0 ? $0 : nil } }
    private static func nonEmpty(_ v: String?) -> String? { v.flatMap { $0.isEmpty ? nil : $0 } }

    /// UTF-16 code-unit order: what JS `<` on two strings does.
    private static func precedes(_ a: String, _ b: String) -> Bool {
        Array(a.utf16).lexicographicallyPrecedes(Array(b.utf16))
    }

    /// One row per session id: waiting first (oldest wait first), then live,
    /// then ended; live and ended by today's tokens, then name, then id.
    public static func rows(waiting: [Waiting], pause: [Pause], today: [Today])
        -> (rows: [SessionBoardRow], counts: BoardCounts)
    {
        var acc: [String: Acc] = [:]
        for s in today where !s.sessionId.isEmpty {
            var r = acc[s.sessionId] ?? Acc()
            if r.name.isEmpty { r.name = s.label }
            if r.cwd.isEmpty { r.cwd = s.cwd }
            r.today = .init(tokens: s.tokens, when: s.when, lastMs: s.lastMs, label: s.label)
            acc[s.sessionId] = r
        }
        // A live name beats today's title: it is what the tab is called.
        for s in pause where !s.sessionId.isEmpty {
            var r = acc[s.sessionId] ?? Acc()
            if !s.name.isEmpty { r.name = s.name }
            if r.cwd.isEmpty { r.cwd = s.cwd }
            r.pid = positive(s.pid) ?? r.pid
            r.pause = nonEmpty(s.state).map {
                .init(state: $0, via: nonEmpty(s.via), reason: nonEmpty(s.reason))
            }
            acc[s.sessionId] = r
        }
        for s in waiting where !s.sessionId.isEmpty {
            var r = acc[s.sessionId] ?? Acc()
            if !s.name.isEmpty { r.name = s.name }
            if r.cwd.isEmpty { r.cwd = s.cwd }
            r.pid = positive(s.pid) ?? r.pid
            r.waiting = .init(reason: s.reason, age: s.age, at: s.at)
            acc[s.sessionId] = r
        }
        let rank: [SessionBoardRow.Status: Int] = [.waiting: 0, .live: 1, .ended: 2]
        let rows = acc.map { id, r -> SessionBoardRow in
            let status: SessionBoardRow.Status =
                r.waiting != nil ? .waiting : r.pid != nil ? .live : .ended
            return SessionBoardRow(
                sessionId: id, name: r.name.isEmpty ? String(id.prefix(8)) : r.name, cwd: r.cwd,
                pid: r.pid, status: status, waiting: r.waiting, pause: r.pause, today: r.today)
        }.sorted { a, b in
            if rank[a.status]! != rank[b.status]! { return rank[a.status]! < rank[b.status]! }
            if a.status == .waiting, let wa = a.waiting, let wb = b.waiting, wa.at != wb.at {
                return wa.at < wb.at
            }
            let ta = a.today?.tokens ?? 0
            let tb = b.today?.tokens ?? 0
            if ta != tb { return ta > tb }
            if a.name != b.name { return precedes(a.name, b.name) }
            return precedes(a.sessionId, b.sessionId)
        }
        let counts = BoardCounts(
            waiting: rows.filter { $0.status == .waiting }.count,
            live: rows.filter(\.live).count,
            today: rows.filter { $0.today != nil }.count)
        return (rows, counts)
    }

    /// The rows one tab shows: waiting, every running session (waiting
    /// included), or every session with work today.
    public static func tab(_ rows: [SessionBoardRow], _ tab: BoardTab) -> [SessionBoardRow] {
        switch tab {
        case .waiting: return rows.filter { $0.status == .waiting }
        case .live: return rows.filter(\.live)
        case .today: return rows.filter { $0.today != nil }
        }
    }

    /// The tab to open on: the remembered one when it still has rows, else
    /// the first tab that has any (waiting first), else the remembered one.
    public static func defaultTab(_ counts: BoardCounts, remembered: BoardTab?) -> BoardTab {
        if let r = remembered, counts[r] > 0 { return r }
        return BoardTab.allCases.first { counts[$0] > 0 } ?? remembered ?? .waiting
    }

    /// The wait, then the pause state, then "running" for a live row with
    /// neither, then today's tokens.
    public static func metaParts(_ row: SessionBoardRow) -> [BoardMetaPart] {
        var parts: [BoardMetaPart] = []
        if let w = row.waiting { parts.append(.waiting(reason: w.reason, age: w.age)) }
        if let p = row.pause { parts.append(.pause(p)) }
        if parts.isEmpty && row.status == .live { parts.append(.running) }
        if let t = row.today { parts.append(.today(tokens: t.tokens, when: t.when)) }
        return parts
    }

    /// Whether the board shows at all: not in the separate layout, and only
    /// with a row or a pause request to show.
    public static func visible(_ layout: SessionsLayout, rows: Int, pauseRequest: Bool) -> Bool {
        layout != .separate && (rows > 0 || pauseRequest)
    }
}
