import SwiftUI

/// Pasek na dole: Start (jak pad), tryb Long / Pętla z wyborem taktów, Stop.
struct TransportBar: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    let projectID: UUID

    var body: some View {
        let p = store.binding(projectID)
        let bars = max(1, p.wrappedValue.barCount)
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Picker("Tryb", selection: p.playMode) {
                    Text("Long").tag(PlayMode.long)
                    Text("Pętla").tag(PlayMode.loop)
                }
                .pickerStyle(.segmented)
                .frame(width: 140)

                if p.wrappedValue.playMode == .long {
                    BarMenu(title: "Od", bar: p.longStartBar, bars: bars, project: p.wrappedValue)
                } else {
                    BarMenu(title: "Od", bar: p.loopStartBar, bars: bars, project: p.wrappedValue)
                    BarMenu(title: "Do", bar: p.loopEndBar, bars: bars, project: p.wrappedValue)
                }
                Spacer(minLength: 0)
                Text("T\(p.wrappedValue.bar(at: audio.position))")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(audio.isPlaying ? .primary : .secondary)
            }
            HStack(spacing: 12) {
                Button {
                    audio.playFromTransport()
                } label: {
                    Label("Start", systemImage: "play.fill")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
                .tint(audio.isPlaying ? .green : .accentColor)

                Button {
                    audio.stop()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.bordered)
            }
            .font(.headline)
            .disabled(p.wrappedValue.beatFileName == nil)
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }
}

/// Wybór bezwzględnego taktu z podpisem sekcji.
struct BarMenu: View {
    let title: String
    @Binding var bar: Int
    let bars: Int
    let project: Project

    var body: some View {
        Menu {
            Picker(title, selection: $bar) {
                ForEach(1...bars, id: \.self) { b in
                    if let s = project.section(containing: b) {
                        Text("Takt \(b) – \(s.title) \(b - s.startBar + 1)").tag(b)
                    } else {
                        Text("Takt \(b)").tag(b)
                    }
                }
            }
        } label: {
            Text("\(title) \(bar)")
                .font(.subheadline.monospacedDigit())
                .padding(.horizontal, 8).padding(.vertical, 6)
                .background(.quaternary, in: RoundedRectangle(cornerRadius: 8))
        }
    }
}

extension SectionKind {
    var color: Color {
        switch self {
        case .intro: return .gray
        case .verse: return .blue
        case .chorus: return .orange
        case .prechorus: return .yellow
        case .bridge: return .purple
        case .outro: return .brown
        case .other: return .teal
        }
    }
}
