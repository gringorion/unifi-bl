# Directives repo

## Scope
- Repository: `/config/workspace/unifi_bl`
- Application: console web de gestion de blocklists CIDR pour UniFi

## Deploiement
- Si une mise a jour serveur est attendue en fin de tache, synchroniser les changements
  vers la cible de deploiement configuree hors du repo avant de cloturer.
- Lors d'une synchronisation, exclure `.env`, `.env.*`, `.git` et `data/` pour ne pas
  ecraser les secrets ni les donnees runtime.

## Docker Hub
- image publique de reference: `gringorion/unifi-bl`
- ne jamais enregistrer ni committer le mot de passe Docker Hub dans le repo, dans
  `AGENTS.md`, dans `.env` ou dans les scripts

## Developpement local Docker
- utiliser `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
- l'override `docker-compose.dev.yml` force un build local a partir des sources

## Securite
- Ne jamais committer de secrets, de mots de passe, de seeds, de cles SSH ou de `.env`.
