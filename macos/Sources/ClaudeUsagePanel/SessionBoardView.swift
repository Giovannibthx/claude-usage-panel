import ClaudeUsageCore
import SwiftUI

// The session board in the popup: "Waiting on you", "Pause sessions" and
// "Today's sessions" as one Sessions section, one row per session, as a
// single list (Settings ▸ Sessions ▸ Layout: merged) or under Waiting / Live /
// Today tabs (tabs). The three sources and their switches are unchanged; the
// join, the row parts and the visibility are ClaudeUsageCore's SessionBoard,
// the twin of the GNOME board. This view only words and draws them.
struct SessionBoardView: View {
    @ObservedObject var model: UsageModel
    @ObservedObject var pause: PauseState
    let layout: SessionsLayout
    @State private var tab: BoardTab?
    @State private var showEnded = false

    private static let tabTitles: [BoardTab: String] = [
        .waiting: "Waiting", .live: "Live", .today: "Today",
    ]

    /// The board over what each section read; a section that is off adds
    /// nothing.
    static func board(model: UsageModel, pause: PauseState) -> (
        rows: [SessionBoardRow], counts: BoardCounts
    ) {
        SessionBoard.rows(
            waiting: model.waitingEnabled
                ? model.waiting.map {
                    .init(
                        sessionId: $0.sessionId, pid: $0.pid, name: $0.name, cwd: $0.cwd,
                        reason: $0.reason.rawValue, at: $0.at, age: $0.age)
                } : [],
            pause: pause.enabled
                ? pause.rows.map {
                    .init(
                        sessionId: $0.sessionId, pid: $0.pid, name: $0.name, cwd: $0.cwd,
                        state: $0.row?.state.rawValue, via: $0.row?.via?.rawValue,
                        reason: $0.row?.reason)
                } : [],
            today: model.showSessions
                ? model.sessions.map {
                    .init(
                        sessionId: $0.sessionId, cwd: $0.cwd, label: $0.label, tokens: $0.tokens,
                        when: $0.when, lastMs: $0.lastMs)
                } : [])
    }

    static func visible(model: UsageModel, layout: SessionsLayout) -> Bool {
        SessionBoard.visible(
            layout, rows: board(model: model, pause: model.pause).rows.count,
            pauseRequest: model.pause.enabled && model.pause.status?.request != nil)
    }

    var body: some View {
        let b = Self.board(model: model, pause: pause)
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text("Sessions").font(.system(size: 13, weight: .bold))
                Text(countsLine(b.counts)).font(.system(size: 11)).foregroundColor(.secondary)
                Spacer()
                if pause.enabled {
                    Button("Pause all") { pause.pauseAll() }
                        .disabled(!pause.canAct || b.counts.live == 0)
                    Button("Resume all") { pause.resumeAll() }
                        .disabled(!pause.canAct)
                }
            }
            .font(.system(size: 11))
            if pause.enabled, let line = pause.summaryLine {
                Text(line).font(.system(size: 12, weight: .semibold))
            }
            if layout == .tabs {
                let current = SessionBoard.defaultTab(b.counts, remembered: tab)
                Picker("", selection: Binding(get: { current }, set: { tab = $0 })) {
                    ForEach(BoardTab.allCases, id: \.self) { t in
                        Text("\(Self.tabTitles[t] ?? t.rawValue) \(b.counts[t])").tag(t)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                ForEach(SessionBoard.tab(b.rows, current)) { rowView($0) }
            } else {
                ForEach(b.rows.filter { $0.status != .ended }) { rowView($0) }
                let ended = b.rows.filter { $0.status == .ended }
                if !ended.isEmpty {
                    Button {
                        showEnded.toggle()
                    } label: {
                        Text("\(showEnded ? "\u{25be}" : "\u{25b8}") \(ended.count) ended today")
                            .font(.system(size: 11)).foregroundColor(.secondary)
                    }
                    .buttonStyle(.borderless)
                    if showEnded {
                        ForEach(ended) { rowView($0) }
                    }
                }
            }
            if pause.enabled, let err = pause.actionError ?? pause.readError {
                Text(err).font(.system(size: 11)).foregroundColor(.cuCritical)
            }
        }
        .task { if pause.enabled { await pause.refresh() } }
    }

    private func countsLine(_ c: BoardCounts) -> String {
        var parts: [String] = []
        if model.waitingEnabled { parts.append("\(c.waiting) waiting") }
        if model.waitingEnabled || pause.enabled { parts.append("\(c.live) live") }
        if model.showSessions {
            let est = model.sessionsPending ? "est., still indexing" : "est."
            parts.append("\(c.today) today (\(est))")
        }
        return parts.joined(separator: " · ")
    }

    /// The words for SessionBoard.metaParts.
    private func meta(_ row: SessionBoardRow) -> String {
        SessionBoard.metaParts(row).compactMap { part -> String? in
            switch part {
            case .waiting(let reason, let age):
                let label = Waiting.reasonLabel(WaitingReason(rawValue: reason) ?? .question)
                return "waiting \(age) · \(label)"
            case .pause(let p):
                guard let state = PauseRowState(rawValue: p.state) else { return nil }
                return Pause.rowLabel(
                    PauseRow(
                        state: state, via: p.via.flatMap(PauseVia.init(rawValue:)), reason: p.reason
                    ))
            case .running:
                return "running"
            case .today(let tokens, let when):
                return "\(SessionFormat.compactTokens(tokens))  \(when)"
            }
        }.joined(separator: " · ")
    }

    @ViewBuilder
    private func rowView(_ row: SessionBoardRow) -> some View {
        HStack(spacing: 6) {
            Button {
                click(row)
            } label: {
                HStack {
                    Text("\u{25b8} \(row.name)").font(.system(size: 12, weight: .semibold))
                    Spacer()
                    Text(meta(row))
                        .font(.system(size: 11))
                        .foregroundColor(row.waiting != nil ? .cuWarning : .secondary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.borderless)
            .help(row.live ? "Focus \(row.name) · \(row.cwd)" : "Resume in a terminal: \(row.cwd)")
            if pause.enabled, row.live {
                Button("Pause") { pause.pause(sessionId: row.sessionId) }
                    .font(.system(size: 11))
                    .disabled(!pause.canAct)
            }
        }
    }

    // A running session: raise its terminal by pid. One that ended: resume
    // it in a terminal, like Today's sessions does.
    private func click(_ row: SessionBoardRow) {
        if let pid = row.pid {
            model.focusSession(pid: pid)
        } else if row.today != nil {
            model.resume(sessionId: row.sessionId)
        }
    }
}
