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

        [DllImport("Advapi32.dll", EntryPoint = "CredEnumerateW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern bool CredEnumerate(string filter, UInt32 flags, out UInt32 count, out IntPtr credentialPtrArray);

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
            $lw = (([int64]$c.LastWritten.dwHighDateTime) -shl 32) -bor ([int64]$c.LastWritten.dwLowDateTime -band 0xFFFFFFFFL)
            return @{
                Target = $target
                UserName = $c.UserName
                Value = $val
                LastWritten = $lw
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

$results = @{
    accounts = @{}
    gcpProjects = @{}
    activeIdeAccount = ""
    activeAgy2Account = ""
    appStorageAgy2Account = ""
    defaultTargetEmail = ""
}
$accountMeta = @{}

# 1. Enumerate Windows Credential Manager
$count = 0
$ptrArray = [IntPtr]::Zero
if ([AgyMultiCredCollector.NativeMethods]::CredEnumerate("gemini:antigravity*", 0, [ref]$count, [ref]$ptrArray)) {
    try {
        for ($i = 0; $i -lt $count; $i++) {
            $credPtr = [Runtime.InteropServices.Marshal]::ReadIntPtr($ptrArray, $i * [IntPtr]::Size)
            $c = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type][AgyMultiCredCollector.NativeMethods+Credential])
            $target = $c.TargetName
            $data = Read-Cred $target
            if ($data -and $data.Value) {
                try {
                    $json = $data.Value | ConvertFrom-Json
                    $email = [string]$json.id_token_email
                    if ($email) {
                        if ($target -eq 'gemini:antigravity') {
                            $results.defaultTargetEmail = $email
                            $existingSpec = Read-Cred "gemini:antigravity:$email"
                            if ($json.token -and (-not $existingSpec -or -not $existingSpec.Value -or $data.LastWritten -gt $existingSpec.LastWritten)) {
                                $null = Write-Cred "gemini:antigravity:$email" "antigravity" $data.Value
                            }
                        }

                        $hasRt = [bool]($json.token -and $json.token.refresh_token)
                        $lw = [int64]$data.LastWritten
                        $shouldSet = $false
                        if (-not $results.accounts.ContainsKey($email)) {
                            $shouldSet = $true
                        } else {
                            $prev = $accountMeta[$email]
                            if ($hasRt -and -not $prev.hasRt) {
                                $shouldSet = $true
                            } elseif ($hasRt -eq $prev.hasRt -and $lw -gt $prev.lastWritten) {
                                $shouldSet = $true
                            } elseif ($hasRt -eq $prev.hasRt -and $lw -eq $prev.lastWritten -and $target -ne 'gemini:antigravity') {
                                $shouldSet = $true
                            }
                        }
                        if ($shouldSet) {
                            $results.accounts[$email] = @{
                                email = $email
                                source = "credential-manager"
                                target = $target
                                token = $json.token
                                auth_method = $json.auth_method
                            }
                            $accountMeta[$email] = @{
                                lastWritten = $lw
                                hasRt = $hasRt
                                target = $target
                            }
                        }
                    }
                } catch {}
            }
        }
    } finally {
        [AgyMultiCredCollector.NativeMethods]::CredFree($ptrArray)
    }
}

# 2. Check default target explicitly if not captured
if (-not $results.defaultTargetEmail) {
    $def = Read-Cred 'gemini:antigravity'
    if ($def -and $def.Value) {
        try {
            $j = $def.Value | ConvertFrom-Json
            if ($j.id_token_email) {
                $defEmail = [string]$j.id_token_email
                $results.defaultTargetEmail = $defEmail
                if (-not $results.accounts.ContainsKey($defEmail)) {
                    $results.accounts[$defEmail] = @{
                        email = $defEmail
                        source = "credential-manager"
                        target = "gemini:antigravity"
                        token = $j.token
                        auth_method = $j.auth_method
                    }
                    $accountMeta[$defEmail] = @{
                        lastWritten = [int64]$def.LastWritten
                        hasRt = [bool]($j.token -and $j.token.refresh_token)
                        target = "gemini:antigravity"
                    }
                }
            }
        } catch {}
    }
}

# 3. Check Antigravity IDE state and Antigravity 2.0 app_storage for active accounts and live tokens
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$extractScript = Join-Path $scriptDir "extract-ide-auth.py"
if (Test-Path $extractScript) {
    try {
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
            if ($authObj -and $authObj.agy2_email) {
                $results.appStorageAgy2Account = [string]$authObj.agy2_email
            }
            if ($authObj -and $authObj.email) {
                $ideEmail = [string]$authObj.email
                $results.activeIdeAccount = $ideEmail

                # Check if specific target exists in Credential Manager
                $specCred = Read-Cred "gemini:antigravity:$ideEmail"
                $usedSpec = $false
                if ($specCred -and $specCred.Value) {
                    try {
                        $j = $specCred.Value | ConvertFrom-Json
                        if ($j.token) {
                            $rtChanged = ($authObj.refresh_token -and $j.token.refresh_token -and ($j.token.refresh_token -ne $authObj.refresh_token))
                            if (-not $rtChanged) {
                                if ($authObj.refresh_token -and -not $j.token.refresh_token) {
                                    $j.token.refresh_token = $authObj.refresh_token
                                }
                                if (-not $results.accounts.ContainsKey($ideEmail) -or -not $results.accounts[$ideEmail].token -or ($authObj.refresh_token -and -not $results.accounts[$ideEmail].token.refresh_token)) {
                                    $results.accounts[$ideEmail] = @{
                                        email = $ideEmail
                                        source = "credential-manager"
                                        target = "gemini:antigravity:$ideEmail"
                                        token = $j.token
                                        auth_method = $j.auth_method
                                    }
                                }
                                $usedSpec = $true
                            }
                        }
                    } catch {}
                }

                if (-not $usedSpec -and (-not $results.accounts.ContainsKey($ideEmail) -or -not $results.accounts[$ideEmail].token -or ($authObj.refresh_token -and $results.accounts[$ideEmail].token.refresh_token -ne $authObj.refresh_token))) {
                    if ($authObj.access_token -or $authObj.refresh_token) {
                        $tokenObj = @{
                            access_token = $authObj.access_token
                            refresh_token = $authObj.refresh_token
                            token_type = "Bearer"
                            expiry = (Get-Date).ToUniversalTime().AddHours(1).ToString("yyyy-MM-ddTHH:mm:ssZ")
                        }
                        $results.accounts[$ideEmail] = @{
                            email = $ideEmail
                            source = "antigravity-ide-active"
                            target = "gemini:antigravity:$ideEmail"
                            token = $tokenObj
                            auth_method = "consumer"
                        }
                        $credPayload = @{
                            token = $tokenObj
                            auth_method = "consumer"
                            id_token_email = $ideEmail
                        } | ConvertTo-Json -Compress
                        $null = Write-Cred "gemini:antigravity:$ideEmail" "antigravity" $credPayload
                    }
                }
            }
        }
    } catch {}
}

$results.activeAgy2Account = if ($results.defaultTargetEmail) {
    $results.defaultTargetEmail
} elseif ($results.appStorageAgy2Account) {
    $results.appStorageAgy2Account
} else {
    ""
}

if ($results.activeAgy2Account -and -not $results.accounts.ContainsKey($results.activeAgy2Account)) {
    $agy2Cred = Read-Cred "gemini:antigravity:$($results.activeAgy2Account)"
    if ($agy2Cred -and $agy2Cred.Value) {
        try {
            $j2 = $agy2Cred.Value | ConvertFrom-Json
            if ($j2.token) {
                $results.accounts[$results.activeAgy2Account] = @{
                    email = $results.activeAgy2Account
                    source = "credential-manager"
                    target = "gemini:antigravity:$($results.activeAgy2Account)"
                    token = $j2.token
                    auth_method = $j2.auth_method
                }
            }
        } catch {}
    }
}

# 4. Check ADC and agya GCP project
$adcPath = "$env:APPDATA\gcloud\application_default_credentials.json"
if (Test-Path $adcPath) {
    try {
        $adcRaw = [IO.File]::ReadAllText($adcPath)
        $adc = $adcRaw | ConvertFrom-Json
        $agyaCmd = "$env:LOCALAPPDATA\agy\bin\agya.cmd"
        $gcpProject = "project-cd8f7986-520d-4fbc-85f"
        if (Test-Path $agyaCmd) {
            $cmdText = [IO.File]::ReadAllText($agyaCmd)
            if ($cmdText -match 'GOOGLE_CLOUD_PROJECT=([^\r\n]+)') {
                $gcpProject = $matches[1].Trim().Trim('"', "'", ' ')
            }
        }
        $results.gcpProjects[$gcpProject] = @{
            projectId = $gcpProject
            label = "agya (Vertex AI)"
            authType = "adc"
            client_id = $adc.client_id
            client_secret = $adc.client_secret
            refresh_token = $adc.refresh_token
            models = @("gemini-4-argon-high", "gemini-2.0-flash", "gemini-1.5-pro")
        }
    } catch {}
}

[Console]::OutputEncoding = [Text.Encoding]::UTF8
$results | ConvertTo-Json -Depth 6