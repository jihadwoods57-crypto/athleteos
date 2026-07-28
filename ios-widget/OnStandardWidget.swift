//  OnStandardWidget.swift
//  Verified Commitments — Home Screen / Lock Screen widget (slice 3)
//
//  ⚠ NOT WIRED INTO THE BUILD. This target is deliberately absent from app.json's `plugins` and
//  from `extra.eas.build.experimental.ios.appExtensions`. See ios-widget/README.md for the two
//  lines that turn it on. It was authored on Windows and has NEVER been compiled: adding an
//  unverified extension target to a production build is a good way to break `npm run ship`, and
//  the founder should enable it on a Mac where the compiler can answer for it.
//
//  DATA: the widget reads a small JSON snapshot from the shared App Group container. It never
//  talks to the network and never holds a session token. The app writes the snapshot whenever it
//  refreshes the board or the athlete's commitments.
//
//  PRIVACY: the snapshot carries counts and one title. No athlete names, no locations, no times
//  of day beyond the response deadline the coach themselves set. A widget is visible to anyone
//  glancing at the phone, so it shows the least that is still useful.

import WidgetKit
import SwiftUI
import AppIntents

// MARK: - Shared snapshot

let appGroupID = "group.app.onstandard.shared"
let snapshotKey = "verifiedCommitments.snapshot"

/// Mirrors the JSON the app writes. Every field optional so a stale or partial snapshot renders
/// a placeholder rather than crashing the timeline.
struct CommitmentSnapshot: Codable {
    var role: String?           // "athlete" | "coach"
    var instanceID: String?
    var title: String?          // the COACH'S words, never a product default
    var actionLabel: String?    // ditto — "I'm Up", "Rise Up", whatever they typed
    var respondBy: String?      // e.g. "5:15 AM"
    var responded: Int?         // coach view: how many are in
    var total: Int?
    var awaiting: Int?
    var acknowledged: Bool?     // athlete view: have I already checked in
    var checkedInAt: String?

    static func load() -> CommitmentSnapshot? {
        guard let defaults = UserDefaults(suiteName: appGroupID),
              let raw = defaults.string(forKey: snapshotKey),
              let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(CommitmentSnapshot.self, from: data)
    }
}

// MARK: - Interactive check-in

/// The athlete presses the coach's button from the Home Screen and never opens the app.
/// The intent only records INTENT: it stamps the App Group so the widget updates instantly, and
/// the app performs the authenticated `ack_commitment` call on next foreground. A widget extension
/// has no Supabase session, and minting one here would put a refresh token in a second process.
struct CheckInIntent: AppIntent {
    static var title: LocalizedStringResource = "Check in"
    static var description = IntentDescription("Tell your coach you're up.")
    static var openAppWhenRun: Bool = false

    @Parameter(title: "Instance") var instanceID: String

    init() { self.instanceID = "" }
    init(instanceID: String) { self.instanceID = instanceID }

    func perform() async throws -> some IntentResult {
        if let defaults = UserDefaults(suiteName: appGroupID) {
            defaults.set(instanceID, forKey: "verifiedCommitments.pendingAck")
            defaults.set(Date().timeIntervalSince1970, forKey: "verifiedCommitments.pendingAckAt")
            // Optimistic local echo so the widget reflects the press immediately.
            if let raw = defaults.string(forKey: snapshotKey),
               let data = raw.data(using: .utf8),
               var snap = try? JSONDecoder().decode(CommitmentSnapshot.self, from: data) {
                snap.acknowledged = true
                if let out = try? JSONEncoder().encode(snap),
                   let s = String(data: out, encoding: .utf8) {
                    defaults.set(s, forKey: snapshotKey)
                }
            }
        }
        WidgetCenter.shared.reloadAllTimelines()
        return .result()
    }
}

// MARK: - Timeline

struct CommitmentEntry: TimelineEntry {
    let date: Date
    let snapshot: CommitmentSnapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> CommitmentEntry {
        CommitmentEntry(date: Date(), snapshot: nil)
    }
    func getSnapshot(in context: Context, completion: @escaping (CommitmentEntry) -> Void) {
        completion(CommitmentEntry(date: Date(), snapshot: CommitmentSnapshot.load()))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<CommitmentEntry>) -> Void) {
        let entry = CommitmentEntry(date: Date(), snapshot: CommitmentSnapshot.load())
        // Refresh every 15 minutes; the app also reloads timelines whenever it writes a snapshot,
        // so a live roll call moves as responses land rather than waiting for this.
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
}

// MARK: - Views

private let brandGreen = Color(red: 0.20, green: 0.83, blue: 0.60)
private let brandAmber = Color(red: 0.96, green: 0.65, blue: 0.14)

struct CoachView: View {
    let snap: CommitmentSnapshot
    var body: some View {
        let responded = snap.responded ?? 0
        let total = snap.total ?? 0
        let awaiting = snap.awaiting ?? max(0, total - responded)
        VStack(alignment: .leading, spacing: 6) {
            Text((snap.title ?? "Roll Call").uppercased())
                .font(.system(size: 10, weight: .heavy)).kerning(0.6)
                .foregroundStyle(.secondary).lineLimit(1)
            Text("\(responded)/\(total) UP")
                .font(.system(size: 30, weight: .black, design: .rounded))
                .foregroundStyle(awaiting == 0 ? brandGreen : .primary)
                .minimumScaleFactor(0.6).lineLimit(1)
            Text(awaiting == 0 ? "Everyone is in" : "\(awaiting) awaiting response")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(awaiting == 0 ? brandGreen : brandAmber)
                .lineLimit(2)
        }
    }
}

struct AthleteView: View {
    let snap: CommitmentSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text((snap.title ?? "Roll Call").uppercased())
                .font(.system(size: 10, weight: .heavy)).kerning(0.6)
                .foregroundStyle(.secondary).lineLimit(1)
            if snap.acknowledged == true {
                Label(snap.checkedInAt.map { "Checked in \($0)" } ?? "Checked in",
                      systemImage: "checkmark.circle.fill")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(brandGreen).lineLimit(2)
            } else {
                if let by = snap.respondBy {
                    Text("Respond by \(by)")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(brandAmber).lineLimit(1)
                }
                Button(intent: CheckInIntent(instanceID: snap.instanceID ?? "")) {
                    Text(snap.actionLabel ?? "I’m Up")
                        .font(.system(size: 15, weight: .heavy))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(brandGreen)
            }
        }
    }
}

struct EmptyView_: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("ONSTANDARD")
                .font(.system(size: 10, weight: .heavy)).kerning(0.6)
                .foregroundStyle(.secondary)
            Text("Nothing scheduled")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.primary)
        }
    }
}

struct OnStandardWidgetEntryView: View {
    var entry: Provider.Entry
    var body: some View {
        Group {
            if let snap = entry.snapshot {
                if snap.role == "coach" { CoachView(snap: snap) } else { AthleteView(snap: snap) }
            } else {
                EmptyView_()
            }
        }
        .containerBackground(.fill.tertiary, for: .widget)
        .widgetURL(URL(string: "onstandard://roll-call/\(entry.snapshot?.instanceID ?? "")"))
    }
}

@main
struct OnStandardWidget: Widget {
    let kind: String = "OnStandardCommitmentWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            OnStandardWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Roll Call")
        .description("Your morning check-in, and your coach's live count.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
    }
}
