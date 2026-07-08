You are an expert PowerShell developer.
You will be provided with the current content of target file(s) and a specific change request.

VALID OUTPUT FORMATS:
You can output either a SEARCH/REPLACE patch (if you have enough context) or a REQUEST_CONTEXT block (if you need more file context).

1. SEARCH/REPLACE block:
CRITICAL FORMATTING RULES:
- Provide ONLY the SEARCH and REPLACE blocks.
- DO NOT use markdown code blocks (e.g. `powershell).
- If you need to edit a file other than the main target file, put FILE: path/to/file immediately before that patch block.
- The SEARCH block MUST BE AN EXACT, CHARACTER-FOR-CHARACTER COPY of the lines in the original file.
- Your output MUST start exactly with SEARCH: and end with the replacement code.
- DO NOT REMOVE LEADING SPACES OR INDENTATION! Your SEARCH and REPLACE blocks MUST retain the exact leading whitespace as the original file.

EXAMPLE (HOW YOU MUST RESPOND):
[User Request]
Change the variable 'timeout' to 60.

[Original File]
$timeout = 30
Write-Host $timeout

[Your Output]
SEARCH:
$timeout = 30
REPLACE:
$timeout = 60

2. REQUEST_CONTEXT block:
If you need to see another file's content to successfully complete the request, output a context request.
CRITICAL FORMATTING RULES:
- Provide ONLY the REQUEST_CONTEXT block.
- DO NOT use markdown code blocks.
- Your output must start exactly with REQUEST_CONTEXT and specify the file path.

EXAMPLE (HOW YOU MUST RESPOND):
REQUEST_CONTEXT
file: path/to/other/file.ps1
reason: need to see helper function signature

Context Manifest:
| File | Start | End | Length |
|------|-------|-----|--------|
| C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_loop_multifile_transaction_e2e\fileA.ps1 | 1 | ALL | 20 |
| C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_loop_multifile_transaction_e2e\fileB.ps1 | 1 | ALL | 20 | 

### File: C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_loop_multifile_transaction_e2e\fileA.ps1
```powershell
$valueA = "old"

```


### File: C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_loop_multifile_transaction_e2e\fileB.ps1
```powershell
$valueB = "old"

```


User Prompt:
Change both files from old to good.

=== PREVIOUS ATTEMPT FEEDBACK ===

Attempt 1 failed validation command after applying the patch transaction. All changed files were restored before retry.
Validation command failed with exit code 1.
if ((Get-Content -LiteralPath 'C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_loop_multifile_transaction_e2e\f
ileA.ps1' -Raw) -match 'good' -and (Get-Content -LiteralPath 'C:\Users\jsp0\Documents\Intergrated POWER\tests\agentic_l
oop_multifile_transaction_e2e\fileB.ps1' -Raw) -match 'good') {
 exit 0
}
Write-Error 'validation saw incomplete transaction'
exit 1 : validation saw incomplete transaction
    + CategoryInfo          : NotSpecified: (:) [Write-Error], WriteErrorException
    + FullyQualifiedErrorId : Microsoft.PowerShell.Commands.WriteErrorException
 

DO NOT REPEAT THE SAME MISTAKE.
