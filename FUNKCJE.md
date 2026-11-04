# Wersy – co już jest w aplikacji

Stan na 4.11.2026. Link: https://kaizenkuba.github.io/32_tony/
Aplikacja działa w Safari na iPhonie (PWA, „Dodaj do ekranu początkowego”) i na komputerze w przeglądarce.
Dane zapisują się lokalnie w przeglądarce danego urządzenia (bez synchronizacji między urządzeniami).

## Projekty
- Lista piosenek: dodaj nową, otwórz, zmień nazwę, usuń.
- Przy każdej piosence: BPM, liczba taktów i wersów.

## Bit
- Dodanie bitu z pliku (MP3, WAV, M4A i inne, które obsługuje przeglądarka). Zmiana bitu.
- Automatyczne wykrywanie BPM i początku taktu 1 („Wykryj ponownie”).
- Ręczna korekta BPM: −/+ 0,5, wpisanie liczby, −/+ 0,1, ÷2 i ×2.
- Tap tempo: wystukujesz tempo, od 4. stuknięcia ustawia BPM.
- Przesuwanie początku taktu 1 (co 0,01 s albo o cały bit).
- Oś czasu: przebieg bitu z liniami taktów i bitów, kolorowe sekcje, zielony wskaźnik odtwarzania, zoom −/+.
  - Tryb „Przewijaj”: przeciąganie przewija, stuknięcie zaznacza takt.
  - Tryb „Przesuń takty”: przeciągasz siatkę taktów, aż trafi w uderzenia.
- Siatka taktów: stuknij pierwszy i ostatni takt, potem wybierz sekcję (intro, zwrotka, przedrefren, refren, bridge, outro, inne) albo „Wyczyść”. Sekcje numerują się same (Zwrotka 1, 2…).
- Wycinanie taktów z bitu: zaznacz takty, „✂ Wytnij takty”. Sekcje, wersy i nagrania za cięciem przesuwają się razem z bitem. „↶ Cofnij ostatnie wycięcie” przywraca stan sprzed cięcia.
- Lista sekcji z zakresem taktów i liczbą wersów, usuwanie sekcji.

## Nagrywanie
- Wiele ścieżek wokalu: dodaj, zmień nazwę, wycisz, głośność, usuń.
- Nagrywanie (●) zaczyna się od wybranego miejsca (Long/Pętla) z bitem w tle.
- Lista nagrań na ścieżce („Nagranie od taktu X”), usuwanie nagrań.
- Wybór mikrofonu (domyślnie mikrofon iPhone'a), przycisk „Odśwież”.

## Latencja
- Test latencji: nagrywasz beatbox na werbel do bitu, przesuwasz suwakiem/przyciskami (−10, −1, +1, +10 ms) albo „Dopasuj automatycznie”, odsłuchujesz i zapisujesz.
- Każde nagranie jest odtwarzane przesunięte o zapisaną latencję.

## Tekst
- Każdy takt = jeden wers, pogrupowane według sekcji.
- Numeracja: numer taktu w piosence · numer wersu w sekcji.
- Kilka wersji każdego wersu: ＋ wersja, oczko (pokaż/ukryj), kosz (usuń).
- Zwijanie sekcji: stuknij nagłówek sekcji (np. puste intro), wersy znikają; stuknij znowu, żeby rozwinąć. Zapamiętuje się.
- „Śledź”: podczas odtwarzania aktualny wers jest podświetlony i przewija się na środek.

## Transport (pasek na dole)
- Start: odtwarza od razu.
- Long: gra od wybranego taktu do końca.
- Pętla: zapętla zakres taktów od–do.
- Stop.
- Wskaźnik bieżącego taktu (T12).

## Pomysły na później
- Synchronizacja projektów między telefonem i komputerem.
- Eksport tekstu i miksu (wokal + bit).
