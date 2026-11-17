. (Join-Path (Split-Path -Parent $PSScriptRoot) "lib/outlook-com.ps1")

$entree = Read-Entree
$id = [string](Get-Valeur $entree "id" "")

if ([string]::IsNullOrWhiteSpace($id)) {
  Write-Sortie @{ message = $null }
  exit 0
}

try {
  $outlook = Get-Outlook
  $session = $outlook.Session
  $mail = Get-Mail $session $id
  if ($null -eq $mail) {
    Write-Sortie @{ message = $null }
    exit 0
  }

  $resume = Convertir-Message $mail

  $corps = ""
  try { $corps = [string]$mail.HTMLBody } catch {}
  if ([string]::IsNullOrWhiteSpace($corps)) { try { $corps = [string]$mail.Body } catch {} }
  if (-not [string]::IsNullOrWhiteSpace($corps) -and $corps -notmatch "<[a-zA-Z!/]") {
    $corps = "<div>" + (Html-Texte $corps) + "</div>"
  }

  $destinataires = @()
  $copies = @()
  try {
    foreach ($destinataire in @($mail.Recipients)) {
      try {
        $type = [int]$destinataire.Type
        if ($type -eq 1) { $destinataires += [string]$destinataire.Name }
        elseif ($type -eq 2) { $copies += [string]$destinataire.Name }
      } catch {}
    }
  } catch {}

  $pieces = @()
  $index = 1
  try {
    foreach ($piece in @($mail.Attachments)) {
      $type = "application/octet-stream"
      $contentId = ""
      try { $type = [string]$piece.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x370E001E") } catch {}
      try { $contentId = [string]$piece.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001E") } catch {}
      if ([string]::IsNullOrWhiteSpace($type)) { $type = "application/octet-stream" }

      $nom = ""
      try { $nom = [string]$piece.FileName } catch {}
      if ([string]::IsNullOrWhiteSpace($nom)) { $nom = "Pièce jointe" }

      $taille = 0
      try { $taille = [int]$piece.Size } catch {}

      $pieces += [pscustomobject]@{
        id = [string]$index
        nom = $nom
        type = $type
        taille = $taille
        inline = (-not [string]::IsNullOrWhiteSpace($contentId))
        contentId = $contentId
      }
      $index++
    }
  } catch {}

  $resume.pieces = @($pieces)
  if ($destinataires.Count -gt 0) { $resume.destinataires = @($destinataires) }
  $resume | Add-Member -NotePropertyName copies -NotePropertyValue @($copies) -Force
  $resume | Add-Member -NotePropertyName corps -NotePropertyValue $corps -Force

  Write-Sortie @{ message = $resume }
} catch {
  Write-Sortie @{ message = $null }
}
