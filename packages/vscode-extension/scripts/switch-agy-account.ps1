param(
    [Parameter(Mandatory=$true)]
    [string]$Email
)
$ErrorActionPreference = 'Stop'

if (-not ('AgyMultiCredCollector.NativeMethods' -as [type])) {
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace AgyMultiCredCollector {
    public static class NativeMethods {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct Credential {
            public UInt32 Flags;
            public UInt32 Type;
            public string TargetName;
            public string Comment;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
            public UInt32 CredentialBlobSize;
            public IntPtr CredentialBlob;
            public UInt32 Persist;
            public UInt32 AttributeCount;
            public IntPtr Attributes;
            public string TargetAlias;
            public string UserName;
        }

        [DllImport("Advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredRead(string target, UInt32 type, UInt32 reservedFlag, out IntPtr credentialPtr);

        [DllImport("Advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredWrite(ref Credential credential, UInt32 flags);

        [DllImport("Advapi32.dll", SetLastError = true)]
        public static extern void CredFree(IntPtr buffer);
    }
}
'@
}

function Read-Cred([string]$target) {
    $ptr = [IntPtr]::Zero
    if ([AgyMultiCredCollector.NativeMethods]::CredRead($target, 1, 0, [ref]$ptr)) {
        try {
            $c = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][AgyMultiCredCollector.NativeMethods+Credential])
            $bytes = New-Object byte[] $c.CredentialBlobSize
            [Runtime.InteropServices.Marshal]::Copy($c.CredentialBlob, $bytes, 0, $bytes.Length)
            try {
                $utf8 = New-Object System.Text.UTF8Encoding($false, $true)
                $val = $utf8.GetString($bytes)
            } catch {
                $val = [Text.Encoding]::Unicode.GetString($bytes)
            }
            return @{
                Target = $target
                UserName = $c.UserName
                Value = $val
            }
        } finally {
            [AgyMultiCredCollector.NativeMethods]::CredFree($ptr)
        }
    }
    return $null
}

function Write-Cred([string]$target, [string]$userName, [string]$value) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($value)
    $blobPtr = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
    try {
        [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blobPtr, $bytes.Length)
        $cred = New-Object AgyMultiCredCollector.NativeMethods+Credential
        $cred.Type = 1
        $cred.TargetName = $target
        $cred.UserName = $userName
        $cred.CredentialBlob = $blobPtr
        $cred.CredentialBlobSize = [uint32]$bytes.Length
        $cred.Persist = 2
        return [AgyMultiCredCollector.NativeMethods]::CredWrite([ref]$cred, 0)
    } finally {
        [System.Runtime.InteropServices.Marshal]::FreeHGlobal($blobPtr)
    }
}

$specific = "gemini:antigravity:$Email"
$data = Read-Cred $specific

# Inspect current default target before switching so we never lose a freshly rotated token
$currentDefault = Read-Cred "gemini:antigravity"
$currentDefaultJson = $null
if ($currentDefault -and $currentDefault.Value) {
    try {
        $currentDefaultJson = $currentDefault.Value | ConvertFrom-Json
        if ($currentDefaultJson -and $currentDefaultJson.id_token_email -and $currentDefaultJson.token) {
            $curEmail = [string]$currentDefaultJson.id_token_email
            if ($curEmail -ine $Email) {
                $curSpecTarget = "gemini:antigravity:$curEmail"
                $curSpecExisting = Read-Cred $curSpecTarget
                $curSpecHasRt = $false
                if ($curSpecExisting -and $curSpecExisting.Value) {
                    try {
                        $curSpecJson = $curSpecExisting.Value | ConvertFrom-Json
                        $curSpecHasRt = [bool]($curSpecJson.token -and $curSpecJson.token.refresh_token)
                    } catch {}
                }
                if ($currentDefaultJson.token.refresh_token -or -not $curSpecHasRt) {
                    $null = Write-Cred $curSpecTarget "antigravity" $currentDefault.Value
                }
            }
        }
    } catch {
        $currentDefaultJson = $null
    }
}

$alreadyActive = $false
if ($currentDefaultJson -and $currentDefaultJson.id_token_email -ieq $Email -and $currentDefaultJson.token) {
    $curHasRt = [bool]$currentDefaultJson.token.refresh_token
    if ($curHasRt -or -not $data -or -not $data.Value) {
        $alreadyActive = $true
    }
}

if (-not $alreadyActive) {
    if (-not $data -or -not $data.Value) {
        $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
        $extractScript = Join-Path $scriptDir "extract-ide-auth.py"
        if (-not (Test-Path $extractScript)) {
            $extractScript = "D:\Workspace\Integrated POWER\packages\vscode-extension\scripts\extract-ide-auth.py"
        }
        if (Test-Path $extractScript) {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = 'python'
            $psi.Arguments = ('"' + $extractScript + '"')
            $psi.CreateNoWindow = $true
            $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
            $psi.UseShellExecute = $false
            $psi.RedirectStandardOutput = $true
            $psi.RedirectStandardError = $true
            $psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8
            $proc = [System.Diagnostics.Process]::Start($psi)
            $extractedRaw = $proc.StandardOutput.ReadToEnd()
            $null = $proc.WaitForExit(10000)
            if ($extractedRaw) {
                $authObj = $extractedRaw | ConvertFrom-Json
                if ($authObj -and $authObj.email -ieq $Email -and ($authObj.access_token -or $authObj.refresh_token)) {
                    $tokenObj = @{
                        access_token = $authObj.access_token
                        refresh_token = $authObj.refresh_token
                        token_type = "Bearer"
                        expiry = (Get-Date).ToUniversalTime().AddHours(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
                    }
                    $credPayload = @{
                        token = $tokenObj
                        auth_method = "consumer"
                        id_token_email = $Email
                    } | ConvertTo-Json -Compress
                    $null = Write-Cred $specific "antigravity" $credPayload
                    $data = @{ Target = $specific; UserName = "antigravity"; Value = $credPayload }
                }
            }
        }
    }

    if (-not $data -or -not $data.Value) {
        throw "Account credentials for '$Email' not found in Credential Manager ($specific)."
    }

    $success = Write-Cred "gemini:antigravity" "antigravity" $data.Value
    if (-not $success) {
        throw "Failed to write active target to Credential Manager."
    }
}

$geminiDir = Join-Path $env:USERPROFILE ".gemini"
if (-not [System.IO.Directory]::Exists($geminiDir)) {
    [System.IO.Directory]::CreateDirectory($geminiDir) | Out-Null
}
$stateFile = Join-Path $geminiDir "current_agy_account.txt"
$tmpFile = Join-Path $geminiDir "current_agy_account.txt.$([System.Guid]::NewGuid().ToString('N')).tmp"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($tmpFile, "$Email`n", $utf8NoBom)
try {
    [System.IO.File]::Move($tmpFile, $stateFile, $true)
} catch {
    Move-Item -Path $tmpFile -Destination $stateFile -Force
}

[Console]::OutputEncoding = [Text.Encoding]::UTF8
Write-Output "Switched default Antigravity credential to $Email"
