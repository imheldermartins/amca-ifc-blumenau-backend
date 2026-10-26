param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
$item = Get-Item -LiteralPath $Path
if ($item.PSIsContainer) {
  $acl = New-Object System.Security.AccessControl.DirectorySecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
} else {
  $acl = New-Object System.Security.AccessControl.FileSecurity
  $inheritance = [System.Security.AccessControl.InheritanceFlags]::None
}
# Preserve ownership; changing it requires privileges beyond WRITE_DAC even
# when the current user already owns the file.
$acl.SetAccessRuleProtection($true, $false)
foreach ($sid in @($identity, [System.Security.Principal.SecurityIdentifier]'S-1-5-18', [System.Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', $inheritance, 'None', 'Allow')
  $acl.AddAccessRule($rule)
}
# Use the .NET Framework API directly: WSL may inherit PowerShell 7's module
# search path, which prevents Windows PowerShell 5 from autoloading Set-Acl.
$item.SetAccessControl($acl)
