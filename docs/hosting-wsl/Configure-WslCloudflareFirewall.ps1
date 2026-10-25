[CmdletBinding(SupportsShouldProcess = $true, ConfirmImpact = 'Medium')]
param(
    # Adds two WSL Hyper-V egress exceptions only when WSL's default outbound
    # action is Block. The default invocation is read-only.
    [switch]$AllowCloudflareTunnelEgress
)

$ErrorActionPreference = 'Stop'
$wslCreatorId = '{40E0AC32-46A5-438A-A0B2-2B479E8F2E90}'
$tunnelRules = @(
    @{ Name = 'CubsCloudflareTunnel-TCP-7844'; Protocol = 'TCP' },
    @{ Name = 'CubsCloudflareTunnel-UDP-7844'; Protocol = 'UDP' }
)

foreach ($commandName in @(
    'Get-NetFirewallProfile',
    'Get-NetFirewallHyperVVMSetting',
    'Get-NetFirewallHyperVRule',
    'New-NetFirewallHyperVRule'
)) {
    if (-not (Get-Command -Name $commandName -ErrorAction SilentlyContinue)) {
        throw "Required Windows firewall cmdlet is unavailable: $commandName. This script requires a supported Windows 11 build with Hyper-V firewall cmdlets."
    }
}

Write-Host 'Windows Defender Firewall profiles (read-only):'
Get-NetFirewallProfile -PolicyStore ActiveStore |
    Sort-Object Name |
    Format-Table Name, Enabled, DefaultInboundAction, DefaultOutboundAction -AutoSize

$wslSetting = Get-NetFirewallHyperVVMSetting `
    -PolicyStore ActiveStore `
    -Name $wslCreatorId

Write-Host "WSL Hyper-V firewall (creator $wslCreatorId):"
$wslSetting |
    Select-Object Name, Enabled, DefaultInboundAction, DefaultOutboundAction,
        LoopbackEnabled, AllowHostPolicyMerge |
    Format-List

$existingRules = @(Get-NetFirewallHyperVRule -VMCreatorId $wslCreatorId)
$existingRules |
    Sort-Object Direction, DisplayName |
    Format-Table Name, DisplayName, Direction, Protocol, LocalPorts, RemotePorts,
        RemoteAddresses, Action, Enabled -AutoSize

if (-not $AllowCloudflareTunnelEgress) {
    Write-Host 'Audit only: no firewall setting or rule was changed.'
    Write-Host 'Cloudflare Tunnel needs outbound TCP/UDP 7844; it does not need an inbound port.'
    Write-Host 'Use -AllowCloudflareTunnelEgress only if WSL outbound is Block and that egress is intentionally required.'
    return
}

$principal = [Security.Principal.WindowsPrincipal]::new(
    [Security.Principal.WindowsIdentity]::GetCurrent()
)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Adding Hyper-V firewall rules requires an elevated PowerShell session. The audit mode does not.'
}

if (-not $wslSetting.Enabled) {
    throw 'The WSL Hyper-V firewall is not enabled. This script will not change its global enablement or default policy.'
}

if ([string]$wslSetting.DefaultOutboundAction -eq 'Allow') {
    Write-Host 'No change needed: WSL already allows outbound traffic by default, including TCP/UDP 7844.'
    return
}

if ([string]$wslSetting.DefaultOutboundAction -ne 'Block') {
    throw "Unexpected WSL default outbound action '$($wslSetting.DefaultOutboundAction)'; no rules were changed."
}

$explicitOutboundBlocks = @(
    $existingRules | Where-Object {
        $_.Enabled -and $_.Direction -eq 'Outbound' -and $_.Action -eq 'Block'
    }
)
if ($explicitOutboundBlocks.Count -gt 0) {
    Write-Warning 'Enabled WSL outbound block rules exist. Review them first; this script will not try to override explicit blocks.'
    $explicitOutboundBlocks |
        Format-Table Name, DisplayName, Protocol, LocalPorts, RemotePorts,
            RemoteAddresses, Action, Enabled -AutoSize
    return
}

Write-Warning 'These exceptions apply to all WSL distributions/processes and any destination on remote port 7844, but only outbound. They do not open inbound ports or change default policies.'
Write-Warning 'If WSL default outbound is Block, DNS, SMTP, package downloads, and other egress may need separate policy; this script only covers the Tunnel transport.'

foreach ($rule in $tunnelRules) {
    if ($existingRules | Where-Object { $_.Name -eq $rule.Name }) {
        Write-Host "Rule already exists; keeping it unchanged: $($rule.Name)"
        continue
    }

    $description = "WSL outbound $($rule.Protocol) remote port 7844"
    if ($PSCmdlet.ShouldProcess($description, 'Create Hyper-V firewall allow rule')) {
        New-NetFirewallHyperVRule `
            -Name $rule.Name `
            -DisplayName "Cub's Cloudflare Tunnel egress $($rule.Protocol) 7844" `
            -Direction Outbound `
            -VMCreatorId $wslCreatorId `
            -Protocol $rule.Protocol `
            -RemotePorts '7844' `
            -Action Allow |
            Out-Null
        Write-Host "Created outbound-only rule: $($rule.Name)"
    }
}

Write-Host 'No Defender Antivirus, Windows Firewall profile, inbound rule, or default policy was changed.'
