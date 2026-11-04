# Aplikacja do pisania wersów – specyfikacja (v0.1)

Aplikacja na iPhone'a do pisania tekstu do bitu, takt po takcie, z nagrywaniem wokalu.

## 1. Struktura aplikacji – trzy zakładki

1. **Projekty** – wybór piosenki (projektu): otwórz istniejący albo dodaj nowy.
2. **Bit / aranżacja + nagrywanie** – dodanie bitu, podział na takty, oznaczanie sekcji, ścieżki wokalu.
3. **Tekst** – wersy generowane na podstawie taktów.

## 2. Zakładka „Projekty”

- Lista projektów (piosenek).
- Otwarcie gotowego projektu.
- Przycisk „Dodaj nowy”.

## 3. Zakładka „Bit” (aranżacja)

### 3.1 Dodanie bitu
- Po wejściu w projekt najpierw dodajemy bit (plik audio).
- Aplikacja **sama wykrywa BPM** i **dzieli bit na takty**.

### 3.2 Oznaczanie sekcji
- Użytkownik zaznacza zakresy taktów i przypisuje im sekcje: intro, zwrotka 1, refren, bridge, zwrotka 2 itd.
- Na bazie tych oznaczeń powstaje zakładka „Tekst”.

### 3.3 Nagrywanie (ścieżki wokalu)
- Wiele ścieżek nagrywania: ścieżka 1, 2, 3… („Nowa ścieżka”), jak w typowym edytorze do nagrywania wokalu.
- Przycisk **Record** – klikam i nagrywam.
- **Głos zawsze nagrywany mikrofonem iPhone'a** (również gdy podłączone są słuchawki).
- **Gdy podłączone są słuchawki, muzyka leci na słuchawkach.**

### 3.4 Test latencji
- Muzyka gra na słuchawkach, użytkownik robi beatbox na werbel.
- Następnie ręcznie dopasowuje (przesuwa) nagrany beatbox do werbla w bicie, o ileś milisekund.
- To przesunięcie zostaje zapisane jako **latencja**.
- **Każdy kolejny nagrany wokal jest automatycznie przesuwany o tę latencję**, żeby przy odsłuchu od razu siedział w bicie.

## 4. Zakładka „Tekst”

### 4.1 Wersy
- **Każdy takt = jeden wers.** Zwrotka z 16 taktami = 16 wersów.
- Wersy widoczne z góry na dół, pogrupowane według sekcji.

### 4.2 Numeracja
Przy każdym wersie dwie liczby:
- **Numer bezwzględny taktu** w piosence (np. zwrotka zaczyna się w takcie 8 → 8, 9, 10…).
- **Numer wersu w sekcji** (1, 2, 3…).
- Przykład: zwrotka od taktu 8 → `8 · 1`, `9 · 2`, `10 · 3`…

### 4.3 Wersje wersu
- Do każdego wersu można dodać kilka wersji.
- Każda wersja może być widoczna lub ukryta – ikonka **oczka / zamkniętego oczka**.
- **Plusik** – dodaj wersję.
- **Śmietniczek** – usuń wersję.

### 4.4 Transport (pasek na dole)
1. **Start** – działa jak pad: klikam i bit leci.
2. **Tryb odtwarzania** – przełącznik:
   - **Long** (gra ciągle) – ustawiasz, od którego taktu startuje,
   - **Pętla** – ustawiasz zakres od–do (w bezwzględnych taktach piosenki).
3. **Stop**.

Cel: wypełnić tekstem całą piosenkę.

## 5. Otwarte pytania (do doprecyzowania później)
- Czy transport (start / tryb / stop) ma być także w zakładce „Bit”?
- Czy przy pisaniu tekstu można odsłuchiwać nagrane wokale razem z bitem?
- Metrum – zakładamy 4/4; czy potrzebna ręczna korekta BPM / początku pierwszego taktu (downbeatu), gdy auto-detekcja się pomyli?
- Eksport: tekst (np. do notatek/PDF), miks wokal+bit (plik audio)?
- Czy przy wielu wersjach wersu jedna jest „główna”?
