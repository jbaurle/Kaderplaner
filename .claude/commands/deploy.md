---
description: Committet die aktuellen Änderungen, pusht nach GitHub und deployt nach kaderplaner.de
---

Bringe den aktuellen Stand des Kaderplaners live. Repo:
`E:\GitHub\kaderplaner` (main, origin = jbaurle/Kaderplaner auf GitHub).
Deploy-Ziel: Cloudflare Worker `kickbase-kaderplaner`, Custom Domain
`kaderplaner.de` (Static Assets aus `dist/`, SPA-Fallback).

1. `git status` und `git diff` ansehen. Wirken die offenen Änderungen wie
   der erwartete, zusammenhängende Stand (kein fremder, unklarer Kram im
   Working Tree)? Wenn ja, weiter. Wenn etwas unklar oder unzusammenhängend
   aussieht: kurz nachfragen statt blind zu committen.
2. Passende Dateien gezielt stagen (kein `git add -A`/`git add .`), Commit
   mit kurzer Message zum "Warum" der Änderung erstellen.
3. `git push` (kein Force-Push).
4. `npm run deploy` ausführen (= `tsc --noEmit && vite build && wrangler
   deploy`). Bricht der Build/Typecheck, hier stoppen und den Fehler
   melden statt den alten Stand erneut zu deployen.
5. Kurze Zusammenfassung: Commit-Hash/-Message, Push OK, Deploy OK
   (oder wo es hakt).
