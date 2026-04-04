# Tests

L'environnement courant ne dispose pas de runtime Node ou Docker pour
executer des tests ici.

## Verifications manuelles recommandees

1. `docker compose up --build`
2. Ouvrir `http://localhost:8080`
3. Cliquer sur `Tester UniFi`
4. Creer une blocklist avec quelques CIDR IPv4
5. Synchroniser cette blocklist vers UniFi
6. Verifier l'objet cree ou mis a jour dans l'interface UniFi
