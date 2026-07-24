param(
    [Parameter(Mandatory=$true)]
    [string]$SourceFile,

    [Parameter(Mandatory=$true)]
    [string]$HeaderPattern,

    [Parameter(Mandatory=$true)]
    [string]$TargetFile
)

$sourceFullPath = [IO.Path]::GetFullPath($SourceFile)
$targetFullPath = [IO.Path]::GetFullPath($TargetFile)

if (-not (Test-Path -LiteralPath $sourceFullPath)) {
    Write-Error "Source file not found: $sourceFullPath"
    exit 1
}

# 1. Pipeline(Get-Content)???怨? ??꾪?.NET API嚥?筌욊낯????뚮선 ?紐꾪맜???癒?맒 獄쎻뫗?
$content = [IO.File]::ReadAllText($sourceFullPath)

# 2. 筌왖?類ｋ쭆 ??삳쐭(HeaderPattern) 獄쏅뗀以??袁⑥삋????덈뮉 ?꾨뗀諭??됰뗀以?```...```)???類?뇣??뱀몵嚥??곕뗄??
# ?? (?s)### `extension.ts`\s*```\w*\r?\n(.*?)```
$regex = "(?si)" + [regex]::Escape($HeaderPattern) + "\s*````?\w*\r?\n(.*?)````?"

if ($content -match $regex) {
    $code = $matches[1]
    
    $targetDir = [IO.Path]::GetDirectoryName($targetFullPath)
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }
    
    # 3. Pipeline(Set-Content)???怨? ??꾪?UTF8-NoBOM 揶쏆빘猿쒏에?筌욊낯?????뵬 ?怨뚮┛
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($targetFullPath, $code, $utf8NoBom)
    
    Write-Output "Successfully extracted code block safely to: $targetFullPath"
} else {
    Write-Error "Could not find a code block matching header pattern: $HeaderPattern"
    exit 1
}
