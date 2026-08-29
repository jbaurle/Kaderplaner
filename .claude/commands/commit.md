---
description: Committet die aktuellen Änderungen aufgabenweise, ohne Push
---

Committe den aktuellen Stand des Kaderplaners, aber pushe nicht. Repo:
`E:\GitHub\Kaderplaner` (main, origin = jbaurle/Kaderplaner auf GitHub).

1. `git status` und `git diff` ansehen. Wirken die offenen Änderungen wie
   der erwartete, zusammenhängende Stand (kein fremder, unklarer Kram im
   Working Tree)? Wenn etwas unklar aussieht: kurz nachfragen statt blind
   zu committen.
2. Die Änderungen nach Aufgaben gruppieren und je Aufgabe einen eigenen
   Commit erstellen. Teilen sich zwei Aufgaben eine Datei, die Hunks
   trennen (Datei sichern, auf HEAD zurücksetzen, die Hunks der einen
   Aufgabe erneut anlegen, committen, volle Fassung zurückkopieren,
   committen). Kein `git add -A`/`git add .`.
3. Commit-Messages auf Deutsch mit Umlauten, Stil wie die bisherigen:
   `feat:`/`fix:` plus Kleinschreibung nach dem Präfix, ein kurzer Body
   zum "Warum", kein Co-Authored-By-Trailer. Die Message über eine
   UTF-8-Datei und `git commit -F` übergeben, damit Umlaute heil bleiben.
4. Vorher `npx tsc --noEmit` und `npx vitest run` laufen lassen; bei Rot
   stoppen und den Fehler melden statt zu committen.
5. Kurze Zusammenfassung: je Commit Hash und Betreff, was ggf.
   uncommittet liegen blieb.
