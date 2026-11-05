# Wersy – co już jest w aplikacji

Stan na 4.11.2026. Link: https://kaizenkuba.github.io/32_tony/
Aplikacja działa w Safari na iPhonie (PWA, „Dodaj do ekranu początkowego”) i na komputerze w przeglądarce.
Dane zapisują się lokalnie na urządzeniu, a po zalogowaniu także w chmurze (Supabase).

## Projekty
- Lista piosenek: dodaj nową, otwórz, zmień nazwę, usuń.
- Synchronizacja: logowanie e-mailem i hasłem (Zaloguj / Załóż konto). Projekty, bity i nagrania są takie same na telefonie i komputerze. Zmiany wysyłają się same po chwili, a apka sprawdza nowości co 20 s i po powrocie do niej. Przycisk „Zapisz / odśwież” robi to od razu.
- Przy każdej piosence: BPM, liczba taktów i wersów.

## Bit
- Panel „Bit” (BPM, tempo, początek taktu) zwija się po stuknięciu nagłówka; zwinięty pokazuje tylko nazwę pliku, BPM i liczbę taktów.
- Dodanie bitu z pliku (MP3, WAV, M4A i inne, które obsługuje przeglądarka). Zmiana bitu.
- Automatyczne wykrywanie BPM i początku taktu 1 („Wykryj ponownie”).
- Ręczna korekta BPM: −/+ 0,5, wpisanie liczby, −/+ 0,1, ÷2 i ×2.
- Tap tempo: wystukujesz tempo, od 4. stuknięcia ustawia BPM.
- Przesuwanie początku taktu 1 (co 0,01 s albo o cały bit).
- Oś czasu: przebieg bitu z liniami taktów i bitów, kolorowe sekcje, zielony wskaźnik odtwarzania, zoom −/+.
  - Małe przyciski ▶ (graj od playheada), ❚❚ (pauza: zatrzymuje i zostawia playhead w tym miejscu), ■ (stop).
  - Obok kłódki licznik czasu piosenki: pozycja playheada (w trakcie grania aktualna pozycja) / długość bitu, np. 1:23.4 / 3:12.0.
  - Na komputerze: kółko myszy przewija oś, Ctrl + kółko (albo szczypanie na touchpadzie) przybliża i oddala.
  - Tryb „Odtwarzaj”: stuknięcie ustawia playhead (czerwony znacznik, skacze co bit), można go też złapać i przeciągnąć. Start w trybie Long gra od playheada; w trakcie grania stuknięcie przeskakuje odtwarzanie w to miejsce. Przeciąganie poza playheadem przewija.
  - Tryb „Przesuń sekcję”: łapiesz sekcję i przeciągasz ją w inne miejsce, skacze co takt i zabiera ze sobą swój tekst. Jeśli nachodzi na inną sekcję, apka pyta o zgodę.
  - Tryb „Przesuń takty”: przeciągasz siatkę taktów, aż trafi w uderzenia. Zablokowany kłódką (🔒), żeby nie przestawić go niechcący; kliknij kłódkę, żeby odblokować.
- Siatka taktów: stuknij pierwszy i ostatni takt, potem wybierz sekcję (intro, zwrotka, przedrefren, refren, bridge, outro, inne) albo „Wyczyść”. Sekcje numerują się same (Zwrotka 1, 2…).
- Wycinanie taktów z bitu: zaznacz takty, „✂ Wytnij takty”. Sekcje, wersy i nagrania za cięciem przesuwają się razem z bitem. „↶ Cofnij ostatnie wycięcie” przywraca stan sprzed cięcia.
- Lista sekcji z zakresem taktów i liczbą wersów, usuwanie sekcji.

## Nagrywanie (osobna zakładka)
- Widok jak w aplikacjach do nagrywania: u góry linijka z taktami i sekcjami, pod nią bit (przebieg z kolorami sekcji), niżej ścieżki wokalu z nagraniami jako kolorowe klocki z przebiegiem.
- Lewa kolumna: nazwy ścieżek. Stuknięcie wybiera ścieżkę do nagrywania (czerwona kropka). „M” wycisza, „⋯” otwiera menu ścieżki (nazwa, głośność, usuń ścieżkę). „＋ Ścieżka” dodaje nową.
- Oś: stuknięcie ustawia playhead (co bit), przeciąganie przewija, dwa palce zoomują (na komputerze Ctrl + kółko). W rogu czas piosenki.
- Nagranie: stuknij, żeby zaznaczyć (biała ramka), ciągnij za lewy lub prawy brzeg, żeby przyciąć. Kosz na dole usuwa zaznaczone nagranie.
- Dolny pasek: Long/Pętla i takt startu, ⏮ (na początek), ▶/❚❚, duży czerwony przycisk nagrywania, ■ stop, kosz. W trakcie nagrywania na ścieżce rośnie czerwony klocek.
- Mikrofon: wybór wejścia (domyślnie mikrofon iPhone'a), „Odśwież”.

## Latencja (w zakładce Nagrywanie)
- Test latencji: nagrywasz beatbox na werbel do bitu, przesuwasz suwakiem/przyciskami (−10, −1, +1, +10 ms) albo „Dopasuj automatycznie”, odsłuchujesz i zapisujesz.
- Każde nagranie jest odtwarzane przesunięte o zapisaną latencję.

## Tekst
- Każdy takt = jeden wers, pogrupowane według sekcji.
- Numeracja: numer taktu w piosence · numer wersu w sekcji.
- Kilka wersji każdego wersu: ＋ wersja, oczko (pokaż/ukryj), kosz (usuń).
- Zwijanie sekcji: stuknij nagłówek sekcji (np. puste intro), wersy znikają; stuknij znowu, żeby rozwinąć. Zapamiętuje się.
- „Śledź”: podczas odtwarzania aktualny wers jest podświetlony i przewija się na środek.

## Notatnik
- Czwarta zakładka: wolna kartka do pisania, osobna dla każdej piosenki. Zapisuje się sama i synchronizuje z kontem. Bit można puszczać z dolnego paska.

## Transport (pasek na dole)
- Start: odtwarza od razu.
- Long: gra od playheada (albo wybranego taktu) do końca.
- Pętla: zapętla zakres taktów od–do.
- Stop.
- Wskaźnik bieżącego taktu (T12).

## Pomysły na później
- Eksport tekstu i miksu (wokal + bit).
