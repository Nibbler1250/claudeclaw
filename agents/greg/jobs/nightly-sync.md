---
schedule: "0 23 * * *"
recurring: true
---
Sync de fin de journee (silencieux — pas de message a Simon sauf urgence).

1. Execute : bash /home/simon/agent/scripts/sync-and-clear.sh
2. Lis ~/agent/learnings/learnings.md et ~/agent/memory/ pour t assurer que tout ce qui est important de la journee est bien sauvegarde. Si tu vois des taches en cours non completees, note-les dans ~/agent/learnings/daily-summaries/ avec la date du jour.
3. NE PAS envoyer de message Telegram a Simon (regle : zero message proactif).
4. Lance la commande /clear pour demarrer une session propre.
