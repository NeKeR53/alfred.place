. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree

try {
  $outlook = Get-Outlook
  $session = $outlook.Session

  $comptes = @()
  foreach ($compte in @($session.Accounts)) {
    $adresse = ""
    try { $adresse = [string]$compte.SmtpAddress } catch {}
    if ([string]::IsNullOrWhiteSpace($adresse)) { try { $adresse = [string]$compte.UserName } catch {} }
    if ([string]::IsNullOrWhiteSpace($adresse)) { try { $adresse = [string]$compte.DisplayName } catch {} }
    if ([string]::IsNullOrWhiteSpace($adresse)) { continue }

    $nom = ""
    try { $nom = [string]$compte.DisplayName } catch {}
    if ([string]::IsNullOrWhiteSpace($nom)) { $nom = $adresse }
    $libelle = $nom
    if ($nom -ne $adresse) { $libelle = "$nom <$adresse>" }

    $comptes += [pscustomobject]@{
      id = $adresse
      label = $libelle
      default = ($comptes.Count -eq 0)
    }
  }

  $profil = $null
  $premier = Get-Compte $session $null
  if ($premier) {
    $nom = ""
    $adresse = ""
    try { $nom = [string]$premier.DisplayName } catch {}
    try { $adresse = [string]$premier.SmtpAddress } catch {}
    if ([string]::IsNullOrWhiteSpace($adresse)) { try { $adresse = [string]$premier.UserName } catch {} }
    $profil = [pscustomobject]@{ nom = $nom; adresse = $adresse }
  }

  if ($comptes.Count -eq 0) {
    $store = $session.DefaultStore
    $nom = ""
    try { $nom = [string]$store.DisplayName } catch {}
    $comptes = @([pscustomobject]@{ id = "default"; label = $nom; default = $true })
    if ($null -eq $profil) { $profil = [pscustomobject]@{ nom = $nom; adresse = "" } }
  }

  Write-Sortie @{ comptes = @($comptes); pret = $true; profil = $profil }
} catch {
  Write-Sortie @{ comptes = @(); pret = $false; profil = $null }
}
