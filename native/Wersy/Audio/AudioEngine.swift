import AVFoundation
import Combine

/// Silnik audio: odtwarzanie bitu (long / pętla), ścieżki wokalu, nagrywanie z mikrofonu iPhone'a.
@MainActor
final class AudioEngine: ObservableObject {
    struct ScheduledTake {
        let url: URL
        /// Pozycja w bicie (s), gdzie nagranie ma zabrzmieć (już po korekcie latencji).
        let position: Double
        let volume: Float
    }

    @Published private(set) var isPlaying = false
    @Published private(set) var isRecording = false
    @Published private(set) var position: Double = 0          // sekundy w bicie
    @Published private(set) var recordingTrackID: UUID?
    @Published var micPermission: Bool = false
    @Published private(set) var routeDescription: String = ""

    private let engine = AVAudioEngine()
    private let beatPlayer = AVAudioPlayerNode()
    private var takePlayers: [AVAudioPlayerNode] = []
    private var beatFile: AVAudioFile?
    private var beatURL: URL?

    private weak var store: ProjectStore?
    private var projectID: UUID?

    // stan odtwarzania
    private var playStartPosition: Double = 0
    private var playStartHostTime: UInt64 = 0
    private var loopRange: (Double, Double)?
    private var stopAtPosition: Double?
    private var timer: Timer?

    // nagrywanie
    private var recordBox: RecordBox?
    private var recordURL: URL?
    private var recordCompletion: ((URL, Double) -> Void)?

    private var observers: [NSObjectProtocol] = []

    init() {
        engine.attach(beatPlayer)
        configureSession()
        observers.append(NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.applyPreferredInput() }
            })
        observers.append(NotificationCenter.default.addObserver(
            forName: .AVAudioEngineConfigurationChange, object: engine, queue: .main) { [weak self] _ in
                Task { @MainActor in self?.handleConfigChange() }
            })
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                self.micPermission = granted
                self.startEngineIfNeeded()
            }
        }
    }

    // MARK: - Sesja audio

    /// Mikrofon iPhone'a zawsze jako wejście; wyjście na słuchawki (przewodowe / Bluetooth A2DP), a bez nich na głośnik.
    private func configureSession() {
        let s = AVAudioSession.sharedInstance()
        do {
            try s.setCategory(.playAndRecord, mode: .default,
                              options: [.defaultToSpeaker, .allowBluetoothA2DP])
            try s.setPreferredIOBufferDuration(0.005)
            try s.setActive(true)
        } catch {
            print("Błąd sesji audio:", error)
        }
        applyPreferredInput()
    }

    private func applyPreferredInput() {
        let s = AVAudioSession.sharedInstance()
        if let builtIn = s.availableInputs?.first(where: { $0.portType == .builtInMic }) {
            try? s.setPreferredInput(builtIn)
        }
        let outs = s.currentRoute.outputs.map(\.portName).joined(separator: ", ")
        let ins = s.currentRoute.inputs.map(\.portName).joined(separator: ", ")
        routeDescription = "Wyjście: \(outs) · Mikrofon: \(ins)"
    }

    private func startEngineIfNeeded() {
        guard !engine.isRunning else { return }
        if micPermission { _ = engine.inputNode } // włącza wejście przed startem
        _ = engine.mainMixerNode
        engine.prepare()
        do { try engine.start() } catch { print("Błąd startu silnika:", error) }
    }

    private func handleConfigChange() {
        let wasPlaying = isPlaying
        let pos = position
        stop()
        // po zmianie trasy połączenia trzeba odtworzyć
        reconnectBeat()
        startEngineIfNeeded()
        applyPreferredInput()
        if wasPlaying { playLong(fromPosition: pos) }
    }

    // MARK: - Projekt

    func load(project: Project, store: ProjectStore) {
        self.store = store
        self.projectID = project.id
        loadBeat(for: project)
    }

    func reloadBeat() {
        guard let p = currentProject else { return }
        loadBeat(for: p)
    }

    private func loadBeat(for project: Project) {
        guard let name = project.beatFileName, let store else {
            beatFile = nil; beatURL = nil; return
        }
        let url = store.fileURL(name, in: project.id)
        beatURL = url
        beatFile = try? AVAudioFile(forReading: url)
        reconnectBeat()
    }

    private func reconnectBeat() {
        guard let f = beatFile else { return }
        engine.disconnectNodeOutput(beatPlayer)
        engine.connect(beatPlayer, to: engine.mainMixerNode, format: f.processingFormat)
    }

    private var currentProject: Project? {
        guard let id = projectID else { return nil }
        return store?.project(id)
    }

    private func takesForPlayback(_ p: Project, latencyMs: Double) -> [ScheduledTake] {
        guard let store else { return [] }
        let lat = latencyMs / 1000
        return p.tracks.filter { !$0.muted }.flatMap { tr in
            tr.takes.map { t in
                ScheduledTake(url: store.fileURL(t.fileName, in: p.id),
                              position: t.startTime - lat,
                              volume: tr.volume)
            }
        }
    }

    // MARK: - Transport (publiczne)

    func playLong(fromBar bar: Int) {
        guard let p = currentProject else { return }
        playLong(fromPosition: p.time(ofBar: bar))
    }

    func playLong(fromPosition pos: Double) {
        guard let p = currentProject, let store else { return }
        start(position: max(0, pos), loop: nil,
              takes: takesForPlayback(p, latencyMs: store.latencyMs))
    }

    func playLoop(fromBar a: Int, toBar b: Int) {
        guard let p = currentProject, let store else { return }
        let s = p.time(ofBar: min(a, b))
        let e = p.time(ofBar: max(a, b) + 1)
        start(position: s, loop: (s, min(e, p.beatDuration)),
              takes: takesForPlayback(p, latencyMs: store.latencyMs))
    }

    /// Odtwarza zgodnie z ustawieniami transportu projektu.
    func playFromTransport() {
        guard let p = currentProject else { return }
        switch p.playMode {
        case .long: playLong(fromBar: p.longStartBar)
        case .loop: playLoop(fromBar: p.loopStartBar, toBar: p.loopEndBar)
        }
    }

    /// Dowolne odtwarzanie z własną listą nagrań (np. test latencji).
    func playCustom(start s: Double, end e: Double, loop: Bool, takes: [ScheduledTake]) {
        start(position: s, loop: loop ? (s, e) : nil, takes: takes, stopAt: loop ? nil : e)
    }

    func stop() {
        if isRecording { finishRecording() }
        timer?.invalidate(); timer = nil
        beatPlayer.stop()
        for pl in takePlayers { pl.stop(); engine.detach(pl) }
        takePlayers.removeAll()
        isPlaying = false
        loopRange = nil
        stopAtPosition = nil
    }

    // MARK: - Nagrywanie

    /// Nagrywa na ścieżkę. W trybie pętli gra raz od początku do końca pętli i sam się zatrzymuje.
    func record(trackID: UUID, completion: @escaping (URL, Double) -> Void) {
        guard let p = currentProject else { return }
        let start: Double
        var stopAt: Double? = nil
        switch p.playMode {
        case .long: start = p.time(ofBar: p.longStartBar)
        case .loop:
            start = p.time(ofBar: min(p.loopStartBar, p.loopEndBar))
            stopAt = min(p.time(ofBar: max(p.loopStartBar, p.loopEndBar) + 1), p.beatDuration)
        }
        let url = store!.fileURL("take-\(UUID().uuidString).caf", in: p.id)
        recordingTrackID = trackID
        recordRaw(to: url, start: start, stopAt: stopAt,
                  takes: takesForPlayback(p, latencyMs: store!.latencyMs), completion: completion)
    }

    /// Nagrywanie do testu latencji (bez ścieżek wokalu w tle).
    func recordLatencyTest(to url: URL, start: Double, end: Double, completion: @escaping (URL, Double) -> Void) {
        recordRaw(to: url, start: start, stopAt: end, takes: [], completion: completion)
    }

    private func recordRaw(to url: URL, start: Double, stopAt: Double?, takes: [ScheduledTake],
                           completion: @escaping (URL, Double) -> Void) {
        guard micPermission else { return }
        stop()
        startEngineIfNeeded()
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0 else { return }
        let box: RecordBox
        do {
            let file = try AVAudioFile(forWriting: url, settings: format.settings,
                                       commonFormat: format.commonFormat, interleaved: format.isInterleaved)
            box = RecordBox(file: file)
        } catch {
            print("Nie można utworzyć pliku nagrania:", error); return
        }
        recordBox = box
        recordURL = url
        recordCompletion = completion
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tapBlock(box))
        isRecording = true
        self.start(position: start, loop: nil, takes: takes, stopAt: stopAt)
    }

    private func finishRecording() {
        engine.inputNode.removeTap(onBus: 0)
        isRecording = false
        let url = recordURL
        let firstHost = recordBox?.firstHostTime ?? playStartHostTime
        // pozycja w bicie odpowiadająca pierwszej próbce nagrania
        let delta = Double(Int64(firstHost) - Int64(playStartHostTime)) * hostTimeToSeconds
        let startPos = playStartPosition + delta
        recordBox = nil
        recordURL = nil
        recordingTrackID = nil
        let done = recordCompletion
        recordCompletion = nil
        if let url { done?(url, startPos) }
    }

    /// Blok tapu działa na wątku audio – zapisuje bezpośrednio do pliku.
    nonisolated private static func tapBlock(_ box: RecordBox) -> AVAudioNodeTapBlock {
        return { buf, when in
            if box.firstHostTime == nil, when.isHostTimeValid { box.firstHostTime = when.hostTime }
            try? box.file.write(from: buf)
        }
    }

    // MARK: - Rdzeń odtwarzania

    private var hostTimeToSeconds: Double {
        var info = mach_timebase_info_data_t()
        mach_timebase_info(&info)
        return Double(info.numer) / Double(info.denom) / 1_000_000_000
    }

    private func start(position pos: Double, loop: (Double, Double)?, takes: [ScheduledTake], stopAt: Double? = nil) {
        let keepRecording = isRecording
        // zatrzymaj odtwarzanie, ale nie nagrywanie, które właśnie startuje
        timer?.invalidate(); timer = nil
        beatPlayer.stop()
        for pl in takePlayers { pl.stop(); engine.detach(pl) }
        takePlayers.removeAll()

        startEngineIfNeeded()
        guard let beatFile else { return }
        let sr = beatFile.processingFormat.sampleRate
        let total = AVAudioFramePosition(beatFile.length)

        if let lr = loop, lr.1 > lr.0 {
            let ls = lr.0, le = lr.1
            // pętla: bufor z fragmentem bitu, odtwarzany z opcją .loops
            let startF = AVAudioFramePosition(ls * sr)
            let len = AVAudioFrameCount(min(total - startF, AVAudioFramePosition((le - ls) * sr)))
            guard len > 0, let buf = AVAudioPCMBuffer(pcmFormat: beatFile.processingFormat, frameCapacity: len) else { return }
            beatFile.framePosition = startF
            try? beatFile.read(into: buf, frameCount: len)
            beatPlayer.scheduleBuffer(buf, at: nil, options: .loops)
            for t in takes { scheduleLoopTake(t, loopStart: ls, loopEnd: ls + Double(len) / sr) }
        } else {
            let startF = AVAudioFramePosition(pos * sr)
            guard startF < total else { return }
            beatPlayer.scheduleSegment(beatFile, startingFrame: startF,
                                       frameCount: AVAudioFrameCount(total - startF), at: nil)
            for t in takes { scheduleLongTake(t, from: pos) }
        }

        // wspólny start wszystkich odtwarzaczy
        let lead = 0.05
        let hostStart = mach_absolute_time() + UInt64(lead / hostTimeToSeconds)
        let when = AVAudioTime(hostTime: hostStart)
        beatPlayer.play(at: when)
        for pl in takePlayers { pl.play(at: when) }

        playStartHostTime = hostStart
        playStartPosition = loop?.0 ?? pos
        loopRange = loop
        stopAtPosition = stopAt
        isPlaying = true
        isRecording = keepRecording
        position = playStartPosition

        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
    }

    private func tick() {
        guard isPlaying else { return }
        let now = mach_absolute_time()
        let elapsed = max(0, Double(Int64(now) - Int64(playStartHostTime)) * hostTimeToSeconds)
        if let lr = loopRange, lr.1 > lr.0 {
            let ls = lr.0, le = lr.1
            position = ls + elapsed.truncatingRemainder(dividingBy: le - ls)
        } else {
            position = playStartPosition + elapsed
            if let stopAt = stopAtPosition, position >= stopAt { stop(); return }
            if let f = beatFile, position >= Double(f.length) / f.processingFormat.sampleRate { stop() }
        }
    }

    private func makeTakePlayer(format: AVAudioFormat, volume: Float) -> AVAudioPlayerNode {
        let pl = AVAudioPlayerNode()
        engine.attach(pl)
        engine.connect(pl, to: engine.mainMixerNode, format: format)
        pl.volume = volume
        takePlayers.append(pl)
        return pl
    }

    private func scheduleLongTake(_ t: ScheduledTake, from pos: Double) {
        guard let f = try? AVAudioFile(forReading: t.url) else { return }
        let sr = f.processingFormat.sampleRate
        let len = Double(f.length) / sr
        guard t.position + len > pos else { return }
        let pl = makeTakePlayer(format: f.processingFormat, volume: t.volume)
        if t.position >= pos {
            let at = AVAudioTime(sampleTime: AVAudioFramePosition((t.position - pos) * sr), atRate: sr)
            pl.scheduleFile(f, at: at)
        } else {
            let skip = AVAudioFramePosition((pos - t.position) * sr)
            pl.scheduleSegment(f, startingFrame: skip, frameCount: AVAudioFrameCount(f.length - skip), at: nil)
        }
    }

    /// Fragment nagrania mieszczący się w pętli, wklejony w bufor o długości pętli (reszta cisza).
    private func scheduleLoopTake(_ t: ScheduledTake, loopStart ls: Double, loopEnd le: Double) {
        guard let f = try? AVAudioFile(forReading: t.url) else { return }
        let fmt = f.processingFormat
        let sr = fmt.sampleRate
        let takeLen = Double(f.length) / sr
        let a = max(ls, t.position), b = min(le, t.position + takeLen)
        guard b > a else { return }
        let loopFrames = AVAudioFrameCount((le - ls) * sr)
        guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: loopFrames) else { return }
        out.frameLength = loopFrames
        let readFrames = AVAudioFrameCount((b - a) * sr)
        guard let tmp = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: readFrames) else { return }
        f.framePosition = AVAudioFramePosition((a - t.position) * sr)
        try? f.read(into: tmp, frameCount: readFrames)
        let dst = Int((a - ls) * sr)
        if let src = tmp.floatChannelData, let d = out.floatChannelData {
            for c in 0..<Int(fmt.channelCount) {
                for i in 0..<Int(tmp.frameLength) where dst + i < Int(loopFrames) {
                    d[c][dst + i] = src[c][i]
                }
            }
        }
        let pl = makeTakePlayer(format: fmt, volume: t.volume)
        pl.scheduleBuffer(out, at: nil, options: .loops)
    }
}

/// Stan nagrania współdzielony z wątkiem audio.
final class RecordBox: @unchecked Sendable {
    let file: AVAudioFile
    var firstHostTime: UInt64?
    init(file: AVAudioFile) { self.file = file }
}
