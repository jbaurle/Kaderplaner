---
description: Pusht die lokalen Commits nach GitHub, ohne Deploy
---

Pushe die lokalen Commits des Kaderplaners nach GitHub. Repo:
`E:\GitHub\Kaderplaner` (main, origin = jbaurle/Kaderplaner auf GitHub).

1. `git status` prüfen: liegen uncommittete Änderungen herum, kurz sagen,
   dass sie nicht mitkommen (nicht selbständig committen).
2. `git log origin/main..HEAD --oneline` zeigen, damit klar ist, was
   gepusht wird. Ist nichts zu pushen, genau das melden und aufhören.
3. `git push` (kein Force-Push).
4. Kurze Zusammenfassung: gepushte Commits (Bereich alt..neu), Push OK
   oder woran es hakt. Kein Deploy, dafür gibt es /deploy.
