param([string[]]$AiderArgs)

$files = @($AiderArgs | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) })
foreach ($file in $files) {
    $content = Get-Content -LiteralPath $file -Raw -Encoding UTF8
    $content = $content.Replace('$value = "old"', '$value = "new"')
    Set-Content -LiteralPath $file -Encoding UTF8 -NoNewline -Value $content
}

"fake aider edited $($files.Count) file(s)"
