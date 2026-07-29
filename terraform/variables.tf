variable "resource_group_name" {
  default = "clusterbloom-rg-v2"
}

variable "location" {
  default = "centralus"
}

variable "vm_size" {
  description = "General-purpose VM size with reliable availability"
  default     = "Standard_D2s_v3"
}

variable "admin_username" {
  default = "spidey"
}

variable "ssh_public_key_path" {
  description = "Path to your public SSH key (RSA required by Azure)"
  default     = "~/.ssh/azure_rsa.pub"
}

variable "vm_name" {
  default = "clusterbloom-vm"
}