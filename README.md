# Kaelys Convoc — Bot Discord de modération

Bot Discord (discord.js v14) dédié au système de **convocations professionnelles** : configurable par serveur, persistant MongoDB, délais, rappels, sanctions automatiques sécurisées, logs de modération centralisés.

## ✨ Fonctionnalités couvertes

- **Commandes slash** : `/convoc`, `/convoc-list`, `/convoc-config`, `/config` (sous-commandes `convocation-channel`, `logs-channel`, `roles/*`, `view`).
- **Types de convocations configurables** (config centralisée + surcharge par serveur) : `verification`, `convocation`, `moderation`, `entretien`, `autre` (facilement extensibles).
- **Ping strict** : seul le membre convoqué est mentionné (pas de `@everyone`/`@here`/rôle mod).
- **Gestion des erreurs propre** : salon non configuré, introuvable, permissions insuffisantes, membre introuvable, etc.
- **Persistance MongoDB** : configuration par serveur (`GuildConfig`), convocations en cours (`Convocation`), logs de modération (`ModLog`). Survient aux redémarrages / PM2.
- **Délais et rappels configurables** par type de convocation (CronJob toutes les 30s).
- **Sanctions sécurisées** : vérifications anti-ban-aveugle (membre présent, exempt, hiérarchie des rôles, permissions bot). Types : `ban`, `kick`, `mute`/`timeout`, `warn`, `none`.
- **Détection des actions requises** :
  - ouverture de ticket (via `TicketIntegration.notifyTicketCreated`),
  - contact staff (réponse mentionnée par un modérateur),
  - réponse dans le salon des convocations,
  - entrée dans un vocal (`voiceStateUpdate`).
- **Intégration modulaire** : services séparés (`ConvocationService`, `ConvocationScheduler`, `ModLogService`, `GuildConfigService`, `PermissionService`, `TicketIntegration`).

## 📁 Architecture

```
.
├── index.js                      # Point d'entrée (client Discord)
├── deploy-commands.js            # Déploiement REST des commandes slash
├── package.json
├── .env.example
└── src/
    ├── config/index.js           # Variables + config statique centralisée
    ├── models/
    │   ├── GuildConfig.js        # Config serveur MongoDB (channels, roles, reasons)
    │   ├── Convocation.js        # Suivi convocations pending/completed/expired/sanctioned
    │   └── ModLog.js             # Logs de modération
    ├── handlers/
    │   ├── CommandHandler.js     # Chargement + dispatch commandes/autocomplete
    │   └── EventHandler.js       # Chargement des événements Discord
    ├── services/
    │   ├── DatabaseService.js
    │   ├── GuildConfigService.js (avec cache mémoire)
    │   ├── PermissionService.js
    │   ├── ModLogService.js      # DB + envoi embed dans salon logs
    │   ├── TicketIntegration.js  # Abstraction hook tickets / actions
    │   ├── ConvocationService.js # Validation, embed, envoi, persist
    │   └── ConvocationScheduler.js # Rappels + expiration + sanctions
    ├── events/
    │   ├── ready.js
    │   ├── guildCreate.js
    │   ├── interactionCreate.js
    │   ├── voiceStateUpdate.js
    │   └── messageCreate.js
    └── commands/
        ├── admin/config.js
        └── moderation/
            ├── convoc.js
            ├── convoc-list.js
            └── convoc-config.js
```

## 🚀 Démarrage rapide

### 1. Installer les dépendances

```bash
npm install
```

### 2. Configurer les variables d’environnement

Copier `.env.example` vers `.env` puis compléter :

```env
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_TEST_GUILD_ID=...   # Optionnel (déploiement dev local)
MONGO_URI=mongodb://127.0.0.1:27017/kaelys_convoc
LOCALE=fr-FR
TIMEZONE=Europe/Paris
```

### 3. Déployer les commandes slash

- **Global (production, propagation ~1h)** :
  ```bash
  npm run deploy
  ```
- **Guilde de dev (immédiate)** :
  ```bash
  npm run deploy:dev
  ```

### 4. Lancer le bot

```bash
npm start
```

## 🧪 Procédure de tests manuels demandée

1. **Test 1 — /convoc standard** : configurer un salon via `/config convocation-channel #convocs` puis `/convoc membre:@User raison:verification`. Vérifier embed + ping `<@id>` + confirmation éphémère.
2. **Test 2 — Permission refusée** : utilisateur non-modérateur exécute `/convoc` → `❌ Permission refusée.`
3. **Test 3 — Salon non configuré** : reset la config (ou serveur neuf) → `❌ Le salon des convocations n'est pas configuré.`
4. **Test 4 — Permissions bot insuffisantes** : retirer `Envoyer des messages`/`Intégrer des liens`/`Mentionner @everyone...` au bot dans le salon → `❌ Permissions insuffisantes...`
5. **Test 5 — Raison `autre`** : `/convoc @User raison:autre details:"test custom"` → champ `details` obligatoire pris en compte dans l’embed.
6. **Test 6 — Redémarrage** : config → redémarrer bot → `/config view` retrouve le salon + `/convoc-list` retrouve les raisons.
7. **Test 7 — Parallélisme** : deux admins lancent `/convoc` en même temps → deux convocations en base, deux messages, aucune erreur.

## 🔧 Personnalisation / Extensibilité

- **Ajouter un type de convocation** : ajouter une clé dans `src/config/index.js → DEFAULT_CONVOC_REASONS`, puis pour surcharger par serveur, utiliser `/convoc-config type:... label:... message:... delai_heures:... sanction:...`.
- **Brancher un système de tickets existant** : appeler `TicketIntegration.notifyTicketCreated({ guildId, openerId, id })` depuis ton code de création de ticket → convocations `open_ticket` passent automatiquement en `completed`.
- **Sanctions / actions custom** : ajouter un type dans `ALLOWED_SANCTION_TYPES` et le cas dans `ConvocationScheduler._applySanction`.

## ⚠️ Sécurité & garde-fous

- Toutes les vérifications avant envoi (membre, salon, perms, exempts, auto-convocation, bot).
- Sanctions : vérifications hiérarchie de rôles, permissions, exempts, membre toujours présent → `convocation.sanction_failed` logué au lieu de planter.
- `allowedMentions: { users: [targetMember.id], roles: [], parse: [] }` sur tous les envois pour éviter tout ping accidentel.

## 📝 Production / PM2

```bash
pm2 start index.js --name kaelys-convoc
pm2 save
```
