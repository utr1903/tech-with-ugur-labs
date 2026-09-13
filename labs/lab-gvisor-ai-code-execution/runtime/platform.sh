#!/usr/bin/env bash
# Fixed official release and platform manifests; unknown architectures fail closed.
select_platform() {
  case "$1" in
    x86_64|amd64)
      pod_subnet=192.168.0.0/16
      artifact_arch=x86_64
      archive_digest=81416511897ab8abd4e723d66823c5b0461a2ee3311cfa70d152404ef9b860cf
      python_digest=2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301
      kind_digest=14ffd6ee8a3daa20cc934ba786626b181e1797268c5465f2c299a7cf54494c77
      calico_node=8e8d25f4d0bf0f1ed4e7ce864d789ea948830c1c4377994fa4032d3093095295
      calico_cni=08b508bec6b7cc2fd35d7ad340f28ff265f7589feacd217a56ccc6aa0cd98634
      calico_controllers=65a824efe37bad955e45a9a37492d8db862f6b7c99bc58ac99cf18915a23ee26
      ;;
    aarch64|arm64)
      pod_subnet=10.244.0.0/16
      artifact_arch=aarch64
      archive_digest=2b162adb35860f598ab2f89b9d752bff2c7ee6175c05d9cc532174a336cfb38c
      python_digest=228390eced221ad2986a3dd77e10b1accca6ba8ceb36f1572de1b346a337cc1a
      kind_digest=cfea27c21c338b9948ea55c413b9c9e2549f3df89a89424889a1fd3ecb0c8951
      calico_node=073583422aca8b318ec00e966fa780972ceee3ff58c1d4b3c17e692d8ee605bb
      calico_cni=3e5aa85177e15b92550e321b079ee89e3f202bc84cbab398e0b12c42eefc564f
      calico_controllers=49f455efc2e65a7b3d8f1c283ff12641f93c01c989c587029464eb953d0a0f96
      ;;
    *) printf 'Unsupported Docker architecture: %s\n' "$1" >&2; return 1 ;;
  esac
  export pod_subnet artifact_arch archive_digest python_digest kind_digest calico_node calico_cni calico_controllers
}
load_platform() {
  test "$(docker info --format '{{.OSType}}')" = linux || { printf 'Requires a Linux Docker daemon\n' >&2; return 1; }
  select_platform "$(docker info --format '{{.Architecture}}')"
}
render_manifest() {
  sed -e "s/2986c55feb36e6cae00fa1fefb454283e4b33f35e75ff8bdd123b134130be301/$python_digest/g" \
      -e "s|192.168.0.0/16|$pod_subnet|g" \
      -e "s/14ffd6ee8a3daa20cc934ba786626b181e1797268c5465f2c299a7cf54494c77/$kind_digest/g" "$1"
}
