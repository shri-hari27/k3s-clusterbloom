output "vm_public_ip" {
  description = "Public IP address of the k3s VM"
  value       = azurerm_public_ip.pip.ip_address
}