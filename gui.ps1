param (
    [string]$ExecutablePath = "node.exe"
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Colors
$cWhite = [System.Drawing.Color]::White
$cRed = [System.Drawing.Color]::Red
$cYellow = [System.Drawing.Color]::Yellow
$cGreen = [System.Drawing.Color]::LimeGreen

# Create Form
$form = New-Object System.Windows.Forms.Form
$form.Text = "Roblox to Steam Shortcut"
$form.Size = New-Object System.Drawing.Size(600, 450)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false

# Label
$label = New-Object System.Windows.Forms.Label
$label.Text = "Roblox Game URL:"
$label.Location = New-Object System.Drawing.Point(20, 20)
$label.Size = New-Object System.Drawing.Size(540, 20)
$form.Controls.Add($label)

# Input Box
$urlInput = New-Object System.Windows.Forms.TextBox
$urlInput.Location = New-Object System.Drawing.Point(20, 45)
$urlInput.Size = New-Object System.Drawing.Size(440, 25)
$form.Controls.Add($urlInput)

# Button
$addButton = New-Object System.Windows.Forms.Button
$addButton.Text = "Add to Steam"
$addButton.Location = New-Object System.Drawing.Point(470, 44)
$addButton.Size = New-Object System.Drawing.Size(90, 25)
$form.Controls.Add($addButton)

# Log Box (RichTextBox allows colored lines)
$logBox = New-Object System.Windows.Forms.RichTextBox
$logBox.Location = New-Object System.Drawing.Point(20, 90)
$logBox.Size = New-Object System.Drawing.Size(540, 300)
$logBox.ScrollBars = "Vertical"
$logBox.ReadOnly = $true
$logBox.Font = New-Object System.Drawing.Font("Consolas", 9)
$logBox.BackColor = [System.Drawing.Color]::Black
$logBox.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($logBox)

# Helper: write one colored line to the log
function Write-Log {
    param(
        [string]$Text,
        [System.Drawing.Color]$Color
    )
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.SelectionLength = 0
    $logBox.SelectionColor = $Color
    $logBox.AppendText($Text + "`r`n")
    $logBox.SelectionColor = $logBox.ForeColor
    $logBox.SelectionStart = $logBox.TextLength
    $logBox.ScrollToCaret()
}

# Button Click Event
$addButton.Add_Click({
        $url = $urlInput.Text
        if ([string]::IsNullOrWhiteSpace($url)) {
            Write-Log "Please enter a Roblox Game URL." $cRed
            return
        }

        $addButton.Enabled = $false
        Write-Log "Processing... Please wait." $cWhite
        $form.Refresh() # Force UI update

        try {
            $pinfo = New-Object System.Diagnostics.ProcessStartInfo
            $pinfo.FileName = $ExecutablePath
            if ($ExecutablePath -eq "node.exe") {
                $pinfo.Arguments = "src/main.js --add `"$url`""
                            $pinfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
            $pinfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

            }
            else {
                $pinfo.Arguments = "--add `"$url`""
            }
            $pinfo.RedirectStandardOutput = $true
            $pinfo.RedirectStandardError = $true
            $pinfo.UseShellExecute = $false
            $pinfo.CreateNoWindow = $true
            $pinfo.WorkingDirectory = $PSScriptRoot

            $p = New-Object System.Diagnostics.Process
            $p.StartInfo = $pinfo
            $p.Start() | Out-Null

            $output = $p.StandardOutput.ReadToEnd()
            $errText = $p.StandardError.ReadToEnd()

            $p.WaitForExit()

            # Decide: was there an error?
            $hasError = ($p.ExitCode -ne 0) -or ($errText -match "Error")

            Write-Log "----------------------------------------" $cWhite

            if ($output) {
                if ($hasError) {
                    Write-Log $output.TrimEnd() $cWhite
                }
                else {
                    Write-Log $output.TrimEnd() $cGreen
                }
            }
            if ($errText) {
                Write-Log "ERROR:" $cRed
                Write-Log $errText.TrimEnd() $cRed
            }

            Write-Log "----------------------------------------" $cWhite

            if ($hasError) {
                Write-Log "Failed to add to Steam." $cYellow
            }
            else {
                Write-Log "Done." $cGreen
            }
        }
        catch {
            Write-Log "Error executing script: $_" $cRed
            Write-Log "Failed to add to Steam." $cYellow
        }
        finally {
            $addButton.Enabled = $true
        }
    })

# Show Form
$form.ShowDialog() | Out-Null
