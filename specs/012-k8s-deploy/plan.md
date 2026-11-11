# Implementation Plan: 012 Kubernetes Deploy

## 0. Files

```text
deploy/README.md                         # the runbook, from account to first deploy
deploy/chart/Chart.yaml                  # digital-memory chart, appVersion = image tag
deploy/chart/values.yaml                 # image tag (written by CI), host, resources
deploy/chart/templates/deployment.yaml   # one replica, probes on /healthz and /readyz
deploy/chart/templates/service.yaml
deploy/chart/templates/ingress.yaml      # Traefik, cert-manager annotation, /mcp timeouts
deploy/chart/templates/configmap.yaml    # non-secret env: PORT, PUBLIC_URL, LOG_LEVEL, ...
deploy/chart/templates/sealed-secret.yaml
deploy/chart/templates/migrate-job.yaml  # pre-upgrade hook: node dist/core/db/migrate-cli.js
deploy/chart/templates/postgres.yaml     # CloudNativePG Cluster, ObjectStore, ScheduledBackup
deploy/chart/templates/middleware.yaml   # Traefik: no compress on /mcp
deploy/argocd/root.yaml                  # the app-of-apps Application
deploy/argocd/apps/cert-manager.yaml
deploy/argocd/apps/traefik.yaml
deploy/argocd/apps/cloudnative-pg.yaml   # operator and the Barman Cloud Plugin
deploy/argocd/apps/sealed-secrets.yaml
deploy/argocd/apps/digital-memory.yaml   # this repo, path deploy/chart
deploy/cluster-issuer.yaml               # Let's Encrypt production issuer
.github/workflows/image.yml              # commit the new tag into values.yaml
.github/workflows/ci.yml                 # helm lint, helm template
```

## 1. Provider and Sizing

Scaleway Kapsule in `fr-par` (or `nl-ams`), one pool with one node of the smallest type the
console allows for Kapsule (DEV1-S, 2 vCPU and 2 GB, or DEV1-M with 3 GB when 2 GB is
refused), one Scaleway load balancer, one 10 GB block volume for Postgres. Expected cost:
node about €7, load balancer about €10, volume under €1, a month, before the trial credit.

Memory budget on the node: Traefik 100 MiB, cert-manager 100 MiB, Sealed Secrets 50 MiB,
CloudNativePG operator 100 MiB, Postgres 512 MiB, the service 300 MiB request and 600 MiB
limit, Argo CD core about 200 MiB. 2 GB leaves under 400 MiB free; 3 GB leaves about 1.3
GiB.

Fallback order when Scaleway refuses the size or the credit: OVHcloud Managed Kubernetes
(D2-4, 4 GB; note its 50 second load balancer idle timeout), then Civo (Medium, 4 GB).

## 2. Bootstrap Order

1. Create the cluster and download the kubeconfig. Create the load balancer through the
   Traefik Service of type `LoadBalancer` later, not by hand.
2. Install Argo CD with `core-install.yaml` into `argocd`. Log in with the CLI in core mode.
3. Install Sealed Secrets through its Helm chart, fetch the cluster public key with
   `kubeseal --fetch-cert`, and commit it under `deploy/` so secrets can be sealed offline.
4. Apply `deploy/argocd/root.yaml` once with `kubectl`. From here on git drives everything.
5. The root application syncs cert-manager, Traefik, the CloudNativePG operator and plugin,
   Sealed Secrets (now managed too), then the service. Sync waves order them.
6. Point the DNS `A` record at the load balancer address; apply the ClusterIssuer; the
   Ingress gets its certificate.
7. Set the Telegram webhook by starting the service with `PUBLIC_URL` (spec 001 webhook mode
   does the rest), and register the OIDC Allowed URLs in BotFather (spec 011).

## 3. The Chart

`values.yaml` holds `image.repository`, `image.tag` (the commit SHA, written by CI),
`host`, `resources`, and the non-secret environment. The Deployment runs one replica with
`strategy: Recreate` (one node, one Postgres connection pool, and the migration hook runs
first), `readinessProbe` on `/readyz` and `livenessProbe` on `/healthz`, `imagePullSecrets`
`[ghcr]`, and `terminationGracePeriodSeconds: 35` so an in-flight MCP stream can end. The
Ingress has the cert-manager `cluster-issuer` annotation and routes `/` to the Service; a
Traefik `Middleware` disables compression on `/mcp`. The load balancer's idle timeout is
set to its maximum through the Service annotations.

The migrate Job is a Helm `pre-upgrade,pre-install` hook with `hook-delete-policy:
before-hook-creation,hook-succeeded`, the same image, command `node
dist/core/db/migrate-cli.js`, and the same secret. A failed Job fails the sync and the old
pods keep running.

## 4. Postgres

A CloudNativePG `Cluster` with one instance, `storage.size: 10Gi`, `resources` with requests
equal to limits (512 MiB, 250m), `postgresql.parameters.shared_buffers: 128MB`. An
`ObjectStore` for the Barman Cloud Plugin points at
`https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` with the bucket, a `backups/postgres`
prefix, and the R2 keys from a sealed secret; the plugin's content-hash workaround for R2 is
applied. A `ScheduledBackup` runs daily at 03:00 UTC; WAL archiving is continuous. The
service reads `DATABASE_URL` from the `<cluster>-app` secret through an env mapping.

Restore drill: create a second `Cluster` with `bootstrap.recovery` from the same object
store on a fresh namespace, run `/readyz` against it, and search for a known memory. The
drill is a task, and the runbook records the commands.

## 5. Secrets

| Sealed secret | Keys                                                                                                                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app-env`     | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OIDC_CLIENT_SECRET`, `QDRANT_API_KEY`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `LLM_FAST_API_KEY`, `LLM_STRONG_API_KEY`, `LANGFUSE_*` |
| `r2-backup`   | the R2 key pair for the object store                                                                                                                                                                 |
| `ghcr`        | docker-registry secret with a read-only package token                                                                                                                                                |

`kubeseal` seals with the committed public key; the plain files never enter git and live in
the maintainer's password manager.

## 6. Promotion and Rollback

`image.yml` already builds and pushes `ghcr.io/<owner>/digital-memory:<sha>`. It gains a
last step that checks out `master`, writes the SHA into `deploy/chart/values.yaml`, commits
`chore(ci): deploy <sha>` and pushes, with a token that may push past branch protection.
`image.yml` ignores `deploy/chart/values.yaml` in `paths-ignore`, so the commit builds no
second image; `ci.yml` still runs, and its chart job lints the values it will deploy. Argo CD
sees the commit, runs the migrate hook, and rolls the Deployment.

Rollback is `git revert` of the deploy commit. Argo CD with self-heal also undoes any manual
change on the cluster within minutes, so the cluster never drifts from git.

## 7. Network

`PUBLIC_URL` is `https://<host>`. Setting it turns on webhook mode and the MCP and OAuth
routes together; the env refine then requires the webhook secret and the OIDC secret.
Traefik's `writeTimeout` is 0 and `idleTimeout` 180 s by default, and the service's heartbeat
every 15 seconds keeps the Scaleway load balancer (300 s idle timeout by default, raised to
its maximum) from cutting a stream.

## Tests

CI: `helm lint deploy/chart` and `helm template` with the committed values, in the `verify`
job. Unit: none, there is no application code.

Smoke checklist after a deploy, recorded in the runbook: `curl https://<host>/healthz` and
`/readyz` answer 200; `/.well-known/oauth-protected-resource` answers; `getWebhookInfo` shows
the URL and no pending error; a `curl -N` against `/mcp` with a valid token streams for 5
minutes without a cut; the day's backup appears under the R2 prefix.

The restore drill in section 4 runs once before the spec is closed.

## Dependencies

`kubectl`, `helm`, `argocd` CLI, `kubeseal`, `scw` CLI. The cluster, the load balancer and a
DNS name the maintainer controls. The GHCR image from spec 008 and a package token. The
OIDC Allowed URLs and the webhook secret from spec 011 and spec 008.

## Open

Mirrors ADR 010 Open: the Gateway API, a second node, Qdrant on the cluster, image signing,
a monitoring stack, the Argo CD UI. Also: the deploy commit token (a fine-grained PAT or a
GitHub App) and whether branch protection should admit it.
