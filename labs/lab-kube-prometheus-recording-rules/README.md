# Recording rules done right

kube-prometheus-stack on kind, customized the way real teams need it:
recording rules with human-readable node names, two dashboards that
prove why recording rules matter, and Grafana-managed alerts delivered
to your own webhook server.

## Prerequisites

- Docker, kind, kubectl, Helm, make, jq, curl

## Quickstart

    make up       # kind cluster + chart + all lab resources (~10 min)
    make verify   # end-to-end check, including firing all six alerts
    make down     # delete the cluster

(Architecture and walkthrough sections land with the final task.)
