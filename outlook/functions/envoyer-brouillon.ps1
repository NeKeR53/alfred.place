. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")

if ([string]::IsNullOrWhiteSpace($id)) { throw "Aucun brouillon à envoyer." }

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) { throw "Ce brouillon n’existe plus dans Outlook." }

  $dejaEnvoye = $false
  try { $dejaEnvoye = [bool]$mail.Sent } catch {}
  if ($dejaEnvoye) { throw "Ce message a déjà été envoyé." }

  $mail.Send()
  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu envoyer le brouillon : $($_.Exception.Message)"
}
