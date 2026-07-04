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

# 1. Pipeline(Get-Content)을 쓰지 않고 .NET API로 직접 읽어 인코딩 손상 방지
$content = [IO.File]::ReadAllText($sourceFullPath)

# 2. 지정된 헤더(HeaderPattern) 바로 아래에 있는 코드 블록(```...```)을 정규식으로 추출
# 예: (?s)### `extension.ts`\s*```\w*\r?\n(.*?)```
$regex = "(?si)" + [regex]::Escape($HeaderPattern) + "\s*````?\w*\r?\n(.*?)````?"

if ($content -match $regex) {
    $code = $matches[1]
    
    $targetDir = [IO.Path]::GetDirectoryName($targetFullPath)
    if (-not (Test-Path -LiteralPath $targetDir)) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
    }
    
    # 3. Pipeline(Set-Content)을 쓰지 않고 UTF8-NoBOM 객체로 직접 파일 쓰기
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($targetFullPath, $code, $utf8NoBom)
    
    Write-Output "Successfully extracted code block safely to: $targetFullPath"
} else {
    Write-Error "Could not find a code block matching header pattern: $HeaderPattern"
    exit 1
}
