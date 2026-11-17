. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$destinataires = [string](Get-Valeur $entree "destinataires" "")
$copies = [string](Get-Valeur $entree "copies" "")
$objet = [string](Get-Valeur $entree "objet" "")
$corps = [string](Get-Valeur $entree "corps" "")
$signature = [string](Get-Valeur $entree "signature" "")

$adresses = @(Adresses-Texte $destinataires)
if ($adresses.Count -eq 0) { throw "Indiquez au moins une adresse de destinataire." }
if ([string]::IsNullOrWhiteSpace($objet)) { throw "Indiquez un objet." }

$html = "<div>$(Html-Texte $corps)</div>"
if (-not [string]::IsNullOrWhiteSpace($signature)) {
  $html += "<br><div>$(Html-Texte $signature)</div>"
}

try {
  $outlook = Get-Outlook
  $mail = $outlook.CreateItem(0)
  $mail.To = ($adresses -join "; ")
  $adressesCopie = @(Adresses-Texte $copies)
  if ($adressesCopie.Count -gt 0) { $mail.CC = ($adressesCopie -join "; ") }
  $mail.Subject = $objet.Trim()
  $mail.HTMLBody = $html
  $mail.Send()
  Write-Sortie @{ ok = $true }
} catch {
  throw "Outlook n’a pas pu envoyer le message : $($_.Exception.Message)"
}
