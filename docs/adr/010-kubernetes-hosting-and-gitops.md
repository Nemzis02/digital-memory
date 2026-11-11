# ADR 010: Kubernetes Hosting and GitOps

## Context

Spec `008-deploy` produced a container image on GHCR, health routes and integration CI, and
deferred the choice of a host to "a separate ADR when Phase 2 needs a public URL". Phase 2
needs one now: the Telegram webhook, the OpenID Connect redirect, the OAuth issuer and the
MCP endpoint share one HTTPS origin, `PUBLIC_URL` (ADR 002 decision 7, ADR 009 decision 9).

Two facts shape the choice. First, an MCP response may stream for minutes, so every proxy
and load balancer between the client and the process matters: Railway cuts a response at 15
minutes, Azure Container Apps at 240 seconds, Cloudflare Tunnel after about 100 seconds of
silence, Fly.io after 60 seconds of silence; a cloud load balancer in front of Kubernetes
has an idle timeout of 50 to 300 seconds. Second, the maintainer wants to learn Kubernetes,
Helm and Argo CD on a real cluster, and this service is where that happens. That intent outweighs
the cheapest path, a VPS with Caddy and podman compose at about $7 a month.

Research on 2026-11-11 fixed the rest. Hetzner has no managed Kubernetes. Scaleway Kapsule,
OVHcloud Managed Kubernetes, Civo, DigitalOcean and Akamai offer a free control plane in the
EU; one small node plus one load balancer costs $20 to $35 a month, and the first months are
covered by sign-up credit on Scaleway, OVHcloud and Civo. The big clouds cost two to four
times that for one application, from the load balancer and NAT line items rather than the
control plane. ingress-nginx was archived on 2026-03-24 and gets no fixes. CloudNativePG is
the default Postgres operator of 2026; the Bitnami chart images need a paid subscription. Argo CD
has a core install without UI or API server at about 200 MB.

## Decision

1. **A managed Kubernetes cluster with a free control plane and one node.** Scaleway Kapsule
   in Paris or Amsterdam on the smallest node type the console permits, with one Scaleway
   load balancer. If Scaleway refuses the node size or the credit, the order is OVHcloud
   Managed Kubernetes, then Civo. A second node is not bought: the service has one replica,
   and a node upgrade is a short outage the maintainer accepts.
2. **Traefik 3 is the ingress and cert-manager issues the certificate.** Both come from their
   Helm charts. TLS is Let's Encrypt over the HTTP-01 challenge on a plain `Ingress` for the
   one host. The Gateway API is the next learning step, not this one; `ingress2gateway`
   converts the manifest when the time comes. ingress-nginx is not installed.
3. **Postgres runs in the cluster under CloudNativePG.** One instance, 512 MiB with requests
   equal to limits, on a block volume. The Barman Cloud Plugin writes base backups and WAL to
   a private prefix of the existing R2 bucket, which needs the plugin's content-hash
   workaround for R2. A restore drill on a fresh cluster is part of the spec. Qdrant stays on
   Qdrant Cloud.
4. **Argo CD in its core install, with the app-of-apps pattern, from this repository.** The
   Helm chart lives in `deploy/chart/` and the Argo CD applications in `deploy/argocd/`: one
   root application points at cert-manager, Traefik, the CloudNativePG operator, Sealed
   Secrets and the service. Sync is automatic with prune and self-heal, so the cluster is
   what git says and nothing else. A rollback is a revert.
5. **CI promotes the image by committing the tag.** The image workflow that pushes to GHCR
   also writes the new tag into the chart values on `master`, with a path filter so the commit
   does not run CI again. Argo CD Image Updater is not installed: one less controller, and
   the git history shows every deploy.
6. **Secrets are Sealed Secrets and the node pulls GHCR with a pull secret.** The bot token,
   the OIDC client secret, the R2 keys and the model keys are sealed with the cluster's key
   and committed; the database URL comes from the secret CloudNativePG creates. GHCR stays
   private; an image pull secret with a read-only package token sits in the namespace.
7. **Migrations run as a Helm pre-upgrade hook.** A Job runs `node dist/core/db/migrate-cli.js`
   before the new Deployment rolls out, as spec 008 separated migrations from the process
   start. A failed migration fails the sync and the old pods keep running.
8. **The MCP stream sends a heartbeat.** A comment line every 15 to 20 seconds on `/mcp`
   keeps the load balancer and Traefik from closing an idle stream, and `/mcp` is excluded
   from the compress middleware, which buffers. The load balancer's idle timeout is raised to
   its maximum where the provider allows it.

## Alternatives Rejected

- **A VPS with Caddy and podman compose.** Cheapest at about $7 a month and no timeout cap,
  but it teaches none of the cluster primitives this ADR exists to learn.
- **k3s on one VPS.** Real Kubernetes API at VPS cost, but no cloud load balancer or CSI
  volumes, and the maintainer also operates the node and the k3s upgrades.
- **GKE, EKS, AKS.** The largest ecosystems, but EKS charges $73 a month for the control
  plane alone and all three add load balancer, NAT and egress fees; two to four times the EU
  clouds for one pod.
- **Fly.io, Render, Railway, Cloud Run, Azure Container Apps, home with a Cloudflare
  Tunnel.** Each has a response or idle timeout that cuts an MCP stream, or no Kubernetes
  to learn, or both.
- **ingress-nginx.** Archived, no CVE fixes; its successor was retired too.
- **The Bitnami Postgres chart or the Zalando operator.** Paywalled images, or Patroni with
  a single vendor. CloudNativePG is the CNCF default.
- **Argo CD Image Updater.** Maintained, but a second controller with cluster write access
  for a job one CI step does.
- **SOPS with age.** Fine, but it needs a repo-server plugin in Argo CD; Sealed Secrets is a
  controller and a CLI. SOPS can replace it later without touching the chart layout.
- **Managed Postgres or Neon.** Less to learn, and either $10 to $15 a month more or cold
  starts on the free tier.

## Consequences

- About $20 to $35 a month after the credit. The maintainer operates the cluster add-ons
  and watches their upgrades; Scaleway forces a cluster upgrade after 14 months.
- `deploy/` enters the repository with a chart, Argo CD manifests and a runbook. CI gains a
  `helm lint` and `helm template` job and the image workflow gains a commit-back step, which
  needs a token that can push to `master` past branch protection.
- A deploy is a commit; a rollback is a revert. There is no manual `kubectl apply` path.
- `PUBLIC_URL` is set in the chart values, which turns on webhook mode (spec 008) and the MCP
  and OAuth routes (ADR 009) together.

## Open

- The Gateway API migration, once the plain Ingress works.
- A second node, when a node upgrade outage becomes a problem.
- Qdrant on the cluster, which would end the Qdrant Cloud fee and add a volume to back up.
- Image signing with cosign and verification at admission (spec 008 Open).
- A monitoring stack; today `/healthz` and `/readyz` and the provider's node metrics.
- The Argo CD UI and API server, if the CLI is too slow to use.

Spec `012-k8s-deploy` carries the implementation.
