# Hypotheses UniFi pour la V1

## Sources officielles utilisees

- `Site Manager API` officielle Ubiquiti:
  - API key dans le header `X-API-Key`
  - API actuellement orientee lecture
  - endpoint d'exemple: `GET https://api.ui.com/v1/hosts`
- `UniFi Network API` officielle Ubiquiti:
  - API key dans le header `X-API-Key`
  - endpoints documentes pour les sites, devices, clients et statistiques
  - exemple documente: `GET /v1/sites/:siteId/devices`

## Hypotheses de mise en oeuvre

- L'UCG Fiber expose une base locale de type:
  - `https://<controleur>/proxy/network/integration/v1`
- Le `UNIFI_SITE_ID` est connu ou recuperable depuis la liste des sites.
- Sur le controleur valide pour ce projet, les groupes d'adresses IPv4
  sont exposes via le schema legacy:
  - `GET /api/s/{siteRef}/rest/firewallgroup`
  - `POST /api/s/{siteRef}/rest/firewallgroup`
  - `PUT /api/s/{siteRef}/rest/firewallgroup/{id}`
  - `DELETE /api/s/{siteRef}/rest/firewallgroup/{id}`

## Pourquoi l'adaptateur blocklists est configurable

La doc publique officielle retrouvee pour UniFi en mars 2026 permet de
construire proprement toute la partie lecture, mais ne donne pas le meme
niveau de clarte publique pour le CRUD des objets CIDR/firewall.

Plutot que de figer un endpoint opaque dans le code, la V1:

- expose des chemins parametrables dans `.env`
- supporte des variables de template comme `{siteId}`, `{siteRef}` et `{networkRootUrl}`
- mappe les champs JSON a partir de variables d'environnement
- garde la logique de synchro stable, meme si le chemin exact varie

## Comportement de synchro

- Une blocklist locale = un objet distant UniFi
- Le rapprochement se fait d'abord par `remoteObjectId`, sinon par nom
- La V1 ajoute un tag de gestion (`managed-by-unifi-bl`) si le champ
  `tags` est disponible
- Le profil legacy `firewallgroup` utilise `_id` comme identifiant et
  `group_members` pour la liste CIDR
- Les CIDR saisis comme IP seule sont normalises en `/32`
- Les CIDR avec bits d'hote non nuls sont rabattes sur leur adresse reseau
  avant synchro, par exemple `1.2.3.4/24` devient `1.2.3.0/24`

## Limites connues

- IPv4 CIDR uniquement dans cette premiere version
- Les reponses API UniFi peuvent varier selon les versions
- Certaines installations peuvent necessiter `ALLOW_INSECURE_TLS=true`
  si le certificat local du controleur est auto-signe
