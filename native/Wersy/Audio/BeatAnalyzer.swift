import AVFoundation
import Accelerate

/// Wykrywanie BPM i pierwszej „jedynki” na podstawie obwiedni onsetów + autokorelacji.
enum BeatAnalyzer {
    struct Result {
        var bpm: Double
        var firstBeat: Double
        var duration: Double
    }

    static func analyze(url: URL) throws -> Result {
        let file = try AVAudioFile(forReading: url)
        let format = file.processingFormat
        let sr = format.sampleRate
        let totalFrames = AVAudioFrameCount(file.length)
        let duration = Double(file.length) / sr

        // analizujemy maks. 90 s – wystarczy do BPM
        let framesToRead = min(totalFrames, AVAudioFrameCount(sr * 90))
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: framesToRead) else {
            return Result(bpm: 90, firstBeat: 0, duration: duration)
        }
        try file.read(into: buf, frameCount: framesToRead)
        let n = Int(buf.frameLength)
        guard n > 0, let ch = buf.floatChannelData else {
            return Result(bpm: 90, firstBeat: 0, duration: duration)
        }

        // mono
        var mono = [Float](repeating: 0, count: n)
        let channels = Int(format.channelCount)
        let scale = 1 / Float(channels)
        for c in 0..<channels {
            let src = ch[c]
            for i in 0..<n { mono[i] += src[i] * scale }
        }

        // energia w oknach
        let hop = 512
        let win = 1024
        let frames = max(0, (n - win) / hop)
        guard frames > 16 else { return Result(bpm: 90, firstBeat: 0, duration: duration) }
        var energy = [Float](repeating: 0, count: frames)
        mono.withUnsafeBufferPointer { p in
            for i in 0..<frames {
                var e: Float = 0
                vDSP_svesq(p.baseAddress! + i * hop, 1, &e, vDSP_Length(win))
                energy[i] = log(1 + 1000 * e)
            }
        }
        // onset = dodatnia różnica energii
        var onset = [Float](repeating: 0, count: frames)
        for i in 1..<frames { onset[i] = max(0, energy[i] - energy[i - 1]) }
        let mean = onset.reduce(0, +) / Float(frames)
        onset = onset.map { $0 - mean }

        let fps = sr / Double(hop)
        func lag(forBPM b: Double) -> Int { Int((60.0 / b) * fps) }

        // autokorelacja w zakresie 60–180 BPM, z wagą preferującą ~95 BPM
        var bestLag = lag(forBPM: 90)
        var bestScore = -Float.greatestFiniteMagnitude
        for l in lag(forBPM: 180)...lag(forBPM: 60) where l < frames {
            var s: Float = 0
            vDSP_dotpr(onset, 1, Array(onset[l...]), 1, &s, vDSP_Length(frames - l))
            s /= Float(frames - l)
            let b = 60.0 * fps / Double(l)
            let w = Float(exp(-pow(log2(b / 95.0), 2) / (2 * 0.6 * 0.6)))
            if s * w > bestScore { bestScore = s * w; bestLag = l }
        }

        // doprecyzowanie lagu (interpolacja paraboliczna)
        func ac(_ l: Int) -> Float {
            guard l > 0, l < frames else { return 0 }
            var s: Float = 0
            vDSP_dotpr(onset, 1, Array(onset[l...]), 1, &s, vDSP_Length(frames - l))
            return s / Float(frames - l)
        }
        let y0 = ac(bestLag - 1), y1 = ac(bestLag), y2 = ac(bestLag + 1)
        let denom = y0 - 2 * y1 + y2
        let delta = denom != 0 ? Double(0.5 * (y0 - y2) / denom) : 0
        let preciseLag = Double(bestLag) + max(-0.5, min(0.5, delta))
        var bpm = 60.0 * fps / preciseLag
        bpm = (bpm * 10).rounded() / 10

        // faza: przesunięcie siatki beatów z największą sumą onsetów
        let period = preciseLag
        var bestPhase = 0
        var bestPhaseScore = -Float.greatestFiniteMagnitude
        for ph in 0..<Int(period) {
            var s: Float = 0
            var k = Double(ph)
            while Int(k) < frames { s += onset[Int(k)]; k += period }
            if s > bestPhaseScore { bestPhaseScore = s; bestPhase = ph }
        }
        let firstBeat = Double(bestPhase) * Double(hop) / sr

        return Result(bpm: bpm, firstBeat: firstBeat, duration: duration)
    }
}
