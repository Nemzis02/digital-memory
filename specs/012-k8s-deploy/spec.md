# Feature Spec: 012 Kubernetes Deploy

## Goal

Run the service at one public HTTPS origin on a managed Kubernetes cluster, deployed by git
through Argo CD, with Postgres in the cluster and its backups in R2 (ADR 010). Today the image
exists on GHCR and nothing runs it; the maintainer also wants this to be the place to learn
Kubernetes, Helm and Argo CD, so every step is written down.

## User Stories

- As the maintainer, I follow one runbook from an empty cloud account to `https://<host>/healthz`
  answering 200 with a valid certificate, and every command in it is the one I ran.
- As the maintainer, I push to `master` and, within a few minutes and with no `kubectl`,
  the new image serves `/readyz`; `git log` shows the commit that changed the image tag.
- As the maintainer, I revert that commit and the previous image is back.
- As a platform, `/readyz` is green behind the ingress, and the Telegram webhook is set to
  `<PUBLIC_URL>/telegram/webhook` and delivers updates.
- As the maintainer, I see a base backup and WAL files under the R2 prefix every day, and I
  have restored them once onto a fresh cluster and seen the memories answer.
- As the maintainer, every secret in git is sealed; `git grep` for a token finds nothing.
- As a contributor, `helm lint` and `helm template` run in CI and fail on a broken chart.
- As a platform, an MCP response that streams for 5 minutes through the load balancer is not
  cut.
- As the maintainer, I know what the cluster costs each month before I create it.

## Out of Scope

The Gateway API. A second node. Qdrant on the cluster. A monitoring stack. The Argo CD UI.
Argo CD Image Updater. Image signing. Staging environments.
