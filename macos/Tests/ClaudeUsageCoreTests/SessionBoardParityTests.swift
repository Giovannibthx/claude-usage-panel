import Foundation
import XCTest

@testable import ClaudeUsageCore

/// The session board against the same fixture the JS port asserts
/// (tests/board.test.js).
final class SessionBoardParityTests: XCTestCase {
    private func str(_ v: Any?) -> String { v as? String ?? "" }
    private func int(_ v: Any?) -> Int? { (v as? NSNumber)?.intValue }
    private func dbl(_ v: Any?) -> Double { (v as? NSNumber)?.doubleValue ?? 0 }

    func testLayouts() throws {
        let fix = try Fixtures.load("board.json")
        for c in fix["layouts"] as! [[String: Any]] {
            XCTAssertEqual(SessionsLayout.of(str(c["value"])).rawValue, str(c["expected"]))
        }
    }

    func testCases() throws {
        let fix = try Fixtures.load("board.json")
        for c in fix["cases"] as! [[String: Any]] {
            let name = str(c["name"])
            let input = c["input"] as! [String: Any]
            let waiting = (input["waiting"] as! [[String: Any]]).map {
                SessionBoard.Waiting(
                    sessionId: str($0["sessionId"]), pid: int($0["pid"]), name: str($0["name"]),
                    cwd: str($0["cwd"]), reason: str($0["reason"]), at: dbl($0["at"]),
                    age: str($0["age"]))
            }
            let pause = (input["pause"] as! [[String: Any]]).map {
                SessionBoard.Pause(
                    sessionId: str($0["sessionId"]), pid: int($0["pid"]), name: str($0["name"]),
                    cwd: str($0["cwd"]), state: $0["state"] as? String, via: $0["via"] as? String,
                    reason: $0["reason"] as? String)
            }
            let today = (input["today"] as! [[String: Any]]).map {
                SessionBoard.Today(
                    sessionId: str($0["sessionId"]), cwd: str($0["cwd"]), label: str($0["label"]),
                    tokens: int($0["tokens"]) ?? 0, when: str($0["when"]), lastMs: dbl($0["lastMs"])
                )
            }
            let (rows, counts) = SessionBoard.rows(waiting: waiting, pause: pause, today: today)
            let e = c["expected"] as! [String: Any]
            XCTAssertEqual(rows.map(\.sessionId), e["order"] as! [String], name)
            let by = Dictionary(uniqueKeysWithValues: rows.map { ($0.sessionId, $0) })
            for (id, s) in e["status"] as! [String: String] {
                XCTAssertEqual(by[id]?.status.rawValue, s, "\(name) \(id)")
            }
            for (id, n) in e["names"] as! [String: String] {
                XCTAssertEqual(by[id]?.name, n, "\(name) \(id)")
            }
            for (id, p) in e["pids"] as! [String: Any] {
                XCTAssertEqual(by[id]?.pid, int(p), "\(name) \(id)")
            }
            let pauses = e["pause"] as! [String: [String: Any]]
            let metas = e["meta"] as! [String: [[String: Any]]]
            let tokens = e["tokens"] as! [String: Any]
            for r in rows {
                XCTAssertEqual(
                    r.pause, pauses[r.sessionId].map(pauseOf), "\(name) pause \(r.sessionId)")
                XCTAssertEqual(
                    SessionBoard.metaParts(r), metas[r.sessionId]?.map(partOf),
                    "\(name) meta \(r.sessionId)")
                XCTAssertEqual(
                    r.today?.tokens, int(tokens[r.sessionId]), "\(name) tokens \(r.sessionId)")
            }
            let ec = e["counts"] as! [String: Any]
            XCTAssertEqual(
                counts,
                BoardCounts(
                    waiting: int(ec["waiting"])!, live: int(ec["live"])!, today: int(ec["today"])!),
                name)
            let tabs = e["tabs"] as! [String: [String]]
            for tab in BoardTab.allCases {
                XCTAssertEqual(
                    SessionBoard.tab(rows, tab).map(\.sessionId), tabs[tab.rawValue],
                    "\(name) tab \(tab)")
            }
        }
    }

    private func pauseOf(_ p: [String: Any]) -> SessionBoardRow.Pause {
        SessionBoardRow.Pause(
            state: str(p["state"]), via: p["via"] as? String, reason: p["reason"] as? String)
    }

    private func partOf(_ p: [String: Any]) -> BoardMetaPart {
        switch str(p["kind"]) {
        case "waiting": return .waiting(reason: str(p["reason"]), age: str(p["age"]))
        case "pause": return .pause(pauseOf(p))
        case "today": return .today(tokens: int(p["tokens"]) ?? -1, when: str(p["when"]))
        default: return .running
        }
    }

    func testVisible() throws {
        let fix = try Fixtures.load("board.json")
        for c in fix["visible"] as! [[String: Any]] {
            XCTAssertEqual(
                SessionBoard.visible(
                    SessionsLayout.of(str(c["layout"])), rows: int(c["rows"]) ?? 0,
                    pauseRequest: c["pauseRequest"] as? Bool ?? false),
                c["expected"] as? Bool, str(c["name"]))
        }
    }

    func testDefaultTab() throws {
        let fix = try Fixtures.load("board.json")
        for c in fix["defaultTab"] as! [[String: Any]] {
            let k = c["counts"] as! [String: Any]
            let counts = BoardCounts(
                waiting: int(k["waiting"])!, live: int(k["live"])!, today: int(k["today"])!)
            let remembered = (c["remembered"] as? String).flatMap(BoardTab.init(rawValue:))
            XCTAssertEqual(
                SessionBoard.defaultTab(counts, remembered: remembered).rawValue,
                str(c["expected"]), str(c["name"]))
        }
    }
}
