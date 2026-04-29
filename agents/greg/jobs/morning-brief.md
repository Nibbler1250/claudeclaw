---
schedule: "15 5 * * *"
recurring: true
---
Lance le brief matinal : python3 /home/simon/agent/scripts/morning-brief.py

Le script verifie automatiquement si c est une semaine de travail (ON) ou de conge (OFF).
- Semaine ON : envoie le brief a Simon via Telegram
- Semaine OFF : ne fait rien (Simon initiera lui-meme la conversation)
