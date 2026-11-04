import Foundation
import SwiftUI

/// Przechowuje projekty jako JSON w Dokumentach, pliki audio w folderze projektu.
@MainActor
final class ProjectStore: ObservableObject {
    @Published private(set) var projects: [Project] = []
    @Published var currentID: UUID?
    /// Globalna latencja nagrywania (ms) – z testu latencji.
    @Published var latencyMs: Double {
        didSet { UserDefaults.standard.set(latencyMs, forKey: "latencyMs") }
    }

    private let root: URL

    init() {
        latencyMs = UserDefaults.standard.double(forKey: "latencyMs")
        root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Projects", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        load()
    }

    func folder(for id: UUID) -> URL {
        let url = root.appendingPathComponent(id.uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func fileURL(_ name: String, in id: UUID) -> URL {
        folder(for: id).appendingPathComponent(name)
    }

    func project(_ id: UUID) -> Project? { projects.first { $0.id == id } }

    func binding(_ id: UUID) -> Binding<Project> {
        Binding(
            get: { self.project(id) ?? Project(name: "") },
            set: { self.update($0) }
        )
    }

    @discardableResult
    func create(name: String) -> Project {
        let p = Project(name: name.isEmpty ? "Nowa piosenka" : name)
        projects.insert(p, at: 0)
        save(p)
        return p
    }

    func update(_ p: Project) {
        guard let i = projects.firstIndex(where: { $0.id == p.id }) else { return }
        projects[i] = p
        save(p)
    }

    func delete(_ id: UUID) {
        projects.removeAll { $0.id == id }
        try? FileManager.default.removeItem(at: root.appendingPathComponent(id.uuidString))
        if currentID == id { currentID = nil }
    }

    private func save(_ p: Project) {
        do {
            let data = try JSONEncoder().encode(p)
            try data.write(to: folder(for: p.id).appendingPathComponent("project.json"), options: .atomic)
        } catch {
            print("Błąd zapisu projektu:", error)
        }
    }

    private func load() {
        let dirs = (try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? []
        projects = dirs.compactMap { dir in
            guard let data = try? Data(contentsOf: dir.appendingPathComponent("project.json")) else { return nil }
            return try? JSONDecoder().decode(Project.self, from: data)
        }
        .sorted { $0.created > $1.created }
    }
}
