import Foundation

/// Typ sekcji piosenki.
enum SectionKind: String, Codable, CaseIterable, Identifiable {
    case intro, verse, chorus, prechorus, bridge, outro, other
    var id: String { rawValue }

    var label: String {
        switch self {
        case .intro: return "Intro"
        case .verse: return "Zwrotka"
        case .chorus: return "Refren"
        case .prechorus: return "Przedrefren"
        case .bridge: return "Bridge"
        case .outro: return "Outro"
        case .other: return "Inne"
        }
    }

    var colorName: String {
        switch self {
        case .intro: return "gray"
        case .verse: return "blue"
        case .chorus: return "orange"
        case .prechorus: return "yellow"
        case .bridge: return "purple"
        case .outro: return "gray"
        case .other: return "teal"
        }
    }
}

/// Jedna wersja wersu.
struct LineVersion: Codable, Identifiable, Hashable {
    var id = UUID()
    var text: String = ""
    var visible: Bool = true
}

/// Wers przypisany do jednego bezwzględnego taktu.
struct Line: Codable, Identifiable, Hashable {
    var id = UUID()
    var versions: [LineVersion] = [LineVersion()]
}

/// Sekcja: zakres taktów (numeracja od 1, włącznie).
struct SongSection: Codable, Identifiable, Hashable {
    var id = UUID()
    var kind: SectionKind
    var number: Int            // np. Zwrotka 1, Zwrotka 2
    var startBar: Int          // bezwzględny takt, od 1
    var endBar: Int            // włącznie
    var lines: [Line] = []     // lines[i] = takt startBar + i

    var title: String {
        switch kind {
        case .verse, .chorus, .bridge, .prechorus, .other: return "\(kind.label) \(number)"
        default: return kind.label
        }
    }
    var barCount: Int { max(0, endBar - startBar + 1) }

    /// Dopasowuje liczbę wersów do liczby taktów, zachowując istniejący tekst.
    mutating func syncLines() {
        if lines.count < barCount {
            lines.append(contentsOf: (0..<(barCount - lines.count)).map { _ in Line() })
        } else if lines.count > barCount {
            lines.removeLast(lines.count - barCount)
        }
    }
}

/// Nagranie na ścieżce wokalu.
struct Take: Codable, Identifiable, Hashable {
    var id = UUID()
    var fileName: String
    /// Pozycja w bicie (sekundy), w której zaczęto nagranie – przed korektą latencji.
    var startTime: Double
}

struct VocalTrack: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var muted: Bool = false
    var volume: Float = 1
    var takes: [Take] = []
}

enum PlayMode: String, Codable { case long, loop }

struct Project: Codable, Identifiable, Hashable {
    var id = UUID()
    var name: String
    var created = Date()
    var beatFileName: String?
    var beatDuration: Double = 0
    var bpm: Double = 90
    var beatsPerBar: Int = 4
    /// Czas (s) pierwszej „jedynki” – początek taktu 1.
    var firstDownbeat: Double = 0
    var sections: [SongSection] = []
    var tracks: [VocalTrack] = []

    // ustawienia transportu
    var playMode: PlayMode = .long
    var longStartBar: Int = 1
    var loopStartBar: Int = 1
    var loopEndBar: Int = 4

    var barDuration: Double { 60.0 / bpm * Double(beatsPerBar) }

    var barCount: Int {
        guard beatDuration > 0, bpm > 0 else { return 0 }
        return max(1, Int(ceil((beatDuration - firstDownbeat) / barDuration)))
    }

    /// Czas startu taktu (bar od 1).
    func time(ofBar bar: Int) -> Double {
        firstDownbeat + Double(bar - 1) * barDuration
    }

    /// Takt (od 1) dla danego czasu.
    func bar(at time: Double) -> Int {
        max(1, Int(floor((time - firstDownbeat) / barDuration)) + 1)
    }

    func section(containing bar: Int) -> SongSection? {
        sections.first { bar >= $0.startBar && bar <= $0.endBar }
    }

    mutating func sortSections() { sections.sort { $0.startBar < $1.startBar } }

    /// Kolejny numer dla danego typu sekcji (Zwrotka 1, 2, 3...).
    func nextNumber(for kind: SectionKind) -> Int {
        (sections.filter { $0.kind == kind }.map(\.number).max() ?? 0) + 1
    }
}
