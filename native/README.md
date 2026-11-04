# Wersy – aplikacja do pisania wersów do bitu (iOS)

Natywna aplikacja SwiftUI + AVAudioEngine (iOS 17+). Specyfikacja: [SPEC.md](SPEC.md).

## Co jest w wersji 0.1
- **Projekty** – lista piosenek, dodawanie, usuwanie (przesuń w lewo).
- **Bit** – import pliku audio, automatyczne BPM i „jedynka”, ręczna korekta (±0,5 BPM, ×2/÷2, przesunięcie początku taktu), siatka taktów, oznaczanie sekcji (intro, zwrotka, refren, przedrefren, bridge, outro), ścieżki nagrywania (nowa ścieżka, record, mute, głośność, usuwanie nagrań), test latencji.
- **Tekst** – każdy takt = jeden wers, numeracja `takt bezwzględny / numer wersu`, wiele wersji wersu z oczkiem (pokaż/ukryj), plusem i śmietnikiem, podświetlenie i przewijanie za odtwarzaniem.
- **Transport** (na dole w Bit i Tekst) – Start (jak pad, każde stuknięcie startuje od nowa), tryb Long (od taktu) / Pętla (od–do, takty bezwzględne), Stop.
- **Audio** – głos zawsze z mikrofonu iPhone'a, muzyka na słuchawki (przewodowe lub Bluetooth), bez słuchawek na głośnik. Każde nagranie jest przy odsłuchu przesuwane o zapisaną latencję.
- Nagrywanie w trybie Pętla gra raz od początku do końca pętli i samo się zatrzymuje; w trybie Long nagrywa od wybranego taktu do Stop.

## Budowanie (Mac)
1. `brew install xcodegen`
2. W folderze repo: `xcodegen generate`
3. Otwórz `Wersy.xcodeproj`, w *Signing & Capabilities* wybierz swój Team (darmowe Apple ID wystarczy do instalacji na własnym iPhonie).
4. Podłącz iPhone'a, wybierz go jako cel i uruchom (⌘R).

## Uwagi
- Słuchawki Bluetooth (np. AirPods) mają duże opóźnienie (~150–250 ms) – zrób test latencji osobno dla nich i dla przewodowych.
- Dane projektów są w Dokumentach aplikacji (`Projects/<id>/`), widoczne w aplikacji Pliki.
