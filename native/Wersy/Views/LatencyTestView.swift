import SwiftUI
import AVFoundation

/// Test latencji: gra bit na słuchawkach, użytkownik robi beatbox na werbel,
/// potem dopasowuje nagranie do bitu. Przesunięcie (ms) = latencja dla wszystkich nagrań.
struct LatencyTestView: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    @Environment(\.dismiss) private var dismiss
    let projectID: UUID

    @State private var offsetMs: Double = 0
    @State private var take: (url: URL, start: Double)?
    @State private var beatEnv: [Float] = []
    @State private var takeEnv: [Float] = []
    private let bars = 4
    private let envRate = 1000.0 // próbek obwiedni na sekundę (1 ms)

    private var project: Project? { store.project(projectID) }
    private var window: (Double, Double) {
        guard let p = project else { return (0, 1) }
        let s = p.time(ofBar: 1)
        return (s, min(p.time(ofBar: 1 + bars), p.beatDuration))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("1. Załóż słuchawki.\n2. Stuknij „Nagraj test” – zagrają \(bars) takty bitu.\n3. Rób beatbox na werbel razem z bitem.\n4. Przesuń nagranie, aż werble się pokryją, i zapisz.")
                        .font(.subheadline)
                    Text(audio.routeDescription).font(.caption).foregroundStyle(.secondary)
                }
                Section {
                    Button {
                        recordTest()
                    } label: {
                        Label(audio.isRecording ? "Nagrywam…" : "Nagraj test",
                              systemImage: audio.isRecording ? "waveform" : "record.circle")
                    }
                    .disabled(audio.isRecording || project?.beatFileName == nil || !audio.micPermission)
                }
                if take != nil {
                    Section("Dopasowanie") {
                        WaveCompare(beat: beatEnv, take: takeEnv, shift: Int(offsetMs * envRate / 1000))
                            .frame(height: 140)
                            .listRowInsets(EdgeInsets())
                        HStack {
                            Text("Przesunięcie")
                            Spacer()
                            Text("\(Int(offsetMs.rounded())) ms").monospacedDigit().font(.headline)
                        }
                        Slider(value: $offsetMs, in: -100...500, step: 1)
                        HStack {
                            ForEach([-10, -1, 1, 10], id: \.self) { d in
                                Button(d > 0 ? "+\(d)" : "\(d)") { offsetMs += Double(d) }
                                    .buttonStyle(.bordered)
                                    .frame(maxWidth: .infinity)
                            }
                        }
                        Button { autoDetect() } label: { Label("Dopasuj automatycznie", systemImage: "wand.and.stars") }
                        HStack {
                            Button { listen() } label: { Label("Odsłuchaj", systemImage: "play.fill") }
                            Spacer()
                            Button { audio.stop() } label: { Label("Stop", systemImage: "stop.fill") }
                        }
                        .buttonStyle(.bordered)
                    }
                }
                Section {
                    HStack {
                        Text("Aktualna latencja")
                        Spacer()
                        Text("\(Int(store.latencyMs.rounded())) ms").monospacedDigit()
                    }
                }
            }
            .navigationTitle("Test latencji")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Zamknij") { audio.stop(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Zapisz") {
                        store.latencyMs = offsetMs
                        audio.stop()
                        dismiss()
                    }
                    .disabled(take == nil)
                }
            }
            .onAppear { offsetMs = store.latencyMs }
        }
    }

    private var testURL: URL {
        store.fileURL("latency-test.caf", in: projectID)
    }

    private func recordTest() {
        let (s, e) = window
        try? FileManager.default.removeItem(at: testURL)
        audio.recordLatencyTest(to: testURL, start: s, end: e) { url, start in
            take = (url, start)
            computeEnvelopes()
        }
    }

    private func listen() {
        guard let t = take else { return }
        let (s, e) = window
        audio.playCustom(start: s, end: e, loop: true,
                         takes: [.init(url: t.url, position: t.start - offsetMs / 1000, volume: 1)])
    }

    private func computeEnvelopes() {
        guard let p = project, let name = p.beatFileName, let t = take else { return }
        let (s, e) = window
        let beatURL = store.fileURL(name, in: p.id)
        beatEnv = Envelope.compute(url: beatURL, from: s, duration: e - s, rate: envRate)
        // obwiednia nagrania ustawiona względem początku okna (bez korekty)
        let raw = Envelope.compute(url: t.url, from: 0, duration: e - s + 1, rate: envRate)
        let lead = Int((t.start - s) * envRate)
        if lead >= 0 {
            takeEnv = Array(repeating: 0, count: lead) + raw
        } else {
            takeEnv = Array(raw.dropFirst(-lead))
        }
    }

    /// Szuka przesunięcia 0–500 ms, przy którym onsety nagrania najlepiej pokrywają się z bitem.
    private func autoDetect() {
        func onsets(_ x: [Float]) -> [Float] {
            guard x.count > 1 else { return x }
            var o = [Float](repeating: 0, count: x.count)
            for i in 1..<x.count { o[i] = max(0, x[i] - x[i - 1]) }
            return o
        }
        let a = onsets(beatEnv), b = onsets(takeEnv)
        var best = 0, bestScore: Float = -1
        for lag in 0...500 {
            var s: Float = 0
            let n = min(a.count, b.count - lag)
            if n <= 0 { break }
            for i in 0..<n { s += a[i] * b[i + lag] }
            if s > bestScore { bestScore = s; best = lag }
        }
        offsetMs = Double(best) * 1000 / envRate
    }
}

/// Bit (góra) i nagranie przesunięte o latencję (dół).
struct WaveCompare: View {
    let beat: [Float]
    let take: [Float]
    let shift: Int

    var body: some View {
        Canvas { ctx, size in
            let n = max(beat.count, 1)
            let h = size.height / 2
            func draw(_ env: [Float], offset: Int, y0: CGFloat, color: Color) {
                let peak = max(env.max() ?? 1, 0.0001)
                var path = Path()
                let step = max(1, n / Int(size.width))
                var i = 0
                while i < n {
                    let j = i + offset
                    let v = (j >= 0 && j < env.count) ? env[j] / peak : 0
                    let x = CGFloat(i) / CGFloat(n) * size.width
                    path.move(to: CGPoint(x: x, y: y0 + h / 2 - CGFloat(v) * h * 0.45))
                    path.addLine(to: CGPoint(x: x, y: y0 + h / 2 + CGFloat(v) * h * 0.45))
                    i += step
                }
                ctx.stroke(path, with: .color(color), lineWidth: 1)
            }
            draw(beat, offset: 0, y0: 0, color: .blue)
            draw(take, offset: shift, y0: h, color: .red)
            var mid = Path()
            mid.move(to: CGPoint(x: 0, y: h)); mid.addLine(to: CGPoint(x: size.width, y: h))
            ctx.stroke(mid, with: .color(.secondary.opacity(0.4)), lineWidth: 0.5)
        }
        .background(Color(.secondarySystemBackground))
    }
}

enum Envelope {
    /// Obwiednia (szczyt w oknach 1/rate s).
    static func compute(url: URL, from start: Double, duration: Double, rate: Double) -> [Float] {
        guard let f = try? AVAudioFile(forReading: url) else { return [] }
        let sr = f.processingFormat.sampleRate
        let startF = AVAudioFramePosition(max(0, start) * sr)
        guard startF < f.length else { return [] }
        let count = AVAudioFrameCount(min(f.length - startF, AVAudioFramePosition(duration * sr)))
        guard count > 0, let buf = AVAudioPCMBuffer(pcmFormat: f.processingFormat, frameCapacity: count) else { return [] }
        f.framePosition = startF
        try? f.read(into: buf, frameCount: count)
        guard let ch = buf.floatChannelData else { return [] }
        let per = max(1, Int(sr / rate))
        let frames = Int(buf.frameLength)
        var out: [Float] = []
        out.reserveCapacity(frames / per + 1)
        var i = 0
        while i < frames {
            var m: Float = 0
            let end = min(frames, i + per)
            for c in 0..<Int(f.processingFormat.channelCount) {
                for k in i..<end { m = max(m, abs(ch[c][k])) }
            }
            out.append(m)
            i = end
        }
        return out
    }
}
