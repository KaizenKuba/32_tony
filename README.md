# Wersy – pisanie wersów do bitu (PWA)

Aplikacja w przeglądarce, działa na iPhonie bez App Store i bez Maca. Specyfikacja: [SPEC.md](SPEC.md).

## Instalacja na iPhonie
1. Otwórz link do aplikacji w **Safari**.
2. Udostępnij → **Do ekranu początkowego**.
3. Uruchamiaj z ikony „Wersy” – działa na pełnym ekranie i offline.

Dane (projekty, bity, nagrania) są zapisywane lokalnie na telefonie (IndexedDB).

## Funkcje
- **Projekty** – lista piosenek, nowa, zmiana nazwy, usuwanie.
- **Bit** – dodanie pliku, automatyczne BPM i „jedynka”, korekta (±0,5, ×2/÷2, przesuwanie początku taktu), siatka taktów, oznaczanie sekcji (intro, zwrotka, przedrefren, refren, bridge, outro), ścieżki nagrywania, wybór mikrofonu, test latencji.
- **Tekst** – takt = wers, numeracja „takt bezwzględny / numer wersu”, wiele wersji z oczkiem, plusem i śmietnikiem, podświetlanie i śledzenie odtwarzania.
- **Transport** – Start (jak pad), Long (od taktu) / Pętla (od–do), Stop.
- **Latencja** – nagrywasz beatbox na werbel do 4 taktów bitu, przesuwasz nagranie (ręcznie albo „Dopasuj automatycznie”), zapisujesz. Każde nagranie jest przy odsłuchu przesuwane o tę wartość.

## Ograniczenia przeglądarki na iOS
- iPhone sam wybiera mikrofon. Z AirPods lub słuchawkami z mikrofonem może nagrywać mikrofonem słuchawek – spróbuj wybrać „iPhone Mikrofon” w sekcji Nagrywanie.
- Nagrania zapisywane są jako WAV (mono, bez redukcji szumów i echa).

## Pliki
`index.html`, `styles.css`, `js/` (app, audio, analyze, db), `sw.js` (offline), `manifest.webmanifest`, `icons/`.
Wersja natywna (Swift, wymaga Maca) jest odłożona w `native/`.
