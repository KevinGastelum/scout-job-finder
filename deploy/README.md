# Deploying Scout

Scout runs fine as `bun run serve` on a laptop. This directory exists because the interesting
part of deploying it is not the YAML — it is that **one stage of the pipeline cannot be
deployed at all**, and the design has to be honest about that rather than paper over it.

## The constraint that shapes everything

Scout has no LLM API key. Every model call spawns the operator's local `claude` CLI in
headless mode, billed against a personal Claude subscription. That is a deliberate product
decision, and it means the rubric stage is bound to one authenticated machine. There is no
way to give a pod that session without copying a credential into the cluster, so the image
does not ship the CLI and does not pretend to.

The funnel already had a seam at the right place. `SCOUT_RUBRIC_BUDGET=0` runs the fetch and
both deterministic filter stages and stops before the only stage that needs the CLI:

| stage | what it does | runs in cluster |
| --- | --- | --- |
| fetch | 15 adapters → normalize → identity resolution | yes |
| hard filters | remote, comp floor, role family, recency | yes |
| retrieval | fetch full descriptions for survivors | yes |
| rubric | LLM scores each survivor against the profile | **no** |

So the split is: the cluster collects and filters continuously; scoring stays on the
operator's machine, where `bun run scan` picks up everything the cluster already stored and
only pays for the postings that survived. The expensive, quota-bound stage runs against the
smallest possible input.

`packages/pipeline/src/funnel/index.ts` treats `0` as a real setting rather than a disabled
one, and `parseRubricBudget` throws on anything that is not a whole non-negative number —
coercing a typo to zero would report a healthy scan that quietly scored nothing.

## Layout

```
deploy/
  helm/scout/     chart for the read tier and the scheduled scan
  terraform/      GKE Autopilot, Artifact Registry, keyless CI federation
```

## Data, and why there is exactly one replica

The store is a single SQLite file on a ReadWriteOnce PersistentVolume. That is not a
placeholder for "real" storage — it is the right shape for a few hundred megabytes read by
one user — but it does constrain the deployment:

- `replicas: 1`, not exposed as a value. A second replica either lands on another node and
  blocks forever waiting for the volume, or lands on the same one and contends for the write
  lock.
- `strategy: Recreate`. A rolling update stands the replacement up before the old pod
  releases the volume, which is the same deadlock by another route.
- The scan CronJob carries a **required** pod affinity onto the server's node, because a
  ReadWriteOnce volume can be mounted by two pods only when they share one.
- `concurrencyPolicy: Forbid`. Two scans writing one SQLite file is the single thing this
  deployment must never do.

The PVC is annotated `helm.sh/resource-policy: keep` — uninstalling the release should not
throw away months of collected postings.

## Reaching it, and why that is deliberately awkward

The server has no authentication and `/api/shortlist` returns personal job-search data. Two
things follow.

**The host guard.** `hostAllowed()` pins the Host header to loopback as a DNS-rebinding
defence: without it, an attacker who points `evil.example` at `127.0.0.1` serves a page whose
requests carry `Origin === Host === evil.example` and sail through a same-origin check. A
container breaks that assumption — a pod is only reachable on its pod IP, and a kubelet probe
never arrives as loopback. The fix was not to weaken the guard but to add an explicit
allowlist (`SCOUT_TRUSTED_HOSTS`) and to answer `/api/health` **ahead** of it, since liveness
discloses nothing. Rebinding still fails: an attacker's page arrives with its own host, and
reaching the pod under a trusted name means passing whatever authenticates in front of it.

**Nothing is exposed by default.** The Service is ClusterIP, the ingress is off, and the
NetworkPolicy is default-deny. The intended way in is `kubectl port-forward`. Enabling the
ingress is guarded by two template `fail`s rather than a default that quietly works:

- `ingress.enabled` without `ingress.host` → the server would 403 every request, because the
  Host it receives is not one it was told to trust.
- `ingress.enabled` with the NetworkPolicy on and no `networkPolicy.ingressFrom` → the chart
  refuses to guess the controller's namespace, because guessing either breaks the route or
  opens the port wider than intended.

Both are exercised in CI as expected-failures.

## Secrets and personal data

Neither the image nor the chart contains any. `profile/profile.json` is the candidate's
personal data and is `.dockerignore`d; the chart mounts it from a Secret the operator creates
out of band, and without it the scan still fetches and stores and simply skips scoring. Job
source API keys arrive the same way, via `envFrom.secretRef` with `optional: true`. The
database itself is excluded from the build context — hundreds of megabytes of personal
job-search data must never be baked into a pushed image.

## CI has no long-lived credential

`terraform/iam.tf` sets up Workload Identity Federation so GitHub Actions mints short-lived
tokens over OIDC instead of holding a service-account JSON key. Two independent restrictions
are applied, and both matter:

1. `attribute_condition` on the provider — without it, a provider trusting
   `token.actions.githubusercontent.com` trusts *every workflow on GitHub*.
2. The `principalSet://...attribute.repository/OWNER/REPO` binding on the service account, so
   a second repository added to the pool later does not inherit deploy rights.

The deploy account gets `roles/container.developer`, not `container.admin`: CI applies
workloads, and changing the shape of the cluster stays a deliberate `terraform apply`.

## Verification

Everything here is validated offline. Nothing has been applied and no GCP project was
touched — there is no billing account behind this.

```bash
terraform -chdir=deploy/terraform fmt -check -recursive
terraform -chdir=deploy/terraform init -backend=false
terraform -chdir=deploy/terraform validate
helm lint deploy/helm/scout
helm template scout deploy/helm/scout
```

`.github/workflows/infra.yml` runs the same checks plus `kubeconform` against the Kubernetes
1.30 API schema, builds the image, starts it, and fails the job if the container cannot
answer its own health check. It never pushes: publishing is a separate credentialed workflow,
because this one runs on pull requests from forks.

**What is not verified:** no cluster has ever run these manifests, so scheduling, volume
binding, and probe timing are reasoned about rather than observed. `kubeconform` checks the
manifests against the API schema; it does not check that GKE Autopilot accepts every field
(Autopilot rejects some pod specs at admission that are valid Kubernetes).

## Cost, if it were applied

Four things bill, and the shape matters more than the exact rates:

- the GKE cluster management fee, charged per cluster-hour — the dominant line item, and the
  reason `location` being a region rather than a zone is a cost decision, not a detail;
- the CPU and memory the pods *request* under Autopilot, not what the nodes have — which is
  why `values.yaml` sets requests rather than leaving them to a default;
- the Cloud NAT gateway, which exists only because private nodes have no other route to the
  fifteen job boards the scan fetches;
- Artifact Registry storage, which is why the repository has a cleanup policy.

Current rates are at <https://cloud.google.com/kubernetes-engine/pricing>; the figures were
not verifiable while writing this, so no dollar amount is quoted here. The order of magnitude
is tens of dollars a month, which for a single-user job finder that already runs on a laptop
is not a sensible bill. This configuration exists because the deployment problem was worth
solving properly, not because the deployment is worth paying for.
