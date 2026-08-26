locals {
  host_project_id = data.terraform_remote_state.foundation.outputs.host_project_id

  vms = {
    "service-a" = {
      project    = data.terraform_remote_state.foundation.outputs.service_a_project_id
      subnetwork = data.terraform_remote_state.network.outputs.subnet_service_a_self_link
      ip         = data.terraform_remote_state.network.outputs.vm_ip_a
    }
    "service-b" = {
      project    = data.terraform_remote_state.foundation.outputs.service_b_project_id
      subnetwork = data.terraform_remote_state.network.outputs.subnet_service_b_self_link
      ip         = data.terraform_remote_state.network.outputs.vm_ip_b
    }
  }

  startup_scripts = {
    for name, vm in local.vms : name => <<-EOT
      #!/bin/bash
      set -e
      mkdir -p /var/www
      echo "<h1>vm-${name}</h1><p>project: ${vm.project}</p>" > /var/www/index.html
      cat > /etc/systemd/system/labweb.service <<'UNIT'
      [Unit]
      Description=Lab web page

      [Service]
      ExecStart=/usr/bin/python3 -m http.server 80 --directory /var/www
      Restart=always

      [Install]
      WantedBy=multi-user.target
      UNIT
      systemctl daemon-reload
      systemctl enable --now labweb
    EOT
  }
}
