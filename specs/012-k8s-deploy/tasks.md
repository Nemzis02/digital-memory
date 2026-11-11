# Implementation Tasks: 012 Kubernetes Deploy

Blocked on nothing for the chart and the CI job. The cluster tasks need a Scaleway account
with the trial credit and a DNS name. ADR 010 is the decision; this spec is the plan.

- [ ] Task 1: Chart skeleton: Deployment, Service, Ingress, ConfigMap, migrate hook Job,
      Traefik middleware; `helm lint` and `helm template` in CI. Local `helm template` review.
- [ ] Task 2: Argo CD manifests: root application and the five child applications with sync
      waves; cluster issuer.
- [ ] Task 3: Create the cluster, install Argo CD core and Sealed Secrets, commit the sealing
      certificate, seal the three secrets, apply the root application. Runbook section.
- [ ] Task 4: CloudNativePG cluster, object store, scheduled backup, R2 workaround; the
      service reads `DATABASE_URL` from the cluster secret. First backup lands in R2.
- [ ] Task 5: DNS, certificate, first deploy; `/healthz`, `/readyz` and the metadata route
      answer over HTTPS; webhook mode set. Smoke checklist run and recorded.
- [ ] Task 6: Image tag commit-back in `image.yml`, `paths-ignore` in both workflows, the
      push token; one push to `master` ends with the new image live; one revert rolls back.
- [ ] Task 7: Restore drill on a fresh namespace from the R2 backups. Runbook section.
- [ ] Task 8: The 5-minute SSE check through the load balancer with the idle timeout raised.
- [ ] Task 9: README through `readme-updater`; MEMORY.md entries for cluster quirks;
      `change-review`, then `security-review` (workflows change).
