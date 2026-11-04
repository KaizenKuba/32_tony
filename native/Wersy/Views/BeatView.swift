import SwiftUI
import UniformTypeIdentifiers

struct BeatView: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    let projectID: UUID

    @State private var importing = false
    @State private var analyzing = false
    @State private var selStart: Int?
    @State private var selEnd: Int?
    @State private var showLatency = false
    @State private var errorText: String?

    private var project: Binding<Project> { store.binding(projectID) }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if project.wrappedValue.beatFileName == nil {
                    emptyBeat
                } else {
                    List {
                        beatInfoSection
                        barsSection
                        sectionsSection
                        tracksSection
                        latencySection
                    }
                    .listStyle(.insetGrouped)
                }
                TransportBar(projectID: projectID)
            }
            .navigationTitle(project.wrappedValue.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if project.wrappedValue.beatFileName != nil {
                    Button("Zmień bit") { importing = true }
                }
            }
            .fileImporter(isPresented: $importing, allowedContentTypes: [.audio]) { result in
                if case .success(let url) = result { importBeat(url) }
            }
            .sheet(isPresented: $showLatency) {
                LatencyTestView(projectID: projectID)
            }
            .alert("Błąd", isPresented: Binding(get: { errorText != nil }, set: { if !$0 { errorText = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(errorText ?? "") }
        }
    }

    // MARK: brak bitu

    private var emptyBeat: some View {
        VStack(spacing: 16) {
            Spacer()
            Image(systemName: "waveform.badge.plus").font(.system(size: 56)).foregroundStyle(.tint)
            Text("Dodaj bit, a aplikacja sama sprawdzi BPM i podzieli go na takty.")
                .multilineTextAlignment(.center).foregroundStyle(.secondary).padding(.horizontal)
            Button { importing = true } label: {
                Label("Dodaj bit", systemImage: "plus").frame(minWidth: 180, minHeight: 44)
            }
            .buttonStyle(.borderedProminent)
            if analyzing { ProgressView("Analizuję bit…") }
            Spacer()
        }
    }

    // MARK: info o bicie

    private var beatInfoSection: some View {
        Section("Bit") {
            HStack {
                Text("BPM")
                Spacer()
                Button { project.wrappedValue.bpm = max(40, project.wrappedValue.bpm - 0.5); syncAll() } label: { Image(systemName: "minus") }
                    .buttonStyle(.bordered)
                TextField("BPM", value: project.bpm, format: .number.precision(.fractionLength(0...1)))
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.center)
                    .frame(width: 70)
                    .onSubmit { syncAll() }
                Button { project.wrappedValue.bpm = min(220, project.wrappedValue.bpm + 0.5); syncAll() } label: { Image(systemName: "plus") }
                    .buttonStyle(.bordered)
            }
            HStack {
                Text("BPM ×2 / ÷2")
                Spacer()
                Button("÷2") { project.wrappedValue.bpm /= 2; syncAll() }.buttonStyle(.bordered)
                Button("×2") { project.wrappedValue.bpm *= 2; syncAll() }.buttonStyle(.bordered)
            }
            HStack {
                Text("Początek taktu 1")
                Spacer()
                Button { nudgeDownbeat(-0.01) } label: { Image(systemName: "chevron.left") }.buttonStyle(.bordered)
                Text(String(format: "%.2f s", project.wrappedValue.firstDownbeat))
                    .font(.body.monospacedDigit()).frame(width: 70)
                Button { nudgeDownbeat(0.01) } label: { Image(systemName: "chevron.right") }.buttonStyle(.bordered)
            }
            Button {
                nudgeDownbeat(project.wrappedValue.barDuration / Double(project.wrappedValue.beatsPerBar))
            } label: { Label("Przesuń „jedynkę” o 1 bit", systemImage: "arrow.right.to.line") }
            HStack {
                Text("Takty: \(project.wrappedValue.barCount) · Metrum \(project.wrappedValue.beatsPerBar)/4")
                Spacer()
                if analyzing { ProgressView() } else {
                    Button("Wykryj ponownie") { reanalyze() }
                }
            }
            .font(.subheadline)
        }
    }

    // MARK: siatka taktów

    private var barsSection: some View {
        let p = project.wrappedValue
        let playingBar = audio.isPlaying ? p.bar(at: audio.position) : nil
        return Section {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: 8), spacing: 4) {
                ForEach(1...max(1, p.barCount), id: \.self) { b in
                    let s = p.section(containing: b)
                    let selected = isSelected(b)
                    Text("\(b)")
                        .font(.caption2.monospacedDigit())
                        .frame(maxWidth: .infinity, minHeight: 34)
                        .background((s?.kind.color ?? .gray.opacity(0.25)).opacity(s == nil ? 1 : 0.35),
                                    in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6)
                            .stroke(selected ? Color.primary : (playingBar == b ? .green : .clear), lineWidth: 2))
                        .onTapGesture { tapBar(b) }
                }
            }
            .padding(.vertical, 4)

            if let a = selStart {
                let b = selEnd ?? a
                HStack {
                    Text("Zaznaczone: \(min(a, b))–\(max(a, b))").font(.subheadline)
                    Spacer()
                    Menu {
                        ForEach(SectionKind.allCases) { k in
                            Button(k.label) { markSection(k) }
                        }
                    } label: { Label("Oznacz jako", systemImage: "tag") }
                    Button { selStart = nil; selEnd = nil } label: { Image(systemName: "xmark.circle.fill") }
                        .foregroundStyle(.secondary)
                }
            }
        } header: {
            Text("Takty")
        } footer: {
            Text("Stuknij pierwszy i ostatni takt sekcji, potem „Oznacz jako”. Każdy takt to jeden wers w zakładce Tekst.")
        }
    }

    // MARK: sekcje

    private var sectionsSection: some View {
        Section("Sekcje") {
            if project.wrappedValue.sections.isEmpty {
                Text("Brak oznaczonych sekcji").foregroundStyle(.secondary)
            }
            ForEach(project.wrappedValue.sections) { s in
                HStack {
                    Circle().fill(s.kind.color).frame(width: 10, height: 10)
                    Text(s.title)
                    Spacer()
                    Text("takty \(s.startBar)–\(s.endBar) · \(s.barCount) wersów")
                        .font(.caption).foregroundStyle(.secondary)
                }
            }
            .onDelete { idx in project.wrappedValue.sections.remove(atOffsets: idx) }
        }
    }

    // MARK: ścieżki

    private var tracksSection: some View {
        Section {
            ForEach(project.tracks) { $track in
                TrackRow(track: $track, projectID: projectID)
            }
            .onDelete { idx in
                for i in idx { deleteFiles(of: project.wrappedValue.tracks[i]) }
                project.wrappedValue.tracks.remove(atOffsets: idx)
            }
            Button {
                let n = project.wrappedValue.tracks.count + 1
                project.wrappedValue.tracks.append(VocalTrack(name: "Ścieżka \(n)"))
            } label: { Label("Nowa ścieżka", systemImage: "plus") }
        } header: {
            Text("Nagrywanie")
        } footer: {
            Text(audio.routeDescription + (audio.micPermission ? "" : "\nBrak dostępu do mikrofonu – włącz w Ustawieniach."))
        }
    }

    private var latencySection: some View {
        Section("Latencja") {
            HStack {
                Text("Korekta nagrań")
                Spacer()
                Text("\(Int(store.latencyMs.rounded())) ms").monospacedDigit().foregroundStyle(.secondary)
            }
            Button { showLatency = true } label: { Label("Test latencji", systemImage: "metronome") }
        }
    }

    // MARK: logika

    private func isSelected(_ b: Int) -> Bool {
        guard let a = selStart else { return false }
        let e = selEnd ?? a
        return b >= min(a, e) && b <= max(a, e)
    }

    private func tapBar(_ b: Int) {
        if selStart == nil || selEnd != nil {
            selStart = b; selEnd = nil
        } else {
            selEnd = b
        }
    }

    private func markSection(_ kind: SectionKind) {
        guard let a = selStart else { return }
        let e = selEnd ?? a
        let lo = min(a, e), hi = max(a, e)
        var p = project.wrappedValue
        // przytnij / usuń nakładające się sekcje (tekst w nienaruszonych taktach zostaje)
        var result: [SongSection] = []
        for var s in p.sections {
            if s.endBar < lo || s.startBar > hi { result.append(s); continue }
            if s.startBar < lo {
                var left = s
                left.endBar = lo - 1
                left.lines = Array(s.lines.prefix(left.barCount))
                left.syncLines()
                result.append(left)
            }
            if s.endBar > hi {
                let drop = hi + 1 - s.startBar
                s.lines = Array(s.lines.dropFirst(drop))
                s.startBar = hi + 1
                s.id = UUID()
                s.syncLines()
                result.append(s)
            }
        }
        var new = SongSection(kind: kind, number: 1, startBar: lo, endBar: hi)
        p.sections = result
        new.number = p.nextNumber(for: kind)
        new.syncLines()
        p.sections.append(new)
        p.sortSections()
        renumber(&p)
        project.wrappedValue = p
        selStart = nil; selEnd = nil
    }

    /// Numeruje sekcje tego samego typu po kolei (Zwrotka 1, Zwrotka 2…).
    private func renumber(_ p: inout Project) {
        var counters: [SectionKind: Int] = [:]
        for i in p.sections.indices {
            let k = p.sections[i].kind
            counters[k, default: 0] += 1
            p.sections[i].number = counters[k]!
        }
    }

    private func nudgeDownbeat(_ d: Double) {
        let bar = project.wrappedValue.barDuration
        var v = project.wrappedValue.firstDownbeat + d
        if v >= bar { v -= bar }
        if v < 0 { v += bar }
        project.wrappedValue.firstDownbeat = v
        syncAll()
    }

    /// Po zmianie siatki przycina sekcje do liczby taktów.
    private func syncAll() {
        var p = project.wrappedValue
        let n = p.barCount
        p.sections = p.sections.compactMap { s in
            var s = s
            guard s.startBar <= n else { return nil }
            s.endBar = min(s.endBar, n)
            s.syncLines()
            return s
        }
        project.wrappedValue = p
    }

    private func importBeat(_ url: URL) {
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        audio.stop()
        var p = project.wrappedValue
        let name = "beat." + (url.pathExtension.isEmpty ? "m4a" : url.pathExtension)
        let dest = store.fileURL(name, in: p.id)
        do {
            if let old = p.beatFileName {
                try? FileManager.default.removeItem(at: store.fileURL(old, in: p.id))
            }
            try? FileManager.default.removeItem(at: dest)
            try FileManager.default.copyItem(at: url, to: dest)
        } catch {
            errorText = "Nie udało się skopiować pliku: \(error.localizedDescription)"
            return
        }
        p.beatFileName = name
        project.wrappedValue = p
        audio.reloadBeat()
        reanalyze()
    }

    private func reanalyze() {
        guard let name = project.wrappedValue.beatFileName else { return }
        let url = store.fileURL(name, in: projectID)
        analyzing = true
        Task.detached(priority: .userInitiated) {
            let r = try? BeatAnalyzer.analyze(url: url)
            await MainActor.run {
                analyzing = false
                guard let r else { errorText = "Nie udało się przeanalizować bitu."; return }
                var p = project.wrappedValue
                p.bpm = r.bpm
                p.firstDownbeat = r.firstBeat
                p.beatDuration = r.duration
                project.wrappedValue = p
                syncAll()
                if p.loopEndBar > p.barCount { project.wrappedValue.loopEndBar = min(4, p.barCount) }
            }
        }
    }

    private func deleteFiles(of track: VocalTrack) {
        for t in track.takes {
            try? FileManager.default.removeItem(at: store.fileURL(t.fileName, in: projectID))
        }
    }
}

struct TrackRow: View {
    @EnvironmentObject var store: ProjectStore
    @EnvironmentObject var audio: AudioEngine
    @Binding var track: VocalTrack
    let projectID: UUID

    var body: some View {
        let recordingThis = audio.isRecording && audio.recordingTrackID == track.id
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                TextField("Nazwa", text: $track.name).font(.headline)
                Button {
                    track.muted.toggle()
                } label: {
                    Image(systemName: track.muted ? "speaker.slash.fill" : "speaker.wave.2.fill")
                }
                .buttonStyle(.borderless)
                Button {
                    if recordingThis { audio.stop() } else { startRecording() }
                } label: {
                    Image(systemName: recordingThis ? "stop.circle.fill" : "record.circle")
                        .font(.title2)
                        .foregroundStyle(.red)
                }
                .buttonStyle(.borderless)
                .disabled(!audio.micPermission)
            }
            Slider(value: $track.volume, in: 0...1.5)
            if !track.takes.isEmpty {
                ForEach(track.takes) { t in
                    HStack {
                        let p = store.project(projectID)
                        Text("Nagranie od taktu \(p?.bar(at: t.startTime) ?? 1)")
                            .font(.caption)
                        Spacer()
                        Button(role: .destructive) {
                            try? FileManager.default.removeItem(at: store.fileURL(t.fileName, in: projectID))
                            track.takes.removeAll { $0.id == t.id }
                        } label: { Image(systemName: "trash") }
                        .buttonStyle(.borderless)
                    }
                }
            }
        }
        .padding(.vertical, 4)
    }

    private func startRecording() {
        let id = track.id
        audio.record(trackID: id) { url, start in
            guard var p = store.project(projectID),
                  let i = p.tracks.firstIndex(where: { $0.id == id }) else { return }
            p.tracks[i].takes.append(Take(fileName: url.lastPathComponent, startTime: start))
            store.update(p)
        }
    }
}
