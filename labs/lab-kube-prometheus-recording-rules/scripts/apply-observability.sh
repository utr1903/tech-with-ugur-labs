#!/usr/bin/env bash
# Packages dashboards and Grafana alerting resources as labeled
# ConfigMaps the Grafana sidecars auto-import.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib.sh

apply_labeled_configmap() {
  local name="$1" file="$2" label="$3"
  kubectl create configmap "$name" -n monitoring \
    --from-file="$(basename "$file")=$file" \
    --dry-run=client -o yaml \
    | kubectl label --local -f - "$label=1" -o yaml \
    | kubectl apply -f -
}

for f in dashboards/*.json; do
  log "Applying dashboard $(basename "$f")..."
  apply_labeled_configmap "dash-$(basename "$f" .json)" "$f" grafana_dashboard
done

if compgen -G "alerting/*.yaml" >/dev/null; then
  for f in alerting/*.yaml; do
    log "Applying alerting resource $(basename "$f")..."
    apply_labeled_configmap "alerting-$(basename "$f" .yaml)" "$f" grafana_alert
  done
fi
